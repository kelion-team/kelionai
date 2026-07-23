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
