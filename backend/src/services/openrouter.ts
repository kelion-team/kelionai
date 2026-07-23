import { config } from '../config.js'

// ── MODELE SELECTABILE — OpenRouter (o singură cheie pentru tot creierul) ─────
// O cheie OpenRouter dă acces la GPT/Gemini/Claude. Catalogul se ia LIVE și se
// pune în cache scurt: modele noi apar AUTOMAT, fără deploy (Adrian: „autoupdate").
// Costul REAL per apel vine din răspuns (usage.cost, în USD) → ledger precis.
// Vocea NU trece pe aici (OpenRouter n-are model realtime) — rămâne OpenAI direct.

const OR_BASE = 'https://openrouter.ai/api/v1'
const CATALOG_TTL_MS = 10 * 60 * 1000

export type ModelTier = 'chat' | 'work'

export interface CatalogModel {
  id: string
  name: string
  provider: 'openai' | 'google' | 'anthropic'
  vision: boolean
  contextLength: number
}

export interface Catalog {
  chat: CatalogModel[] // GPT + Gemini
  work: CatalogModel[] // GPT + Claude
  fetchedAt: number
}

export interface RawModel {
  id: string
  name?: string
  context_length?: number
  architecture?: { input_modalities?: string[] }
  supported_parameters?: string[]
}

let cache: Catalog | null = null

function providerOf(id: string): CatalogModel['provider'] | null {
  if (id.startsWith('openai/')) return 'openai'
  if (id.startsWith('google/')) return 'google'
  if (id.startsWith('anthropic/')) return 'anthropic'
  return null
}

// Excludem variantele vechi/ieftine irelevante ca lista să fie curată pentru user.
function isSelectable(id: string): boolean {
  return !/gpt-3\.5|gpt-4-turbo-preview|claude-3-haiku|-0613|-16k|preview-\d|customtools/.test(id)
}

export function toModel(m: RawModel): CatalogModel | null {
  const provider = providerOf(m.id)
  if (!provider) return null
  const sp = m.supported_parameters ?? []
  if (!sp.includes('tools')) return null // toate capabilitățile cer tool-use
  if (!isSelectable(m.id)) return null
  return {
    id: m.id,
    name: m.name ?? m.id,
    provider,
    vision: (m.architecture?.input_modalities ?? []).includes('image'),
    contextLength: m.context_length ?? 0,
  }
}

/** Ia catalogul live (cu cache scurt) și-l grupează pe tier-uri selectabile. */
export async function getCatalog(force = false): Promise<Catalog> {
  if (!force && cache && Date.now() - cache.fetchedAt < CATALOG_TTL_MS) return cache
  if (!config.openrouter.key) {
    return (cache = { chat: [], work: [], fetchedAt: Date.now() })
  }
  const r = await fetch(`${OR_BASE}/models`, {
    headers: { Authorization: `Bearer ${config.openrouter.key}` },
    signal: AbortSignal.timeout(20_000),
  }).catch(() => null)
  if (!r || !r.ok) return cache ?? { chat: [], work: [], fetchedAt: Date.now() }

  const data = ((await r.json().catch(() => ({}))) as { data?: RawModel[] }).data ?? []
  const models = data.map(toModel).filter((m): m is CatalogModel => m != null)
  // Chat = GPT + Gemini (rapide, conversație). Work = GPT + Claude (raționament greu).
  const chat = models.filter((m) => m.provider === 'openai' || m.provider === 'google')
  const work = models.filter((m) => m.provider === 'openai' || m.provider === 'anthropic')
  const byId = (a: CatalogModel, b: CatalogModel): number => a.id.localeCompare(b.id)
  cache = { chat: chat.sort(byId), work: work.sort(byId), fetchedAt: Date.now() }
  return cache
}

