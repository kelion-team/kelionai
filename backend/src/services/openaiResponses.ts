import { createHmac } from 'node:crypto'
import { config } from '../config.js'
import { recordProviderUsage } from '../db.js'
import { readSSE } from './sse.js'
import type { BrainTool, BrainCallOpts, OrChatResult, OrMessage, OrToolCall, ResponseCarryItem } from './brainContract.js'
import { getSubscriptionCredentials, isSubscriptionMode, CHATGPT_ACCOUNT_ID_HEADER } from './chatgptSubscription.js'

const OPENAI_BASE = 'https://api.openai.com/v1'

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
    input_tokens_details?: { cached_tokens?: number }
    output_tokens_details?: { reasoning_tokens?: number }
  }
  error?: { message?: string }
}

export function openaiAvailable(): boolean {
  return Boolean(config.openai?.key) || isSubscriptionMode()
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
  const subMode = isSubscriptionMode()
  const body: Record<string, unknown> = {
    model,
    input: converted.input,
    stream,
    store: false,
  }
  // Endpoint-ul Codex (abonament) NU acceptă max_output_tokens, safety_identifier,
  // include, sau temperature. Le omitem în modul subscription.
  if (!subMode) {
    body.max_output_tokens = opts.maxTokens ?? 1024
    body.include = ['reasoning.encrypted_content']
  }
  if (!subMode && opts.usageContext?.userEmail) {
    body.safety_identifier = createHmac('sha256', config.sessionSecret)
      .update(`openai-safety\0${opts.usageContext.userEmail.trim().toLowerCase()}`)
      .digest('hex')
  }
  // instructions e OBLIGATORIU în modul subscription (non-empty string)
  if (converted.instructions) {
    body.instructions = converted.instructions
  } else if (subMode) {
    body.instructions = 'You are a helpful assistant.'
  }
  if (opts.reasoning) body.reasoning = { effort: opts.reasoning }
  // Reasoning models reject temperature. Keep it only for explicitly
  // non-reasoning legacy models configured by an operator.
  if (!subMode && opts.temperature != null && !/^gpt-5(?:\.|-|$)/i.test(model)) body.temperature = opts.temperature
  // gpt-4.1, gpt-4.1-mini, gpt-4o etc. NU suportă reasoning.effort —
  // doar modelele o-series (o3, o4-mini) și gpt-5 îl acceptă. Dacă
  // trimitem reasoning pe un model care nu-l suportă, OpenAI dă 400.
  if (body.reasoning && !/^(o[0-9]|gpt-5)/i.test(model)) delete body.reasoning
  const responseTools = toolsToResponses(tools, opts)
  if (responseTools.length) {
    body.tools = responseTools
    body.tool_choice = opts.toolChoice ?? 'auto'
    body.parallel_tool_calls = true
  }
  return body
}

async function openaiFetch(body: unknown, timeoutMs: number): Promise<Response> {
  // Modul abonament ChatGPT Pro: folosește tokenul OAuth din ~/.codex/auth.json
  // contra chatgpt.com/backend-api/codex, plătit din abonamentul $200/lună.
  if (isSubscriptionMode()) {
    const creds = await getSubscriptionCredentials()
    if (creds) {
      return fetch(`${creds.baseUrl}/responses`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${creds.accessToken}`,
          [CHATGPT_ACCOUNT_ID_HEADER]: creds.accountId,
          'Content-Type': 'application/json',
          'originator': 'codex_cli_rs',
          'OpenAI-Beta': 'responses=experimental',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      })
    }
  }
  // Modul cheie API (legacy/prod): api.openai.com/v1 cu sk-...
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
  const inputTokens = Number(response.usage?.input_tokens ?? 0)
  const outputTokens = Number(response.usage?.output_tokens ?? 0)
  const cachedInputTokens = Number(response.usage?.input_tokens_details?.cached_tokens ?? 0)
  const reasoningOutputTokens = Number(response.usage?.output_tokens_details?.reasoning_tokens ?? 0)
  const ints = [inputTokens, outputTokens, cachedInputTokens, reasoningOutputTokens]
  if (ints.some((value) => !Number.isSafeInteger(value) || value < 0)) {
    throw new Error('openai_usage_invalid')
  }
  const model = String(response.model ?? fallbackModel)
  const serviceTier = typeof response.service_tier === 'string' ? response.service_tier.slice(0, 40) : null
  const context = opts.usageContext ?? { userEmail: 'system', surface: 'unattributed' }
  await recordProviderUsage({
    responseId,
    userEmail: context.userEmail,
    surface: context.surface,
    model,
    serviceTier,
    inputTokens,
    outputTokens,
    cachedInputTokens,
    reasoningOutputTokens,
  })
  return { responseId, model, serviceTier, inputTokens, outputTokens, cachedInputTokens, reasoningOutputTokens }
}

export async function openaiResponses(
  model: string,
  messages: OrMessage[],
  tools: BrainTool[] = [],
  opts: BrainCallOpts = {},
): Promise<OrChatResult> {
  if (!openaiAvailable()) return noKeyResult(model)
  const response = await openaiFetch(toResponsesBody(model, messages, tools, opts, false), opts.timeoutMs ?? 120_000)
  if (!response.ok) throw new Error(`openai ${response.status}: ${(await response.text().catch(() => '')).slice(0, 300)}`)
  const json = await response.json() as OpenAIResponse
  if (json.error?.message) throw new Error(`openai: ${json.error.message.slice(0, 300)}`)
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
  const response = await openaiFetch(toResponsesBody(model, messages, tools, opts, true), opts.timeoutMs ?? 120_000)
  if (!response.ok || !response.body) {
    throw new Error(`openai ${response.status}: ${(await response.text().catch(() => '')).slice(0, 300)}`)
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
      const old = partialCalls.get(key) ?? { id: key, name: String(event.name ?? ''), arguments: '' }
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
      const err = event.error as { message?: unknown } | undefined
      throw new Error(`openai stream: ${String(err?.message ?? 'eroare necunoscută').slice(0, 300)}`)
    }
  })
  const completed = finalResponse as OpenAIResponse | null
  if (!completed) throw new Error('openai_stream_missing_completed_response')
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
}

export async function openaiHealth(): Promise<{ ok: boolean; serving: boolean; reason?: 'quota' | 'error' | 'no_key' }> {
  if (!openaiAvailable()) return { ok: false, serving: false, reason: 'no_key' }
  try {
    const response = await openaiFetch({
      model: config.openai.luna,
      input: 'Reply with ok.',
      max_output_tokens: 8,
      reasoning: { effort: 'none' },
      store: false,
    }, 8_000)
    if (response.ok) return { ok: true, serving: true }
    const body = (await response.text().catch(() => '')).toLowerCase()
    return {
      ok: true,
      serving: false,
      reason: response.status === 429 || /quota|rate.?limit|billing/.test(body) ? 'quota' : 'error',
    }
  } catch {
    return { ok: false, serving: false, reason: 'error' }
  }
}
