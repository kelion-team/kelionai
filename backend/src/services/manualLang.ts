// ── TRADUCEREA UNUI SET DE TEXTE, DINTR-UN SINGUR APEL ──────────────────────
//
// Adrian, 30 iul: „nu sunt doar 5 limbi, sunt X limbi". Deci nu un dicționar
// scris de mână — engleza e sursa, orice altă limbă se traduce la cerere și se
// ține în bază.
//
// PRIMA VARIANTĂ N-A MERS, și merită scris de ce: folosea `translateMany`, care
// face UN APEL DE REȚEA PER TEXT. Manualul are ~120 de texte → 120 de cereri
// simultane la fiecare limbă nouă. Furnizorul le limitează, o parte cad, iar
// garda „măcar jumătate traduse" respingea tot → se întorcea engleză curată.
// Verificat pe live: /api/manual?lang=es dădea titlul în engleză. Ruta răspundea
// 200 și nu făcea nimic — exact felul de „merge" care nu merge.
//
// Acum: textele se trimit ÎN LOTURI NUMEROTATE, un apel per lot. 120 de texte =
// 2 apeluri, nu 120.
//
// Cheia de cache include AMPRENTA textelor engleze: când se schimbă un text în
// cod, amprenta se schimbă și limba se re-traduce singură. Fără asta,
// traducerile ar îngheța la prima versiune și ar minți tăcut după fiecare deploy.
import { createHash } from 'node:crypto'
import { config } from '../config.js'
import { loadKv, saveKv } from '../db.js'
import { openrouterComplete } from './openrouter.js'

const inLucru = new Map<string, Promise<Record<string, string>>>()

const amprenta = (texte: Record<string, string>): string =>
  createHash('sha256')
    .update(JSON.stringify(Object.keys(texte).sort().map((k) => [k, texte[k]])))
    .digest('hex')
    .slice(0, 12)

/** NUMELE limbii, nu codul — bug prins verificând live pe 30 iul: italiana
 *  întorcea text SPANIOL, iar româna rămânea în engleză.
 *
 *  Cauza: trimiteam modelului „Translate into it" / „into ro". Pentru un model,
 *  „it" e pronumele englezesc, nu italiana; „ro" nu înseamnă nimic. Codul de
 *  limbă e pentru mașini; cererea de traducere e text pentru un cititor, deci
 *  cere numele scris. */
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
}

const numeLimba = (cod: string): string => NUME_LIMBA[cod] ?? cod

/** Codul de limbă normalizat („pt-BR" → „pt"), fără gunoi. */
export function normalizeLang(v: string): string {
  const s = String(v ?? '').trim().toLowerCase().split(/[-_]/)[0]
  return /^[a-z]{2,3}$/.test(s) ? s : ''
}

/** Traduce un lot într-un singur apel. Întoarce null dacă nu iese o listă de
 *  ACEEAȘI lungime — mai bine engleză întreagă decât o traducere decalată, în
 *  care fiecare rând ajunge sub alt titlu. */
