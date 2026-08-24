import { apiFetch } from './transport'

// Acest modul analizează LOCAL fluxul deja deschis de sesiunea vocală. Nu cere
// un al doilea microfon și nu trimite audio brut. FFT-ul oferă numai INDICII
// grosiere (liniște / posibilă voce ori muzică / zgomot brusc), nu poate afirma
// că a identificat o alarmă, plâns, sticlă spartă sau alt eveniment semantic.
//
// ARHITECTURĂ:
//   - Web Audio API + AnalyserNode (FFT 1024) — gratis, 0ms, fără biblioteci
//   - Analiză spectrală: energie pe benzi (bass pentru bubuituri, mid pentru
//     voce, high pentru alarme/sonerii)
//   - Detectare eveniment: salt brusc de energie > prag → eveniment
//   - Clasificare grosieră, explicit euristică: liniște / posibilă conversație /
//     posibilă muzică / zgomot brusc.
//   - Trimite numai indiciile la /api/auz/eveniment cu intensitate + timestamp.
//   - NU trimite audio brut — doar metadate (bandă minimă, privacy)

export interface EvenimentSonor {
  ts: number
  tip: 'zgomot_brusc' | 'conversatie_posibila' | 'muzica_posibila' | 'liniste'
  intensitate: number // 0-100
  durataMs: number
  frecventaDominanta: number // Hz
}

const INTERVAL_ANALIZA_MS = 500
const FFT_SIZE = 1024
const PRAG_SALT_BRUSC = 3.0 // raport energie curentă vs medie
const PRAG_LINISTE = 5 // energie sub care e liniște
const PRAG_CONVERSATIE = 25
const PRAG_MUZICA = 40
const FRECVENTA_BASS = 250
const FRECVENTA_MID = 1500
const FRECVENTA_HIGH = 4000

let inMers = false
let audioCtx: AudioContext | null = null
let analyser: AnalyserNode | null = null
let stream: MediaStream | null = null
let timer: ReturnType<typeof setInterval> | null = null
let bufferFrecvente: Uint8Array<ArrayBuffer> | null = null
let bufferTemporal: Float32Array<ArrayBuffer> | null = null
let istoricEnergie: number[] = []
let ultimaClasificare: EvenimentSonor['tip'] = 'liniste'
let ultimaDetectieEveniment = 0
let contorRecurenta = 0

function calculeazaEnergiePeBanda(data: Uint8Array, startBin: number, endBin: number): number {
  let suma = 0
  for (let i = startBin; i < endBin && i < data.length; i++) {
    suma += data[i]
  }
  return endBin > startBin ? suma / (endBin - startBin) : 0
}

function frecventaDominanta(data: Uint8Array, sampleRate: number): number {
  let maxVal = 0
  let maxIdx = 0
  for (let i = 1; i < data.length; i++) {
    if (data[i] > maxVal) {
      maxVal = data[i]
      maxIdx = i
    }
  }
  return (maxIdx * sampleRate) / (2 * data.length)
}

export function clasificaIndiciuSunet(
  energieBass: number,
  energieMid: number,
  energieHigh: number,
): EvenimentSonor['tip'] {
  const total = energieBass + energieMid + energieHigh
  if (total < PRAG_LINISTE) return 'liniste'
  // Energie răspândită în mai multe benzi poate sugera muzică, dar nu o confirmă.
  const benziActive = [energieBass, energieMid, energieHigh].filter((e) => e > PRAG_CONVERSATIE).length
  if (total > PRAG_MUZICA * 2 && benziActive >= 2) return 'muzica_posibila'
  // Banda de vorbire dominantă poate sugera conversație, fără identificare semantică.
  if (energieMid > PRAG_CONVERSATIE && energieMid >= energieBass && energieMid >= energieHigh) return 'conversatie_posibila'
  // Orice alt profil este doar un zgomot neclasificat.
  if (total > PRAG_CONVERSATIE) return 'zgomot_brusc'
  return 'conversatie_posibila'
}

async function trimiteEveniment(ev: EvenimentSonor): Promise<void> {
  try {
    await apiFetch('/api/auz/eveniment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ev),
    })
  } catch {
    // offline — tăcut
  }
}

function tick(): void {
  if (!analyser || !bufferFrecvente || !bufferTemporal || document.hidden) return
  // Gestiunea energiei: pe baterie critică, sare ciclul (analiza FFT consumă)
  // Import dinamic ca să nu încărcăm modulul dacă nu e nevoie
  void import('./energie').then(({ poateRulaVerificare }) => {
    if (!poateRulaVerificare()) return
    tickIntern()
  }).catch(() => tickIntern())
}

