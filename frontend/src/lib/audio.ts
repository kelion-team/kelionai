// Audio device routing (Bluetooth headsets / external speakers + mics).
//
// On a phone running this PWA, the OS usually routes to a connected Bluetooth
// device by default — but not always (iOS forces "communication" mode while the
// mic is open, and some Androids stick to the built-in speaker). So we let the
// user explicitly choose the INPUT (mic) and OUTPUT (speaker) device and apply
// it to every audio path: mic capture via a getUserMedia deviceId constraint,
// and TTS playback via setSinkId on the playback AudioContext (or the <audio>
// element). Choice persists in localStorage.
//
// Platform reality (handled, not hidden):
// - Input selection works wherever getUserMedia does (Android + iOS).
// - Output selection (setSinkId) works on Chromium (Android/desktop). Safari/iOS
//   does NOT expose setSinkId, so there we fall back to the OS routing — which
//   does send playback to a connected Bluetooth device on the playback path.

const LS_IN = 'kelion.audioIn'
const LS_OUT = 'kelion.audioOut'

let inputId = read(LS_IN)
let outputId = read(LS_OUT)

function read(k: string): string {
  try {
    return localStorage.getItem(k) ?? ''
  } catch {
    return ''
  }
}
function write(k: string, v: string): void {
  try {
    localStorage.setItem(k, v)
  } catch {
    /* ignore */
  }
}

const subs = new Set<() => void>()
function emit(): void {
  for (const f of subs) f()
}
export function subscribeAudio(fn: () => void): () => void {
  subs.add(fn)
  return () => {
    subs.delete(fn)
  }
}

export interface AudioDevice {
  id: string
  label: string
}
export interface AudioDeviceList {
  inputs: AudioDevice[]
  outputs: AudioDevice[]
}

interface WithSink {
  setSinkId?: (id: string) => Promise<void>
}

/** True when the browser lets us pick the OUTPUT device (Chromium; not iOS). */
export function outputSelectable(): boolean {
  const ctxProto = globalThis.AudioContext?.prototype as unknown as WithSink | undefined
  const elProto = globalThis.HTMLMediaElement?.prototype as unknown as WithSink | undefined
  return typeof ctxProto?.setSinkId === 'function' || typeof elProto?.setSinkId === 'function'
}

export async function listAudioDevices(): Promise<AudioDeviceList> {
  const empty: AudioDeviceList = { inputs: [], outputs: [] }
  if (!navigator.mediaDevices?.enumerateDevices) return empty
  try {
    const devs = await navigator.mediaDevices.enumerateDevices()
    const map = (kind: MediaDeviceKind, fallback: string): AudioDevice[] =>
      devs
        .filter((d) => d.kind === kind && d.deviceId)
        .map((d, i) => ({ id: d.deviceId, label: d.label || `${fallback} ${i + 1}` }))
    return { inputs: map('audioinput', 'Microfon'), outputs: map('audiooutput', 'Difuzor') }
  } catch {
    return empty
  }
}

export function getInputId(): string {
  return inputId
}
export function getOutputId(): string {
  return outputId
}
export function setInputId(id: string): void {
  inputId = id
  write(LS_IN, id)
  emit()
}
export function setOutputId(id: string): void {
  outputId = id
  write(LS_OUT, id)
  emit()
}

/** Mic constraint for getUserMedia — pins the chosen input when one is set. */
export function inputConstraint(): MediaTrackConstraints {
  return inputId ? { deviceId: { ideal: inputId } } : {}
}

/**
 * Route playback to the chosen output. Prefer the AudioContext sink (keeps the
 * lip-sync analyser graph intact); fall back to the <audio> element. No-op when
 * the platform can't select output (Safari/iOS) — OS routing takes over.
 */
export async function applyOutput(
  ctx: AudioContext | null,
  el: HTMLAudioElement | null,
): Promise<void> {
  if (!outputId) return
  const c = ctx as unknown as WithSink | null
  if (c?.setSinkId) {
    try {
      await c.setSinkId(outputId)
      return
    } catch {
      /* fall through to element */
    }
  }
  const e = el as unknown as WithSink | null
  if (e?.setSinkId) {
    try {
      await e.setSinkId(outputId)
    } catch {
      /* unsupported / not permitted — OS routing */
    }
  }
}
