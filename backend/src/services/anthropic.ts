import { config } from '../config.js'
import type {
  Message,
  MessageCreateParams,
  ContentBlock,
} from './brain-types.js'

// CREIERUL — Kimi (primar) → GLM (rezervă). Vechiul provider a fost SCOS complet
// (ordinul lui Adrian, 12 iul: „rămâne doar Kimi și GLM"). Nu mai există NICIO
// dependență de SDK — un client nativ pe `fetch` vorbește direct formatul de fir
// Messages API (POST /v1/messages, SSE), pe care ambele endpoint-uri îl cer.
// Numele fișierului rămâne `anthropic.ts` doar pentru a nu atinge zecile de
// importuri din restul codului.
export const KIMI_BASE = 'https://api.kimi.com/coding/'
export const GLM_BASE = 'https://api.z.ai/api/anthropic'

// Timp maxim pentru un apel (stream sau nu). SDK-ul avea un timeout intern; îl
// reproducem ca să nu atârne o tură la nesfârșit dacă upstream-ul se blochează.
const REQUEST_TIMEOUT_MS = 300_000

function messagesUrl(base: string): string {
  // KIMI_BASE are slash final, GLM_BASE nu — construim URL-ul corect pentru ambele.
  return base.endsWith('/') ? `${base}v1/messages` : `${base}/v1/messages`
}

function brainError(status: number, body: string): Error & { status?: number } {
  const err = new Error(`brain ${status}: ${body.slice(0, 300)}`) as Error & { status?: number }
  err.status = status
  return err
}

// Un pas peste liniile SSE ale răspunsului: emite fiecare eveniment
// { event, data } pe măsură ce sosește (data-urile multiple ale unui eveniment
// sunt concatenate cu newline, conform SSE).
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

// Bloc în curs de asamblare din stream: pornim de la content_block și adunăm
// text (text_delta) sau argumentele tool_use (input_json_delta) pe parcurs.
interface PendingBlock {
  block: Record<string, unknown>
  jsonBuf: string
}

// Stream-ul returnat de messages.stream: expune `.on('text', cb)` (delta live)
// și `.finalMessage()` (mesajul asamblat când stream-ul se termină) — aceeași
// suprafață pe care se bazează bucla de tool-use din routes/chat.ts.
class MessageStream {
  private textHandlers: ((delta: string) => void)[] = []
  private readonly done: Promise<Message>

  constructor(run: (emitText: (delta: string) => void) => Promise<Message>) {
    // Rulăm imediat; primul `await fetch` cedează controlul înainte de orice
    // text_delta, deci `.on('text')` (înregistrat sincron după constructor) e
    // mereu gata înainte să curgă vreo bucată.
    this.done = run((delta) => {
      for (const h of this.textHandlers) h(delta)
    })
    // Evită „unhandled rejection"; apelantul primește eroarea prin finalMessage().
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

// Clientul nativ al creierului: o singură pereche bază+cheie (Kimi SAU GLM).
export class BrainClient {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
  ) {}

  private headers(): Record<string, string> {
    // NUMELE acestor headere sunt protocolul de fir cerut de Kimi/GLM (nu un SDK).
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

// Asamblează Message-ul din evenimentele SSE, emițând fiecare delta de text pe
// măsură ce sosește. Adună blocuri (text + tool_use, cu `input` reconstruit din
// input_json_delta) și usage-ul de-a lungul message_start → message_stop.
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
      // Un tool_use pornește cu input gol; îl reconstruim din input_json_delta.
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
  // Orice bloc rămas nefinalizat (stream întrerupt) — închide-l cu ce avem.
  for (const index of [...pending.keys()]) finalizeBlock(index)
  // Compactează eventualele găuri din array (index-based inserție).
  msg.content = msg.content.filter((b) => b != null)
  return msg
}

// Kimi: primar. GLM: rezervă (folosit la eșecul lui Kimi — vezi failover-ul din
// routes/chat.ts). Fără cheie, clientul respectiv dă eroare la primul apel, care
// e raportată cinstit (nu se comută pe nimic din vechiul provider — nu mai există).
export const kimi = new BrainClient(config.kimiKey, KIMI_BASE)
export const glm = new BrainClient(config.glmKey, GLM_BASE)
// Clientul implicit al creierului = Kimi (primar). Restul codului importă
// `anthropic` — acum e Kimi (doar numele bindingului a rămas).
export const anthropic = kimi

// Ping the brain tiers on their real endpoints: does Kimi serve, and does GLM
// (the reserve)? Real 200s, not assumptions — this is how "what model is the
// brain on" gets verified live.
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

// Ping each brain key with a 1-token request to verify it authenticates and has
// credit. Reports a status WITHOUT ever exposing the key value:
// 'ok' | 'not_configured' | 'fail' | 'fail_<httpStatus>'.
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
  // Non-secret diagnostics to pinpoint a bad key without exposing its value:
  // length + whether the raw env value carried surrounding whitespace.
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
