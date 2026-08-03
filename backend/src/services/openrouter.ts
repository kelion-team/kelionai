import { config } from '../config.js'
import { readSSE } from './sse.js'

// ── SELECTABLE MODELS — OpenRouter (one key for the whole brain) ─────────────
// One OpenRouter key gives access to GPT/Gemini/Claude. The catalog is fetched
// LIVE and cached briefly: new models appear AUTOMATICALLY, no deploy needed
// (Adrian: "autoupdate").
// The REAL per-call cost comes from the response (usage.cost, in USD) → precise ledger.
// Voice does NOT go through here (OpenRouter has no realtime model) — stays on OpenAI direct.

const OR_BASE = 'https://openrouter.ai/api/v1'
const CATALOG_TTL_MS = 10 * 60 * 1000

// 'top' = the final rung of the ladder (Fable 5, only for extreme difficulty) —
// validated against the SAME vision+tools filtered catalog as 'work', different fallback.
export type ModelTier = 'chat' | 'work' | 'top'

// THE COST COLOR (Adrian, Aug 1: "green = free, yellow = cheap with money,
// orange, red — by capabilities and costs"). The class is computed from the
// REAL OpenRouter prices, never guessed.
export type CostClass = 'free' | 'cheap' | 'mid' | 'expensive'

export interface CatalogModel {
  id: string
  name: string
  // ANY provider on OpenRouter (Adrian, Jul 30: "I must be able to decide any
  // model from the list" — the old 5-company filter was my judgment, not his
  // order; the capability rules below stay the only gate).
  provider: string
  vision: boolean
  contextLength: number
  costClass: CostClass
  /** USD per 1M input tokens (0 = free). From the live OpenRouter pricing. */
  promptPerM: number
  /** USD per 1M output tokens (0 = free). From the live OpenRouter pricing. */
  completionPerM: number
}

/** The blend a chat turn actually costs: ~3:1 input:output (you read more than
 *  you write). Per 1M blended tokens. Pure and tested. */
export function blendedPerM(promptPerM: number, completionPerM: number): number {
  return (promptPerM * 3 + completionPerM) / 4
}

/** green → yellow → orange → red. Pure and tested — this decides the color the
 *  user trusts, so it must never be "checked by eye". */
export function classifyCost(promptPerM: number, completionPerM: number): CostClass {
  const b = blendedPerM(promptPerM, completionPerM)
  if (!(b > 0)) return 'free'
  if (b < 0.5) return 'cheap'
  if (b < 5) return 'mid'
  return 'expensive'
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
  /** Live OpenRouter prices, USD per TOKEN as strings — we keep per-1M numbers. */
  pricing?: { prompt?: string; completion?: string }
}

let cache: Catalog | null = null

// NO PROVIDER WHITELIST (Adrian, Jul 30: "I must be able to decide any model
// from the list"). Any company on OpenRouter enters, as long as the capability
// rules pass below. Before Jul 30 there was a 5-name filter here — his order
// removed it; the only gates left are tools + the vision rules per tier.
function providerOf(id: string): string {
  return id.split('/')[0] || 'unknown'
}

// Exclude old/cheap irrelevant variants so the list stays clean for the user.
function isSelectable(id: string): boolean {
  return !/gpt-3\.5|gpt-4-turbo-preview|claude-3-haiku|-0613|-16k|preview-\d|customtools/.test(id)
}

/** USD/token string → per-1M number; garbage or missing means 0 (free/unknown
 *  → the honest "free" class only when BOTH are 0, see classifyCost). */
function perM(v: string | undefined): number {
  const n = Number(v ?? '0')
  return Number.isFinite(n) && n > 0 ? n * 1e6 : 0
}

export function toModel(m: RawModel): CatalogModel | null {
  const provider = providerOf(m.id)
  const sp = m.supported_parameters ?? []
  if (!sp.includes('tools')) return null // all capabilities require tool-use
  if (!isSelectable(m.id)) return null
  const promptPerM = perM(m.pricing?.prompt)
  const completionPerM = perM(m.pricing?.completion)
  return {
    id: m.id,
    name: m.name ?? m.id,
    provider,
    vision: (m.architecture?.input_modalities ?? []).includes('image'),
    contextLength: m.context_length ?? 0,
    costClass: classifyCost(promptPerM, completionPerM),
    promptPerM,
    completionPerM,
  }
}

