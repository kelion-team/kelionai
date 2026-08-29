import WebSocket from 'ws'
import { config } from '../config.js'
import { CHARTER_CHAT_VOCE_LEGI } from './charterChatVoce.js'
import { clasificaEroareOpenAIRealtime, clasificaStatusOpenAIRealtime, eroareOpenAIRealtimeEsteGlobala } from './openaiVoiceStatus.js'
import type { VocalLiveFailureCode } from '../shared/api-types.js'

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
  model: string
  surface: 'realtime' | 'realtime_transcription'
  inputTokens: number
  outputTokens: number
  totalTokens: number
  inputAudioTokens: number
  outputAudioTokens: number
}

export interface VocalLiveEvenimente {
  onGata?(): Promise<boolean | void | DebitVocalGate>
    | boolean
    | void
    | DebitVocalGate
  onAudioIesire(base64pcm24: string): void
  onTranscriereUser(text: string, final: boolean): void
  onTranscriereKelion(text: string, final: boolean): void
  onUnealta(apel: { id: string; name: string; args: Record<string, unknown> }): void
  onIntrerupt?(): void
  onTuraGata?(): void
  onUsage?(usage: RealtimeUsage): Promise<void> | void
  onEroare(motiv: string, code?: VocalLiveFailureCode): void
  onInfo?(msg: string): void
}

export interface DebitVocalGate {
  rezervaConsum(): Promise<boolean>
  confirmaDupaTrimitere(): Promise<boolean>
}

interface DebitVocalGateIntern extends DebitVocalGate {
  pregatesteDebit?(): Promise<boolean>
  debiteazaLaPrimaIntrare?(): Promise<boolean>
  incheieAsteptareaDebitului?(durabil: boolean): void
}

export interface VocalLive {
  scrieAudio(pcm16k: Buffer): void
  anunta(text: string): void
  ancoreaza(text: string): void
  raspundeUnealta(id: string, name: string, rezultat: unknown): void
  /** O debitare periodică anulează răspunsul activ și oprește imediat orice
   * intrare care poate produce usage. Coada se varsă numai după confirmare. */
  asteaptaDebit(
    debiteaza: () => Promise<boolean>,
    rezervaConsum: () => Promise<boolean>,
    confirmaDupaTrimitere: () => Promise<boolean>,
  ): Promise<boolean>
  intrerupe(): void
  inchide(): void
}

export function modelTranscriereRealtimeMeterizabil(model: string): boolean {
  const normalized = model.trim().toLowerCase()
  // Realtime transcription usage can be token- or duration-based. The current
  // durable ledger stores token classes, so duration-priced models (notably
  // Whisper) must never be advertised as available until that schema exists.
  return /^gpt-[a-z0-9._-]*transcrib[a-z0-9._-]*$/.test(normalized) && !normalized.includes('whisper')
}

