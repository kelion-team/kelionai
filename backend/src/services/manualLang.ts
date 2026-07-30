// ── INTERFAȚA ÎN ORICÂTE LIMBI, DINTR-O SINGURĂ SURSĂ ───────────────────────
//
// Adrian, 30 iul: „nu sunt doar 5 limbi, sunt X limbi după ce se detectează
// limba userului". Corect — și de-aia un dicționar scris de mână NU e soluția:
// pagina promite „zeci de limbi", iar de mână nu ții pasul niciodată. Ce s-a
// întâmplat până acum e dovada: 7 limbi în dicționar și ~290 de texte rămase
// scrise direct în cod, fiindcă era mai ușor decât să traduci tot în 7 limbi.
//
// Regula nouă, una singură:
//   • ENGLEZA e sursa, în cod, completă. Atât scrie omul.
//   • Orice altă limbă se TRADUCE — o dată, la prima cerere — și se ține în
//     bază. Al doilea user care vorbește limba aia o primește instantaneu.
//   • Dacă traducerea pică, se întoarce engleza. Niciodată o rubrică goală.
//
// Cheia de cache include AMPRENTA textelor engleze: când se schimbă un text în
// cod, amprenta se schimbă și limba se re-traduce singură. Fără asta,
// traducerile ar îngheța la prima versiune și ar minți tăcut după fiecare
// deploy — exact felul de eroare pe care n-o vede nimeni luni de zile.
import { createHash } from 'node:crypto'
import { loadKv, saveKv } from '../db.js'
import { translateMany } from './google.js'

/** Traducerea unei limbi durează (un apel per text). Cererile care sosesc în
 *  timpul ăsta așteaptă ACEEAȘI promisiune, nu pornesc încă o traducere. */
const inLucru = new Map<string, Promise<Record<string, string>>>()

const amprenta = (texte: Record<string, string>): string =>
  createHash('sha256')
    .update(JSON.stringify(Object.keys(texte).sort().map((k) => [k, texte[k]])))
    .digest('hex')
    .slice(0, 12)

/** Limba normalizată la codul de bază („pt-BR" → „pt"), fără gunoi. */
export function normalizeLang(v: string): string {
  const s = String(v ?? '').trim().toLowerCase().split(/[-_]/)[0]
  return /^[a-z]{2,3}$/.test(s) ? s : ''
}

/**
 * Textele interfeței în limba cerută. `sursa` = perechile cheie→text ENGLEZ,
 * trimise de aplicație (dicționarul trăiește în frontend, unde îi e locul).
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

  const inCurs = inLucru.get(cheieKv)
  if (inCurs) return inCurs

  const treaba = (async (): Promise<Record<string, string>> => {
    try {
      const valori = chei.map((k) => sursa[k])
      const traduse = await translateMany(valori, cod)
      const out: Record<string, string> = {}
      traduse.forEach((v, i) => {
        // `translateMany` întoarce textul ORIGINAL când traducerea eșuează.
        // Nu-l salvăm ca „tradus": ar îngheța engleza în cache pentru limba aia
        // și n-ar mai fi reîncercată niciodată.
        if (v && v !== valori[i]) out[chei[i]] = v
      })
      // Salvăm doar dacă am tradus MĂCAR jumătate — altfel a picat serviciul, iar
      // o traducere ciuntită înghețată în bază e mai rea decât engleza curată.
      if (Object.keys(out).length >= chei.length / 2) {
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
