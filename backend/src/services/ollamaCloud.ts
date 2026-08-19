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

/** Serializare sigură a argumentelor de tool call — garantează string JSON valid pentru Ollama Cloud. */
export function serializeazaArgumenteTool(args: unknown): string {
  // Null/undefined → obiect gol serializat
  if (args === null || args === undefined) {
    return '{}'
  }
  
  // String → încearcă să parseze și re-serializze pentru validare
  if (typeof args === 'string') {
    const trimmed = args.trim()
    if (trimmed === '') {
      return '{}'
    }
    try {
      const parsed = JSON.parse(trimmed)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return JSON.stringify(parsed)
      }
      // String valid dar nu e object (array/primitive) → obiect gol
      return '{}'
    } catch {
      // String invalid JSON → fallback la obiect gol
      return '{}'
    }
  }
  
  // Obiect → serializare directă, dar validează că e obiect (nu array)
  if (typeof args === 'object') {
    if (Array.isArray(args)) {
      return '{}'
    }
    try {
      const serialized = JSON.stringify(args)
      if (!serialized || serialized.trim() === '{}') {
        return '{}'
      }
      return serialized
    } catch {
      return '{}'
    }
  }
  
  // Tipuri primitive (number, boolean, etc.) → obiect gol
  return '{}'
}

/** Parsează argumente tool call din string JSON — cu fallback curat pentru Ollama Cloud. */
export function parseazaArgumenteTool(args: unknown): Record<string, unknown> {
  // Null/undefined → obiect gol
  if (args === null || args === undefined) {
    return {}
  }
  
  // Obiect deja → returnează direct (dacă nu e array)
  if (typeof args === 'object') {
    if (Array.isArray(args)) {
      return {}
    }
    return args as Record<string, unknown>
  }
  
  // String → parsează JSON
  if (typeof args === 'string') {
    const trimmed = args.trim()
    if (trimmed === '') {
      return {}
    }
    try {
      const parsed = JSON.parse(trimmed)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
      return {}
    } catch {
      return {}
    }
  }
  
  // Orice alt tip → obiect gol
  return {}
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
        tool_calls: m.tool_calls.map((c) => {
          // Validează și structurează argumentele pentru Ollama Cloud
          const argsStr = serializeazaArgumenteTool(c.function.arguments)
          // Parsează pentru a asigura că e obiect valid, apoi re-serializază
          const argsObj = parseazaArgumenteTool(argsStr)
          return {
            id: c.id,
            type: 'function',
            function: { 
              name: c.function.name, 
              arguments: JSON.stringify(argsObj),
            },
          }
        }),
      })
      continue
    }
    out.push({ role: m.role, content: continutOpenAi(m) })
  }
  return out
}

/** Normalizează schema de unelte pentru compatibilitate Ollama Cloud (JSON Schema valid). */
export function normalizeazaSchema(schema: unknown): Record<string, unknown> {
  // Schema invalidă → returnează schema minimală validă
  if (!schema || typeof schema !== 'object') {
    return { type: 'object', properties: {} }
  }
  
  const s = schema as Record<string, unknown>
  const cleaned: Record<string, unknown> = {}
  
  // Asigură tipul de bază (default: object)
  if (s.type && typeof s.type === 'string') {
    cleaned.type = s.type
  } else {
    cleaned.type = 'object'
  }
  
  // Asigură properties există pentru object și e un obiect valid
  if (cleaned.type === 'object') {
    if (s.properties && typeof s.properties === 'object' && !Array.isArray(s.properties)) {
      const props: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(s.properties as Record<string, unknown>)) {
        // Doar normalizează dacă e un obiect schema valid (are type sau properties)
        // Altfel păstrează schema proprietății așa cum e (ex: { type: 'string' })
        if (value && typeof value === 'object') {
          const valObj = value as Record<string, unknown>
          // Dacă are 'type' sau 'properties', e o schemă - normalizeaz-o
          if (valObj.type || valObj.properties) {
            props[key] = normalizeazaSchema(value)
          } else {
            // Altfel păstrează ca atare (poate fi deja o schemă simplă validă)
            props[key] = value
          }
        } else {
          // Valoare non-obiect → schema minimală
          props[key] = { type: 'object', properties: {} }
        }
      }
      cleaned.properties = props
    } else {
      cleaned.properties = {}
    }
  }
  
  // Validează required (trebuie să fie array de stringuri)
  if (s.required && Array.isArray(s.required)) {
    const requiredStrings = (s.required as unknown[]).filter(r => typeof r === 'string')
    if (requiredStrings.length > 0) {
      cleaned.required = requiredStrings
    }
  }
  
  // Copiază alte proprietăți permise în JSON Schema
  const allowedKeys = ['description', 'items', 'enum', 'default', 'format', 'pattern', 'minimum', 'maximum', 'minLength', 'maxLength']
  for (const key of allowedKeys) {
    if (key in s) {
      const val = s[key]
      if (key === 'items' && val && typeof val === 'object') {
        cleaned[key] = normalizeazaSchema(val)
      } else if (key !== 'type' && key !== 'properties' && key !== 'required') {
        cleaned[key] = val
      }
    }
  }
  
  return cleaned
}

export function unelteOpenAi(tools: AnthropicTool[]): unknown[] {
  return tools.map((t) => {
    const schema = normalizeazaSchema(t.input_schema ?? { type: 'object', properties: {} })
    
    // Asigură că parameters are structura corectă pentru Ollama Cloud
    const parameters: Record<string, unknown> = {
      type: schema.type || 'object',
      properties: schema.properties || {},
    }
    
    // Adaugă required doar dacă e array valid cu elemente
    if (schema.required && Array.isArray(schema.required) && (schema.required as string[]).length > 0) {
      parameters.required = schema.required
    }
    
    // Adaugă description dacă există
    if (schema.description && typeof schema.description === 'string') {
      parameters.description = schema.description
    }
    
    return {
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters,
      },
    }
  })
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
  const toolCalls: OrToolCall[] = (msg?.tool_calls ?? []).map((c, i) => {
    // Parsează și validează argumentele din răspuns
    const argsStr = c.function?.arguments ?? '{}'
    const argsObj = parseazaArgumenteTool(argsStr)
    return {
      id: c.id || `oc_${i}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'function' as const,
      function: { 
        name: c.function?.name || 'tool', 
        arguments: JSON.stringify(argsObj),
      },
    }
  })
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
    .map(([, v]) => {
      // Parsează și validează argumentele acumulate din stream
      const argsObj = parseazaArgumenteTool(v.args)
      return {
        id: v.id,
        type: 'function' as const,
        function: { name: v.name || 'tool', arguments: JSON.stringify(argsObj) },
      }
    })
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
