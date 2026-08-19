// ── CREIER 2 CLOUD (Ollama) — calea de chat pe ture GRELE ─────────────────────
// Owner, 16–17 aug: chat rapid = Gemini; Creier 2 (Kimi K3 / Qwen3.5) = cloud
// Ollama pe cereri grele, după proba cheii. Același contract OrMessage/OrChatResult
// ca Gemini, ca orchestratorul să rămână o singură buclă de unelte.
import type { AnthropicTool, BrainCallOpts, OrChatResult, OrMessage, OrToolCall } from './brainContract.js'
import { getCheieOllama, bazaOllamaCloud } from './creierCloud.js'

export const OLLAMA_CLOUD_PREFIX = 'ollama-cloud/'

export function ollamaCloudModelCod(model: string): string {
  return model.startsWith(OLLAMA_CLOUD_PREFIX) ? model.slice(OLLAMA_CLOUD_PREFIX.length) : model
}

export function esteOllamaCloud(model: string): boolean {
  return model.startsWith(OLLAMA_CLOUD_PREFIX)
}

/** Conținut OpenAI-chat din OrMessage (text + image data-URI; audio → notă text). */
function continutOpenAi(m: OrMessage): unknown {
  if (typeof m.content === 'string') return m.content
  if (!Array.isArray(m.content)) return ''
  const parts: unknown[] = []
  for (const b of m.content as { type: string; text?: string; image_url?: { url?: string }; audio_url?: { url?: string } }[]) {
    if (b.type === 'text' && b.text) parts.push({ type: 'text', text: b.text })
    else if (b.type === 'image_url' && b.image_url?.url) parts.push({ type: 'image_url', image_url: { url: b.image_url.url } })
    else if (b.type === 'audio_url') parts.push({ type: 'text', text: '[mesaj vocal — vezi transcriptul din istoric]' })
  }
  return parts.length ? parts : ''
}

/** Serializare sigură a argumentelor de tool call — garantează string JSON valid. */
function serializeazaArgumenteTool(args: unknown): string {
  if (args === null || args === undefined) {
    return '{}'
  }
  if (typeof args === 'string') {
    // Dacă e deja string, încearcă să-l parseze și re-serializze pentru validare
    try {
      const parsed = JSON.parse(args)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return JSON.stringify(parsed)
      }
      return '{}'
    } catch {
      // String invalid JSON → fallback la obiect gol
      return '{}'
    }
  }
  if (typeof args === 'object') {
    // Obiect → serializare directă, dar validează că e obiect (nu array)
    if (Array.isArray(args)) {
      return '{}'
    }
    try {
      return JSON.stringify(args)
    } catch {
      return '{}'
    }
  }
  return '{}'
}

function mesajeOpenAi(messages: OrMessage[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  for (const m of messages) {
    if (m.role === 'tool') {
      out.push({ role: 'tool', tool_call_id: m.tool_call_id, content: String(m.content ?? '') })
      continue
    }
    if (m.role === 'assistant' && m.tool_calls?.length) {
      out.push({
        role: 'assistant',
        content: typeof m.content === 'string' ? m.content : '',
        tool_calls: m.tool_calls.map((c) => ({
          id: c.id,
          type: 'function',
          function: { 
            name: c.function.name, 
            arguments: serializeazaArgumenteTool(c.function.arguments) 
          },
        })),
      })
      continue
    }
    out.push({ role: m.role, content: continutOpenAi(m) })
  }
  return out
}

/** Normalizează schema de unelte pentru compatibilitate Ollama Cloud (JSON Schema valid). */
export function normalizeazaSchema(schema: unknown): Record<string, unknown> {
  if (!schema || typeof schema !== 'object') {
    return { type: 'object', properties: {} }
  }
  const s = schema as Record<string, unknown>
  // Asigură tipul de bază
  if (!s.type) s.type = 'object'
  // Asigură properties există pentru object
  if (s.type === 'object' && !s.properties) s.properties = {}
  // Validează că properties e un obiect
  if (s.properties && typeof s.properties !== 'object') {
    s.properties = {}
  }
  // Curăță proprietăți invalide (nu sunt permise în JSON Schema pentru OpenAI/Ollama)
  const allowedKeys = ['type', 'description', 'properties', 'required', 'items', 'enum', 'default', 'format', 'pattern', 'minimum', 'maximum', 'minLength', 'maxLength']
  const cleaned: Record<string, unknown> = {}
  for (const key of Object.keys(s)) {
    if (allowedKeys.includes(key)) {
      const val = s[key]
      // Recursive cleanup for nested properties
      if (key === 'properties' && val && typeof val === 'object') {
        const nested: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
          nested[k] = normalizeazaSchema(v)
        }
        cleaned[key] = nested
      } else if (key === 'items' && val && typeof val === 'object') {
        cleaned[key] = normalizeazaSchema(val)
      } else {
        cleaned[key] = val
      }
    }
  }
  return cleaned
}

export function unelteOpenAi(tools: AnthropicTool[]): unknown[] {
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: normalizeazaSchema(t.input_schema ?? { type: 'object', properties: {} }),
    },
  }))
}

