import { LANGS } from './languages'

// Audio-based language detection. Records a few seconds of mic audio and asks
// the backend (Google STT v2 chirp, auto language ID) which language was spoken.
// This is the only way to detect the language of pure audio when the browser
// recognizer is set to the wrong language (e.g. Chinese speech, English browser)
// — text detection can't, because the transcript would already be garbled.

// Map a Google-returned code (e.g. "zh-Hans", "ro", "en-us", "cmn-Hans") to one
// of our supported BCP-47 recognizer/voice codes, by base language.
export function mapDetectedToSupported(raw: string | null | undefined): string | null {
  if (!raw) return null
  let base = raw.toLowerCase().split('-')[0]
  if (base === 'cmn' || base === 'zh') base = 'zh'
  const hit = LANGS.find((l) => l.code.toLowerCase().startsWith(base + '-'))
  return hit?.code ?? null
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      const s = String(reader.result)
      resolve(s.slice(s.indexOf(',') + 1)) // strip the data: URL prefix
    }
    reader.onerror = () => reject(new Error('read_failed'))
    reader.readAsDataURL(blob)
  })
}

/**
 * Record ~`ms` of mic audio and return the detected, supported language code
 * (or null if undetected / unsupported / unavailable). Best-effort: never
 * throws.
 */
export async function detectLanguageFromMic(ms = 4500): Promise<string | null> {
  if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) return null
  let stream: MediaStream | null = null
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const chunks: Blob[] = []
    const rec = new MediaRecorder(stream)
    const stopped = new Promise<void>((resolve) => {
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data)
      }
      rec.onstop = () => resolve()
    })
    rec.start()
    await new Promise((r) => setTimeout(r, ms))
    rec.stop()
    await stopped

    const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' })
    if (blob.size < 1200) return null // basically silence
    const audio = await blobToBase64(blob)
    const res = await fetch('/api/asr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ audio }),
    })
    if (!res.ok) return null
    const j = (await res.json()) as { lang?: string | null; transcript?: string }
    if (!j.transcript?.trim()) return null
    return mapDetectedToSupported(j.lang)
  } catch {
    return null
  } finally {
    stream?.getTracks().forEach((t) => t.stop())
  }
}
