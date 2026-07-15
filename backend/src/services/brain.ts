import { config } from '../config.js'
import { MODEL_FAST, MODEL_TOP, pickBrain } from './modelRouter.js'
import type {
  Message,
  MessageCreateParams,
  ContentBlock,
} from './brain-types.js'

// CREIERUL — Kimi (primar) → GLM (rezervă). Vechiul provider a fost SCOS complet.
// Nu mai există NICIO dependență de SDK Provider — client nativ pe fetch.
export const KIMI_BASE = 'https://api.kimi.com/coding/'
export const GLM_BASE = 'https://api.z.ai/api/anthropic'

const REQUEST_TIMEOUT_MS = 300_000

function messagesUrl(base: string): string {
  return base.endsWith('/') ? `${base}v1/messages` : `${base}/v1/messages`
}

function brainError(status: number, body: string): Error & { status?: number } {
  const err = new Error(`brain ${status}: ${body.slice(0, 300)}`) as Error & { status?: number }
  err.status = status
  return err
}

async function* sseEvents(res: Response): AsyncGenerator<{ event: string; data: string }> {
  const body = res.body
  if (!body) return
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let event = ''
  let data = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) {
      let line = buf.slice(0, nl)
      buf = buf.slice(nl + 1)
      if (line.endsWith('\r')) line = line.slice(0, -1)
      if (line === '') {
        if (data) yield { event, data }
        event = ''
        data = ''
        continue
      }
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) data += (data ? '\n' : '') + line.slice(5).trim()
    }
  }
  if (data) yield { event, data }
}

interface PendingBlock {
  block: Record<string, unknown>
  jsonBuf: string
}

class MessageStream {
  private textHandlers: ((delta: string) => void)[] = []
  private readonly done: Promise<Message>

  constructor(run: (emitText: (delta: string) => void) => Promise<Message>) {
    this.done = run((delta) => {
      for (const h of this.textHandlers) h(delta)
    })
    this.done.catch(() => {})
  }

  on(event: 'text', cb: (delta: string) => void): this {
    if (event === 'text') this.textHandlers.push(cb)
    return this
  }

  finalMessage(): Promise<Message> {
    return this.done
  }
}

export class BrainClient {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
  ) {}

  private headers(): Record<string, string> {
    return {
      'x-api-key': this.apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    }
  }

  readonly messages = {
    create: (params: MessageCreateParams): Promise<Message> => this.create(params),
    stream: (params: MessageCreateParams): MessageStream => this.stream(params),
  }

  private async create(params: MessageCreateParams): Promise<Message> {
    const res = await fetch(messagesUrl(this.baseUrl), {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!res.ok) throw brainError(res.status, await res.text().catch(() => ''))
    return (await res.json()) as Message
  }

  private stream(params: MessageCreateParams): MessageStream {
    return new MessageStream(async (emitText) => {
      const res = await fetch(messagesUrl(this.baseUrl), {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ ...params, stream: true }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      if (!res.ok) throw brainError(res.status, await res.text().catch(() => ''))
      return await assembleStream(res, emitText)
    })
  }
}

async function assembleStream(
  res: Response,
  emitText: (delta: string) => void,
): Promise<Message> {
  const msg: Message = {
    id: '',
    role: 'assistant',
    model: '',
    content: [],
    stop_reason: null,
    stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: 0 },
  }
  const pending = new Map<number, PendingBlock>()

  const finalizeBlock = (index: number): void => {
    const p = pending.get(index)
    if (!p) return
    if (p.jsonBuf) {
      try {
        p.block.input = JSON.parse(p.jsonBuf)
      } catch {
        p.block.input = {}
      }
    }
    msg.content[index] = p.block as unknown as ContentBlock
    pending.delete(index)
  }

  for await (const { data } of sseEvents(res)) {
    if (data === '[DONE]') break
    let ev: Record<string, unknown>
    try {
      ev = JSON.parse(data) as Record<string, unknown>
    } catch {
      continue
    }
    const type = ev.type

    if (type === 'message_start') {
      const m = (ev.message ?? {}) as Record<string, unknown>
      if (typeof m.id === 'string') msg.id = m.id
      if (typeof m.model === 'string') msg.model = m.model
      const u = (m.usage ?? {}) as Record<string, unknown>
      if (typeof u.input_tokens === 'number') msg.usage.input_tokens = u.input_tokens
      if (typeof u.output_tokens === 'number') msg.usage.output_tokens = u.output_tokens
      if (typeof u.cache_read_input_tokens === 'number')
        msg.usage.cache_read_input_tokens = u.cache_read_input_tokens
    } else if (type === 'content_block_start') {
      const index = ev.index as number
      const cb = { ...((ev.content_block ?? {}) as Record<string, unknown>) }
      if (cb.type === 'tool_use' || cb.type === 'server_tool_use') cb.input = {}
      pending.set(index, { block: cb, jsonBuf: '' })
    } else if (type === 'content_block_delta') {
      const index = ev.index as number
      const delta = (ev.delta ?? {}) as Record<string, unknown>
      const p = pending.get(index)
      if (!p) continue
      if (delta.type === 'text_delta' && typeof delta.text === 'string') {
        p.block.text = ((p.block.text as string | undefined) ?? '') + delta.text
        emitText(delta.text)
      } else if (delta.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
        p.jsonBuf += delta.partial_json
      }
    } else if (type === 'content_block_stop') {
      finalizeBlock(ev.index as number)
    } else if (type === 'message_delta') {
      const delta = (ev.delta ?? {}) as Record<string, unknown>
      if (typeof delta.stop_reason === 'string' || delta.stop_reason === null)
        msg.stop_reason = delta.stop_reason as string | null
      if (typeof delta.stop_sequence === 'string' || delta.stop_sequence === null)
        msg.stop_sequence = delta.stop_sequence as string | null
      const u = (ev.usage ?? {}) as Record<string, unknown>
      if (typeof u.output_tokens === 'number') msg.usage.output_tokens = u.output_tokens
      if (typeof u.input_tokens === 'number') msg.usage.input_tokens = u.input_tokens
    } else if (type === 'message_stop') {
      break
    }
  }
  for (const index of [...pending.keys()]) finalizeBlock(index)
  msg.content = msg.content.filter((b) => b != null)
  return msg
}

