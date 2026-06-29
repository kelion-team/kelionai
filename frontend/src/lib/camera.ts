// Device camera access (interim — capture + preview + front/back switch only).
// Sending frames to Claude ("Kelion sees") is the separate vision milestone.
// Requires HTTPS (kelionai.app) and a one-time browser permission prompt.

export type Facing = 'user' | 'environment'

export function cameraSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function'
  )
}

export async function startCamera(facing: Facing): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    video: { facingMode: facing },
    audio: false,
  })
}

export function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop())
}

/** True when the device exposes more than one camera (front/back switch worth showing). */
export async function hasMultipleCameras(): Promise<boolean> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices()
    return devices.filter((d) => d.kind === 'videoinput').length > 1
  } catch {
    return false
  }
}
