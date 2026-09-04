import { createHmac } from 'node:crypto'
import { config } from '../config.js'
import { recordProviderUsage } from '../db.js'
import { readSSE } from './sse.js'
import type { BrainTool, BrainCallOpts, OrChatResult, OrMessage, OrToolCall, ResponseCarryItem } from './brainContract.js'
import {
  allowlistedOpenAIProviderCode,
  cacheOpenAIHealthProbe,
  classifyOpenAIError,
  probeOpenAIHealth,
  type OpenAIAuthMode,
  type OpenAIHealthResult,
  type OpenAIProviderErrorCode,
} from './openaiHealth.js'

export { probeOpenAIHealth } from './openaiHealth.js'
export type { OpenAIHealthResult } from './openaiHealth.js'

const OPENAI_BASE = 'https://api.openai.com/v1'
const PROVIDER_USAGE_WRITE_TIMEOUT_MS = 5_000
const OPENAI_RATE_LIMIT_RETRY_DEFAULT_MS = 1_000
const OPENAI_RATE_LIMIT_RETRY_MIN_MS = 250
const OPENAI_RATE_LIMIT_RETRY_MAX_MS = 10_000

type ResponseInput = Record<string, unknown>

interface ResponseFunctionCall {
  type: 'function_call'
  id?: string
  call_id?: string
  name?: string
  arguments?: string
}

interface ResponseMessage {
  type: 'message'
  content?: Array<{ type?: string; text?: string; refusal?: string }>
}

interface OpenAIResponse {
  id?: string
  model?: string
  service_tier?: string
  status?: string
  output?: Array<ResponseFunctionCall | ResponseMessage | Record<string, unknown>>
  output_text?: string
  usage?: {
    input_tokens?: number
    output_tokens?: number
    total_tokens?: number
    input_tokens_details?: { cached_tokens?: number }
    output_tokens_details?: { reasoning_tokens?: number }
  }
  error?: { code?: string; type?: string; message?: string }
}

/** Safe transport error: status + a closed provider code, never provider text. */
export class OpenAIProviderRequestError extends Error {
  readonly status: number
  readonly providerCode?: OpenAIProviderErrorCode
  readonly rateLimitRetryConsumed: boolean

  constructor(
    status: number,
    providerCode?: OpenAIProviderErrorCode,
    rateLimitRetryConsumed = false,
  ) {
    super(`openai ${status}${providerCode ? ` ${providerCode}` : ''}`)
    this.name = 'OpenAIProviderRequestError'
    this.status = status
    this.providerCode = providerCode
    this.rateLimitRetryConsumed = rateLimitRetryConsumed
  }
}

/** Includes structural matching so the guard remains stable across module reloads in tests. */
export function isOpenAIProviderThrottleError(error: unknown): boolean {
  if (error && typeof error === 'object') {
    const candidate = error as { name?: unknown; status?: unknown; rateLimitRetryConsumed?: unknown }
    if (candidate.rateLimitRetryConsumed === true) return true
    const status = typeof candidate.status === 'number' ? candidate.status : 0
    const permanent4xx = status >= 400 && status < 500 && status !== 408 && status !== 409
    if (candidate.name === 'OpenAIProviderRequestError' && permanent4xx) return true
  }
  return /\bopenai\s+429\b|rate[_ -]?limit(?:ed|[_ -]?exceeded)?|insufficient[_ -]?quota|credit[_ -]?balance[_ -]?exhausted|(?:project|organization)[_ -]?(?:spend|usage)[_ -]?limit/i.test(
    String((error as { message?: unknown })?.message ?? error),
  )
}

/** Parses only Retry-After seconds/date and clamps it to a user-safe bounded delay. */
export function safeOpenAIRetryAfterMs(raw: string | null, nowMs = Date.now()): number {
  const value = raw?.trim() ?? ''
  let delayMs = Number.NaN
  if (/^\d+(?:\.\d+)?$/.test(value)) {
    delayMs = Number(value) * 1_000
  } else if (value) {
    const at = Date.parse(value)
    if (Number.isFinite(at)) delayMs = at - nowMs
  }
  if (!Number.isFinite(delayMs)) delayMs = OPENAI_RATE_LIMIT_RETRY_DEFAULT_MS
  return Math.max(
    OPENAI_RATE_LIMIT_RETRY_MIN_MS,
    Math.min(OPENAI_RATE_LIMIT_RETRY_MAX_MS, Math.ceil(delayMs)),
  )
}

