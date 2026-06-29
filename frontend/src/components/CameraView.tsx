import { useEffect, useRef, type MutableRefObject } from 'react'
import { startCamera, stopStream, type Facing } from '../lib/camera'

// Floating glass preview of the device camera. Acquires the stream while
// `active`, releases it otherwise (and on unmount / facing change). Exposes a
// frame grabber via `captureRef` so the chat can send what the camera sees to
// Claude (permanent vision). Frames are downscaled to keep the payload small.
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
      if (!v || !v.videoWidth) return null
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
      return canvas.toDataURL('image/jpeg', 0.6)
    }
    return () => {
      captureRef.current = null
    }
  }, [captureRef])

  if (!active) return null
  return (
    <div className="camera-card">
      <video
        ref={videoRef}
        muted
        playsInline
        className={facing === 'user' ? 'mirror' : ''}
      />
    </div>
  )
}