// Dificultatea cerută de sarcină (0-100), pur euristic din text (0 cost/latență).
// Semnale: lungime, raționament/analiză, cod/depanare, multi-pas. Pe baza ei
// ESCALADĂM chat→creier (Adrian: „legate, escaladează singur").
export function taskDifficulty(text: string): number {
  const t = (text || '').toLowerCase()
  let d = 15 // conversație simplă: salut, întrebare scurtă, mulțumire
  const len = t.length
  if (len > 1000) d += 65
  else if (len > 500) d += 45
  else if (len > 200) d += 20
  // Raționament / analiză / explicație aprofundată.
  if (/(analiz[ăae]|demonstr|rezolv[ăa]|[îi]n detaliu|pas cu pas|g[âa]nde[șs]te|ra[țt]ion|argument[ea]|compar[ăa]|evalu[eaă]|de ce\b|cum func[țt]ion|strategi[ea]|plan detaliat|explic)/.test(t)) d += 65
  // Cod / software / depanare — cel mai exigent.
  if (/(algoritm|debug|\bcod\b|\bprogram|func[țt]i|script|\bbug\b|refactor|optimiz|compil|stack ?trace|except|sql|regex)/.test(t)) d += 70
  // Multi-pas.
  if ((t.match(/\?/g) || []).length >= 3 || /(și apoi|dup[ăa] care|mai [îi]nt[âa]i)/.test(t)) d += 12
  return Math.min(100, Math.max(0, d))
}

// Prag de escaladare: peste el, cererea urcă de la CHAT la CREIER.
export const ESCALATE_AT = 60

/** Validează că un model ales de user e în tier-ul respectiv; altfel implicitul. */
export async function resolveModel(tier: ModelTier, wanted?: string | null): Promise<string> {
  const fallback = tier === 'chat' ? config.openrouter.chatDefault : config.openrouter.workDefault
  if (!wanted) return fallback
  const cat = await getCatalog()
  const list = tier === 'chat' ? cat.chat : cat.work
  return list.some((m) => m.id === wanted) ? wanted : fallback
}

export interface OrMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  // Pentru tura de tool: legătura cu apelul cerut de model.
  tool_call_id?: string
  tool_calls?: OrToolCall[]
}

// Unealtă în format Anthropic (cum sunt definite în chat.ts).
export interface AnthropicTool {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

export interface OrToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

// Conversie Anthropic → OpenAI (OpenRouter): input_schema → parameters.
export function toolsToOpenAI(tools: AnthropicTool[]): unknown[] {
  return tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }))
}

export interface OrChatResult {
  text: string
  toolCalls: OrToolCall[]
  costUsd: number
  model: string
  stop: string
}

