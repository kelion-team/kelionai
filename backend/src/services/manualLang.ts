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

/** Codul de limbă normalizat („pt-BR" → „pt"), fără gunoi. */
export function normalizeLang(v: string): string {
  const s = String(v ?? '').trim().toLowerCase().split(/[-_]/)[0]
  return /^[a-z]{2,3}$/.test(s) ? s : ''
}

/** Traduce un lot într-un singur apel. Întoarce null dacă nu iese o listă de
 *  ACEEAȘI lungime — mai bine engleză întreagă decât o traducere decalată, în
 *  care fiecare rând ajunge sub alt titlu. */
async function traduceLot(valori: string[], lang: string): Promise<string[] | null> {
  const numerotat = valori.map((v, i) => `${i + 1}. ${v.replace(/\s*\n+\s*/g, ' ')}`).join('\n')
  const r = await openrouterComplete(
    config.openrouter.searchModel,
    [
      {
        role: 'user',
        content:
          `Translate each numbered line into ${lang}. Keep the exact same numbering and the same number of lines. ` +
          'Translate naturally, the way a native speaker would write it in a product manual. ' +
          'Lines in quotation marks are example phrases a user would say out loud — translate them as natural speech and keep the quotes. ' +
          'Do not add, merge or drop lines. No commentary, no preamble.\n\n' +
          numerotat,
      },
    ],
    { temperature: 0, maxTokens: 8000 },
  ).catch(() => null)
  if (!r?.text) return null
  const linii = r.text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^\d+[.)]\s/.test(l))
    .map((l) => l.replace(/^\d+[.)]\s*/, '').trim())
  return linii.length === valori.length ? linii : null
}

/**
 * Textele date, în limba cerută. `sursa` = perechile cheie→text ENGLEZ.
 * Întoarce doar cheile traduse; apelantul le pune peste engleză.
 */
export async function translateStrings(
  lang: string,
  sursa: Record<string, string>,
): Promise<Record<string, string>> {
  const cod = normalizeLang(lang)
  if (!cod || cod === 'en') return {}
  const chei = Object.keys(sursa)
  if (!chei.length) return {}

  const cheieKv = `tr:${cod}:${amprenta(sursa)}`
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
      const LOT = 40
      const out: Record<string, string> = {}
      for (let i = 0; i < valori.length; i += LOT) {
        const traduse = await traduceLot(valori.slice(i, i + LOT), cod)
        if (!traduse) return {} // un lot ratat = manual decalat; mai bine engleză
        traduse.forEach((v, j) => {
          if (v) out[chei[i + j]] = v
        })
      }
      if (Object.keys(out).length === chei.length) {
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