export function vocalLiveDisponibila(): boolean {
  return Boolean(
    config.openai.key
    && VOCAL_LIVE_MODEL
    && modelTranscriereRealtimeMeterizabil(config.openai.realtimeTranscription),
  )
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
  | { fel: 'unealta'; responseId: string; id: string; name: string; args: Record<string, unknown> }
  | { fel: 'intrerupt' }
  | { fel: 'turaGata'; responseId: string; executaUnelte: boolean }
  | { fel: 'usage'; usage: RealtimeUsage }
  | { fel: 'eroare'; motiv: string; code?: VocalLiveFailureCode }

interface TokenUsageStrict {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  inputAudioTokens: number
  outputAudioTokens: number
}

function recordStrict(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function nonNegativeSafeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : null
}

function providerIdentifierStrict(value: unknown, maxLength = 160): string | null {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maxLength
    && /^[A-Za-z0-9._:-]+$/.test(value)
    ? value
    : null
}

function audioTokensStrict(value: unknown): number | null {
  if (value === undefined) return 0
  const details = recordStrict(value)
  if (!details) return null
  if (!Object.prototype.hasOwnProperty.call(details, 'audio_tokens')) return 0
  return nonNegativeSafeInteger(details.audio_tokens)
}

function tokenUsageStrict(value: unknown, requireTokenType = false): TokenUsageStrict | null {
  const raw = recordStrict(value)
  if (!raw || (requireTokenType && raw.type !== 'tokens')) return null
  const inputTokens = nonNegativeSafeInteger(raw.input_tokens)
  const outputTokens = nonNegativeSafeInteger(raw.output_tokens)
  const totalTokens = nonNegativeSafeInteger(raw.total_tokens)
  const inputAudioTokens = audioTokensStrict(raw.input_token_details)
  const outputAudioTokens = audioTokensStrict(raw.output_token_details)
  if (
    inputTokens === null
    || outputTokens === null
    || totalTokens === null
    || inputAudioTokens === null
    || outputAudioTokens === null
  ) return null
  if (
    totalTokens !== inputTokens + outputTokens
    || inputAudioTokens > inputTokens
    || outputAudioTokens > outputTokens
  ) return null
  return { inputTokens, outputTokens, totalTokens, inputAudioTokens, outputAudioTokens }
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
    const usage = tokenUsageStrict(m.usage, true)
    const usageId = providerIdentifierStrict(m.event_id ?? m.item_id)
    const frames: VocalLiveCadru[] = text ? [{ fel: 'user', text, final: true }] : []
    // Input transcription has its own rate card and is not included in the
    // speech-to-speech response usage. A completed event without an
    // idempotency key/usage cannot be reconciled safely, so fail closed.
    if (!usage || !usageId) return [...frames, {
      fel: 'eroare',
      motiv: 'realtime_transcription_usage_unavailable',
      code: 'billing_unavailable',
    }]
    return [...frames, {
      fel: 'usage',
      usage: {
        responseId: usageId,
        model: config.openai.realtimeTranscription,
        surface: 'realtime_transcription',
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: usage.totalTokens,
        inputAudioTokens: usage.inputAudioTokens,
        outputAudioTokens: usage.outputAudioTokens,
      },
    }]
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
    const responseId = providerIdentifierStrict(m.response_id)
    const id = providerIdentifierStrict(m.call_id ?? m.item_id)
    const name = providerIdentifierStrict(m.name, 64)
    if (!responseId || !id || !name) return [{ fel: 'eroare', motiv: 'realtime_tool_call_invalid' }]
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
    return [{ fel: 'unealta', responseId, id, name, args }]
  }
  if (type === 'input_audio_buffer.speech_started') return [{ fel: 'intrerupt' }]
  if (type === 'response.done') {
    const response = recordStrict(m.response) ?? {}
    const responseId = providerIdentifierStrict(response.id)
    const status = String(response.status ?? '')
    if (!responseId) return [{
      fel: 'eroare',
      motiv: 'realtime_usage_missing_response_id',
      code: 'billing_unavailable',
    }]
    const parsedUsage = tokenUsageStrict(response.usage)
    if (!parsedUsage) return [{
      fel: 'eroare',
      motiv: 'provider_usage_unavailable',
      code: 'billing_unavailable',
    }]
    const usage: RealtimeUsage = {
      responseId,
      model: VOCAL_LIVE_MODEL,
      surface: 'realtime',
      ...parsedUsage,
    }
    const usageEvent: VocalLiveCadru[] = [{ fel: 'usage', usage }]
    if (status === 'cancelled' || status === 'canceled') {
      return [...usageEvent, { fel: 'intrerupt' }]
    }
    // `incomplete` is a turn-level limit (for example max_output_tokens), not
    // proof that the key/model/session is broken. Preserve any partial answer,
    // close the turn normally and keep the microphone session alive.
    if (status === 'incomplete') return [...usageEvent, {
      fel: 'turaGata',
      responseId: usage.responseId,
      executaUnelte: false,
    }]
    if (status === 'failed') {
      const detail = (response.status_details ?? {}) as Record<string, unknown>
      const providerError = detail.error ?? detail.reason ?? status
      const code = clasificaEroareOpenAIRealtime(providerError)
      if (
        eroareOpenAIRealtimeEsteGlobala(code)
        || code === 'rate_limit'
        || code === 'provider_5xx'
      ) return [...usageEvent, {
        fel: 'eroare',
        motiv: 'openai_realtime_response_failed',
        code,
      }]
      // Other failed responses are turn-scoped. Discard staged side effects
      // and keep the healthy microphone session alive.
      return [...usageEvent, { fel: 'turaGata', responseId: usage.responseId, executaUnelte: false }]
    }
    if (status === 'completed') return [...usageEvent, {
      fel: 'turaGata',
      responseId: usage.responseId,
      executaUnelte: true,
    }]
    return [...usageEvent, {
      fel: 'eroare',
      motiv: 'openai_realtime_response_status_invalid',
      code: 'configuration',
    }]
  }
  if (type === 'error') {
    const error = (m.error ?? {}) as Record<string, unknown>
    const code = clasificaEroareOpenAIRealtime(error)
    // Invalid turn requests remain recoverable. Account-wide failures and
    // transient provider failures are surfaced with a closed public code so
    // the client can offer a safe retry without receiving provider text.
    if (
      !eroareOpenAIRealtimeEsteGlobala(code)
      && code !== 'rate_limit'
      && code !== 'provider_5xx'
    ) return []
    return [{
      fel: 'eroare',
      motiv: 'openai_realtime_unavailable',
      code,
    }]
  }
  return []
}

