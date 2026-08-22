// ── VEDEREA CONTINUĂ (owner, 22 aug 2026: „simte mediul") ───────────────────
//
// Kelion nu mai e ORB între chemări. Acest modul capturează cadre de la cameră
// la intervale inteligente (1 cadru/2sec în repaus, mai des la mișcare), detectează
// mișcare prin diferență de pixeli (gratis, 0ms, fără biblioteci), și trimite
// cadrele cu mișcare către backend pentru înțelegere (Gemini multimodal).
//
// ARHITECTURĂ:
//   - Motion detection: canvas diff între cadre consecutive (threshold pe număr
//     de pixeli schimbați). 0 cost, 0 dependențe, ~5ms per cadru.
//   - Sampling adaptiv: 2s în repaus, 500ms la mișcare detectată, timp de 10s.
//   - Trimite cadre cu mișcare la /api/vedere/observație cu timestamp + GPS.
//   - Nu trimite cadre duplicate (dacă nimic nu s-a mișcat, nu consumă bandă).
//   - Oprește automat când tab-ul e în fundal (visibilitychange).

export interface ObservatieVizuala {
  ts: number
  lat?: number
  lon?: number
  imagine: string // base64 JPEG, ~320x240 pentru bandă redusă
  miscare: number // 0-100, intensitatea mișcării detectate
}

const INTERVAL_REPAUS_MS = 2000
const INTERVAL_MISCARE_MS = 500
const DURATA_FERESTRA_MISCARE_MS = 10_000
const PRAG_MISCARE_PCT = 5 // % din pixeli schimbați pentru a declanșa
const LATIME_CADRU = 320
const INALTIME_CADRU = 240
const CALITATE_JPEG = 0.6

let inMers = false
let stream: MediaStream | null = null
let video: HTMLVideoElement | null = null
let canvas: HTMLCanvasElement | null = null
let ctx: CanvasRenderingContext2D | null = null
let cadruAnterior: ImageData | null = null
let ultimulCadruTrimis = 0
let ultimaMiscareLa = 0
let timer: ReturnType<typeof setInterval> | null = null

function creeazaCanvas(): void {
  if (canvas) return
  canvas = document.createElement('canvas')
  canvas.width = LATIME_CADRU
  canvas.height = INALTIME_CADRU
  ctx = canvas.getContext('2d', { willReadFrequently: true })
}

/** Diferență între cadre → intensitate mișcare (0-100). 0 = identic, 100 = total schimbat. */
function detecteazaMiscare(cadruNou: ImageData): number {
  if (!cadruAnterior) {
    cadruAnterior = cadruNou
    return 0
  }
  const a = cadruAnterior.data
  const b = cadruNou.data
  let pixeliSchimbati = 0
  let total = 0
  // Sample la fiecare 4 pixeli pentru viteză (1/16 din total)
  for (let i = 0; i < a.length; i += 64) {
    total++
    const dr = Math.abs(a[i] - b[i])
    const dg = Math.abs(a[i + 1] - b[i + 1])
    const db = Math.abs(a[i + 2] - b[i + 2])
    if (dr + dg + db > 60) pixeliSchimbati++
  }
  cadruAnterior = cadruNou
  return total > 0 ? Math.round((pixeliSchimbati / total) * 100) : 0
}

function captureazaCadru(): { imagine: string; miscare: number } | null {
  if (!video || !canvas || !ctx || video.readyState < 2) return null
  ctx.drawImage(video, 0, 0, LATIME_CADRU, INALTIME_CADRU)
  const cadruNou = ctx.getImageData(0, 0, LATIME_CADRU, INALTIME_CADRU)
  const miscare = detecteazaMiscare(cadruNou)
  const imagine = canvas.toDataURL('image/jpeg', CALITATE_JPEG)
  return { imagine, miscare }
}

async function trimiteObservatie(obs: ObservatieVizuala): Promise<void> {
  try {
    await fetch('/api/vedere/observatie', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(obs),
    })
  } catch {
    // offline sau server indisponibil — tăcut, reîncearcă la următorul cadru
  }
}

async function tick(): Promise<void> {
  if (!video || document.hidden) return
  // Gestiunea energiei: pe baterie critică, sare ciclul (camera consumă mult)
  const { poateRulaVerificare } = await import('./energie')
  if (!poateRulaVerificare()) return
  const captura = captureazaCadru()
  if (!captura) return
  const acum = Date.now()
  const inFereastraMiscare = acum - ultimaMiscareLa < DURATA_FERESTRA_MISCARE_MS
  // Trimite doar dacă e mișcare SAU dacă a trecut mult timp de la ultima trimitere
  const trimitePentruMiscare = captura.miscare >= PRAG_MISCARE_PCT
  const trimitePentruRepaus = !inFereastraMiscare && acum - ultimulCadruTrimis > 30_000
  if (trimitePentruMiscare) ultimaMiscareLa = acum
  if (trimitePentruMiscare || trimitePentruRepaus) {
    ultimulCadruTrimis = acum
    let lat: number | undefined
    let lon: number | undefined
    try {
      navigator.geolocation?.getCurrentPosition?.(
        (p) => { lat = p.coords.latitude; lon = p.coords.longitude },
        () => {},
        { timeout: 2000, maximumAge: 60_000 },
      )
    } catch { /* GPS indisponibil — trimite fără */ }
    void trimiteObservatie({
      ts: acum,
      lat,
      lon,
      imagine: captura.imagine,
      miscare: captura.miscare,
    })
  }
  // Ajustează intervalul: repaus sau fereastră de mișcare
  const intervalNou = inFereastraMiscare ? INTERVAL_MISCARE_MS : INTERVAL_REPAUS_MS
  if (timer) clearInterval(timer)
  timer = setInterval(() => void tick(), intervalNou)
}

/** Pornește vederea continuă. Necesită stream de cameră deja activ. */
export function pornesteVedereaContinua(streamActiv: MediaStream): void {
  if (inMers) return
  inMers = true
  stream = streamActiv
  creeazaCanvas()
  video = document.createElement('video')
  video.srcObject = stream
  video.muted = true
  video.playsInline = true
  void video.play().then(() => {
    timer = setInterval(() => void tick(), INTERVAL_REPAUS_MS)
  }).catch(() => {
    // play respins — reîncearcă la primul click
    inMers = false
  })
}

/** Oprește vederea continuă și eliberează resursele. */
export function opresteVedereaContinua(): void {
  inMers = false
  if (timer) { clearInterval(timer); timer = null }
  if (video) { video.srcObject = null; video = null }
  if (stream) { stream = null }
  cadruAnterior = null
}

/** Dacă vederea continuă e activă. */
export function vedereContinuaActiva(): boolean {
  return inMers
}
