import type { Lang } from './i18n'
import { reconcileOfflineComponent } from './offlineKitIntegrity'
import { forgetOfflineComponent } from './offlineKitReadiness'

type WorkerMessage = {
  tip: 'gata' | 'text' | 'eroare' | 'progres'
  id?: number
  text?: string
  progress?: number
  loaded?: number
  total?: number
}

let worker: Worker | null = null
let ready = false
let preparation: Promise<boolean> | null = null
let preparationResolve: ((ready: boolean) => void) | null = null
let preparationProgress: ((progress: number) => void) | null = null
let preparationCleanup: (() => void) | null = null
let nextId = 1
const pending = new Map<number, { resolve: (text: string | null) => void; timeout: ReturnType<typeof setTimeout> }>()

function settlePreparation(result: boolean): void {
  const resolve = preparationResolve
  preparationResolve = null
  preparation = null
  preparationProgress = null
  preparationCleanup?.()
  preparationCleanup = null
  resolve?.(result)
}

function stopWorker(expected = worker): void {
  if (!expected || worker !== expected) return
  expected.terminate()
  worker = null
  ready = false
  settlePreparation(false)
  for (const item of pending.values()) {
    globalThis.clearTimeout(item.timeout)
    item.resolve(null)
  }
  pending.clear()
}

function startWorker(): Worker {
  if (worker) return worker
  const instance = new Worker(new URL('./urecheaOffline.worker.ts', import.meta.url), { type: 'module' })
  worker = instance
  instance.onmessage = (event: MessageEvent<WorkerMessage>) => {
    if (worker !== instance) return
    const message = event.data
    if (message.tip === 'progres') {
      const ratio = typeof message.progress === 'number'
        ? message.progress
        : typeof message.loaded === 'number' && typeof message.total === 'number' && message.total > 0
          ? message.loaded / message.total
          : 0
      preparationProgress?.(Math.min(1, Math.max(0, ratio)))
      return
    }
    if (message.tip === 'gata') {
      ready = true
      settlePreparation(true)
      return
    }
    if ((message.tip === 'text' || message.tip === 'eroare') && message.id != null) {
      const item = pending.get(message.id)
      pending.delete(message.id)
      if (item) globalThis.clearTimeout(item.timeout)
      item?.resolve(message.tip === 'text' ? (message.text ?? '') : null)
    }
    if (message.tip === 'eroare' && message.id == null) {
      settlePreparation(false)
    }
  }
  instance.onerror = () => stopWorker(instance)
  return instance
}

export function urecheaOfflineGata(): boolean {
  return ready
}

export async function pregatesteUrecheaOffline(options: {
  allowNetwork?: boolean
  onProgress?: (progress: number) => void
  signal?: AbortSignal
} = {}): Promise<boolean> {
  if (ready) return true
  const allowNetwork = options.allowNetwork === true
  if (!allowNetwork && !(await reconcileOfflineComponent('hearing')).ok) return false
  if (options.signal?.aborted) return false
  preparationProgress = options.onProgress ?? preparationProgress
  if (preparation) return preparation
  preparation = new Promise<boolean>((resolve) => {
    preparationResolve = (result) => {
      resolve(result)
    }
    try {
      const activeWorker = startWorker()
      const onAbort = (): void => stopWorker(activeWorker)
      options.signal?.addEventListener('abort', onAbort, { once: true })
      preparationCleanup = () => options.signal?.removeEventListener('abort', onAbort)
      activeWorker.postMessage({ tip: 'pregateste', allowNetwork })
    } catch {
      settlePreparation(false)
    }
  })
  return preparation
}

export function oprestePregatireaUrechiiOffline(): void {
  stopWorker()
}

export async function stergeUrecheaOffline(): Promise<void> {
  stopWorker()
  if (typeof caches !== 'undefined') await caches.delete('transformers-cache').catch(() => false)
  forgetOfflineComponent('hearing')
}

