// Device camera access with low-light compensation. The feed is for Kelion's
// vision only; we try to maximise usable detail in dim conditions without
// torching the user's face on front cameras.

export type Facing = 'user' | 'environment'

const CAMERA_RELEASE_MS = 450      // time for mobile hardware to let go of the sensor
const MAX_START_RETRIES = 3
const RETRY_DELAYS_MS = [300, 700, 1200]

export function cameraSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function'
  )
}

class CameraStartError extends Error {
  code: string
  fatal: boolean
  constructor(message: string, code: string, fatal: boolean) {
    super(message)
    this.name = 'CameraStartError'
    this.code = code
    this.fatal = fatal
  }
}

let releaseChain: Promise<void> = Promise.resolve()

/**
 * Stop every track in a stream and extend the global release chain so that
 * the next startCamera() waits long enough for mobile hardware to actually
 * free the sensor. Parallel stops are collapsed into one delay.
 */
export function stopStream(stream: MediaStream | null): void {
  if (!stream) return
  const tracks = stream.getTracks()
  if (tracks.length === 0) return
  tracks.forEach((track) => track.stop())
  releaseChain = releaseChain.then(async () => {
    await new Promise((r) => setTimeout(r, CAMERA_RELEASE_MS))
  })
}

function isAbortSignalAborted(signal?: AbortSignal): boolean {
  return !!signal?.aborted
}

function isTransientCameraError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const name = err.name
  // AbortError: request was interrupted (page lost focus, another tab grabbed it,
  // or our own cleanup raced the start). Usually goes away on retry.
  // NotReadableError: device is in use by another process / hardware busy.
  // TrackStartError: mobile Chrome sometimes throws this when the sensor is
  // still waking up from a previous stop.
  return (
    name === 'AbortError' ||
    name === 'NotReadableError' ||
    name === 'TrackStartError' ||
    // iOS Safari occasionally surfaces a DOMException named 'NotAllowedError'
    // transiently when the permission prompt is still being dismissed; we give
    // it one chance via the retry loop, then treat it as fatal.
    name === 'NotAllowedError'
  )
}

function classifyCameraError(err: unknown): { fatal: boolean; code: string } {
  if (err instanceof CameraStartError) return { fatal: err.fatal, code: err.code }
  if (!(err instanceof Error)) return { fatal: true, code: 'UnknownError' }
  const name = err.name
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return { fatal: true, code: name }
  }
  if (name === 'OverconstrainedError') {
    return { fatal: false, code: name }
  }
  if (isTransientCameraError(err)) {
    return { fatal: false, code: name }
  }
  return { fatal: true, code: name }
}

function buildConstraints(facing: Facing): MediaStreamConstraints {
  const base: MediaTrackConstraints = {
    facingMode: facing,
    width: { ideal: 1280 },
    height: { ideal: 720 },
  }
  // Advanced constraints are a *wish list*: the browser ignores unsupported ones.
  // We ask for continuous auto-exposure and auto-white-balance so the sensor can
  // lift shadows on its own before we do any canvas correction.
  // These keys are non-standard, so we cast to the generic constraint type.
  const advanced: MediaTrackConstraintSet[] = [
    { exposureMode: 'continuous' } as MediaTrackConstraintSet,
    { whiteBalanceMode: 'continuous' } as MediaTrackConstraintSet,
    { focusMode: 'continuous' } as MediaTrackConstraintSet,
  ]
  return {
    video: { ...base, advanced },
    audio: false,
  }
}

async function tryStartCamera(
  facing: Facing,
  signal?: AbortSignal,
): Promise<MediaStream> {
  if (isAbortSignalAborted(signal)) {
    throw new CameraStartError('Camera start aborted', 'AbortError', false)
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia(buildConstraints(facing))
    if (isAbortSignalAborted(signal)) {
      stopStream(stream)
      throw new CameraStartError('Camera start aborted after acquire', 'AbortError', false)
    }
    return stream
  } catch (err) {
    const { fatal, code } = classifyCameraError(err)
    const message = err instanceof Error ? err.message : String(err)
    throw new CameraStartError(message, code, fatal)
  }
}