function tickIntern(): void {
  if (!analyser || !bufferFrecvente || !bufferTemporal || document.hidden) return
  analyser.getByteFrequencyData(bufferFrecvente)
  analyser.getFloatTimeDomainData(bufferTemporal)
  const sampleRate = audioCtx?.sampleRate ?? 44100
  const binHz = sampleRate / (2 * bufferFrecvente.length)
  const bassEnd = Math.floor(FRECVENTA_BASS / binHz)
  const midEnd = Math.floor(FRECVENTA_MID / binHz)
  const highEnd = Math.floor(FRECVENTA_HIGH / binHz)
  const energieBass = calculeazaEnergiePeBanda(bufferFrecvente, 1, bassEnd)
  const energieMid = calculeazaEnergiePeBanda(bufferFrecvente, bassEnd, midEnd)
  const energieHigh = calculeazaEnergiePeBanda(bufferFrecvente, midEnd, highEnd)
  const energieTotal = energieBass + energieMid + energieHigh
  const fd = frecventaDominanta(bufferFrecvente, sampleRate)
  // Mediere pentru detectare salt brusc
  istoricEnergie.push(energieTotal)
  if (istoricEnergie.length > 20) istoricEnergie.shift()
  const medie = istoricEnergie.reduce((a, b) => a + b, 0) / istoricEnergie.length
  const raport = medie > 1 ? energieTotal / medie : 1
  const acum = Date.now()
  // Detectare eveniment: salt brusc de energie
  if (raport > PRAG_SALT_BRUSC && acum - ultimaDetectieEveniment > 2000) {
    ultimaDetectieEveniment = acum
    if (energieTotal >= PRAG_CONVERSATIE) {
      void trimiteEveniment({
        ts: acum,
        tip: 'zgomot_brusc',
        intensitate: Math.min(100, Math.round(raport * 20)),
        durataMs: INTERVAL_ANALIZA_MS,
        frecventaDominanta: Math.round(fd),
      })
    }
  }
  // Clasificare continuă (pentru context ambiental)
  const clasificare = clasificaIndiciuSunet(energieBass, energieMid, energieHigh)
  if (clasificare !== ultimaClasificare) {
    contorRecurenta++
    ultimaClasificare = clasificare
    // Trimite schimbări de context la fiecare 3 schimbări (nu spam)
    if (contorRecurenta % 3 === 0 && clasificare !== 'liniste') {
      void trimiteEveniment({
        ts: acum,
        tip: clasificare,
        intensitate: Math.min(100, Math.round(energieTotal)),
        durataMs: INTERVAL_ANALIZA_MS,
        frecventaDominanta: Math.round(fd),
      })
    }
  }
}

/** Pornește analiza ambientală pe fluxul microfonului DEJA permis și deschis de
 * sesiunea vocală. Nu deține fluxul și nu îi oprește track-urile la cleanup. */
export async function pornesteAuzulAmbiental(streamActiv: MediaStream): Promise<boolean> {
  if (inMers) return true
  try {
    if (streamActiv.getAudioTracks().length === 0) return false
    stream = streamActiv
    audioCtx = new AudioContext()
    const source = audioCtx.createMediaStreamSource(stream)
    analyser = audioCtx.createAnalyser()
    analyser.fftSize = FFT_SIZE
    analyser.smoothingTimeConstant = 0.3
    source.connect(analyser)
    bufferFrecvente = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount))
    bufferTemporal = new Float32Array(new ArrayBuffer(analyser.fftSize * Float32Array.BYTES_PER_ELEMENT))
    inMers = true
    timer = setInterval(tick, INTERVAL_ANALIZA_MS)
    return true
  } catch {
    // Permisiune refuzată sau microfon indisponibil — tăcut
    opresteAuzulAmbiental()
    return false
  }
}

/** Oprește auzul ambiental și eliberează resursele. */
export function opresteAuzulAmbiental(): void {
  inMers = false
  if (timer) { clearInterval(timer); timer = null }
  stream = null
  if (audioCtx) { void audioCtx.close(); audioCtx = null }
  analyser = null
  bufferFrecvente = null
  bufferTemporal = null
  istoricEnergie = []
  ultimaClasificare = 'liniste'
  ultimaDetectieEveniment = 0
  contorRecurenta = 0
}

/** Ultima clasificare ambientală curentă. */
export function contextAmbientalCurent(): EvenimentSonor['tip'] {
  return ultimaClasificare
}
