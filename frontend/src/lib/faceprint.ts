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
    // Pe CPU o singură inferență ține firul principal zeci de ms (măsurat în
    // Performance, 8 aug: 55–77 ms per task). WebGL mută greul pe GPU; dacă
    // browserul nu-l poate da, rămânem pe ce alege el singur (fail-open), dar
    // spunem în consolă pe ce backend chiar rulăm — nu presupunem.
    // Accesul la `tf` e DINAMIC, nu prin tipuri: declarațiile lui face-api
    // 1.7.15 nu expun getBackend/setBackend/ready pe `typeof tf`, deși la
    // rulare există (tfjs-ul împachetat e întreg) — cu tipuri, `tsc -b` din
    // imaginea Docker pică și publicarea se oprește (măsurat 8 aug: exact așa
    // a stat masterul 20 de minute nepublicat).
    const tfx = (mod as unknown as {
      tf?: { getBackend?: () => string; setBackend?: (b: string) => Promise<boolean>; ready?: () => Promise<void> }
    }).tf
    try {
      if (tfx?.setBackend && tfx.getBackend?.() !== 'webgl') {
        await tfx.setBackend('webgl')
        await tfx.ready?.()
      }
    } catch {
      /* backendul rămâne cel implicit */
    }
    // The models are served from /models (copied from the package at build).
    await mod.nets.tinyFaceDetector.loadFromUri('/models')
    await mod.nets.faceLandmark68Net.loadFromUri('/models')
    await mod.nets.faceRecognitionNet.loadFromUri('/models')
    api = mod
    modelsReady = true
    // eslint-disable-next-line no-console
    console.info(`[fața] backend inferență: ${tfx?.getBackend?.() ?? 'necunoscut (tf neexpus)'}`)
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

  // ── PÂNZĂ MICĂ DE INFERENȚĂ (măsurat 8 aug, Performance în consola ownerului) ──
  // Vechiul drum dădea rețelelor elementul <video> întreg (ex. 1280×720): fiecare
  // din cele 3 rețele urcă intrarea ca textură pe GPU, deci plăteam uploadul
  // cadrului mare de 3 ori pe eșantion — task-uri de 55–77 ms pe firul principal.
  // Acum cadrul se desenează o dată (drawImage ieftin) pe o pânză refolosită de
  // max 320px — analiza a cerut chiar „160x120 or 320x240" — și rețelele văd doar
  // pânza mică (~6% din pixeli). Detectorul coboară și el la inputSize 160
  // (redimensionează intern oricum; 160 e o treaptă validă a tiny_face_detector).
  const INTRARE_MAX = 320
  const panzaInferenta = document.createElement('canvas')

  void (async () => {
    const face = await ensureApi()
    if (!face || stopped) return
    const opts = new face.TinyFaceDetectorOptions({ inputSize: 160, scoreThreshold: 0.5 })
    let primaMasurata = false
    const tick = async (): Promise<void> => {
      if (stopped) return
      try {
        if (video.videoWidth > 0 && video.readyState >= 2) {
          const scara = Math.min(1, INTRARE_MAX / Math.max(video.videoWidth, video.videoHeight))
          const w = Math.max(2, Math.round(video.videoWidth * scara))
          const h = Math.max(2, Math.round(video.videoHeight * scara))
          if (panzaInferenta.width !== w) panzaInferenta.width = w
          if (panzaInferenta.height !== h) panzaInferenta.height = h
          // willReadFrequently: face-api CITEȘTE pixelii pânzei la fiecare
          // eșantion (getImageData) — fără atribut, browserul ține pânza pe GPU
          // și fiecare citire e un readback scump (avertismentul din consola
          // ownerului, 8 aug). Cu el, pânza stă în RAM: desenul e ieftin la
          // 320px, iar citirile repetate devin ieftine.
          const pctx = panzaInferenta.getContext('2d', { willReadFrequently: true })
          if (pctx) {
            pctx.drawImage(video, 0, 0, w, h)
            const t0 = performance.now()
            const det = await face
              .detectSingleFace(panzaInferenta, opts)
              .withFaceLandmarks()
              .withFaceDescriptor()
            if (!primaMasurata) {
              primaMasurata = true
              // O singură cifră, o singură dată — dovada că reparația a lucrat,
              // fără să înece consola. (Durata totală, nu blocajul de fir —
              // blocajul se vede în Performance, ca la măsurarea inițială.)
              // eslint-disable-next-line no-console
              console.info(`[fața] prima inferență: ${Math.round(performance.now() - t0)} ms (intrare ${w}×${h}, detector 160)`)
            }
            if (det?.descriptor && det.descriptor.length >= 64) {
              latest = {
                descriptor: Array.from(det.descriptor as Float32Array),
                photo: capture() || '',
                at: Date.now(),
              }
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