// Variantă STREAMING: textul curge prin `onText` (primul cuvânt instant, ca pe
// vechiul Kimi), iar apelurile de unelte se asamblează pe index din delte.
export async function openrouterChatStream(
  model: string,
  messages: OrMessage[],
  tools: AnthropicTool[],
  onText: (delta: string) => void,
  opts: { maxTokens?: number; temperature?: number } = {},
): Promise<OrChatResult> {
  if (!config.openrouter.key) return { text: '', toolCalls: [], costUsd: 0, model, stop: 'no_key' }
  const body: Record<string, unknown> = {
    model,
    messages,
    max_tokens: opts.maxTokens ?? 1024,
    temperature: opts.temperature ?? 0.7,
    stream: true,
    usage: { include: true },
    stream_options: { include_usage: true },
  }
  if (tools.length) {
    body.tools = toolsToOpenAI(tools)
    body.tool_choice = 'auto'
  }
  const r = await fetch(`${OR_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.openrouter.key}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://kelionai.app',
      'X-Title': 'Kelionai',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  })
  if (!r.ok || !r.body) {
    throw new Error(`openrouter ${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}`)
  }

  let text = ''
  let costUsd = 0
  let served = model
  let stop = 'stop'
  // Apelurile de unelte vin fragmentat, pe index; le asamblăm.
  const calls = new Map<number, { id: string; name: string; args: string }>()

  const reader = r.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (data === '[DONE]') continue
      let ev: {
        choices?: {
          delta?: { content?: string; tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[] }
          finish_reason?: string
        }[]
        usage?: { cost?: number }
        model?: string
      }
      try {
        ev = JSON.parse(data)
      } catch {
        continue
      }
      if (ev.model) served = ev.model
      if (ev.usage?.cost != null) costUsd = Number(ev.usage.cost)
      const choice = ev.choices?.[0]
      if (!choice) continue
      if (choice.finish_reason) stop = choice.finish_reason
      const d = choice.delta
      if (d?.content) {
        text += d.content
        onText(d.content)
      }
      for (const tc of d?.tool_calls ?? []) {
        const idx = tc.index ?? 0
        const cur = calls.get(idx) ?? { id: '', name: '', args: '' }
        if (tc.id) cur.id = tc.id
        if (tc.function?.name) cur.name = tc.function.name
        if (tc.function?.arguments) cur.args += tc.function.arguments
        calls.set(idx, cur)
      }
    }
  }

  const toolCalls: OrToolCall[] = [...calls.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, c]) => ({ id: c.id || `call_${c.name}`, type: 'function', function: { name: c.name, arguments: c.args } }))
  return { text, toolCalls, costUsd, model: served, stop }
}

/**
 * O tură de chat prin OpenRouter CU tool-use (format OpenAI). Întoarce textul,
 * eventualele apeluri de unelte cerute de model, și costul REAL. Cheamă-l în
 * buclă: execuți uneltele, adaugi rezultatele ca mesaje role:'tool', re-apelezi.
 */
export async function openrouterChat(
  model: string,
  messages: OrMessage[],
  tools: AnthropicTool[] = [],
  opts: { maxTokens?: number; temperature?: number } = {},
): Promise<OrChatResult> {
  if (!config.openrouter.key) return { text: '', toolCalls: [], costUsd: 0, model, stop: 'no_key' }
  const body: Record<string, unknown> = {
    model,
    messages,
    max_tokens: opts.maxTokens ?? 1024,
    temperature: opts.temperature ?? 0.7,
    usage: { include: true },
  }
  if (tools.length) {
    body.tools = toolsToOpenAI(tools)
    body.tool_choice = 'auto'
  }
  const r = await fetch(`${OR_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.openrouter.key}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://kelionai.app',
      'X-Title': 'Kelionai',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  })
  if (!r.ok) throw new Error(`openrouter ${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}`)
  const j = (await r.json()) as {
    choices?: { message?: { content?: string; tool_calls?: OrToolCall[] }; finish_reason?: string }[]
    usage?: { cost?: number }
    model?: string
  }
  const choice = j.choices?.[0]
  return {
    text: choice?.message?.content ?? '',
    toolCalls: choice?.message?.tool_calls ?? [],
    costUsd: Number(j.usage?.cost ?? 0),
    model: j.model ?? model,
    stop: choice?.finish_reason ?? 'stop',
  }
}

export interface OrResult {
  text: string
  /** Cost REAL în USD raportat de OpenRouter (0 dacă indisponibil). */
  costUsd: number
  model: string
}

/**
 * Completare printr-un model OpenRouter, cu cost REAL în răspuns (usage.cost).
 * `usage:{include:true}` cere OpenRouter să întoarcă costul exact al apelului.
 */
