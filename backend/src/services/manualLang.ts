// ── TRANSLATING A SET OF TEXTS IN A SINGLE CALL ─────────────────────────────
//
// Adrian, Jul 30: "it's not just 5 languages, it's X languages". So no
// hand-written dictionary — English is the source, any other language is
// translated on demand and kept in the database.
//
// THE FIRST VERSION DIDN'T WORK, and it's worth writing down why: it used
// `translateMany`, which makes ONE NETWORK CALL PER TEXT. The manual has ~120
// texts → 120 simultaneous requests for every new language. The provider rate-
// limits them, some fail, and the "at least half translated" guard rejected
// everything → clean English came back. Verified live: /api/manual?lang=es
// returned the title in English. The route answered 200 and did nothing —
// exactly the kind of "works" that doesn't work.
//
// Now: texts are sent IN NUMBERED BATCHES, one call per batch. 120 texts =
// 2 calls, not 120.
//
// The cache key includes the FINGERPRINT of the English texts: when a text
// changes in code, the fingerprint changes and the language re-translates
// itself. Without that, translations would freeze at the first version and
// silently lie after every deploy.
import { createHash } from 'node:crypto'
import { config } from '../config.js'
import { loadKv, saveKv } from '../db.js'
import { rationeazaMesaje } from './creierRationament.js'

const inLucru = new Map<string, Promise<Record<string, string>>>()

const amprenta = (texte: Record<string, string>): string =>
  createHash('sha256')
    .update(JSON.stringify(Object.keys(texte).sort().map((k) => [k, texte[k]])))
    .digest('hex')
    .slice(0, 12)

/** The language NAME, not the code — a bug caught verifying live on Jul 30:
 *  Italian returned SPANISH text, and Romanian stayed in English.
 *
 *  The cause: we sent the model "Translate into it" / "into ro". To a model,
 *  "it" is the English pronoun, not Italian; "ro" means nothing. The language
 *  code is for machines; the translation request is text for a reader, so ask
 *  for the written name. */
const NUME_LIMBA: Record<string, string> = {
  en: 'English',
  fr: 'French',
  de: 'German',
  es: 'Spanish',
  it: 'Italian',
  ru: 'Russian',
  ro: 'Romanian',
  pt: 'Portuguese',
  nl: 'Dutch',
  pl: 'Polish',
  zh: 'Chinese (Simplified)',
  ar: 'Arabic',
  ja: 'Japanese',
  tr: 'Turkish',
  uk: 'Ukrainian',
  hi: 'Hindi',
  ko: 'Korean',
}

const numeLimba = (cod: string): string => NUME_LIMBA[cod] ?? cod

/** The normalized language code ("pt-BR" → "pt"), without garbage. */
export function normalizeLang(v: string): string {
  const s = String(v ?? '').trim().toLowerCase().split(/[-_]/)[0]
  return /^[a-z]{2,3}$/.test(s) ? s : ''
}

/** Translates one batch in a single call. Returns null unless a list of the
 *  SAME length comes out — better full English than a shifted translation
 *  where every line lands under the wrong heading. */
async function traduceLot(valori: string[], lang: string): Promise<(string | null)[] | null> {
  // Fără cheie → null → engleza rămâne (nu simulăm o traducere).
  if (!config.openai.key) return null
  const numerotat = valori.map((v, i) => `${i + 1}. ${v.replace(/\s*\n+\s*/g, ' ')}`).join('\n')
  const r = await rationeazaMesaje(
    [
      {
        role: 'user',
        content:
          `Translate each numbered line into ${numeLimba(lang)}. Keep the exact same numbering: ` +
          'every output line must start with its number, and there must be exactly one output line per input line. ' +
          'Translate naturally, the way a native speaker would write it in a product manual. ' +
          'Lines in quotation marks are example phrases a user would say out loud ? translate them as natural speech and keep the quotes. ' +
          'Keep the product name "Kelionai" and the assistant name "Kelion" exactly as they are ? never translate or alter them. ' +
          'No commentary, no preamble.\n\n' +
          numerotat,
      },
    ],
    {
      ruta: 'service.manualLang', treapta: 'rapid', temperature: 0, maxTokens: 8000, tools: [],
      usageContext: { userEmail: 'system', surface: 'manual_translation' },
    },
  ).catch(() => null)
  if (!r?.text) return null

  // MATCH BY NUMBER, not by counting. The previous guard was "all or nothing":
  // if the model returned even one line too many or too few, we threw away the
  // WHOLE language — and that language was retried on every request and failed
  // the same way. Romanian stayed stuck like that (verified live, Jul 30:
  // "STILL" for minutes on end, while the other six were done).
  //
  // Now each line sits at ITS index, taken from the number it starts with.
  // What is missing stays in English — one untranslated line in a translated
  // page is annoying; a whole blocked language is a dead feature.
  const out: (string | null)[] = Array.from({ length: valori.length }, () => null)
  let puse = 0
  for (const linie of r.text.split('\n')) {
    const m = linie.trim().match(/^(\d+)[.)]\s*(.+)$/)
    if (!m) continue
    const idx = Number(m[1]) - 1
    if (idx < 0 || idx >= valori.length || out[idx] !== null) continue
    out[idx] = m[2].trim()
    puse++
  }
  // Under three quarters translated means the answer is broken, not just incomplete.
  return puse >= Math.ceil(valori.length * 0.75) ? out : null
}