export function openaiAvailable(): boolean {
  return Boolean(config.openai?.key)
}

function contentToInput(content: OrMessage['content'], assistant: boolean): unknown {
  if (typeof content === 'string') return content
  const blocks: Record<string, unknown>[] = []
  let sawRawAudio = false
  let sawTranscript = false
  for (const raw of content as Array<Record<string, unknown>>) {
    if (raw.type === 'text' && typeof raw.text === 'string') {
      blocks.push({ type: assistant ? 'output_text' : 'input_text', text: raw.text })
      if (raw.text.trim()) sawTranscript = true
      continue
    }
    if (!assistant && raw.type === 'image_url') {
      const image = raw.image_url as { url?: unknown; detail?: unknown } | undefined
      if (typeof image?.url === 'string') {
        const block: Record<string, unknown> = { type: 'input_image', image_url: image.url }
        if (image.detail === 'low' || image.detail === 'high' || image.detail === 'auto' || image.detail === 'original') {
          block.detail = image.detail
        }
        blocks.push(block)
      }
      continue
    }
    if (!assistant && raw.type === 'audio_url') sawRawAudio = true
    // GPT-5.6 accepts image input, but not raw audio. The caller already keeps
    // the transcript as text; raw audio is handled by the transcription API.
  }
  if (sawRawAudio && !sawTranscript) throw new Error('openai_audio_transcript_required')
  if (blocks.length) return blocks
  return assistant ? [{ type: 'output_text', text: '' }] : [{ type: 'input_text', text: '(mesaj vocal)' }]
}

/** House messages -> Responses input items. Exported for contract tests. */
export function toResponsesInput(messages: OrMessage[]): { instructions?: string; input: ResponseInput[] } {
  const instructions: string[] = []
  const input: ResponseInput[] = []
  for (const message of messages) {
    if (message.role === 'system') {
      const text = typeof message.content === 'string' ? message.content : JSON.stringify(message.content)
      if (text) instructions.push(text)
      continue
    }
    if (message.response_items?.length) {
      input.push(...cloneResponseItems(message.response_items))
      continue
    }
    if (message.role === 'tool') {
      input.push({
        type: 'function_call_output',
        call_id: message.tool_call_id ?? '',
        output: typeof message.content === 'string' ? message.content : JSON.stringify(message.content),
      })
      continue
    }
    const assistant = message.role === 'assistant'
    const content = contentToInput(message.content, assistant)
    const hasContent = typeof content === 'string' ? content.length > 0 : Array.isArray(content) && content.length > 0
    if (hasContent) input.push({ type: 'message', role: message.role, content })
    for (const call of message.tool_calls ?? []) {
      input.push({
        type: 'function_call',
        call_id: call.id,
        name: call.function.name,
        arguments: call.function.arguments || '{}',
      })
    }
  }
  return { instructions: instructions.length ? instructions.join('\n\n') : undefined, input }
}

function toolsToResponses(tools: BrainTool[], opts: BrainCallOpts): Record<string, unknown>[] {
  const hasExplicitAllowlist = opts.toolChoice === 'required' && Array.isArray(opts.allowedFunctionNames)
  const allowed = hasExplicitAllowlist ? new Set(opts.allowedFunctionNames) : null
  const converted = tools
    .filter((tool) => !allowed || allowed.has(tool.name))
    .map((tool) => ({
      type: 'function',
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
      // Existing schemas intentionally permit optional fields and additional
      // properties; opting out avoids Responses trying to normalize them into
      // an incompatible strict schema.
      strict: false,
    }))
  if (opts.toolChoice === 'required' && converted.length === 0) {
    throw new Error('openai_required_tool_allowlist_empty')
  }
  return converted
}

