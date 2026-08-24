import WebSocket from 'ws'
import { config } from '../config.js'
import { CHARTER_CHAT_VOCE_LEGI } from './charterChatVoce.js'

const WS_URL = 'wss://api.openai.com/v1/realtime'

export const VOCAL_LIVE_MODEL = config.openai.realtime
export const VOCAL_LIVE_VOICE = config.openaiVoice

export function octetiDinBase64(b64: string): number {
  if (!b64) return 0
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((b64.length / 4) * 3) - padding)
}

export interface AncoraRealitate {
  nowIso?: string
  tz?: string
  lat?: number
  lon?: number
  acc?: number
}

export function oraLocalaText(nowIso: string, tz?: string): string {
  try {
    const date = new Date(nowIso)
    if (!Number.isFinite(date.getTime())) return ''
    return new Intl.DateTimeFormat('ro-RO', {
      dateStyle: 'full',
      timeStyle: 'medium',
      ...(tz ? { timeZone: tz } : {}),
    }).format(date)
  } catch {
    return ''
  }
}

export function construiesteInstructiune(
  persona: string,
  nume: string,
  istoric: Array<{ role?: string; content?: string }> = [],
  ancora?: AncoraRealitate,
  limba?: string,
): string {
  const local = ancora?.nowIso ? oraLocalaText(ancora.nowIso, ancora.tz) : ''
  const coordonate = Number.isFinite(ancora?.lat) && Number.isFinite(ancora?.lon)
    ? `${Number(ancora?.lat).toFixed(5)}, ${Number(ancora?.lon).toFixed(5)}`
    : ''
  const history = istoric
    .slice(-12)
    .map((m) => `${m.role === 'assistant' ? 'Kelion' : nume}: ${String(m.content ?? '').slice(0, 400)}`)
    .join('\n')
  return [
    persona,
    CHARTER_CHAT_VOCE_LEGI,
    `Vorbești natural cu ${nume}. Păstrează aceeași identitate, memorie, sesiune și aceleași unelte ca în chat.`,
    limba ? `Limba preferată a conversației este ${limba}; schimb-o numai la cererea explicită a persoanei.` : '',
    local ? `Ora locală măsurată de client: ${local}.` : '',
    coordonate ? `Coordonate oferite cu consimțământ pentru această sesiune: ${coordonate}.` : '',
    history ? `Ultimele schimburi, numai ca context:\n${history}` : '',
  ].filter(Boolean).join('\n\n')
}