// ── LIVE PER-MODEL PRICE LOOKUP ─────────────────────────────────────────────
// The owner's standing order: "the cost table is not real — show real, stop
// fabricating". A model's price is NEVER written by hand anywhere else in the
// codebase: it is read from the live /models catalog (which OpenRouter keeps
// current) and looked up here. Pure matcher, kept separate from the network so
// it stays under test.
/** Finds a model's live price in an already-fetched catalog. Accepts the exact
 *  OpenRouter id, the id without the `:free` suffix, or the bare model name
 *  after the provider slash (e.g. "gemini-2.5-flash"). null = not in the live
 *  catalog → the caller must label any fallback as an estimate. */
export function priceFromCatalog(
  cat: Catalog,
  modelId: string,
): { promptPerM: number; completionPerM: number } | null {
  const wanted = modelId.trim().toLowerCase()
  if (!wanted) return null
  const bare = wanted.split('/').pop() ?? wanted
  const all = [...cat.chat, ...cat.work]
  const m =
    all.find((x) => x.id.toLowerCase() === wanted) ??
    all.find((x) => x.id.toLowerCase().replace(/:free$/, '') === wanted.replace(/:free$/, '')) ??
    all.find((x) => (x.id.toLowerCase().split('/').pop() ?? '').replace(/:free$/, '') === bare.replace(/:free$/, ''))
  return m ? { promptPerM: m.promptPerM, completionPerM: m.completionPerM } : null
}

/** The LIVE per-1M-token price of a model, from the cached OpenRouter catalog.
 *  null = the catalog couldn't be read or the model isn't in it — NEVER
 *  silently 0, so the caller can't present a failed lookup as "free". */
export async function getLiveModelPricePerM(
  modelId: string,
): Promise<{ promptPerM: number; completionPerM: number } | null> {
  const cat = await getCatalog().catch(() => null)
  return cat ? priceFromCatalog(cat, modelId) : null
}

/** Fetches the live catalog (with short cache) and groups it into selectable tiers. */
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
  const { chat, work } = groupCatalog(models)
  cache = { chat, work, fetchedAt: Date.now() }
  return cache
}

/** Splits the models into the two lists offered to the user. Pure (no network, no
 *  keys) so it can be kept under test — this filter decides what the user sees in
 *  the menu, so it must never be "verified by eye". */
export function groupCatalog(models: CatalogModel[]): { chat: CatalogModel[]; work: CatalogModel[] } {
  // 100% COMPATIBILITY (Adrian, Jul 25: "keep in the lists only those 100%
  // compatible with voice and brain, vision etc."): a camera frame that reaches
  // the brain THROUGH VISION (needsVision forces escalation here — see chat.ts)
  // must be served by a model that ACTUALLY sees — otherwise the picture would be
  // ignored/would crash. A REAL filter on the live catalog, not an assumption.
  // VISION IS MANDATORY ON THE CHAT LIST TOO (Adrian's order, Jul 29: "only AI
  // that respects ALL the application's features is shown — sight, hearing, live
  // voice"). Until now only `work` required vision; the chat list also offered
  // blind models. Vision escalation covered them from behind, but the user still
  // saw in the menu a model that can't do everything — and a list where you pick
  // something incomplete is a broken promise. Now: in BOTH lists, only models
  // that SEE (here) and KNOW TOOLS (enforced in toModel, without which neither
  // Google, nor memory, nor commands, nor voice-to-brain escalation would work).
  // NO PROVIDER LIST (Adrian, Jul 30: "I must be able to decide any model from
  // the list" · "if you put up unwanted barriers not approved by me, doesn't that
  // mean you're sabotaging my work?"). The per-company filter — openai/google/
  // anthropic, plus nvidia/cohere only on free — was my judgment ("so the lists
  // don't get diluted"), not his order. His order, from Jul 29, was about
  // CAPABILITIES: "only AI that respects ALL the application's features is shown".
  // So exactly that remains: sees (here) and knows tools (enforced in toModel).
  // Any model on OpenRouter that has them appears in the list.
  const chat = models.filter((m) => m.vision)
  // THE FULL FREE BRAIN (Adrian, Jul 27): the work tier also accepts FREE models
  // with vision+tools (gemma :free, nemotron omni/vl :free) — the default core is
  // now free, and the admin can also pick them manually from the list.
  //
  // ── VISION IS DELEGATED, NO LONGER EXCLUDES (Adrian, Jul 31) ────────────────
  //
  // Him: "Nemotron 3 Ultra 550B stays, who does the seeing?"
  //
  // Ultra is the most capable free brain measured (550B, one million context,
  // tools, thinking) and it is BLIND. With the filter above applied here too, it
  // could NEVER appear in the list — that's why he kept looking for it and not
  // finding it.
  //
  // His rule from Jul 29 still stands, but at the level that actually mattered:
  // "only AI that respects ALL the application's features is shown". The feature
  // belongs to the APPLICATION, not to a single model. From now on, a turn with
  // a picture is automatically served by a model that sees (see `bestVisionModel`),
  // and the rest by the chosen brain. So every model in the list "does everything"
  // — some by delegating vision, which the human doesn't need to know about for
  // it to work.
  //
  // `chat` (the cheap, public tier) keeps vision mandatory: there is no
  // escalation there, so a blind model really would break a turn with a picture.
  const work = models

  const byId = (a: CatalogModel, b: CatalogModel): number => a.id.localeCompare(b.id)
  return { chat: chat.sort(byId), work: work.sort(byId) }
}