/** WAV PCM 16-bit mono/16 kHz (data URI sau base64 brut) -> Float32. */
export function wavBase64LaFloat32(input: string): Float32Array {
  const prefix = /^data:audio\/wav;base64,/iu
  if (/^data:/iu.test(input) && !prefix.test(input)) throw new Error('wav_data_uri_invalid')
  const base64 = input.replace(prefix, '')
  if (!base64 || /\s/u.test(base64)) throw new Error('wav_base64_invalid')
  const raw = atob(base64)
  const bytes = new Uint8Array(raw.length)
  for (let index = 0; index < raw.length; index++) bytes[index] = raw.charCodeAt(index)
  if (bytes.byteLength < 44) throw new Error('wav_too_short')
  const view = new DataView(bytes.buffer)
  const fourCc = (offset: number): string => String.fromCharCode(
    view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3),
  )
  if (fourCc(0) !== 'RIFF' || fourCc(8) !== 'WAVE') throw new Error('wav_container_invalid')
  const riffEnd = view.getUint32(4, true) + 8
  if (riffEnd > bytes.byteLength || riffEnd < 44) throw new Error('wav_bounds_invalid')

  let formatValid = false
  let dataOffset = -1
  let dataBytes = 0
  for (let offset = 12; offset + 8 <= riffEnd;) {
    const id = fourCc(offset)
    const size = view.getUint32(offset + 4, true)
    const body = offset + 8
    const end = body + size
    if (end > riffEnd) throw new Error('wav_chunk_bounds_invalid')
    if (id === 'fmt ') {
      if (size < 16) throw new Error('wav_format_invalid')
      const pcm = view.getUint16(body, true)
      const channels = view.getUint16(body + 2, true)
      const sampleRate = view.getUint32(body + 4, true)
      const byteRate = view.getUint32(body + 8, true)
      const blockAlign = view.getUint16(body + 12, true)
      const bitsPerSample = view.getUint16(body + 14, true)
      formatValid = pcm === 1 && channels === 1 && sampleRate === 16_000 &&
        byteRate === 32_000 && blockAlign === 2 && bitsPerSample === 16
    } else if (id === 'data' && dataOffset < 0) {
      dataOffset = body
      dataBytes = size
    }
    offset = end + (size % 2)
  }
  if (!formatValid) throw new Error('wav_format_unsupported')
  if (dataOffset < 0 || dataBytes % 2 !== 0 || dataOffset + dataBytes > riffEnd) {
    throw new Error('wav_data_invalid')
  }
  const sampleCount = dataBytes / 2
  const output = new Float32Array(sampleCount)
  let energy = 0
  let peak = 0
  for (let index = 0; index < sampleCount; index++) {
    output[index] = view.getInt16(dataOffset + index * 2, true) / 32768
    energy += output[index] * output[index]
    peak = Math.max(peak, Math.abs(output[index]))
  }
  const rms = sampleCount > 0 ? Math.sqrt(energy / sampleCount) : 0
  if (peak < 0.01 || rms < 0.002) throw new Error('wav_no_speech')
  return output
}

const WHISPER_LANGUAGE: Record<string, string> = {
  ro: 'romanian', en: 'english', es: 'spanish', fr: 'french',
  de: 'german', it: 'italian', pt: 'portuguese',
}

export function transcrieOffline(audio: Float32Array, lang: Lang | string): Promise<string | null> {
  if (!ready || !worker) return Promise.resolve(null)
  const id = nextId++
  return new Promise((resolve) => {
    const timeout = globalThis.setTimeout(() => {
      const item = pending.get(id)
      if (item) {
        pending.delete(id)
        item.resolve(null)
      }
    }, 60_000)
    pending.set(id, { resolve, timeout })
    try {
      worker?.postMessage({ tip: 'transcrie', audio, limba: WHISPER_LANGUAGE[lang] ?? 'romanian', id })
    } catch {
      pending.delete(id)
      globalThis.clearTimeout(timeout)
      resolve(null)
    }
  })
}