export function toResponsesBody(
  model: string,
  messages: OrMessage[],
  tools: BrainTool[],
  opts: BrainCallOpts,
  stream: boolean,
): Record<string, unknown> {
  const converted = toResponsesInput(messages)
  const body: Record<string, unknown> = {
    model,
    input: converted.input,
    stream,
    store: false,
    max_output_tokens: opts.maxTokens ?? 1024,
    include: ['reasoning.encrypted_content'],
  }
  if (opts.usageContext?.userEmail) {
    body.safety_identifier = createHmac('sha256', config.sessionSecret)
      .update(`openai-safety\0${opts.usageContext.userEmail.trim().toLowerCase()}`)
      .digest('hex')
  }
  if (converted.instructions) body.instructions = converted.instructions
  if (opts.reasoning) body.reasoning = { effort: opts.reasoning }
  // Reasoning models reject temperature. Keep it only for explicitly
  // non-reasoning legacy models configured by an operator. GPT-6 Astra is
  // reasoning-only too, so it must follow the same transport contract.
  const esteModelDeRationament = /^(?:o[0-9]|gpt-(?:5|6)(?:\.|-|$))/i.test(model)
  if (opts.temperature != null && !esteModelDeRationament) body.temperature = opts.temperature
  // gpt-4.1, gpt-4.1-mini, gpt-4o etc. NU suportă reasoning.effort —
  // doar modelele o-series, GPT-5 și GPT-6 îl acceptă. Dacă trimitem
  // reasoning pe un model care nu-l suportă, OpenAI dă 400.
  // GPT-6 Astra nu acceptă effort=none; omiterea câmpului este echivalentul
  // corect pentru o probă fără reasoning.
  if (body.reasoning && !esteModelDeRationament) delete body.reasoning
  if (model.match(/^gpt-6(?:\.|-|$)/i) && (body.reasoning as { effort?: string } | undefined)?.effort === 'none') {
    delete body.reasoning
  }
  const responseTools = toolsToResponses(tools, opts)
  if (responseTools.length) {
    body.tools = responseTools
    body.tool_choice = opts.toolChoice ?? 'auto'
    body.parallel_tool_calls = true
  }
  return body
}

async function openaiFetch(
  body: unknown,
  timeoutMs: number,
): Promise<Response> {
  return fetch(`${OPENAI_BASE}/responses`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.openai?.key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
}

async function providerCodeFromResponse(response: Response): Promise<OpenAIProviderErrorCode | undefined> {
  let providerError: unknown
  try {
    const payload = await response.json() as Record<string, unknown>
    providerError = payload.error
  } catch {
    providerError = undefined
  }
  return allowlistedOpenAIProviderCode(response.status, providerError)
}

async function openaiResponseError(
  response: Response,
  rateLimitRetryConsumed = false,
): Promise<OpenAIProviderRequestError> {
  return new OpenAIProviderRequestError(
    response.status,
    await providerCodeFromResponse(response),
    rateLimitRetryConsumed,
  )
}

function providerCodeFromPayload(providerError: unknown): OpenAIProviderErrorCode | undefined {
  return allowlistedOpenAIProviderCode(429, providerError)
}

function exactProviderLimitError(providerError: unknown): OpenAIProviderRequestError | null {
  const code = providerCodeFromPayload(providerError)
  return code ? new OpenAIProviderRequestError(429, code) : null
}

interface OpenAIFetchResult {
  response: Response
  rateLimitRetryConsumed: boolean
}

/**
 * A provider 429 is never fanned out across models here. Only the documented
 * request-rate code gets one retry; quota/spend/usage and unknown 429s return
 * immediately to the caller.
 */
async function openaiFetchWithBoundedRateLimitRetry(
  body: unknown,
  timeoutMs: number,
): Promise<OpenAIFetchResult> {
  const first = await openaiFetch(body, timeoutMs)
  if (first.status !== 429) return { response: first, rateLimitRetryConsumed: false }
  const code = await providerCodeFromResponse(first.clone())
  if (code !== 'rate_limit_exceeded') return { response: first, rateLimitRetryConsumed: false }
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, safeOpenAIRetryAfterMs(first.headers.get('retry-after')))
    timer.unref?.()
  })
  try {
    return { response: await openaiFetch(body, timeoutMs), rateLimitRetryConsumed: true }
  } catch (error) {
    // The one retry was already spent. Preserve that provenance so outer chat
    // and memory layers cannot turn a transport failure into a third request.
    throw errorAfterRateLimitRetry(error, true)
  }
}