// ── THE REAL BALANCE OF THE OPENROUTER ACCOUNT = "Kelion's wallet" (Adrian, Jul 24)
// The brain (OpenRouter) is funded CENTRALLY from Kelion's account, not by each
// user separately. The admin must see the EXACT remaining VALUE (like on the
// openrouter.ai/credits page: "$5.83") so he knows when to top up. Users NEVER
// see this (the route is admin-only). Official endpoint: GET /credits →
// { data: { total_credits, total_usage } }; remaining = total_credits − total_usage.
export interface OpenRouterBalance {
  ok: boolean
  balance: number // USD remaining, exact (total_credits − total_usage)
  totalCredits: number
  totalUsage: number
  currency: 'usd'
  low: boolean // below threshold → the admin must top up
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
    // ── A RESPONSE I DON'T UNDERSTAND IS NOT "ZERO DOLLARS" ───────────────────
    //
    // Adrian, Jul 31: the OpenRouter page showed him $10.00, while the app bar
    // showed "OpenRouter $0.00", flashing red — "top up!". Worse: a few hours
    // earlier I had told him, in black and white, that the pill does NOT lie and
    // that the zero was a successful measurement. It wasn't.
    //
    // The cause, here: `ok: true` was set as soon as the HTTP was 200. But if
    // the body doesn't parse (`.catch(() => ({}))`), or `data` is missing, or
    // the fields got renamed at the provider, then `?? 0` silently turns a
    // FAILED READ into "you have zero dollars" — red alarm included. Exactly the
    // "£0.00" pattern from this morning, elsewhere: a read failure presented as
    // an established state.
    //
    // Now: if I don't find the figures where I expect them, I say I CANNOT READ.
    // The bar already has the branch for that and writes "⚠ OpenRouter".
    const d = j?.data
    const totalCredits = Number(d?.total_credits)
    const totalUsage = Number(d?.total_usage)
    if (!d || !Number.isFinite(totalCredits) || !Number.isFinite(totalUsage))
      // Put the RECEIVED KEYS in the error (names only, no values): if the
      // provider changes the response shape, the next person looking sees right
      // away what came in, instead of searching for a day like today.
      return { ...base, error: `unexpected_shape:${Object.keys(d ?? j ?? {}).join(',').slice(0, 80) || 'empty'}` }
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

// The difficulty demanded by the task (0-100), purely heuristic from text (0
// cost/latency). Signals: length, reasoning/analysis, code/debugging, multi-step.
// Based on it we ESCALATE chat→brain (Adrian: "linked, escalate on your own").
export function taskDifficulty(text: string): number {
  const t = (text || '').toLowerCase()
  let d = 15 // simple conversation: greeting, short question, thanks
  const len = t.length
  if (len > 1000) d += 65
  else if (len > 500) d += 45
  else if (len > 200) d += 20
  // Reasoning / analysis / in-depth explanation.
  if (/(analiz[ăae]|demonstr|rezolv[ăa]|[îi]n detaliu|pas cu pas|g[âa]nde[șs]te|ra[țt]ion|argument[ea]|compar[ăa]|evalu[eaă]|de ce\b|cum func[țt]ion|strategi[ea]|plan detaliat|explic)/.test(t)) d += 65
  // Code / software / debugging — the most demanding.
  if (/(algoritm|debug|\bcod\b|\bprogram|func[țt]i|script|\bbug\b|refactor|optimiz|compil|stack ?trace|except|sql|regex)/.test(t)) d += 70
  // Multi-step.
  if ((t.match(/\?/g) || []).length >= 3 || /(și apoi|dup[ăa] care|mai [îi]nt[âa]i)/.test(t)) d += 12
  return Math.min(100, Math.max(0, d))
}

// Escalation threshold: above it, the request climbs from CHAT to BRAIN.
export const ESCALATE_AT = 60
// 3-RUNG LADDER (Adrian, Jul 25: "at the brain, gpt-5-mini up to Fable"):
// free (chat) → cheap-capable (brain, default) → Fable 5 ONLY on truly extreme
// difficulty. Below this extra threshold, the brain uses the cheap model
// (workDefault/sel.work); above it, it climbs to TOP_DEFAULT regardless of what
// the user picked — reserved for the genuinely hard cases.
export const ESCALATE_TOP_AT = 85

// EXECUTION INTENT (Adrian, Jul 25: "escalation goes from the cheapest capable
// model up to truly hard tasks, and returns to live chat") — real analysis showed
// that the cheap chat model simply did NOT call tools on the owner's execution
// orders (it talked about them instead of doing them), while forcing the big
// brain on EVERY admin turn burned $23+/hour on ordinary conversation alone.
// The correct solution: stay cheap by default, escalate ONLY on real action
// requests — and automatically return to the cheap rung on the next reply (heavy
// is computed per-turn, from the current text, not kept latched).
// WIDENED (Adrian, Jul 27 evening: "it doesn't know what to do, it just says
// it's doing it" — everyday commands: "open youtube", "play a song", "search X",
// "run an audit" were NOT recognized as orders → they stayed on the conversation
// model, which only narrates. Any command verb = an EXECUTION turn.)
const ACTION_INTENT = /(repar[ăa]|remediaz|execut[ăa]?|ruleaz[ăa]|public[ăa]|deploy|livrez|livreaz[ăa]|scrie\s*cod|corecteaz[ăa]|\bfix\b|adaug[ăa]|schimb[ăa]|instaleaz[ăa]|creeaz[ăa]|[șs]terge|modific[ăa]|\bcommit\b|\bmerge\b|\bpr\b|\bbranch\b|runbook|workflow|restart|backup|afi[șs]eaz[ăa]|arat[ăa](-mi)?\b|diagnostic|deschide|porne[șs]te|opre[șs]te|\bpune\b|caut[ăa]|c[âa]nt[ăa]|salveaz[ăa]|trimite|cite[șs]te|verific[ăa]|uit[ăa]-te|ascult[ăa]|deseneaz[ăa]|genereaz[ăa]|construie[șs]te|\bf[ăa]\b|\baudit\b|raporteaz[ăa]|\braport\b|noteaz[ăa]|programeaz[ăa]|tradu\b|calculeaz[ăa]|rezerv[ăa]|comand[ăa]|monitorizeaz[ăa])/i
export function hasActionIntent(text: string): boolean {
  return ACTION_INTENT.test(text || '')
}

// THE OWNER'S BRAIN = POWERFUL AGENT (iron rule §14, AI-HANDOFF): on the owner's
// path the model does NOT skimp on free. It picks the best PAID model with
// vision+tools from the LIVE catalog (so the ID is guaranteed valid, not
// invented): prefers Claude/Anthropic (the brain settled on by the owner),
// otherwise OpenAI. null if the catalog has no capable paid model (falls back to
// current behavior).
// ── THE EYES, WHEN THE BRAIN IS BLIND (Adrian, Jul 31: "who does the seeing?") ──
//
// Ultra thinks the best of the free ones and sees nothing at all. Instead of
// excluding it for that, the turn WITH A PICTURE goes to a model that sees; the
// rest stays with the chosen brain. Two trades, two specialists — the same idea
// as Aider (one thinks, the other writes).
//
// The choice is made from the LIVE catalog, not from a hand-written list: an
// invented id or one removed by the provider would break exactly the turn in
// which the human really needs something to be seen. We prefer free; if no free
// one with vision exists, we take the cheapest that sees, so vision doesn't
// disappear altogether.
export async function bestVisionModel(): Promise<string | null> {
  const cat = await getCatalog().catch(() => null)
  if (!cat) return null
  // `chat` is already filtered on vision AND tools (toModel enforces tools).
  const vazatori = cat.chat
  if (!vazatori.length) return null
  const gratuite = vazatori.filter((m) => m.id.endsWith(':free'))
  const lista = gratuite.length ? gratuite : vazatori
  // Stable, explainable preference: Gemma 4 31B is the largest free DENSE model
  // with vision in the catalog (measured Jul 31). If it disappears, we take the
  // first in the list — still from the live catalog, so still a valid id.
  return lista.find((m) => m.id.startsWith('google/gemma-4-31b'))?.id ?? lista[0]?.id ?? null
}

export async function bestPaidWorkModel(): Promise<string | null> {
  // ANTI-BREAKAGE GUARD: don't route to PAID if the OpenRouter wallet is empty —
  // the paid call would fail (402/insufficient) and the brain would break. No
  // money → null → stays on free, dumb but FUNCTIONAL (Jul 27 incident: the
  // balance went negative).
  //
  // BUT (Adrian, Jul 30: "Kelion doesn't execute requirements"): "I couldn't READ
  // the balance" and "the balance is zero" are not the same thing, and treated
  // alike they silently demoted the owner to a :free model that NARRATES instead
  // of executing. The guard stays — a paid call on an empty wallet really does
  // break the turn — but from now on it SAYS why, so the reason is one search
  // away, not one day away. (Rule no. 1.)
  const bal = await getOpenRouterBalance().catch(() => null)
  if (!bal || !bal.ok) {
    console.error('[BRAIN] cannot READ the OpenRouter balance → staying on free (unknown whether you have funds)')
    return null
  }
  if (bal.balance <= 0) {
    console.error(`[BRAIN] OpenRouter balance ${bal.balance} → staying on free (you really have no credit)`)
    return null
  }
  const cat = await getCatalog()
  const paid = cat.work.filter(
    (m) => (m.provider === 'anthropic' || m.provider === 'openai') && !m.id.endsWith(':free'),
  )
  if (!paid.length) {
    console.error(`[BRAIN] catalog has no paid model (work=${cat.work.length}) → staying on free`)
    return null
  }
  const claude = paid.find((m) => m.provider === 'anthropic')
  return (claude ?? paid[0]).id
}

/** Validates that a user-picked model is in the respective tier; otherwise the default.
 *
 *  `fellBack` says whether the REQUESTED model was rejected (not in the live
 *  catalog — removed by the provider, or the catalog couldn't be read). Without
 *  it, the replacement was SILENT: you'd pick a model in Admin→Models, it would
 *  disappear from the provider, and you'd silently get the `:free` default —
 *  which talks instead of executing. Exactly the complaint "it doesn't follow
 *  the requirement, it does what it wants". */
export async function resolveModelChecked(
  tier: ModelTier,
  wanted?: string | null,
): Promise<{ model: string; fellBack: boolean }> {
  const fallback =
    tier === 'chat' ? config.openrouter.chatDefault : tier === 'top' ? config.openrouter.topDefault : config.openrouter.workDefault
  if (!wanted) return { model: fallback, fellBack: false }
  const cat = await getCatalog()
  const list = tier === 'chat' ? cat.chat : cat.work // 'work' and 'top' validate against the same catalog (vision+tools)
  return list.some((m) => m.id === wanted)
    ? { model: wanted, fellBack: false }
    : { model: fallback, fellBack: true }
}

export async function resolveModel(tier: ModelTier, wanted?: string | null): Promise<string> {
  return (await resolveModelChecked(tier, wanted)).model
}

// ── THE CONTRACT OF A BRAIN CALL (Batch B) ────────────────────────────────────
// A turn's knobs were written LITERALLY in 7 signatures, in both engines
// (OpenRouter and Gemini direct). It wasn't negligence: the two IMPLEMENT the
// same contract, so the orchestrator can call them interchangeably. But written
// by hand 7 times, the contract could silently diverge — you'd add a knob in one
// engine and the other would ignore it. Now it's ONE type; both use it.
export interface BrainCallOpts {
  /** The response's token ceiling. */
  maxTokens?: number
  /** How "free" the response is (0 = strict, 1 = creative). */
  temperature?: number
  /** How much reasoning models think internally. */
  reasoning?: 'low' | 'medium' | 'high'
  /** `required` = must call a tool; `auto` = decides on its own. */
  toolChoice?: 'auto' | 'required'
}

export interface OrMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  // String for plain text; array for multimodal in OpenAI format
  // ({type:'text'|'image_url'} blocks) — this is how models SEE pictures/camera.
  content: string | { type: 'text'; text: string }[] | { type: string; [k: string]: unknown }[]
  // For the tool turn: the link to the call requested by the model.
  tool_call_id?: string
  tool_calls?: OrToolCall[]
}

