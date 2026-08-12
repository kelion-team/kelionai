import { useEffect, useRef, useState, type MutableRefObject } from 'react'
import {
  startCamera,
  stopStream,
  boostLowLight,
  isFatalCameraError,
  getCameraErrorCode,
  type Facing,
} from '../lib/camera'
import { startFaceSampling } from '../lib/faceprint'
import { getTeava, calitateCamera } from '../lib/retea'

// Device camera capture — NOT shown on screen. The feed is for Kelion's vision
// only: the <video> element is kept playing but visually hidden, and frames are
// grabbed via `captureRef` and sent to the brain (permanent vision). The element
// stays off-screen (not display:none) so the browser keeps decoding frames.
// Frames are downscaled to keep the payload small.
export default function CameraView({
  active,
  facing,
  onError,
  captureRef,
}: {
  readonly active: boolean
  readonly facing: Facing
  readonly onError: () => void
  readonly captureRef?: MutableRefObject<(() => string | null) | null>
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const faceStopRef = useRef<(() => void) | null>(null)
  const [retryNonce, setRetryNonce] = useState(0)

  // Start/stop the camera stream. Camera access is serialised inside camera.ts,
  // so rapid flips (front/back) or React StrictMode remounts cannot grab the
  // sensor before the previous stop has released it.
  useEffect(() => {
    if (!active) {
      faceStopRef.current?.()
      faceStopRef.current = null
      stopStream(streamRef.current)
      streamRef.current = null
      return
    }

    const controller = new AbortController()
    void (async () => {
      try {
        const stream = await startCamera(facing, controller.signal)
        if (controller.signal.aborted) {
          stopStream(stream)
          return
        }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play().catch(() => undefined)
        }
        // Lift exposure/gain after the stream is alive — the browser may have
        // started conservatively in dim light.
        await boostLowLight(stream).catch(() => undefined)
        // Face sampling in the BACKGROUND (owner vs. someone else recognition).
        // Starts only now (live camera), runs decoupled from chat, stops at
        // cleanup. It blocks nothing on the reply path.
        if (videoRef.current && !faceStopRef.current) {
          faceStopRef.current = startFaceSampling(
            videoRef.current,
            () => captureRef?.current?.() ?? null,
          )
        }
      } catch (err) {
        // If our own cleanup aborted the request, this is not a real error.
        if (controller.signal.aborted) return
        const code = getCameraErrorCode(err)
        const fatal = isFatalCameraError(err)
        const message = err instanceof Error ? err.message : String(err)
        // eslint-disable-next-line no-console
        console.error(`camera nu pornește: ${code}${fatal ? ' (fatal)' : ''} (facing=${facing})`, message)
        onError()
      }
    })()

    return () => {
      controller.abort()
      faceStopRef.current?.()
      faceStopRef.current = null
      stopStream(streamRef.current)
      streamRef.current = null
    }
    // `captureRef` lipsea din listă. E un ref (identitate stabilă), deci
    // adăugarea NU schimbă când rulează efectul — dar oprește avertismentul și,
    // mai important, ține lista sinceră: dacă mâine devine altceva decât un ref,
    // efectul chiar trebuie să reacționeze la el.
  }, [active, facing, onError, retryNonce, captureRef])

  // If the page regains focus or comes back online, try to recover from a
  // transient failure (camera busy, permission prompt dismissed, etc.).
  useEffect(() => {
    if (!active) return
    const tryResume = () => {
      if (document.hidden) return
      if (streamRef.current) return
      setRetryNonce((n) => n + 1)
    }
    window.addEventListener('focus', tryResume)
    document.addEventListener('visibilitychange', tryResume)
    window.addEventListener('online', tryResume)
    return () => {
      window.removeEventListener('focus', tryResume)
      document.removeEventListener('visibilitychange', tryResume)
      window.removeEventListener('online', tryResume)
    }
  }, [active])

  // Register a frame grabber (latest frame as a downscaled JPEG data URL).
  useEffect(() => {
    if (!captureRef) return
    // ── CANVASURI REFOLOSITE + SONDĂ MICĂ (măsurat 8 aug, consola ownerului) ──
    // Vechea captare făcea, la FIECARE tick de 250 ms: un canvas NOU, drawImage
    // la 768px, apoi getImageData(768) — o citire GPU→CPU sincronă — uneori de
    // DOUĂ ori (a doua oară pentru boost-ul de lumină). Ceasul cu nume a prins-o
    // în flagrant: „captare cadre cameră a ținut firul 2312 ms (vârf 6341 ms)"
    // — iar cererea de chat a așteptat EXACT 6334 ms în spatele ei. Alea erau
    // secundele de întârziere reclamate.
    // Acum: lumina se măsoară pe o sondă de 48×27 (getImageData de ~500× mai
    // ieftin), canvasurile se refolosesc, iar citirea mare (768px) nu se mai
    // face deloc — cadrul mare doar se desenează și se împachetează JPEG.
    const panzaMare = document.createElement('canvas')
    const sonda = document.createElement('canvas')
    sonda.width = 48
    sonda.height = 27

    /** Fracția de pixeli „aprinși" din sondă (sub filtrul dat), sau null dacă
     *  sonda nu se poate citi (canvas pătat — atunci avem încredere în cadru). */
    const masoaraLumina = (v: HTMLVideoElement, filtru: string): number | null => {
      const pctx = sonda.getContext('2d', { willReadFrequently: true })
      if (!pctx) return null
      pctx.filter = filtru
      pctx.drawImage(v, 0, 0, sonda.width, sonda.height)
      try {
        const d = pctx.getImageData(0, 0, sonda.width, sonda.height).data
        let lit = 0
        let total = 0
        for (let i = 0; i < d.length; i += 16) {
          total++
          if (d[i] + d[i + 1] + d[i + 2] > 36) lit++ // peste aproape-negru
        }
        return total > 0 ? lit / total : 0
      } catch {
        return null
      }
    }

    captureRef.current = () => {
      const v = videoRef.current
      // The frame is only real once the camera has actually decoded a picture.
      // videoWidth alone isn't enough — readyState < 2 (HAVE_CURRENT_DATA) means
      // no frame is painted yet, and drawImage would grab a BLACK rectangle.
      if (!v || !v.videoWidth || v.readyState < 2) return null
      // 512, nu 768 (10 aug — „chat audio crăpat" pe voce+cameră): `toDataURL`
      // e o encodare JPEG SINCRONĂ; costul crește cu pixelii. La 768² ținea firul
      // 50–134 ms și înfometa redarea vocii → audio crăpat + barge-in-uri false.
      // 512² = ~44% din pixeli → ~jumătate de blocaj, cu Kelion vede la fel de bine.
      // CALITATE ADAPTIVĂ LA ȚEAVĂ (12 aug): pe 4G/Wi-Fi rămâne 512/0.6; pe
      // 3G/2G scade dimensiunea + calitatea JPEG, ca vederea să treacă și pe
      // țeavă slabă (citit LIVE la fiecare cadru → comută din mers, fără re-render).
      const cal = calitateCamera(getTeava())
      const maxDim = cal.maxDim
      const scale = Math.min(1, maxDim / Math.max(v.videoWidth, v.videoHeight))
      const w = Math.round(v.videoWidth * scale)
      const h = Math.round(v.videoHeight * scale)
      if (panzaMare.width !== w) panzaMare.width = w
      if (panzaMare.height !== h) panzaMare.height = h
      const ctx = panzaMare.getContext('2d')
      if (!ctx) return null

      const lit = masoaraLumina(v, 'none')
      let filtru = 'none'
      if (lit !== null) {
        if (lit === 0) return null // niciun pixel măsurabil — lentila acoperită
        if (lit < 0.08) {
          // Scenă întunecată dar nu moartă: boost, ca Kelion să primească un
          // cadru utilizabil în lumină slabă. Garda pe negru pur rămâne.
          const boost = lit < 0.02 ? 2.8 : lit < 0.04 ? 2.2 : 1.8
          filtru = `brightness(${boost}) contrast(${Math.min(1.4, 1 + boost * 0.15)})`
          const litBoost = masoaraLumina(v, filtru)
          // Dacă și boostat rămâne practic negru, senzorul nu produce imagine.
          if (litBoost !== null && litBoost < 0.02) return null
        }
      }
      // Cadrul mare: DOAR desen + JPEG — nicio citire de pixeli pe 768px.
      ctx.filter = filtru
      ctx.drawImage(v, 0, 0, w, h)
      return panzaMare.toDataURL('image/jpeg', cal.jpeg)
    }
    return () => {
      captureRef.current = null
    }
  }, [captureRef])

  if (!active) return null
  // Hidden from the user — Kelion's eyes only. Kept off-screen (not display:none)
  // so the browser keeps decoding frames for capture.
  return <video ref={videoRef} muted playsInline aria-hidden className="camera-hidden" />
}