export interface UnealtaVocala {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface RealtimeUsage {
  responseId: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  inputAudioTokens: number
  outputAudioTokens: number
}

export interface VocalLiveEvenimente {
  onGata?(): void
  onAudioIesire(base64pcm24: string): void
  onTranscriereUser(text: string, final: boolean): void
  onTranscriereKelion(text: string, final: boolean): void
  onUnealta(apel: { id: string; name: string; args: Record<string, unknown> }): void
  onIntrerupt?(): void
  onTuraGata?(): void
  onUsage?(usage: RealtimeUsage): void
  onEroare(motiv: string): void
  onInfo?(msg: string): void
}

export interface VocalLive {
  scrieAudio(pcm16k: Buffer): void
  anunta(text: string): void
  ancoreaza(text: string): void
  raspundeUnealta(id: string, name: string, rezultat: unknown): void
  intrerupe(): void
  inchide(): void
}

export function vocalLiveDisponibila(): boolean {
  return Boolean(config.openai.key && VOCAL_LIVE_MODEL)
}

export function construiesteSetup(
  model: string,
  voce: string,
  instructiune: string,
  unelte: UnealtaVocala[],
  limba?: string,
): Record<string, unknown> {
  return {
    type: 'session.update',
    session: {
      type: 'realtime',
      model,
      instructions: instructiune,
      output_modalities: ['audio'],
      audio: {
        input: {
          format: { type: 'audio/pcm', rate: 24_000 },
          noise_reduction: { type: 'near_field' },
          transcription: {
            ...(config.openai.realtimeTranscription ? { model: config.openai.realtimeTranscription } : {}),
            ...(limba ? { language: limba.split('-')[0] } : {}),
          },
          turn_detection: {
            type: 'server_vad',
            create_response: true,
            interrupt_response: true,
            prefix_padding_ms: 300,
            silence_duration_ms: 500,
          },
        },
        output: {
          format: { type: 'audio/pcm', rate: 24_000 },
          voice: voce,
        },
      },
      tools: unelte.map((tool) => ({
        type: 'function',
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      })),
      tool_choice: 'auto',
    },
  }
}

export type VocalLiveCadru =
  | { fel: 'gata' }
  | { fel: 'audio'; data: string }
  | { fel: 'user'; text: string; final: boolean }
  | { fel: 'kelion'; text: string; final: boolean }
  | { fel: 'unealta'; id: string; name: string; args: Record<string, unknown> }
  | { fel: 'intrerupt' }
  | { fel: 'turaGata' }
  | { fel: 'usage'; usage: RealtimeUsage }
  | { fel: 'eroare'; motiv: string }

function nonNegativeInt(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0
}

export function interpreteazaCadru(m: Record<string, unknown>): VocalLiveCadru[] {
  const type = String(m.type ?? '')
  if (type === 'session.updated') return [{ fel: 'gata' }]
  if (type === 'response.output_audio.delta' || type === 'response.audio.delta') {
    const data = String(m.delta ?? '')
    return data ? [{ fel: 'audio', data }] : []
  }
  if (type === 'conversation.item.input_audio_transcription.delta') {
    const text = String(m.delta ?? '')
    return text ? [{ fel: 'user', text, final: false }] : []
  }
  if (type === 'conversation.item.input_audio_transcription.completed') {
    const text = String(m.transcript ?? '')
    return text ? [{ fel: 'user', text, final: true }] : []
  }
  if (type === 'response.output_audio_transcript.delta' || type === 'response.audio_transcript.delta') {
    const text = String(m.delta ?? '')
    return text ? [{ fel: 'kelion', text, final: false }] : []
  }
  if (type === 'response.output_audio_transcript.done' || type === 'response.audio_transcript.done') {
    const text = String(m.transcript ?? '')
    return text ? [{ fel: 'kelion', text, final: true }] : []
  }
  if (type === 'response.function_call_arguments.done') {
    const id = String(m.call_id ?? m.item_id ?? '')
    const name = String(m.name ?? '')
    if (!id || !name) return [{ fel: 'eroare', motiv: 'realtime_tool_call_invalid' }]
    let args: Record<string, unknown>
    try {
      const parsed = JSON.parse(String(m.arguments ?? '{}')) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return [{ fel: 'eroare', motiv: 'realtime_tool_arguments_invalid' }]
      }
      args = parsed as Record<string, unknown>
    } catch {
      return [{ fel: 'eroare', motiv: 'realtime_tool_arguments_invalid' }]
    }
    return [{ fel: 'unealta', id, name, args }]
  }
  if (type === 'input_audio_buffer.speech_started') return [{ fel: 'intrerupt' }]
  if (type === 'response.done') {
    const response = (m.response ?? {}) as Record<string, unknown>
    const raw = (response.usage ?? {}) as Record<string, unknown>
    const inputDetails = (raw.input_token_details ?? {}) as Record<string, unknown>
    const outputDetails = (raw.output_token_details ?? {}) as Record<string, unknown>
    const usage: RealtimeUsage = {
      responseId: String(response.id ?? ''),
      inputTokens: nonNegativeInt(raw.input_tokens),
      outputTokens: nonNegativeInt(raw.output_tokens),
      totalTokens: nonNegativeInt(raw.total_tokens),
      inputAudioTokens: nonNegativeInt(inputDetails.audio_tokens),
      outputAudioTokens: nonNegativeInt(outputDetails.audio_tokens),
    }
    const usageEvent: VocalLiveCadru[] = usage.responseId ? [{ fel: 'usage', usage }] : []
    const status = String(response.status ?? '')
    if (status && status !== 'completed') {
      const detail = (response.status_details ?? {}) as Record<string, unknown>
      return [...usageEvent, { fel: 'eroare', motiv: `realtime_response_${status}:${String(detail.reason ?? detail.error ?? '').slice(0, 160)}` }]
    }
    if (!usage.responseId) return [{ fel: 'eroare', motiv: 'realtime_usage_missing_response_id' }]
    return [...usageEvent, { fel: 'turaGata' }]
  }
  if (type === 'error') {
    const error = (m.error ?? {}) as Record<string, unknown>
    return [{ fel: 'eroare', motiv: String(error.message ?? error.code ?? 'realtime_error').slice(0, 300) }]
  }
  return []
}

function resamplePcm16Mono16To24(input: Buffer): Buffer {
  const sampleCount = Math.floor(input.length / 2)
  if (!sampleCount) return Buffer.alloc(0)
  const outputCount = Math.floor(sampleCount * 1.5)
  const output = Buffer.allocUnsafe(outputCount * 2)
  for (let i = 0; i < outputCount; i++) {
    const source = i / 1.5
    const leftIndex = Math.min(sampleCount - 1, Math.floor(source))
    const rightIndex = Math.min(sampleCount - 1, leftIndex + 1)
    const fraction = source - leftIndex
    const left = input.readInt16LE(leftIndex * 2)
    const right = input.readInt16LE(rightIndex * 2)
    const sample = Math.max(-32_768, Math.min(32_767, Math.round(left + (right - left) * fraction)))
    output.writeInt16LE(sample, i * 2)
  }
  return output
}