async function traduceLot(valori: string[], lang: string): Promise<(string | null)[] | null> {
  const numerotat = valori.map((v, i) => `${i + 1}. ${v.replace(/\s*\n+\s*/g, ' ')}`).join('\n')
  const r = await openrouterComplete(
    config.openrouter.searchModel,
    [
      {
        role: 'user',
        content:
          `Translate each numbered line into ${numeLimba(lang)}. Keep the exact same numbering: ` +
          'every output line must start with its number, and there must be exactly one output line per input line. ' +
          'Translate naturally, the way a native speaker would write it in a product manual. ' +
          'Lines in quotation marks are example phrases a user would say out loud — translate them as natural speech and keep the quotes. ' +
          'Keep the product name "Kelionai" and the assistant name "Kelion" exactly as they are — never translate or alter them. ' +
          'No commentary, no preamble.\n\n' +
          numerotat,
      },
    ],
    { temperature: 0, maxTokens: 8000 },
  ).catch(() => null)
  if (!r?.text) return null

  // POTRIVIRE DUPĂ NUMĂR, nu după numărătoare. Garda de dinainte era „totul sau
  // nimic": dacă modelul întorcea fie și un rând în plus sau în minus, aruncam
  // TOATĂ limba — iar limba aia se reîncerca la fiecare cerere și pica la fel.
  // Româna a stat blocată așa (verificat live, 30 iul: „ÎNCĂ" minute la rând,
  // în timp ce celelalte șase erau gata).
  //
  // Acum fiecare rând se așază la INDEXUL lui, luat din numărul cu care începe.
  // Ce lipsește rămâne în engleză — un rând netradus într-o pagină tradusă e
  // supărător, o limbă întreagă blocată e o funcție moartă.
  const out: (string | null)[] = new Array(valori.length).fill(null)
  let puse = 0
  for (const linie of r.text.split('\n')) {
    const m = linie.trim().match(/^(\d+)[.)]\s*(.+)$/)
    if (!m) continue
    const idx = Number(m[1]) - 1
    if (idx < 0 || idx >= valori.length || out[idx] !== null) continue
    out[idx] = m[2].trim()
    puse++
  }
  // Sub trei sferturi traduse înseamnă că răspunsul e rupt, nu doar incomplet.
  return puse >= Math.ceil(valori.length * 0.75) ? out : null
}

/**
 * Textele date, în limba cerută. `sursa` = perechile cheie→text ENGLEZ.
 * Întoarce doar cheile traduse; apelantul le pune peste engleză.
 */
/** E deja tradus și pus deoparte? Ruta întreabă asta ca să poată răspunde
 *  INSTANT cu ce are, în loc să țină userul într-o cerere de un minut. */
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

  // v2 în cheie: traducerile salvate ÎNAINTE de reparație sunt greșite (italiana
  // era spaniolă, româna era engleză) și ar rămâne în bază pe veci. Schimbarea
  // versiunii le lasă acolo, dar nimeni nu le mai citește — se traduce din nou.
  const cheieKv = `tr3:${cod}:${amprenta(sursa)}`
  const salvat = await loadKv(cheieKv).catch(() => null)
  if (salvat) {
    try {
      return JSON.parse(salvat) as Record<string, string>
    } catch {
      /* intrare coruptă → traducem din nou */
    }
  }

  // Cererile sosite în timp ce se traduce așteaptă ACEEAȘI promisiune, nu
  // pornesc încă o traducere pentru aceeași limbă.
  const inCurs = inLucru.get(cheieKv)
  if (inCurs) return inCurs

  const treaba = (async (): Promise<Record<string, string>> => {
    try {
      const valori = chei.map((k) => sursa[k])
      // Loturi de 40: destul de mari ca să fie puține apeluri, destul de mici ca
      // modelul să nu piardă numerotarea pe drum.
      //
      // ÎN PARALEL, nu unul după altul (măsurat pe live: în serie, franceza a
      // durat peste 100 de secunde și cererea a expirat — adică userul alegea
      // limba și nu se schimba nimic pe ecran). Loturile sunt independente:
      // fiecare are numerotarea lui. Așa durata totală e cea a celui mai lent
      // lot, nu suma lor.
      const LOT = 40
      const felii: string[][] = []
      for (let i = 0; i < valori.length; i += LOT) felii.push(valori.slice(i, i + LOT))
      const rezultate = await Promise.all(felii.map((f) => traduceLot(f, cod)))
      if (rezultate.some((r) => r == null)) return {} // lot rupt de tot → engleză
      const out: Record<string, string> = {}
      rezultate.forEach((traduse, idxFelie) => {
        traduse!.forEach((v, j) => {
          if (v) out[chei[idxFelie * LOT + j]] = v
        })
      })
      // Se salvează dacă marea majoritate e tradusă; golurile rămân engleză.
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