export async function openrouterComplete(
  model: string,
  messages: OrMessage[],
  opts: { maxTokens?: number; temperature?: number } = {},
): Promise<OrResult> {
  if (!config.openrouter.key) return { text: '', costUsd: 0, model }
  const r = await fetch(`${OR_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.openrouter.key}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://kelionai.app',
      'X-Title': 'Kelionai',
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: opts.maxTokens ?? 1024,
      temperature: opts.temperature ?? 0.7,
      usage: { include: true },
    }),
    signal: AbortSignal.timeout(120_000),
  })
  if (!r.ok) {
    const err = await r.text().catch(() => '')
    throw new Error(`openrouter ${r.status}: ${err.slice(0, 200)}`)
  }
  const j = (await r.json()) as {
    choices?: { message?: { content?: string } }[]
    usage?: { cost?: number }
    model?: string
  }
  return {
    text: j.choices?.[0]?.message?.content ?? '',
    costUsd: Number(j.usage?.cost ?? 0),
    model: j.model ?? model,
  }
}

// ── IMAGINE prin OpenRouter (aceeași cheie ca creierul; fără Gemini separat) ──
// Modelul de imagini întoarce imaginea inline în `message.images[].image_url.url`
// (data URL). Întoarcem mime + bytes; costul REAL vine din usage.cost.
export type OrImage = { mime: string; buf: Buffer; costUsd: number } | { error: string }
export async function openrouterImage(prompt: string): Promise<OrImage> {
  if (!config.openrouter.key) return { error: 'image_not_configured' }
  let r: Response
  try {
    r = await fetch(`${OR_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.openrouter.key}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://kelionai.app',
        'X-Title': 'Kelionai',
      },
      body: JSON.stringify({
        model: config.openrouter.imageModel,
        messages: [{ role: 'user', content: prompt }],
        modalities: ['image', 'text'],
        usage: { include: true },
      }),
      signal: AbortSignal.timeout(120_000),
    })
  } catch {
    return { error: 'image_unavailable' }
  }
  if (!r.ok) return { error: `image_http_${r.status}` }
  const j = (await r.json().catch(() => ({}))) as {
    choices?: { message?: { images?: { image_url?: { url?: string } }[] } }[]
    usage?: { cost?: number }
  }
  const url = j.choices?.[0]?.message?.images?.[0]?.image_url?.url ?? ''
  const m = /^data:([^;]+);base64,(.+)$/s.exec(url)
  if (!m) return { error: 'no_image' }
  return { mime: m[1], buf: Buffer.from(m[2], 'base64'), costUsd: Number(j.usage?.cost ?? 0) }
}

// ── CĂUTARE WEB prin OpenRouter (plugin `web`; fără Serper) ───────────────────
// Orice model acceptă plugin-ul `web`: OpenRouter caută pe web și dă modelului
// rezultatele, iar răspunsul include text + citări (annotations url_citation).
export interface OrSearchResult {
  text: string
  sources: { title: string; url: string }[]
  costUsd: number
}
export async function openrouterWebSearch(query: string, instruction?: string): Promise<OrSearchResult> {
  if (!config.openrouter.key) return { text: '', sources: [], costUsd: 0 }
  const sys = instruction ?? 'Search the web and answer concisely with the most current, factual information. Cite sources.'
  let r: Response
  try {
    r = await fetch(`${OR_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.openrouter.key}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://kelionai.app',
        'X-Title': 'Kelionai',
      },
      body: JSON.stringify({
        model: config.openrouter.searchModel,
        plugins: [{ id: 'web' }],
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: query },
        ],
        max_tokens: 900,
        usage: { include: true },
      }),
      signal: AbortSignal.timeout(60_000),
    })
  } catch {
    return { text: '', sources: [], costUsd: 0 }
  }
  if (!r.ok) return { text: '', sources: [], costUsd: 0 }
  const j = (await r.json().catch(() => ({}))) as {
    choices?: {
      message?: {
        content?: string
        annotations?: { type?: string; url_citation?: { title?: string; url?: string } }[]
      }
    }[]
    usage?: { cost?: number }
  }
  const msg = j.choices?.[0]?.message
  const sources = (msg?.annotations ?? [])
    .filter((a) => a.type === 'url_citation' && a.url_citation?.url)
    .map((a) => ({ title: a.url_citation?.title ?? '', url: a.url_citation?.url ?? '' }))
  return { text: msg?.content ?? '', sources, costUsd: Number(j.usage?.cost ?? 0) }
}