export const kimi = new BrainClient(config.kimiKey, KIMI_BASE)
export const glm = new BrainClient(config.glmKey, GLM_BASE)
export const brain = kimi

export async function brainComplete(prompt: string, maxTokens = 1024): Promise<string> {
  const extract = (m: Message): string =>
    (m.content || [])
      .filter((b) => (b as { type?: string }).type === 'text')
      .map((b) => (b as unknown as { text: string }).text)
      .join('')
      .trim()
  const params = { max_tokens: maxTokens, messages: [{ role: 'user' as const, content: prompt }] }
  try {
    return extract(
      await pickBrain(
        () => kimi.messages.create({ model: MODEL_FAST, ...params }),
        () => glm.messages.create({ model: MODEL_TOP, ...params }),
        (reason) => console.log(`[brainComplete] Kimi → GLM (${reason})`),
      ),
    )
  } catch {
    return ''
  }
}

export async function verifyModels(): Promise<Record<string, string>> {
  const ping = async (client: BrainClient, model: string): Promise<string> => {
    try {
      const r = await client.messages.create({
        model,
        max_tokens: 64,
        messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
      })
      return `ok (served by ${r.model})`
    } catch (e) {
      const status = (e as { status?: number } | null)?.status
      return status ? `fail_${status}` : 'fail'
    }
  }
  return {
    'kimi-k2-thinking': await ping(kimi, 'kimi-k2-thinking'),
    'glm-4.6': await ping(glm, 'glm-4.6'),
  }
}

export async function verifyKeys(): Promise<{
  primary: string
  reserve: string
  diag: Record<string, unknown>
}> {
  const ping = async (client: BrainClient, model: string): Promise<string> => {
    try {
      await client.messages.create({
        model,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      })
      return 'ok'
    } catch (e) {
      const status = (e as { status?: number } | null)?.status
      return status ? `fail_${status}` : 'fail'
    }
  }
  const primary = config.kimiKey ? await ping(kimi, 'kimi-k2-thinking') : 'not_configured'
  const reserve = config.glmKey ? await ping(glm, 'glm-4.6') : 'not_configured'
  const rawK = process.env.KIMI_API_KEY ?? process.env.KIMI_KEY ?? ''
  const rawG = process.env.GLM_API_KEY ?? process.env.GLM_KEY ?? ''
  const diag = {
    kimiLen: config.kimiKey.length,
    glmLen: config.glmKey.length,
    kimiRawHadWhitespace: rawK !== rawK.trim(),
    glmRawHadWhitespace: rawG !== rawG.trim(),
  }
  return { primary, reserve, diag }
}