/**
 * Acquire a camera stream, serialising access so only one start/stop sequence
 * runs at a time, and retrying transient errors (AbortError, NotReadableError,
 * TrackStartError) with a short backoff. Pass an AbortSignal to cancel cleanly
 * when the owning component unmounts or the user flips the camera rapidly.
 */
export async function startCamera(
  facing: Facing,
  signal?: AbortSignal,
): Promise<MediaStream> {
  // Wait for any previous stop to fully release the sensor.
  await releaseChain
  if (isAbortSignalAborted(signal)) {
    throw new CameraStartError('Camera start aborted before acquire', 'AbortError', false)
  }

  let lastError: CameraStartError | undefined
  for (let attempt = 0; attempt <= MAX_START_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)]
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, delay)
        signal?.addEventListener('abort', () => {
          clearTimeout(t)
          reject(new CameraStartError('Camera start aborted during retry wait', 'AbortError', false))
        }, { once: true })
      })
    }
    try {
      return await tryStartCamera(facing, signal)
    } catch (err) {
      lastError = err instanceof CameraStartError ? err : undefined
      if (!lastError || lastError.fatal) break
      // Only retry the transient errors listed above.
    }
  }

  throw lastError ?? new CameraStartError('Camera failed to start', 'UnknownError', true)
}

function hasCapability(track: MediaStreamTrack, key: string): boolean {
  try {
    const caps = track.getCapabilities() as Record<string, unknown>
    return !!caps[key]
  } catch {
    return false
  }
}

// Apply an extra low-light lift on top of the auto-exposure already requested.
// We prefer exposure compensation, then ISO, then brightness/fill light.
export async function boostLowLight(stream: MediaStream): Promise<void> {
  const track = stream.getVideoTracks()[0]
  if (!track) return
  try {
    const constraints: Record<string, unknown> = {}
    if (hasCapability(track, 'exposureMode')) {
      Object.assign(constraints, { exposureMode: 'continuous' })
    }
    if (hasCapability(track, 'whiteBalanceMode')) {
      Object.assign(constraints, { whiteBalanceMode: 'continuous' })
    }
    if (hasCapability(track, 'exposureCompensation')) {
      const caps = track.getCapabilities() as Record<string, { max?: number; min?: number } | undefined>
      const range = caps.exposureCompensation
      const max = range?.max ?? 3
      const min = range?.min ?? -3
      // Boost up to +2 EV, but never beyond the hardware max.
      Object.assign(constraints, { exposureCompensation: Math.min(2, max) })
      // If the device reports a tiny range, pin it to the max to do what we can.
      if (max <= 0) Object.assign(constraints, { exposureCompensation: max })
      if ((constraints.exposureCompensation as number) < min) {
        Object.assign(constraints, { exposureCompensation: min })
      }
    } else if (hasCapability(track, 'iso')) {
      const caps = track.getCapabilities() as Record<string, { max?: number; min?: number } | undefined>
      const range = caps.iso
      const max = range?.max ?? 800
      const min = range?.min ?? 100
      const target = Math.min(Math.max(800, min), max)
      Object.assign(constraints, { iso: target })
    }
    if (Object.keys(constraints).length > 0) {
      await track.applyConstraints(constraints as MediaTrackConstraintSet)
    }
  } catch {
    // applyConstraints is best-effort: unsupported modes or locked cameras are
    // ignored so we never break the stream.
  }
}

/**
 * Returns true for errors that will not be fixed by retrying immediately
 * (e.g. permanent permission denial, unsupported hardware). The UI can use
 * this to decide whether to show a retry button or a fatal message.
 */
export function isFatalCameraError(err: unknown): boolean {
  return classifyCameraError(err).fatal
}

/**
 * Human-readable camera error code for telemetry.
 */
export function getCameraErrorCode(err: unknown): string {
  return classifyCameraError(err).code
}