function markRateLimitRetryConsumed(error: unknown): unknown {
  if (error && typeof error === 'object') {
    try {
      Object.defineProperty(error, 'rateLimitRetryConsumed', {
        value: true,
        configurable: true,
      })
      return error
    } catch {
      // Frozen/non-extensible errors cannot carry transport provenance. The
      // wrapper remains status-neutral and retains the original as its cause.
    }
  }
  const wrapped = new Error('openai_retry_failed_after_rate_limit', { cause: error })
  Object.defineProperty(wrapped, 'rateLimitRetryConsumed', {
    value: true,
    configurable: true,
  })
  return wrapped
}

function errorAfterRateLimitRetry(error: unknown, consumed: boolean): unknown {
  return consumed ? markRateLimitRetryConsumed(error) : error
}

function outputText(response: OpenAIResponse): string {
  if (typeof response.output_text === 'string') return response.output_text
  let text = ''
  for (const item of response.output ?? []) {
    if (item.type !== 'message') continue
    for (const block of (item as ResponseMessage).content ?? []) {
      if (block.type === 'output_text' && block.text) text += block.text
      else if (block.type === 'refusal' && block.refusal) text += `[refuz: ${block.refusal}]`
    }
  }
  return text
}

function outputToolCalls(response: OpenAIResponse): OrToolCall[] {
  const calls: OrToolCall[] = []
  for (const item of response.output ?? []) {
    if (item.type !== 'function_call') continue
    const call = item as ResponseFunctionCall
    if (!call.name) continue
    calls.push({
      id: call.call_id || call.id || `call_${calls.length}`,
      type: 'function',
      function: { name: call.name, arguments: call.arguments || '{}' },
    })
  }
  return calls
}

const MAX_RESPONSE_ITEMS = 256
const MAX_RESPONSE_ITEMS_BYTES = 2_000_000

/** Defensive JSON clone for provider transport state. It deliberately does
 * not inspect reasoning payloads and never logs them. */
export function cloneResponseItems(items: readonly ResponseCarryItem[]): ResponseCarryItem[] {
  if (items.length > MAX_RESPONSE_ITEMS) throw new Error('openai_response_output_too_many_items')
  const encoded = JSON.stringify(items)
  if (Buffer.byteLength(encoded, 'utf8') > MAX_RESPONSE_ITEMS_BYTES) {
    throw new Error('openai_response_output_too_large')
  }
  const cloned = JSON.parse(encoded) as unknown
  if (!Array.isArray(cloned) || cloned.some((item) => !item || typeof item !== 'object' || Array.isArray(item))) {
    throw new Error('openai_response_output_invalid')
  }
  return cloned as ResponseCarryItem[]
}

function responseItems(response: OpenAIResponse): ResponseCarryItem[] {
  return cloneResponseItems((response.output ?? []) as ResponseCarryItem[])
}

function noKeyResult(model: string): OrChatResult {
  return {
    text: '', toolCalls: [], model, stop: 'no_key', responseId: '', serviceTier: null,
    inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, reasoningOutputTokens: 0,
    responseItems: [],
  }
}