type ApelUnealtaRealtime = Extract<VocalLiveCadru, { fel: 'unealta' }>

/** Tool arguments are only a proposal until the provider commits the whole
 * response as `completed`. Failed, cancelled or incomplete turns must never
 * execute side effects that the model did not finish authoritatively. */
export function creeazaPoartaUnelteRealtime(
  executa: (apel: Omit<ApelUnealtaRealtime, 'fel' | 'responseId'>) => void,
): {
  pregateste: (apel: ApelUnealtaRealtime) => void
  finalizeaza: (responseId: string, committed: boolean) => void
  anuleaza: () => void
} {
  const pending = new Map<string, Map<string, Omit<ApelUnealtaRealtime, 'fel' | 'responseId'>>>()
  return {
    pregateste: ({ responseId, id, name, args }) => {
      const calls = pending.get(responseId) ?? new Map()
      calls.set(id, { id, name, args })
      pending.set(responseId, calls)
    },
    finalizeaza: (responseId, committed) => {
      const calls = committed ? [...(pending.get(responseId)?.values() ?? [])] : []
      pending.delete(responseId)
      for (const call of calls) executa(call)
    },
    anuleaza: () => pending.clear(),
  }
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
  let errorReported = false
  const queuedAudio: Buffer[] = []
  let queuedAudioBytes = 0
  let meteringInFlight = false
  let debitInFlight = false
  let consumeDebitInFlight = false
  let pendingDebitGate: DebitVocalGateIntern | null = null
  let raspunsProviderActiv = false
  const asteptariMeteringAnterior = new Set<(durabil: boolean) => void>()
  const meteringQueue: Array<
    | { kind: 'audio'; audio: Buffer }
    | { kind: 'message'; message: Record<string, unknown> }
  > = []
  let meteringQueueBytes = 0
  const maxQueuedAudioBytes = 2 * 1024 * 1024 // hardcod-permis: pre-ready memory ceiling
  const maxMeteringQueueBytes = 2 * 1024 * 1024 // hardcod-permis: bounded 5 s metering pause
  const debitReserveDeadlineMs = 11_000 // hardcod-permis: first input may need debit + durable reservation
  const debitStartDeadlineMs = 5_500 // hardcod-permis: gard peste deadline-ul DB al debitului
  const debitSendDeadlineMs = 5_000 // hardcod-permis: toate cadrele trebuie scrise înainte de ACK
  const debitAckDeadlineMs = 5_500 // hardcod-permis: provider may be active only for this bounded DB acknowledgement
  const previousUsageDeadlineMs = 5_500 // hardcod-permis: cancel -> response.done + metering durabil
  const ws = new WebSocket(`${WS_URL}?model=${encodeURIComponent(VOCAL_LIVE_MODEL)}`, {
    headers: { Authorization: `Bearer ${config.openai.key}` },
  })
  let setupTimer: ReturnType<typeof setTimeout> | null = null
  const incheieAsteptariMeteringAnterior = (durabil: boolean): void => {
    for (const resolve of asteptariMeteringAnterior) resolve(durabil)
    asteptariMeteringAnterior.clear()
  }
  const closeProviderNow = (): void => {
    if (closed) return
    closed = true
    if (setupTimer) clearTimeout(setupTimer)
    queuedAudio.length = 0
    queuedAudioBytes = 0
    meteringQueue.length = 0
    meteringQueueBytes = 0
    incheieAsteptariMeteringAnterior(false)
    pendingDebitGate?.incheieAsteptareaDebitului?.(false)
    pendingDebitGate = null
    try { ws.terminate() } catch { /* already closed */ }
  }
  const reportError = (motiv: string, code?: VocalLiveFailureCode): void => {
    if (errorReported) return
    errorReported = true
    closeProviderNow()
    ev.onEroare(motiv, code)
  }
  setupTimer = setTimeout(() => {
    if (closed || ready) return
    reportError('openai_realtime_setup_timeout', 'transport')
  }, 10_000) // hardcod-permis: bounded provider setup timeout

  const queueAudio = (audio: Buffer): void => {
    queuedAudio.push(audio)
    queuedAudioBytes += audio.length
    while (queuedAudioBytes > maxQueuedAudioBytes && queuedAudio.length) {
      queuedAudioBytes -= queuedAudio.shift()?.length ?? 0
    }
  }

  const send = (message: Record<string, unknown>): boolean => {
    if (closed || ws.readyState !== WebSocket.OPEN) return false
    try {
      ws.send(JSON.stringify(message))
      if (message.type === 'response.create') raspunsProviderActiv = true
      return true
    } catch {
      return false
    }
  }
  const sendCuConfirmare = (
    message: Record<string, unknown>,
    deadlineEpochMs: number,
  ): Promise<boolean> => {
    if (closed || ws.readyState !== WebSocket.OPEN) return Promise.resolve(false)
    let payload: string
    try {
      payload = JSON.stringify(message)
    } catch {
      return Promise.resolve(false)
    }
    return new Promise<boolean>((resolve) => {
      let settled = false
      let timer: ReturnType<typeof setTimeout> | null = null
      const finish = (ok: boolean): void => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        resolve(ok)
      }
      const remainingMs = deadlineEpochMs - Date.now()
      if (remainingMs <= 0) {
        finish(false)
        return
      }
      timer = setTimeout(() => finish(false), remainingMs)
      try {
        ws.send(payload, (error?: Error) => {
          if (!error && message.type === 'response.create') raspunsProviderActiv = true
          finish(!error)
        })
      } catch {
        finish(false)
      }
    })
  }
  const queueWhileMetering = (
    item: (typeof meteringQueue)[number],
    bytes: number,
  ): boolean => {
    if (meteringQueueBytes + bytes > maxMeteringQueueBytes) {
      reportError('realtime_metering_queue_overflow', 'billing_unavailable')
      return false
    }
    meteringQueue.push(item)
    meteringQueueBytes += bytes
    return true
  }
  const sendTurnMessages = (messages: Record<string, unknown>[]): void => {
    if (closed) return
    if (!ready) {
      for (const message of messages) {
        const bytes = Buffer.byteLength(JSON.stringify(message), 'utf8')
        if (!queueWhileMetering({ kind: 'message', message }, bytes)) return
      }
      return
    }
    if (meteringInFlight) {
      for (const message of messages) {
        const bytes = Buffer.byteLength(JSON.stringify(message), 'utf8')
        if (!queueWhileMetering({ kind: 'message', message }, bytes)) return
      }
      return
    }
    if (debitInFlight) {
      for (const message of messages) {
        const bytes = Buffer.byteLength(JSON.stringify(message), 'utf8')
        if (!queueWhileMetering({ kind: 'message', message }, bytes)) return
      }
      return
    }
    if (consumeDebitInFlight || pendingDebitGate) {
      for (const message of messages) {
        const bytes = Buffer.byteLength(JSON.stringify(message), 'utf8')
        if (!queueWhileMetering({ kind: 'message', message }, bytes)) return
      }
      startDebitConsumption()
      return
    }
    for (const message of messages) send(message)
  }
  const sendText = (text: string, respond: boolean): void => {
    if (!text.trim()) return
    const messages: Record<string, unknown>[] = [{
      type: 'conversation.item.create',
      item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: text.trim().slice(0, 12_000) }] },
    }]
    if (respond) messages.push({ type: 'response.create' })
    sendTurnMessages(messages)
  }
  const poartaUnelte = creeazaPoartaUnelteRealtime(ev.onUnealta)

  const flushQueuedAudio = (): void => {
    if (closed || !ready || meteringInFlight || debitInFlight || consumeDebitInFlight || pendingDebitGate) return
    for (const audio of queuedAudio.splice(0)) send({ type: 'input_audio_buffer.append', audio: audio.toString('base64') })
    queuedAudioBytes = 0
  }

  const flushMeteringQueue = (): void => {
    if (closed || !ready || meteringInFlight || debitInFlight || consumeDebitInFlight || pendingDebitGate) return
    for (const item of meteringQueue.splice(0)) {
      if (item.kind === 'audio') send({ type: 'input_audio_buffer.append', audio: item.audio.toString('base64') })
      else send(item.message)
    }
    meteringQueueBytes = 0
  }

  const drainDebitQueue = async (): Promise<boolean> => {
    if (closed || !ready || ws.readyState !== WebSocket.OPEN) return false
    const deadlineEpochMs = Date.now() + debitSendDeadlineMs
    const meteringItems = meteringQueue.splice(0)
    meteringQueueBytes = 0
    const audioItems = queuedAudio.splice(0)
    queuedAudioBytes = 0
    let sent = false
    for (const item of meteringItems) {
      const ok = await sendCuConfirmare(
        item.kind === 'audio'
          ? { type: 'input_audio_buffer.append', audio: item.audio.toString('base64') }
          : item.message,
        deadlineEpochMs,
      )
      if (!ok) return false
      sent = true
    }
    for (const audio of audioItems) {
      if (!await sendCuConfirmare(
        { type: 'input_audio_buffer.append', audio: audio.toString('base64') },
        deadlineEpochMs,
      )) return false
      sent = true
    }
    return sent
  }

  const asteaptaPoartaCuDeadline = (
    callback: () => Promise<boolean>,
    deadlineMs: number,
  ): Promise<boolean> => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const deadline = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), deadlineMs)
    })
    const operation = Promise.resolve().then(callback).catch(() => false)
    return Promise.race([operation, deadline]).finally(() => {
      if (timer) clearTimeout(timer)
    })
  }

  const asteaptaMeteringAnterior = (): Promise<boolean> => {
    if (!raspunsProviderActiv) return Promise.resolve(true)
    return new Promise<boolean>((resolve) => {
      let settled = false
      let timer: ReturnType<typeof setTimeout> | null = null
      const finish = (durabil: boolean): void => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        asteptariMeteringAnterior.delete(finish)
        resolve(durabil)
      }
      asteptariMeteringAnterior.add(finish)
      timer = setTimeout(() => finish(false), previousUsageDeadlineMs)
    })
  }

  const failDebitGate = (motiv: string): void => {
    // If provider-bound input already crossed the transport boundary, stop the
    // response before terminating. The unacknowledged durable operation stays
    // eligible for the restart reconciler.
    send({ type: 'response.cancel' })
    reportError(motiv, 'billing_unavailable')
  }

  function startDebitConsumption(): void {
    if (
      closed
      || !ready
      || debitInFlight
      || consumeDebitInFlight
      || meteringInFlight
      || !pendingDebitGate
      || (meteringQueue.length === 0 && queuedAudio.length === 0)
    ) return
    const gate = pendingDebitGate
    consumeDebitInFlight = true
    void (async () => {
      if (gate.pregatesteDebit) {
        const pregatit = await gate.pregatesteDebit()
        gate.pregatesteDebit = undefined
        if (closed) return
        if (!pregatit) {
          consumeDebitInFlight = false
          failDebitGate('provider_usage_unavailable')
          return
        }
      }
      if (gate.debiteazaLaPrimaIntrare) {
        debitInFlight = true
        const durabil = await asteaptaPoartaCuDeadline(
          gate.debiteazaLaPrimaIntrare,
          debitStartDeadlineMs,
        )
        debitInFlight = false
        gate.debiteazaLaPrimaIntrare = undefined
        if (closed) return
        if (!durabil) {
          consumeDebitInFlight = false
          failDebitGate('voice_billing_unavailable')
          return
        }
      }
      const durable = await asteaptaPoartaCuDeadline(gate.rezervaConsum, debitReserveDeadlineMs)
      if (closed) return
      if (!durable) {
        consumeDebitInFlight = false
        failDebitGate('voice_billing_consume_unavailable')
        return
      }
      if (!await drainDebitQueue()) {
        consumeDebitInFlight = false
        reportError('openai_realtime_socket_error', 'transport')
        return
      }
      const acknowledged = await asteaptaPoartaCuDeadline(gate.confirmaDupaTrimitere, debitAckDeadlineMs)
      if (closed) return
      if (!acknowledged) {
        consumeDebitInFlight = false
        failDebitGate('voice_billing_ack_unavailable')
        return
      }
      gate.incheieAsteptareaDebitului?.(true)
      if (pendingDebitGate === gate) pendingDebitGate = null
      consumeDebitInFlight = false
      flushMeteringQueue()
      flushQueuedAudio()
    })().catch(() => {
      debitInFlight = false
      consumeDebitInFlight = false
      gate.incheieAsteptareaDebitului?.(false)
      if (!closed) failDebitGate('voice_billing_consume_unavailable')
    })
  }

  ws.on('open', () => send(construiesteSetup(VOCAL_LIVE_MODEL, VOCAL_LIVE_VOICE, instructiune, unelte, limba)))
  const processMessage = async (raw: Buffer): Promise<void> => {
    let message: Record<string, unknown>
    try { message = JSON.parse(raw.toString('utf8')) as Record<string, unknown> } catch { return }
    const providerType = String(message.type ?? '')
    if (
      providerType === 'response.created'
      || providerType === 'input_audio_buffer.speech_stopped'
      || providerType === 'input_audio_buffer.committed'
      || providerType.startsWith('response.output_audio.')
      || providerType.startsWith('response.output_audio_transcript.')
      || providerType.startsWith('response.function_call_arguments.')
    ) raspunsProviderActiv = true
    for (const event of interpreteazaCadru(message)) {
      if (closed) return
      if (event.fel === 'gata') {
        if (setupTimer) clearTimeout(setupTimer)
        let accepted: boolean | void | DebitVocalGate
        try {
          accepted = await ev.onGata?.()
        } catch {
          reportError('voice_billing_unavailable', 'billing_unavailable')
          return
        }
        if (accepted === false) {
          reportError('voice_billing_unavailable', 'billing_unavailable')
          return
        }
        if (closed) return
        if (accepted && typeof accepted === 'object') pendingDebitGate = accepted
        ready = true
        startDebitConsumption()
        flushQueuedAudio()
        ev.onInfo?.('OpenAI Realtime session ready: native audio, server VAD, interruption and tool calls')
      } else if (event.fel === 'audio') ev.onAudioIesire(event.data)
      else if (event.fel === 'user') ev.onTranscriereUser(event.text, event.final)
      else if (event.fel === 'kelion') ev.onTranscriereKelion(event.text, event.final)
      else if (event.fel === 'unealta') poartaUnelte.pregateste(event)
      else if (event.fel === 'intrerupt') {
        poartaUnelte.anuleaza()
        ev.onIntrerupt?.()
      }
      else if (event.fel === 'usage') {
        meteringInFlight = true
        try {
          await ev.onUsage?.(event.usage)
          if (event.usage.surface === 'realtime') {
            raspunsProviderActiv = false
            incheieAsteptariMeteringAnterior(true)
          }
        } catch {
          reportError('provider_usage_unavailable', 'billing_unavailable')
          return
        } finally {
          meteringInFlight = false
        }
        startDebitConsumption()
        flushMeteringQueue()
        flushQueuedAudio()
      }
      else if (event.fel === 'turaGata') {
        poartaUnelte.finalizeaza(event.responseId, event.executaUnelte)
        ev.onTuraGata?.()
      } else if (event.fel === 'eroare') {
        poartaUnelte.anuleaza()
        reportError(event.motiv, event.code)
      }
    }
  }
  let messageChain = Promise.resolve()
  ws.on('message', (raw: Buffer) => {
    messageChain = messageChain
      .then(() => processMessage(raw))
      .catch(() => reportError('openai_realtime_event_processing_failed', 'transport'))
  })
  ws.on('error', () => reportError('openai_realtime_socket_error', 'transport'))
  ws.on('unexpected-response', (_request, response) => {
    const status = response.statusCode
    if (typeof status !== 'number') {
      reportError('openai_realtime_handshake_rejected', 'transport')
      response.resume()
      return
    }
    // 429 separates quota from rate-limit, while 404 separates a missing model
    // from a generic bad request. Read at most 8 KiB for classification only;
    // provider content is never returned, logged or persisted.
    let body = ''
    let finished = false
    const finish = (providerError?: unknown): void => {
      if (finished) return
      finished = true
      reportError(
        'openai_realtime_handshake_rejected',
        clasificaStatusOpenAIRealtime(status, providerError),
      )
      response.resume()
    }
    response.setEncoding('utf8')
    response.on('data', (chunk: string) => {
      if (body.length < 8_192) body += chunk.slice(0, 8_192 - body.length)
    })
    response.on('end', () => {
      let providerError: unknown
      try {
        const payload = JSON.parse(body) as Record<string, unknown>
        providerError = payload.error
      } catch {
        providerError = undefined
      }
      finish(providerError)
    })
    response.on('error', () => finish())
  })
  ws.on('close', () => {
    if (setupTimer) clearTimeout(setupTimer)
    poartaUnelte.anuleaza()
    if (!closed) reportError('openai_realtime_closed', 'transport')
  })

  return {
    scrieAudio(pcm16k): void {
      if (closed || !pcm16k.length || pcm16k.length > 128 * 1024) return
      const pcm24k = resamplePcm16Mono16To24(pcm16k)
      if (!ready) {
        queueAudio(pcm24k)
        return
      }
      if (meteringInFlight) {
        queueWhileMetering({ kind: 'audio', audio: pcm24k }, pcm24k.length)
        return
      }
      if (debitInFlight) {
        queueWhileMetering({ kind: 'audio', audio: pcm24k }, pcm24k.length)
        return
      }
      if (consumeDebitInFlight || pendingDebitGate) {
        queueWhileMetering({ kind: 'audio', audio: pcm24k }, pcm24k.length)
        startDebitConsumption()
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
      sendTurnMessages([
        { type: 'conversation.item.create', item: { type: 'function_call_output', call_id: id, output: output.slice(0, 40_000) } },
        { type: 'response.create' },
      ])
    },
    asteaptaDebit(debiteaza, rezervaConsum, confirmaDupaTrimitere): Promise<boolean> {
      if (closed) {
        return Promise.resolve(false)
      }
      if (debitInFlight || consumeDebitInFlight || pendingDebitGate) {
        reportError('voice_billing_overlap', 'billing_unavailable')
        return Promise.resolve(false)
      }
      // Oprește tura care poate continua să genereze cost în timp ce DB-ul
      // decide următorul minut. Cancel-ul direct precedă orice coadă vărsată.
      poartaUnelte.anuleaza()
      const cancelConfirmat = sendCuConfirmare(
        { type: 'response.cancel' },
        Date.now() + debitSendDeadlineMs,
      )
      const meteringAnterior = asteaptaMeteringAnterior()
      ev.onIntrerupt?.()
      let settled = false
      let settleDebit!: (durabil: boolean) => void
      const debit = new Promise<boolean>((resolve) => {
        settleDebit = (durabil) => {
          if (settled) return
          settled = true
          resolve(durabil)
        }
      })
      pendingDebitGate = {
        pregatesteDebit: async () => {
          const [cancelDurabil, usageDurabil] = await Promise.all([
            cancelConfirmat,
            meteringAnterior,
          ])
          return cancelDurabil && usageDurabil
        },
        debiteazaLaPrimaIntrare: async () => {
          return debiteaza()
        },
        incheieAsteptareaDebitului: settleDebit,
        rezervaConsum,
        confirmaDupaTrimitere,
      }
      void Promise.all([cancelConfirmat, meteringAnterior]).then(([confirmat, metered]) => {
        if (closed) return
        if (!confirmat) reportError('openai_realtime_socket_error', 'transport')
        else if (!metered) reportError('provider_usage_unavailable', 'billing_unavailable')
      })
      // Debitul rămâne leneș până când apare primul cadru care chiar trebuie
      // trimis providerului; un minut de tăcere nu micșorează portofelul.
      startDebitConsumption()
      return debit
    },
    intrerupe(): void { send({ type: 'response.cancel' }) },
    inchide(): void {
      closed = true
      if (setupTimer) clearTimeout(setupTimer)
      poartaUnelte.anuleaza()
      queuedAudio.length = 0
      queuedAudioBytes = 0
      meteringQueue.length = 0
      meteringQueueBytes = 0
      incheieAsteptariMeteringAnterior(false)
      pendingDebitGate?.incheieAsteptareaDebitului?.(false)
      pendingDebitGate = null
      try { ws.close() } catch { /* already closed */ }
    },
  }
}
