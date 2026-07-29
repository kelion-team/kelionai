import { config } from '../config.js'
import { readSSE } from './sse.js'

// ── MODELE SELECTABILE — OpenRouter (o singură cheie pentru tot creierul) ─────
// O cheie OpenRouter dă acces la GPT/Gemini/Claude. Catalogul se ia LIVE și se
// pune în cache scurt: modele noi apar AUTOMAT, fără deploy (Adrian: „autoupdate").
// Costul REAL per apel vine din răspuns (usage.cost, în USD) → ledger precis.
// Vocea NU trece pe aici (OpenRouter n-are model realtime) — rămâne OpenAI direct.

const OR_BASE = 'https://openrouter.ai/api/v1'
const CATALOG_TTL_MS = 10 * 60 * 1000

// 'top' = treapta finală a ladder-ului (Fable 5, doar dificultate extremă) —
// validează pe ACELAȘI catalog filtrat vision+tools ca 'work', fallback diferit.
export type ModelTier = 'chat' | 'work' | 'top'

export interface CatalogModel {
  id: string
  name: string
  provider: 'openai' | 'google' | 'anthropic' | 'nvidia' | 'cohere'
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
  // CREIERUL FULL FREE (Adrian, 27 iul: „da" pe schema $0): nvidia (nemotron
  // omni/ultra) și cohere (north-mini-code) intră în catalog DOAR pentru
  // variantele lor gratuite cu tools — vezi filtrarea pe liste mai jos.
  if (id.startsWith('nvidia/')) return 'nvidia'
  if (id.startsWith('cohere/')) return 'cohere'
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
  // COMPATIBILITATE 100% (Adrian, 25 iul: „păstrăm în liste doar cele
  // compatibile 100% la voce și creier, vedere etc."): un cadru de cameră care
  // ajunge la creier PE VEDERE (needsVision forțează escaladarea aici — vezi
  // chat.ts) trebuie servit de un model care CHIAR vede — altfel poza ar fi
  // ignorată/ar pica. Filtru REAL pe catalogul live, nu presupunere.
  // nvidia/cohere apar DOAR pe gratuit (:free) — restul providerilor noi ar
  // dilua listele; cele plătite rămân pe openai/google/anthropic ca până acum.
  const freeOnly = (m: CatalogModel): boolean =>
    (m.provider === 'nvidia' || m.provider === 'cohere') ? m.id.endsWith(':free') : true
  const chat = models.filter((m) => (m.provider === 'openai' || m.provider === 'google' || m.provider === 'nvidia' || m.provider === 'cohere') && freeOnly(m))
  // CREIERUL FULL FREE (Adrian, 27 iul): treapta work acceptă și modelele
  // GRATUITE cu vedere+tools (gemma :free, nemotron omni/vl :free) — nucleul
  // implicit e acum gratuit, iar adminul le poate alege și manual din listă.
  const work = models.filter((m) => m.vision && (m.provider === 'openai' || m.provider === 'anthropic' || (m.id.endsWith(':free') && freeOnly(m))))
  const byId = (a: CatalogModel, b: CatalogModel): number => a.id.localeCompare(b.id)
  cache = { chat: chat.sort(byId), work: work.sort(byId), fetchedAt: Date.now() }
  return cache
}

// ── SOLDUL REAL AL CONTULUI OPENROUTER = „punga lui Kelion" (Adrian, 24 iul) ──
// Creierul (OpenRouter) e alimentat CENTRAL din contul lui Kelion, nu de fiecare
// user separat. Adminul trebuie să vadă VALOAREA EXACTĂ rămasă (ca pe pagina
// openrouter.ai/credits: „$5,83") ca să știe când să depună bani. Userii NU văd
// asta niciodată (ruta e admin-only). Endpoint oficial: GET /credits →
// { data: { total_credits, total_usage } }; rămas = total_credits − total_usage.
export interface OpenRouterBalance {
  ok: boolean
  balance: number // USD rămași, exact (total_credits − total_usage)
  totalCredits: number
  totalUsage: number
  currency: 'usd'
  low: boolean // sub prag → adminul trebuie să depună bani
  threshold: number
  topup: string
  error?: string
}

const OR_LOW_THRESHOLD = Math.max(0, Number(process.env.OPENROUTER_LOW_USD ?? '10') || 10)
let orBalCache: { at: number; val: OpenRouterBalance } | null = null