export function deschideVocalLive(
  instructiune: string,
  unelte: UnealtaVocala[],
  ev: VocalLiveEvenimente,
  limba?: string,
): VocalLive | null {
  if (!vocalLiveDisponibila()) return null
  let closed = false
  let ready = false
  const queuedAudio: Buffer[] = []
  let queuedAudioBytes = 0
  const maxQueuedAudioBytes = 2 * 1024 * 1024 // hardcod-permis: pre-ready memory ceiling
  const ws = new WebSocket(`${WS_URL}?model=${encodeURIComponent(VOCAL_LIVE_MODEL)}`, {
    headers: { Authorization: `Bearer ${config.openai.key}` },
  })
  const setupTimer = setTimeout(() => {
    if (closed || ready) return
    ev.onEroare('openai_realtime_setup_timeout')
    closed = true
    try { ws.close() } catch { /* already closed */ }
  }, 10_000) // hardcod-permis: bounded provider setup timeout

  const send = (message: Record<string, unknown>): void => {
    if (closed || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify(message))
  }
  const sendText = (text: string, respond: boolean): void => {
    if (!text.trim()) return
    send({
      type: 'conversation.item.create',
      item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: text.trim().slice(0, 12_000) }] },
    })
    if (respond) send({ type: 'response.create' })
  }

  ws.on('open', () => send(construiesteSetup(VOCAL_LIVE_MODEL, VOCAL_LIVE_VOICE, instructiune, unelte, limba)))
  ws.on('message', (raw: Buffer) => {
    let message: Record<string, unknown>
    try { message = JSON.parse(raw.toString('utf8')) as Record<string, unknown> } catch { return }
    for (const event of interpreteazaCadru(message)) {
      if (event.fel === 'gata') {
        ready = true
        clearTimeout(setupTimer)
        for (const audio of queuedAudio.splice(0)) send({ type: 'input_audio_buffer.append', audio: audio.toString('base64') })
        queuedAudioBytes = 0
        ev.onInfo?.('OpenAI Realtime session ready: native audio, server VAD, interruption and tool calls')
        ev.onGata?.()
      } else if (event.fel === 'audio') ev.onAudioIesire(event.data)
      else if (event.fel === 'user') ev.onTranscriereUser(event.text, event.final)
      else if (event.fel === 'kelion') ev.onTranscriereKelion(event.text, event.final)
      else if (event.fel === 'unealta') ev.onUnealta({ id: event.id, name: event.name, args: event.args })
      else if (event.fel === 'intrerupt') ev.onIntrerupt?.()
      else if (event.fel === 'usage') ev.onUsage?.(event.usage)
      else if (event.fel === 'turaGata') ev.onTuraGata?.()
      else if (event.fel === 'eroare') ev.onEroare(event.motiv)
    }
  })
  ws.on('error', (error) => ev.onEroare(`openai_realtime_socket: ${error.message.slice(0, 200)}`))
  ws.on('close', (code, reason) => {
    clearTimeout(setupTimer)
    if (!closed) ev.onEroare(`openai_realtime_closed: ${code} ${reason.toString('utf8').slice(0, 160)}`)
  })

  return {
    scrieAudio(pcm16k): void {
      if (closed || !pcm16k.length || pcm16k.length > 128 * 1024) return
      const pcm24k = resamplePcm16Mono16To24(pcm16k)
      if (!ready) {
        queuedAudio.push(pcm24k)
        queuedAudioBytes += pcm24k.length
        while (queuedAudioBytes > maxQueuedAudioBytes && queuedAudio.length) {
          queuedAudioBytes -= queuedAudio.shift()?.length ?? 0
        }
        return
      }
      send({ type: 'input_audio_buffer.append', audio: pcm24k.toString('base64') })
    },
    anunta(text): void { sendText(text, true) },
    ancoreaza(text): void { sendText(text, false) },
    raspundeUnealta(id, _name, rezultat): void {
      if (!id) return
      let output: string
      try { output = JSON.stringify(rezultat) } catch { output = JSON.stringify({ error: 'non_serializable_tool_result' }) }
      send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: id, output: output.slice(0, 40_000) } })
      send({ type: 'response.create' })
    },
    intrerupe(): void { send({ type: 'response.cancel' }) },
    inchide(): void {
      closed = true
      clearTimeout(setupTimer)
      try { ws.close() } catch { /* already closed */ }
    },
  }
}
