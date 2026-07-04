import { useEffect, useRef, type MutableRefObject } from 'react'
import { startCamera, stopStream, type Facing } from '../lib/camera'

// Device camera capture — NOT shown on screen. The feed is for Kelion's vision
// only: the <video> element is kept playing but visually hidden, and frames are
// grabbed via `captureRef` and sent to Claude (permanent vision). The element
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

  useEffect(() => {
    if (!active) {
      stopStream(streamRef.current)
      streamRef.current = null
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const stream = await startCamera(facing)
        if (cancelled) {
          stopStream(stream)
          return
        }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play().catch(() => undefined)
        }
      } catch {
        onError()
      }
    })()
    return () => {
      cancelled = true
      stopStream(streamRef.current)
      streamRef.current = null
    }
  }, [active, facing, onError])

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
      ctx.drawImage(v, 0, 0, w, h)
      // GUARD against sending a black frame (camera warming up, covered, or a
      // decode gap): read the pixels ONCE and sample every ~64th; if virtually
      // all are near-black the frame is useless — return null so Kelion never
      // receives a black image.
      try {
        const data = ctx.getImageData(0, 0, w, h).data
        let lit = 0
        let total = 0
        for (let i = 0; i < data.length; i += 256) {
          total++
          if (data[i] + data[i + 1] + data[i + 2] > 36) lit++ // above near-black
        }
        if (total > 0 && lit / total < 0.02) return null // <2% lit = black frame
      } catch {
        /* getImageData can throw on a tainted canvas — then just trust the frame */
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
