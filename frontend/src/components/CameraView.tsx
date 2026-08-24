import { useEffect, useRef, useState, type MutableRefObject } from 'react'
import {
  boostLowLight,
  getCameraErrorCode,
  isFatalCameraError,
  startCamera,
  stopStream,
  type Facing,
} from '../lib/camera'
import { calitateCamera, getTeava } from '../lib/retea'

function blobLaDataUrl(blob: Blob): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null)
    reader.onerror = () => resolve(null)
    reader.readAsDataURL(blob)
  })
}

/** Camera rămâne locală; un JPEG este creat numai când apelantul cere un instantaneu. */
export default function CameraView({
  active,
  facing,
  onError,
  captureRef,
}: {
  readonly active: boolean
  readonly facing: Facing
  readonly onError: () => void
  readonly captureRef?: MutableRefObject<(() => Promise<string | null>) | null>
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [retryNonce, setRetryNonce] = useState(0)

  useEffect(() => {
    if (!active) {
      stopStream(streamRef.current)
      streamRef.current = null
      return
    }
    const controller = new AbortController()
    void (async () => {
      try {
        const cameraStream = await startCamera(facing, controller.signal)
        if (controller.signal.aborted) {
          stopStream(cameraStream)
          return
        }
        streamRef.current = cameraStream
        if (videoRef.current) {
          videoRef.current.srcObject = cameraStream
          await videoRef.current.play()
        }
        await boostLowLight(cameraStream).catch(() => undefined)
      } catch (error) {
        if (controller.signal.aborted) return
        const code = getCameraErrorCode(error)
        const fatal = isFatalCameraError(error)
        console.error(`camera unavailable: ${code}${fatal ? ' (fatal)' : ''} (facing=${facing})`)
        onError()
      }
    })()
    return () => {
      controller.abort()
      stopStream(streamRef.current)
      streamRef.current = null
    }
  }, [active, facing, onError, retryNonce])

  useEffect(() => {
    if (!active) return
    const resume = (): void => {
      if (!document.hidden && !streamRef.current) setRetryNonce((value) => value + 1)
    }
    window.addEventListener('focus', resume)
    document.addEventListener('visibilitychange', resume)
    return () => {
      window.removeEventListener('focus', resume)
      document.removeEventListener('visibilitychange', resume)
    }
  }, [active])

  useEffect(() => {
    if (!captureRef) return
    let pending: Promise<string | null> | null = null
    const capture = (): Promise<string | null> => {
      if (pending) return pending
      pending = (async () => {
        const video = videoRef.current
        if (!active || !video || video.readyState < 2 || video.videoWidth < 1 || video.videoHeight < 1) return null
        const quality = calitateCamera(getTeava())
        const scale = Math.min(1, quality.maxDim / Math.max(video.videoWidth, video.videoHeight))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(video.videoWidth * scale))
        canvas.height = Math.max(1, Math.round(video.videoHeight * scale))
        const context = canvas.getContext('2d')
        if (!context) return null
        try {
          context.drawImage(video, 0, 0, canvas.width, canvas.height)
          const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality.jpeg))
          return blob ? await blobLaDataUrl(blob) : null
        } finally {
          context.clearRect(0, 0, canvas.width, canvas.height)
          canvas.width = 1
          canvas.height = 1
        }
      })().finally(() => {
        pending = null
      })
      return pending
    }
    captureRef.current = capture
    return () => {
      if (captureRef.current === capture) captureRef.current = null
    }
  }, [active, captureRef])

  if (!active) return null
  return <video ref={videoRef} muted playsInline aria-hidden className="camera-hidden" />
}