// Tool in Anthropic format (as defined in chat.ts).
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

// Anthropic → OpenAI (OpenRouter) conversion: input_schema → parameters.
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
  /** REAL token counts from the provider's `usage` (0 only when the provider
   *  didn't send them). Never hand-filled — an adapter that returns literal
   *  zeros here is fabricating a measurement. */
  inputTokens: number
  outputTokens: number
}

// ── SINGLE SOURCE for the OpenRouter request (headers + fetch + body) ─────────
// Headers + fetch were copied into every function (stream/chat/complete/image);
// the chat body (model/messages/tokens/temperature/usage + reasoning + tools)
// was copied into stream and chat. Here, exactly once (the single-source
// no-duplicates principle). IDENTICAL behavior — just moved.
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

// AUDIO NATIV DOAR PENTRU GEMINI (Adrian, 3 aug — „deep learning legat de creier
// direct"): partea `audio_url` (vocea brută) e înțeleasă NATIV doar de Gemini
// (toGeminiPayload → inline_data audio). Modelele de pe OpenRouter (nemotron etc.)
// NU acceptă audio → dacă am trimite blocul, ar crăpa. Aici îl scoatem, lăsând
// textul (transcriptul Chirp) ca rezervă. Astfel același `orMsgs` merge la ambele
// căi: Gemini AUDE, restul citesc textul.
export function faraAudioParts(messages: OrMessage[]): OrMessage[] {
  let aScos = false
  const out = messages.map((m) => {
    if (!Array.isArray(m.content)) return m
    const blocuri = m.content as { type: string }[]
    const filtrate = blocuri.filter((b) => b.type !== 'audio_url')
    if (filtrate.length === blocuri.length) return m
    aScos = true
    // Dacă turul era DOAR audio (fără text), punem un marcaj scurt ca modelul
    // să știe că a fost o intrare vocală, nu un mesaj gol.
    const content = (filtrate.length ? filtrate : '(voce)') as OrMessage['content']
    return { ...m, content }
  })
  return aScos ? out : messages
}

