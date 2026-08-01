// Person recognition by face — 128-d descriptor (face-api), 100%
// client-side. Adrian: "camera on → automatic capture on voice, no button,
// all in parallel so it does NOT slow down chat." That's why:
//  - face-api loads LAZILY, only when the camera starts (doesn't bloat the
//    bundle, keeps chat/voice startup under 1s);
//  - sampling runs in the BACKGROUND (timer), decoupled from message sending;
//  - chat only takes the latest READY descriptor via getPendingFaceDescriptor()
//    (instant, waits for no inference) — exactly like voiceFeatures.

type FaceApi = typeof import('@vladmandic/face-api')

let api: FaceApi | null = null
let modelsReady = false
let loading = false

// The latest descriptor computed in the background (fresh). Chat reads it instantly.
let latest: { descriptor: number[]; photo: string; at: number } | null = null

async function ensureApi(): Promise<FaceApi | null> {
  if (api && modelsReady) return api
  if (loading) return null
  loading = true
  try {
    const mod = (await import('@vladmandic/face-api')) as FaceApi
    // The models are served from /models (copied from the package at build).
    await mod.nets.tinyFaceDetector.loadFromUri('/models')
    await mod.nets.faceLandmark68Net.loadFromUri('/models')
    await mod.nets.faceRecognitionNet.loadFromUri('/models')
    api = mod
    modelsReady = true
    return mod
  } catch {
    // Without face recognition — chat works exactly as before (fail-open).
    return null
  } finally {
    loading = false
  }
}

const SAMPLE_EVERY_MS = 1500 // o inferență la ~1.5s cât e camera pornită
const FRESH_MS = 8000 // un descriptor mai vechi de atât e considerat expirat

/**
 * Starts background face sampling from the camera's <video> element.
 * `capture` returns a small JPEG of the current frame (the saved thumbnail).
 * Returns a stop function. NOTHING here blocks chat.
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
        /* a bad frame doesn't stop the loop */
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
 * The latest ready (fresh) face descriptor, for attaching to /api/chat.
 * Instant — triggers no inference, waits for nothing. null if no camera is
 * on, no face was caught, or the descriptor is too old.
 */
export function getPendingFaceDescriptor(): { descriptor: number[]; photo: string } | null {
  if (!latest) return null
  if (Date.now() - latest.at > FRESH_MS) return null
  return { descriptor: latest.descriptor, photo: latest.photo }
}
