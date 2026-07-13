import { useEffect, useRef, useState, type MutableRefObject } from 'react'
import {
  startCamera,
  stopStream,
  boostLowLight,
  isFatalCameraError,
  getCameraErrorCode,
  type Facing,
} from '../lib/camera'

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
  const [retryNonce, setRetryNonce] = useState(0)

  // Start/stop the camera stream. Camera access is serialised inside camera.ts,
  // so rapid flips (front/back) or React StrictMode remounts cannot grab the
  // sensor before the previous stop has released it.
  useEffect(() => {
    if (!active) {
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
      stopStream(streamRef.current)
      streamRef.current = null
    }
  }, [active, facing, onError, retryNonce])

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
    captureRef.current = () => {
      const v = videoRef.current
      // The frame is only real once the camera has actually decoded a picture.
      // videoWidth alone isn't enough — readyState < 2 (HAVE_CURRENT_DATA) means
      // no frame is painted yet, and drawImage would grab a BLACK rectangle.
      if (!v || !v.videoWidth || v.readyState < 2) return null
      const maxDim = 768
      const scale = Math.min(1, maxDim / Math.max(v.videoWidth, v.videoHeight))
      const w = Math.round(v.videoWidth * scale)
      const h = Math.round(v.videoHeight * scale)
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) return null

      // Helper: sample luminance and return fraction of "lit" pixels.
      const measureLit = (imageData?: ImageData): number => {
        const data = imageData?.data
        if (!data || data.length === 0) return 0
        let lit = 0
        let total = 0
        // Sample roughly every 64th pixel (stride = 256 bytes = 64 pixels × 4).
        for (let i = 0; i < data.length; i += 256) {
          total++
          if (data[i] + data[i + 1] + data[i + 2] > 36) lit++ // above near-black
        }
        return total > 0 ? lit / total : 0
      }

      // First pass: draw normally so we can measure the real sensor output.
      ctx.filter = 'none'
      ctx.drawImage(v, 0, 0, w, h)
      let imageData: ImageData | undefined
      try {
        imageData = ctx.getImageData(0, 0, w, h)
      } catch {
        // Tainted canvas — can't sample, so trust the frame rather than dropping it.
        return canvas.toDataURL('image/jpeg', 0.6)
      }
      const lit = measureLit(imageData)

      // Second pass: if the scene is dim but not dead-black, boost it on the
      // canvas so Kelion still receives a usable frame in low light. We keep
      // the guard against pure black frames (lens covered / not ready).
      if (lit > 0 && lit < 0.08) {
        const boost = lit < 0.02 ? 2.8 : lit < 0.04 ? 2.2 : 1.8
        ctx.filter = `brightness(${boost}) contrast(${Math.min(1.4, 1 + boost * 0.15)})`
        ctx.drawImage(v, 0, 0, w, h)
        try {
          imageData = ctx.getImageData(0, 0, w, h)
        } catch {
          // Tainted canvas after boost — ship the boosted frame.
          return canvas.toDataURL('image/jpeg', 0.6)
        }
        const litBoosted = measureLit(imageData)
        // If even a heavy boost leaves the frame virtually black, the lens is
        // covered or the sensor is not producing data — don't ship it.
        if (litBoosted < 0.02) return null
      } else if (lit === 0) {
        // No measurable pixels at all — reject.
        return null
      }

      return canvas.toDataURL('image/jpeg', 0.6)
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