function dinRaspunsOpenAi(j: {
  model?: string
  choices?: {
    message?: {
      content?: string | null
      tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[]
    }
    finish_reason?: string
  }[]
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}, modelCerut: string): OrChatResult {
  const msg = j.choices?.[0]?.message
  const text = String(msg?.content ?? '')
  const toolCalls: OrToolCall[] = (msg?.tool_calls ?? []).map((c, i) => ({
    id: c.id || `oc_${i}_${Math.random().toString(36).slice(2, 8)}`,
    type: 'function' as const,
    function: { 
      name: c.function?.name || 'tool', 
      arguments: serializeazaArgumenteTool(c.function?.arguments) 
    },
  }))
  const inTok = Number(j.usage?.prompt_tokens ?? 0) || 0
  const outTok = Number(j.usage?.completion_tokens ?? 0) || 0
  // Costul real e pe soldul Ollama (extra usage) — aici 0 ca să nu fabricăm USD.
  return {
    text,
    toolCalls,
    costUsd: 0,
    model: String(j.model || modelCerut),
    stop: j.choices?.[0]?.finish_reason || 'stop',
    inputTokens: inTok,
    outputTokens: outTok,
  }
}

async function cereOllamaCloud(
  model: string,
  messages: OrMessage[],
  tools: AnthropicTool[],
  opts: BrainCallOpts,
  stream: boolean,
): Promise<{ response: Response; model: string }> {
  const cheie = await getCheieOllama()
  if (!cheie) throw new Error('ollama_cloud: nicio cheie')
  const cod = ollamaCloudModelCod(model)
  const body: Record<string, unknown> = {
    model: cod,
    messages: mesajeOpenAi(messages),
    stream,
    max_tokens: opts.maxTokens ?? 4096,
  }
  if (typeof opts.temperature === 'number') body.temperature = opts.temperature
  if (tools.length) {
    body.tools = unelteOpenAi(tools)
    body.tool_choice = opts.toolChoice === 'required' ? 'required' : 'auto'
  }
  const response = await fetch(`${bazaOllamaCloud()}/v1/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cheie}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(opts.timeoutMs && opts.timeoutMs > 0 ? opts.timeoutMs : 120_000),
  })
  return { response, model: cod }
}

export async function ollamaCloudChat(
  model: string,
  messages: OrMessage[],
  tools: AnthropicTool[] = [],
  opts: BrainCallOpts = {},
): Promise<OrChatResult> {
  const { response: r, model: cod } = await cereOllamaCloud(model, messages, tools, opts, false)
  if (!r.ok) {
    const t = (await r.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 280)
    throw new Error(`ollama_cloud ${r.status}: ${t}`)
  }
  const j = (await r.json()) as Parameters<typeof dinRaspunsOpenAi>[0]
  return dinRaspunsOpenAi(j, cod)
}

/** Stream text deltas; tool_calls pe chunk-ul final (compat OpenAI SSE). */
export async function ollamaCloudChatStream(
  model: string,
  messages: OrMessage[],
  tools: AnthropicTool[],
  onText: (delta: string) => void,
  opts: BrainCallOpts = {},
): Promise<OrChatResult> {
  const { response: r, model: cod } = await cereOllamaCloud(model, messages, tools, opts, true)
  if (!r.ok || !r.body) {
    const t = (await r.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 280)
    throw new Error(`ollama_cloud ${r.status}: ${t}`)
  }
  const reader = r.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  let text = ''
  const toolAcc = new Map<number, { id: string; name: string; args: string }>()
  let stop = 'stop'
  let modelServit = cod
  let inTok = 0
  let outTok = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    const linii = buf.split('\n')
    buf = linii.pop() ?? ''
    for (const linie of linii) {
      const s = linie.trim()
      if (!s.startsWith('data:')) continue
      const payload = s.slice(5).trim()
      if (payload === '[DONE]') continue
      let j: {
        model?: string
        choices?: {
          delta?: {
            content?: string
            tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[]
          }
          finish_reason?: string | null
        }[]
        usage?: { prompt_tokens?: number; completion_tokens?: number }
      }
      try {
        j = JSON.parse(payload) as typeof j
      } catch {
        continue
      }
      if (j.model) modelServit = j.model
      if (j.usage) {
        inTok = Number(j.usage.prompt_tokens ?? inTok) || inTok
        outTok = Number(j.usage.completion_tokens ?? outTok) || outTok
      }
      const ch = j.choices?.[0]
      if (ch?.finish_reason) stop = ch.finish_reason
      const d = ch?.delta
      if (d?.content) {
        text += d.content
        onText(d.content)
      }
      for (const tc of d?.tool_calls ?? []) {
        const idx = tc.index ?? 0
        const cur = toolAcc.get(idx) ?? { id: tc.id || `oc_${idx}`, name: '', args: '' }
        if (tc.id) cur.id = tc.id
        if (tc.function?.name) cur.name += tc.function.name
        if (tc.function?.arguments) cur.args += tc.function.arguments
        toolAcc.set(idx, cur)
      }
    }
  }
  const toolCalls: OrToolCall[] = [...toolAcc.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, v]) => ({
      id: v.id,
      type: 'function' as const,
      function: { name: v.name || 'tool', arguments: serializeazaArgumenteTool(v.args) },
    }))
  return {
    text,
    toolCalls,
    costUsd: 0,
    model: modelServit,
    stop,
    inputTokens: inTok,
    outputTokens: outTok,
  }
}