async function meterResponse(response: OpenAIResponse, opts: BrainCallOpts, fallbackModel: string): Promise<{
  responseId: string
  model: string
  serviceTier: string | null
  inputTokens: number
  outputTokens: number
  cachedInputTokens: number
  reasoningOutputTokens: number
}> {
  const responseId = String(response.id ?? '')
  if (!responseId) throw new Error('openai_usage_missing_response_id')
  if (
    !response.usage
    || typeof response.usage.input_tokens !== 'number'
    || typeof response.usage.output_tokens !== 'number'
    || typeof response.usage.total_tokens !== 'number'
  ) throw new Error('openai_usage_missing')
  const inputTokens = response.usage.input_tokens
  const outputTokens = response.usage.output_tokens
  const totalTokens = response.usage.total_tokens
  const cachedInputTokens = Number(response.usage?.input_tokens_details?.cached_tokens ?? 0)
  const reasoningOutputTokens = Number(response.usage?.output_tokens_details?.reasoning_tokens ?? 0)
  const ints = [inputTokens, outputTokens, totalTokens, cachedInputTokens, reasoningOutputTokens]
  if (
    ints.some((value) => !Number.isSafeInteger(value) || value < 0)
    || totalTokens !== inputTokens + outputTokens
    || cachedInputTokens > inputTokens
    || reasoningOutputTokens > outputTokens
  ) {
    throw new Error('openai_usage_invalid')
  }
  const model = String(response.model ?? fallbackModel)
  const serviceTier = typeof response.service_tier === 'string' ? response.service_tier.slice(0, 40) : null
  const context = opts.usageContext ?? { userEmail: 'system', surface: 'unattributed' }
  let deadline: ReturnType<typeof setTimeout> | null = null
  try {
    await Promise.race([
      recordProviderUsage({
        responseId,
        userEmail: context.userEmail,
        surface: context.surface,
        model,
        serviceTier,
        inputTokens,
        outputTokens,
        cachedInputTokens,
        reasoningOutputTokens,
      }),
      new Promise<never>((_resolve, reject) => {
        deadline = setTimeout(
          () => reject(new Error('provider_usage_write_timeout')),
          PROVIDER_USAGE_WRITE_TIMEOUT_MS,
        )
        deadline.unref?.()
      }),
    ])
  } finally {
    if (deadline) clearTimeout(deadline)
  }
  return { responseId, model, serviceTier, inputTokens, outputTokens, cachedInputTokens, reasoningOutputTokens }
}

export async function openaiResponses(
  model: string,
  messages: OrMessage[],
  tools: BrainTool[] = [],
  opts: BrainCallOpts = {},
): Promise<OrChatResult> {
  if (!openaiAvailable()) return noKeyResult(model)
  const fetched = await openaiFetchWithBoundedRateLimitRetry(
    toResponsesBody(model, messages, tools, opts, false),
    opts.timeoutMs ?? 120_000,
  )
  const { response, rateLimitRetryConsumed } = fetched
  try {
    if (!response.ok) throw await openaiResponseError(response, rateLimitRetryConsumed)
    const json = await response.json() as OpenAIResponse
    if (json.error) {
      const providerLimit = exactProviderLimitError(json.error)
      if (providerLimit) throw providerLimit
      throw new Error('openai_response_error')
    }
    const usage = await meterResponse(json, opts, model)
    if (json.status === 'failed' || json.status === 'incomplete' || json.status === 'cancelled') {
      throw new Error(`openai_response_${json.status}`)
    }
    return {
      text: outputText(json),
      toolCalls: outputToolCalls(json),
      // Responses exposes token usage, not an invoice amount. Provider expense
      // is reconciled separately in USD micros; never fabricate money here.
      stop: json.status ?? 'completed',
      responseItems: responseItems(json),
      ...usage,
    }
  } catch (error) {
    throw errorAfterRateLimitRetry(error, rateLimitRetryConsumed)
  }
}

