// Local AI voice pipeline (STT/TTS) running as a separate microservice.
// Replaces the paid Google Cloud services when the app is configured to use it.

import { Readable } from 'stream'

const VOSK_URL = process.env.LOCAL_VOSK_URL || 'http://localhost:8010'
const STT_URL = `${VOSK_URL}/stt`
const TTS_URL = `${VOSK_URL}/tts`

export function localVoskAvailable(): boolean {
  return !!process.env.LOCAL_VOSK_URL
}

export interface LocalSttResult {
  ok: true
  lang: string
  transcript: string
}

export async function localTranscribe(
  audioBase64: string,
  langHint: string,
): Promise<LocalSttResult | { ok: false; error: string }> {
  try {
    const res = await fetch(STT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audio: audioBase64, lang: langHint }),
    })
    if (!res.ok) {
      return { ok: false, error: `stt_failed_${res.status}` }
    }
    const data = (await res.json()) as { text: string; language: string }
    return { ok: true, transcript: data.text, lang: data.language }
  } catch (e) {
    const error = e instanceof Error ? e.message : 'stt_fetch_failed'
    return { ok: false, error }
  }
}

export interface LocalTtsResult {
  ok: true
  audio: Buffer
}

export async function localSynthesize(
  text: string,
  lang: string,
): Promise<LocalTtsResult | { ok: false; error: string }> {
  try {
    const res = await fetch(TTS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, lang }),
    })
    if (!res.ok) {
      return { ok: false, error: `tts_failed_${res.status}` }
    }
    const audioBlob = await res.blob()
    const audioBuffer = await audioBlob.arrayBuffer()
    return { ok: true, audio: Buffer.from(audioBuffer) }
  } catch (e) {
    const error = e instanceof Error ? e.message : 'tts_fetch_failed'
    return { ok: false, error }
  }
}
