// ── #2 CITIT PE BUZE (owner, 22 aug 2026: „uimește-mă") ──────────────────────
//
// Comunicare silentă în ședințe: miști buzele, Kelion citește ce spui prin
// lip-reading (MediaPipe Face Mesh are deja landmark-uri pe gură) și
// răspunde prin text pe ecran sau vibrație pe telefon.
//
// NU e lip-reading complet — e detectare de FORME de gură pentru cuvinte
// simple (da, nu, ajutor, oprește, bine). Pe baza distanțelor dintre
// landmark-urile buzelor (face-api.js 68-point model, punctele 48-67).

export type CuvantBuze = 'da' | 'nu' | 'ajutor' | 'opreste' | 'bine' | 'salut' | null

export interface RezultatCitireBuze {
  cuvant: CuvantBuze
  incredere: number // 0-1
  ts: number
}

const INTERVAL_MS = 500 // verifică la 500ms
const PRAG_INCREDERE = 0.6 // hardcod-permis: prag tehnic de încredere
let inMers = false
let timer: ReturnType<typeof setInterval> | null = null
let ultimaDetectie: CuvantBuze = null
let ultimaTs = 0

/** Detectează cuvântul din forma buzelor. Geometrie pură pe landmark-uri. */
export function citesteBuzeDinLandmark(
  landmark: { positions: Array<{ x: number; y: number }> } | null,
): RezultatCitireBuze {
  if (!landmark) return { cuvant: null, incredere: 0, ts: Date.now() }
  const pts = landmark.positions
  if (!pts || pts.length < 68) return { cuvant: null, incredere: 0, ts: Date.now() }
  const ts = Date.now()

  // Puncte cheie gură (face-api.js 68-point):
  // 48 = colț stâng, 54 = colț drept, 51 = buza superioară centru, 57 = buza inferioară centru
  // 62 = centru gură (între buze), 66 = același
  const coltStang = pts[48]
  const coltDrept = pts[54]
  const buzaSus = pts[51]
  const buzaJos = pts[57]

  const latimeGura = Math.abs(coltDrept.x - coltStang.x)
  const inaltimeGura = Math.abs(buzaJos.y - buzaSus.y)
  if (latimeGura < 1) return { cuvant: null, incredere: 0, ts }

  // Raport aspect: 0 = gură închisă, >0.3 = gură deschisă
  const raport = inaltimeGura / latimeGura

  // Forme de gură:
  // „DA" — gură ușor deschisă, colțurile sus (zâmbet mic), raport ~0.2
  // „NU" — gură închisă, colțurile jos, raport <0.1
  // „AJUTOR" — gură larg deschisă, raport >0.4
  // „OPREȘTE" — buzele strânse, raport <0.05, lățime mică
  // „BINE" — zâmbet larg, colțurile sus, raport ~0.15
  // „SALUT" — gură moderat deschisă, raport ~0.3

  const ridicareColturi = ((coltStang.y + coltDrept.y) / 2 - buzaSus.y) / latimeGura

  let cuvant: CuvantBuze = null
  let incredere = 0

  if (raport > 0.4) {
    cuvant = 'ajutor'
    incredere = Math.min(1, (raport - 0.4) * 3)
  } else if (raport > 0.25 && ridicareColturi > 0.1) {
    cuvant = 'salut'
    incredere = Math.min(1, (raport - 0.25) * 4 + ridicareColturi)
  } else if (raport > 0.15 && ridicareColturi > 0.15) {
    cuvant = 'bine'
    incredere = Math.min(1, ridicareColturi * 3)
  } else if (raport > 0.15 && ridicareColturi < 0) {
    cuvant = 'da'
    incredere = Math.min(1, (0.15 - Math.abs(ridicareColturi)) * 5)
  } else if (raport < 0.08 && ridicareColturi < -0.05) {
    cuvant = 'nu'
    incredere = Math.min(1, (0.08 - raport) * 10 + Math.abs(ridicareColturi) * 5)
  } else if (raport < 0.05) {
    cuvant = 'opreste'
    incredere = Math.min(1, (0.05 - raport) * 15)
  }

  if (incredere < PRAG_INCREDERE) return { cuvant: null, incredere: 0, ts }
  return { cuvant, incredere, ts }
}

/** Pornește cititul pe buze. Primește o funcție care întoarce landmark-ul curent. */
export function pornesteCititBuze(
  obtineLandmark: () => Promise<{ positions: Array<{ x: number; y: number }> } | null>,
  laCuvant: (rez: RezultatCitireBuze) => void,
): void {
  if (inMers) return
  inMers = true
  timer = setInterval(async () => {
    if (document.hidden) return
    try {
      const lm = await obtineLandmark()
      const rez = citesteBuzeDinLandmark(lm)
      // Trimite doar cuvinte noi (nu repeta același cuvânt continuu)
      if (rez.cuvant && rez.cuvant !== ultimaDetectie) {
        ultimaDetectie = rez.cuvant
        ultimaTs = rez.ts
        laCuvant(rez)
      } else if (!rez.cuvant && Date.now() - ultimaTs > 2000) {
        // Reset după 2s de tăcere — permite detectarea aceluiași cuvânt din nou
        ultimaDetectie = null
      }
    } catch { /* tăcut */ }
  }, INTERVAL_MS)
}

/** Oprește cititul pe buze. */
export function opresteCititBuze(): void {
  inMers = false
  if (timer) { clearInterval(timer); timer = null }
}