/** Responses SSE streaming: text is emitted immediately; calls are returned at completion. */
export async function openaiResponsesStream(
  model: string,
  messages: OrMessage[],
  tools: BrainTool[],
  onText: (delta: string) => void,
  opts: BrainCallOpts = {},
): Promise<OrChatResult> {
  if (!openaiAvailable()) return noKeyResult(model)
  const fetched = await openaiFetchWithBoundedRateLimitRetry(
    toResponsesBody(model, messages, tools, opts, true),
    opts.timeoutMs ?? 120_000,
  )
  const { response, rateLimitRetryConsumed } = fetched
  try {
    if (!response.ok || !response.body) {
      throw await openaiResponseError(response, rateLimitRetryConsumed)
    }
    let text = ''
    let finalResponse: OpenAIResponse | null = null
    const partialCalls = new Map<string, { id: string; name: string; arguments: string }>()
    await readSSE(response.body, (raw) => {
      const event = raw as Record<string, unknown>
      const type = String(event.type ?? '')
      if (type === 'response.output_text.delta' && typeof event.delta === 'string') {
        text += event.delta
        onText(event.delta)
        return
      }
      if (type === 'response.output_item.added' || type === 'response.output_item.done') {
        const item = event.item as ResponseFunctionCall | undefined
        if (item?.type === 'function_call') {
          const key = item.call_id || item.id || `call_${partialCalls.size}`
          const old = partialCalls.get(key) ?? { id: key, name: '', arguments: '' }
          if (item.name) old.name = item.name
          if (item.arguments) old.arguments = item.arguments
          partialCalls.set(key, old)
        }
        return
      }
      if (type === 'response.function_call_arguments.delta') {
        const key = String(event.call_id ?? event.item_id ?? `call_${partialCalls.size}`)
        const old = partialCalls.get(key) ?? { id: key, name: '', arguments: '' }
        if (typeof event.name === 'string') old.name = event.name
        if (typeof event.delta === 'string') old.arguments += event.delta
        partialCalls.set(key, old)
        return
      }
      if (
        (type === 'response.completed' || type === 'response.failed' || type === 'response.incomplete')
        && event.response && typeof event.response === 'object'
      ) {
        finalResponse = event.response as OpenAIResponse
        return
      }
      if (type === 'error') {
        const providerLimit = exactProviderLimitError(event)
        if (providerLimit) throw providerLimit
        throw new Error('openai_stream_error')
      }
    })
    const completed = finalResponse as OpenAIResponse | null
    if (!completed) throw new Error('openai_stream_missing_completed_response')
    if (completed.error) {
      const providerLimit = exactProviderLimitError(completed.error)
      if (providerLimit) throw providerLimit
      throw new Error('openai_stream_response_error')
    }
    const usage = await meterResponse(completed, opts, model)
    if (completed.status === 'failed' || completed.status === 'incomplete' || completed.status === 'cancelled') {
      throw new Error(`openai_response_${completed.status}`)
    }
    const completeCalls = completed ? outputToolCalls(completed) : []
    const toolCalls = completeCalls.length
      ? completeCalls
      : [...partialCalls.values()].filter((call) => call.name).map((call) => ({
        id: call.id,
        type: 'function' as const,
        function: { name: call.name, arguments: call.arguments || '{}' },
      }))
    if (!text && completed) text = outputText(completed)
    return {
      text,
      toolCalls,
      stop: completed?.status ?? 'completed',
      responseItems: responseItems(completed),
      ...usage,
    }
  } catch (error) {
    throw errorAfterRateLimitRetry(error, rateLimitRetryConsumed)
  }
}

function authModeOpenAI(): OpenAIAuthMode {
  return config.openai?.key ? 'api_key' : 'unknown'
}

async function probeOpenAIHealthOnce(): Promise<OpenAIHealthResult> {
  const model = config.openai.luna
  const authMode = authModeOpenAI()
  const body = toResponsesBody(
    model,
    [
      { role: 'system', content: 'This is a provider health probe. Return only ok.' },
      { role: 'user', content: 'ok' },
    ],
    [],
    {
      // Reasoning models can consume part of this budget before emitting the
      // visible token. Eight tokens could therefore yield a billable
      // `incomplete` response and falsely report a healthy project as 400.
      maxTokens: 64,
      reasoning: 'none',
      usageContext: { userEmail: 'system', surface: 'openai_health' },
    },
    false,
  )
  return probeOpenAIHealth(authMode !== 'unknown', () => openaiFetch(body, 8_000), {
    authMode,
    onServing: async (response) => {
      const payload = await response.json() as OpenAIResponse
      // Even a semantically failed/incomplete 2xx response can be billable.
      // Persist every provider response that carries an id before deciding
      // whether it proves the service healthy.
      await meterResponse(payload, {
        usageContext: { userEmail: 'system', surface: 'openai_health' },
      }, model)
      if (
        payload.error
        || payload.status === 'failed'
        || payload.status === 'incomplete'
        || payload.status === 'cancelled'
      ) return classifyOpenAIError(400, payload.error, authMode)
    },
  })
}

const cachedOpenAIHealth = cacheOpenAIHealthProbe(probeOpenAIHealthOnce)

export function openaiHealth(): Promise<OpenAIHealthResult> {
  return cachedOpenAIHealth()
}
