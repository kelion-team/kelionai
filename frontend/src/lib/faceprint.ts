// Recunoașterea persoanei după față — descriptor 128-d (face-api), 100%
// client-side. Adrian: „camera pornită → captură automată la voce, fără buton,
// tot în paralel să NU încetinească chatul." De aceea:
//  - face-api se încarcă LAZY, doar când pornește camera (nu umflă bundle-ul,
//    păstrează pornirea chat/voce sub 1s);
//  - eșantionarea rulează în FUNDAL (timer), decuplată de trimiterea mesajului;
//  - chatul ia doar ultimul descriptor GATA prin getPendingFaceDescriptor()
//    (instant, nu așteaptă nicio inferență) — exact ca voiceFeatures.

type FaceApi = typeof import('@vladmandic/face-api')

let api: FaceApi | null = null
let modelsReady = false
let loading = false

// Ultimul descriptor calculat în fundal (proaspăt). Chatul îl citește instant.
let latest: { descriptor: number[]; photo: string; at: number } | null = null

async function ensureApi(): Promise<FaceApi | null> {
  if (api && modelsReady) return api
  if (loading) return null
  loading = true
  try {
    const mod = (await import('@vladmandic/face-api')) as FaceApi
    // Modelele sunt servite din /models (copiate din pachet la build).
    await mod.nets.tinyFaceDetector.loadFromUri('/models')
    await mod.nets.faceLandmark68Net.loadFromUri('/models')
    await mod.nets.faceRecognitionNet.loadFromUri('/models')
    api = mod
    modelsReady = true
    return mod
  } catch {
    // Fără recunoaștere facială — chatul merge exact ca înainte (fail-open).
    return null
  } finally {
    loading = false
  }
}

const SAMPLE_EVERY_MS = 1500 // o inferență la ~1.5s cât e camera pornită
const FRESH_MS = 8000 // un descriptor mai vechi de atât e considerat expirat

/**
 * Pornește eșantionarea feței în fundal din elementul <video> al camerei.
 * `capture` întoarce un JPEG mic al cadrului curent (miniatura salvată).
 * Întoarce o funcție de oprire. NIMIC din asta nu blochează chatul.
 */
export function startFaceSampling(
  video: HTMLVideoElement,
  capture: () => string | null,
): () => void {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | null = null

  void (async () => {
    const face = await ensureApi()
    if (!face || stopped) return
    const opts = new face.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 })
    const tick = async (): Promise<void> => {
      if (stopped) return
      try {
        if (video.videoWidth > 0 && video.readyState >= 2) {
          const det = await face
            .detectSingleFace(video, opts)
            .withFaceLandmarks()
            .withFaceDescriptor()
          if (det?.descriptor && det.descriptor.length >= 64) {
            latest = {
              descriptor: Array.from(det.descriptor as Float32Array),
              photo: capture() || '',
              at: Date.now(),
            }
          }
        }
      } catch {
        /* un cadru prost nu oprește bucla */
      }
      if (!stopped) timer = setTimeout(() => void tick(), SAMPLE_EVERY_MS)
    }
    void tick()
  })()

  return () => {
    stopped = true
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    latest = null // la oprirea camerei, nu mai raportăm o față veche
  }
}

/**
 * Ultimul descriptor facial gata (proaspăt), pentru atașare la /api/chat.
 * Instant — nu declanșează nicio inferență, nu așteaptă nimic. null dacă nu e
 * cameră pornită, nu s-a prins nicio față, sau descriptorul e prea vechi.
 */
export function getPendingFaceDescriptor(): { descriptor: number[]; photo: string } | null {
  if (!latest) return null
  if (Date.now() - latest.at > FRESH_MS) return null
  return { descriptor: latest.descriptor, photo: latest.photo }
}