export async function getOpenRouterBalance(force = false): Promise<OpenRouterBalance> {
  const base: OpenRouterBalance = {
    ok: false, balance: 0, totalCredits: 0, totalUsage: 0, currency: 'usd',
    low: true, threshold: OR_LOW_THRESHOLD, topup: 'https://openrouter.ai/credits',
  }
  if (!config.openrouter.key) return { ...base, error: 'not_configured' }
  if (!force && orBalCache && Date.now() - orBalCache.at < 60_000) return orBalCache.val
  try {
    const r = await fetch(`${OR_BASE}/credits`, {
      headers: { Authorization: `Bearer ${config.openrouter.key}` },
      signal: AbortSignal.timeout(12_000),
    })
    if (!r.ok) return { ...base, error: `http_${r.status}` }
    const j = (await r.json().catch(() => ({}))) as {
      data?: { total_credits?: number; total_usage?: number }
    }
    const totalCredits = Number(j.data?.total_credits ?? 0)
    const totalUsage = Number(j.data?.total_usage ?? 0)
    const balance = Math.round((totalCredits - totalUsage) * 100) / 100
    const val: OpenRouterBalance = {
      ...base, ok: true, balance, totalCredits, totalUsage, low: balance < OR_LOW_THRESHOLD,
    }
    orBalCache = { at: Date.now(), val }
    return val
  } catch (e) {
    return { ...base, error: String(e).slice(0, 120) }
  }
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
// LADDER PE 3 TREPTE (Adrian, 25 iul: „la creier gpt-5-mini până la Fable"):
// gratuit (chat) → ieftin-capabil (creier, implicit) → Fable 5 DOAR pe
// dificultate cu adevărat extremă. Sub acest prag suplimentar, creierul
// folosește modelul ieftin (workDefault/sel.work); peste el, urcă la
// TOP_DEFAULT indiferent ce a ales userul — rezervat pentru cazurile chiar grele.
export const ESCALATE_TOP_AT = 85

// INTENȚIE DE EXECUȚIE (Adrian, 25 iul: „escaladarea se face de la cel mai
// ieftin și capabil model până la sarcini cu adevărat grele, și se revine la
// chat live") — analiza reală a arătat că modelul ieftin de chat pur și simplu
// NU chema unelte la ordinele de execuție ale proprietarului (le vorbea, nu le
// făcea), în timp ce forțarea creierului mare pe FIECARE tură de admin a ars
// $23+/oră doar pe conversație obișnuită. Soluția corectă: rămâi ieftin
// implicit, escaladează DOAR pe cererile de acțiune reală — și revii automat
// la treapta ieftină la următoarea replică (heavy se calculează per-tură, din
// textul curent, nu se ține agățat).
// LĂRGIT (Adrian, 27 iul seara: „nu știe ce să facă, doar spune că face" —
// comenzile de zi cu zi: „deschide youtube", „pune o melodie", „caută X",
// „fă un audit" NU erau recunoscute ca ordine → rămâneau pe modelul de
// conversație, care doar povestește. Orice verb de comandă = tura de EXECUȚIE.)
const ACTION_INTENT = /(repar[ăa]|remediaz|execut[ăa]?|ruleaz[ăa]|public[ăa]|deploy|livrez|livreaz[ăa]|scrie\s*cod|corecteaz[ăa]|\bfix\b|adaug[ăa]|schimb[ăa]|instaleaz[ăa]|creeaz[ăa]|[șs]terge|modific[ăa]|\bcommit\b|\bmerge\b|\bpr\b|\bbranch\b|runbook|workflow|restart|backup|afi[șs]eaz[ăa]|arat[ăa](-mi)?\b|diagnostic|deschide|porne[șs]te|opre[șs]te|\bpune\b|caut[ăa]|c[âa]nt[ăa]|salveaz[ăa]|trimite|cite[șs]te|verific[ăa]|uit[ăa]-te|ascult[ăa]|deseneaz[ăa]|genereaz[ăa]|construie[șs]te|\bf[ăa]\b|\baudit\b|raporteaz[ăa]|\braport\b|noteaz[ăa]|programeaz[ăa]|tradu\b|calculeaz[ăa]|rezerv[ăa]|comand[ăa]|monitorizeaz[ăa])/i
export function hasActionIntent(text: string): boolean {
  return ACTION_INTENT.test(text || '')
}

// CREIERUL OWNERULUI = AGENT PUTERNIC (regula de fier §14, AI-HANDOFF): pe drumul
// ownerului modelul NU se cioantă pe gratuit. Alege cel mai bun model PLĂTIT cu
// vedere+unelte din catalogul LIVE (deci ID garantat valid, nu inventat): preferă
// Claude/Anthropic (creierul stabilit de owner), altfel OpenAI. null dacă în
// catalog nu există niciun model plătit capabil (cade pe comportamentul curent).
export async function bestPaidWorkModel(): Promise<string | null> {
  // GARDĂ ANTI-SPARGERE: nu ruta pe PLĂTIT dacă punga OpenRouter e goală — apelul
  // plătit ar pica (402/insufficient) și creierul s-ar rupe. Fără bani → null →
  // rămâne pe free, dumb dar FUNCȚIONAL (incident 27 iul: soldul a ajuns la minus).
  const bal = await getOpenRouterBalance().catch(() => null)
  if (!bal || !bal.ok || bal.balance <= 0) return null
  const cat = await getCatalog()
  const paid = cat.work.filter(
    (m) => (m.provider === 'anthropic' || m.provider === 'openai') && !m.id.endsWith(':free'),
  )
  if (!paid.length) return null
  const claude = paid.find((m) => m.provider === 'anthropic')
  return (claude ?? paid[0]).id
}

/** Validează că un model ales de user e în tier-ul respectiv; altfel implicitul. */
export async function resolveModel(tier: ModelTier, wanted?: string | null): Promise<string> {
  const fallback =
    tier === 'chat' ? config.openrouter.chatDefault : tier === 'top' ? config.openrouter.topDefault : config.openrouter.workDefault
  if (!wanted) return fallback
  const cat = await getCatalog()
  const list = tier === 'chat' ? cat.chat : cat.work // 'work' și 'top' validează pe același catalog (vision+tools)
  return list.some((m) => m.id === wanted) ? wanted : fallback
}

export interface OrMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  // String pentru text simplu; array pentru multimodal în format OpenAI
  // (blocuri {type:'text'|'image_url'}) — așa VĂD modelele pozele/camera.
  content: string | { type: 'text'; text: string }[] | { type: string; [k: string]: unknown }[]
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

// ── SURSĂ UNICĂ pentru cererea OpenRouter (antete + fetch + corp) ────────────
// Antetele + fetch-ul erau copiate în fiecare funcție (stream/chat/complete/
// image); corpul de chat (model/mesaje/tokeni/temperatură/usage + raționament +
// unelte) era copiat în stream și chat. Aici, o singură dată (principiul
// unic-fără-duplicate). Comportament IDENTIC — doar mutat.
function orFetch(body: unknown, timeoutMs = 120_000): Promise<Response> {
  return fetch(`${OR_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.openrouter.key}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://kelionai.app',
      'X-Title': 'Kelionai',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
}

function orBody(
  model: string,
  messages: OrMessage[],
  tools: AnthropicTool[],
  opts: { maxTokens?: number; temperature?: number; reasoning?: 'low' | 'medium' | 'high'; toolChoice?: 'auto' | 'required' },
  stream: boolean,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model,
    messages,
    max_tokens: opts.maxTokens ?? 1024,
    temperature: opts.temperature ?? 0.7,
    usage: { include: true },
  }
  if (stream) {
    body.stream = true
    body.stream_options = { include_usage: true }
  }
  if (opts.reasoning) body.reasoning = { effort: opts.reasoning }
  if (tools.length) {
    body.tools = toolsToOpenAI(tools)
    body.tool_choice = opts.toolChoice ?? 'auto'
  }
  return body
}

// Variantă STREAMING: textul curge prin `onText` (primul cuvânt instant, ca pe
// vechiul Kimi), iar apelurile de unelte se asamblează pe index din delte.
export async function openrouterChatStream(
  model: string,
  messages: OrMessage[],
  tools: AnthropicTool[],
  onText: (delta: string) => void,
  opts: { maxTokens?: number; temperature?: number; reasoning?: 'low' | 'medium' | 'high'; toolChoice?: 'auto' | 'required' } = {},
): Promise<OrChatResult> {
  if (!config.openrouter.key) return { text: '', toolCalls: [], costUsd: 0, model, stop: 'no_key' }
  // Corp + fetch din sursa comună (raționament + unelte incluse). `stream:true`.
  const r = await orFetch(orBody(model, messages, tools, opts, true))
  if (!r.ok || !r.body) {
    throw new Error(`openrouter ${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}`)
  }

  let text = ''
  let costUsd = 0
  let served = model
  let stop = 'stop'
  // Apelurile de unelte vin fragmentat, pe index; le asamblăm.
  const calls = new Map<number, { id: string; name: string; args: string }>()

  // Citirea fluxului SSE din sursa comună (services/sse.ts); procesarea
  // evenimentului (format OpenAI: choices/delta) rămâne aici.
  await readSSE(r.body, (raw) => {
    const ev = raw as {
      choices?: {
        delta?: { content?: string; tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[] }
        finish_reason?: string
      }[]
      usage?: { cost?: number }
      model?: string
    }
    if (ev.model) served = ev.model
    if (ev.usage?.cost != null) costUsd = Number(ev.usage.cost)
    const choice = ev.choices?.[0]
    if (!choice) return
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
  })

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
  opts: { maxTokens?: number; temperature?: number; reasoning?: 'low' | 'medium' | 'high'; toolChoice?: 'auto' | 'required' } = {},
): Promise<OrChatResult> {
  if (!config.openrouter.key) return { text: '', toolCalls: [], costUsd: 0, model, stop: 'no_key' }
  // Corp + fetch din sursa comună (raționament + unelte incluse). `stream:false`.
  const r = await orFetch(orBody(model, messages, tools, opts, false))
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
  // Antete + fetch din sursa comună; corp simplu (fără unelte/raționament).
  const r = await orFetch({
    model,
    messages,
    max_tokens: opts.maxTokens ?? 1024,
    temperature: opts.temperature ?? 0.7,
    usage: { include: true },
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
    // Antete + fetch din sursa comună; corp specific de imagine (modalities).
    r = await orFetch({
      model: config.openrouter.imageModel,
      messages: [{ role: 'user', content: prompt }],
      modalities: ['image', 'text'],
      usage: { include: true },
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
    // Antete + fetch din sursa comună; corp specific de căutare (plugin web).
    r = await orFetch({
      model: config.openrouter.searchModel,
      plugins: [{ id: 'web' }],
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: query },
      ],
      max_tokens: 900,
      usage: { include: true },
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