/**
 * The given texts, in the requested language. `sursa` = the key→ENGLISH text
 * pairs. Returns only the translated keys; the caller layers them over English.
 */
/** Already translated and put aside? The route asks this so it can answer
 *  INSTANTLY with what it has, instead of holding the user in a one-minute
 *  request. */
export async function translationReady(
  lang: string,
  sursa: Record<string, string>,
): Promise<Record<string, string> | null> {
  const cod = normalizeLang(lang)
  if (!cod || cod === 'en') return {}
  const salvat = await loadKv(`tr3:${cod}:${amprenta(sursa)}`).catch(() => null)
  if (!salvat) return null
  try {
    return JSON.parse(salvat) as Record<string, string>
  } catch {
    return null
  }
}

export async function translateStrings(
  lang: string,
  sursa: Record<string, string>,
): Promise<Record<string, string>> {
  const cod = normalizeLang(lang)
  if (!cod || cod === 'en') return {}
  const chei = Object.keys(sursa)
  if (!chei.length) return {}

  // v2 in the key: translations saved BEFORE the fix are wrong (Italian was
  // Spanish, Romanian was English) and would stay in the database forever.
  // Bumping the version leaves them there, but nobody reads them anymore — the
  // translation is redone.
  const cheieKv = `tr3:${cod}:${amprenta(sursa)}`
  const salvat = await loadKv(cheieKv).catch(() => null)
  if (salvat) {
    try {
      return JSON.parse(salvat) as Record<string, string>
    } catch {
      /* corrupted entry → translate again */
    }
  }

  // Requests arriving while a translation runs await the SAME promise instead
  // of starting another translation for the same language.
  const inCurs = inLucru.get(cheieKv)
  if (inCurs) return inCurs

  const treaba = (async (): Promise<Record<string, string>> => {
    try {
      const valori = chei.map((k) => sursa[k])
      // Batches of 40: big enough to keep the call count low, small enough that
      // the model doesn't lose the numbering along the way.
      //
      // IN PARALLEL, not one after another (measured live: in series, French
      // took over 100 seconds and the request timed out — i.e. the user picked
      // the language and nothing changed on screen). The batches are
      // independent: each has its own numbering. That way the total time is
      // that of the slowest batch, not their sum.
      const LOT = 40
      const felii: string[][] = []
      for (let i = 0; i < valori.length; i += LOT) felii.push(valori.slice(i, i + LOT))
      const rezultate = await Promise.all(felii.map((f) => traduceLot(f, cod)))
      if (rezultate.some((r) => r == null)) return {} // batch broken entirely → English
      const out: Record<string, string> = {}
      rezultate.forEach((traduse, idxFelie) => {
        traduse!.forEach((v, j) => {
          if (v) out[chei[idxFelie * LOT + j]] = v
        })
      })
      // Saved when the vast majority is translated; the gaps stay English.
      if (Object.keys(out).length >= Math.ceil(chei.length * 0.9)) {
        await saveKv(cheieKv, JSON.stringify(out)).catch(() => {})
      }
      return out
    } catch {
      return {}
    } finally {
      inLucru.delete(cheieKv)
    }
  })()

  inLucru.set(cheieKv, treaba)
  return treaba
}
