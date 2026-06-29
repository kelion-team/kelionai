import { useEffect, useRef } from 'react'
import { startCamera, stopStream, type Facing } from '../lib/camera'

// Floating glass preview of the device camera. Acquires the stream while
// `active`, releases it otherwise (and on unmount / facing change).
export default function CameraView({
  active,
  facing,
  onError,
}: {
  readonly active: boolean
  readonly facing: Facing
  readonly onError: () => void
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