function orBody(
  model: string,
  messages: OrMessage[],
  tools: AnthropicTool[],
  opts: BrainCallOpts,
  stream: boolean,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model,
    messages: faraAudioParts(messages),
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

// The key guard + the call, in one place: without a key the network is NOT
// called; an empty result marked `no_key` is returned (the caller passes it on
// as such). Both turns — streaming and not — had the guard and the call copied.
async function orCall(
  model: string,
  messages: OrMessage[],
  tools: AnthropicTool[],
  opts: BrainCallOpts,
  stream: boolean,
): Promise<Response | OrChatResult> {
  if (!config.openrouter.key) return { text: '', toolCalls: [], costUsd: 0, model, stop: 'no_key', inputTokens: 0, outputTokens: 0 }
  return orFetch(orBody(model, messages, tools, opts, stream))
}

// STREAMING variant: text flows through `onText` (first word instant, like the
// old Kimi), and tool calls are assembled by index from deltas.
export async function openrouterChatStream(
  model: string,
  messages: OrMessage[],
  tools: AnthropicTool[],
  onText: (delta: string) => void,
  opts: BrainCallOpts = {},
): Promise<OrChatResult> {
  const call = await orCall(model, messages, tools, opts, true)
  if (!(call instanceof Response)) return call
  const r = call
  if (!r.ok || !r.body) {
    throw new Error(`openrouter ${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}`)
  }

  let text = ''
  let costUsd = 0
  let inputTokens = 0
  let outputTokens = 0
  let served = model
  let stop = 'stop'
  // Tool calls arrive fragmented, by index; we assemble them.
  const calls = new Map<number, { id: string; name: string; args: string }>()

  // SSE stream reading from the shared source (services/sse.ts); event
  // processing (OpenAI format: choices/delta) stays here.
  await readSSE(r.body, (raw) => {
    const ev = raw as {
      choices?: {
        delta?: { content?: string; tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[] }
        finish_reason?: string
      }[]
      usage?: { cost?: number; prompt_tokens?: number; completion_tokens?: number }
      model?: string
    }
    if (ev.model) served = ev.model
    if (ev.usage?.cost != null) costUsd = Number(ev.usage.cost)
    if (ev.usage?.prompt_tokens != null) inputTokens = Number(ev.usage.prompt_tokens) || 0
    if (ev.usage?.completion_tokens != null) outputTokens = Number(ev.usage.completion_tokens) || 0
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
  return { text, toolCalls, costUsd, model: served, stop, inputTokens, outputTokens }
}

/**
 * One chat turn through OpenRouter WITH tool-use (OpenAI format). Returns the
 * text, any tool calls requested by the model, and the REAL cost. Call it in a
 * loop: execute the tools, append the results as role:'tool' messages, call again.
 */
export async function openrouterChat(
  model: string,
  messages: OrMessage[],
  tools: AnthropicTool[] = [],
  opts: BrainCallOpts = {},
): Promise<OrChatResult> {
  const call = await orCall(model, messages, tools, opts, false)
  if (!(call instanceof Response)) return call
  const r = call
  if (!r.ok) throw new Error(`openrouter ${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}`)
  const j = (await r.json()) as {
    choices?: { message?: { content?: string; tool_calls?: OrToolCall[] }; finish_reason?: string }[]
    usage?: { cost?: number; prompt_tokens?: number; completion_tokens?: number }
    model?: string
  }
  const choice = j.choices?.[0]
  return {
    text: choice?.message?.content ?? '',
    toolCalls: choice?.message?.tool_calls ?? [],
    costUsd: Number(j.usage?.cost ?? 0),
    model: j.model ?? model,
    stop: choice?.finish_reason ?? 'stop',
    inputTokens: Number(j.usage?.prompt_tokens ?? 0) || 0,
    outputTokens: Number(j.usage?.completion_tokens ?? 0) || 0,
  }
}

export interface OrResult {
  text: string
  /** REAL cost in USD reported by OpenRouter (0 if unavailable). */
  costUsd: number
  model: string
}

/**
 * Completion through an OpenRouter model, with REAL cost in the response (usage.cost).
 * `usage:{include:true}` asks OpenRouter to return the exact cost of the call.
 */
export async function openrouterComplete(
  model: string,
  messages: OrMessage[],
  opts: { maxTokens?: number; temperature?: number } = {},
): Promise<OrResult> {
  if (!config.openrouter.key) return { text: '', costUsd: 0, model }
  // Headers + fetch from the shared source; simple body (no tools/reasoning).
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

// ── IMAGE through OpenRouter (same key as the brain; no separate Gemini) ──────
// The image model returns the image inline in `message.images[].image_url.url`
// (data URL). We return mime + bytes; the REAL cost comes from usage.cost.
export type OrImage = { mime: string; buf: Buffer; costUsd: number } | { error: string }
export async function openrouterImage(prompt: string): Promise<OrImage> {
  if (!config.openrouter.key) return { error: 'image_not_configured' }
  let r: Response
  try {
    // Headers + fetch from the shared source; image-specific body (modalities).
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

// ── WEB SEARCH through OpenRouter (`web` plugin; no Serper) ───────────────────
// Any model accepts the `web` plugin: OpenRouter searches the web and feeds the
// results to the model, and the response includes text + citations (url_citation
// annotations).
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
    // Headers + fetch from the shared source; search-specific body (web plugin).
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
