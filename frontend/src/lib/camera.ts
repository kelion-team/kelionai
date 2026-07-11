// Device camera access with low-light compensation. The feed is for Kelion's
// vision only; we try to maximise usable detail in dim conditions without
// torching the user's face on front cameras.

export type Facing = 'user' | 'environment'

export function cameraSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function'
  )
}

// MediaTrackCapabilities keys vary by browser/device. We probe them and only
// apply constraints the hardware reports as supported.
export async function startCamera(facing: Facing): Promise<MediaStream> {
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
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { ...base, advanced },
    audio: false,
  })
  return stream
}

export function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop())
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

// Read the current auto-exposure / ISO / brightness settings for debugging.
export function getCameraSettings(stream: MediaStream): Record<string, unknown> {
  const track = stream.getVideoTracks()[0]
  if (!track) return {}
  try {
    return track.getSettings() as Record<string, unknown>
  } catch {
    return {}
  }
}
