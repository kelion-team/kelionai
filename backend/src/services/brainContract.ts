import { modelUnicDirect, modelRapidDirect } from '../config.js'

// ── CONTRACTUL CREIERULUI — tipuri + reguli PURE, fără rețea ─────────────────
// (Extirparea totală OpenRouter + OpenAI, 3 aug — ordinul repetat al ownerului:
// „openrouter și open ai scos din toată aplicația".)
//
// Aici trăiesc formele pe care TOT creierul le vorbește (mesaje, unelte,
// rezultate) plus euristicile pure de rutare (dificultate, intenție de acțiune)
// și rezolvarea modelului pe trepte. Istoric, formele au fost definite în
// services/openrouter.ts (creierul de atunci); creierul e acum GEMINI DIRECT
// unic (services/geminiDirect.ts), iar contractul — care nu a fost niciodată
// specific unui furnizor — s-a mutat aici. Numele `Or*` rămân: sunt formatul
// „al casei" (stil OpenAI-chat), folosit în zeci de fișiere și teste.

// 'top' = ultima treaptă a scării (escaladarea grea) — validată la fel ca
// 'work'; diferă doar defaultul (gemini-2.5-pro).
export type ModelTier = 'chat' | 'work' | 'top'

// ── THE CONTRACT OF A BRAIN CALL (Batch B) ────────────────────────────────────
// A turn's knobs were written LITERALLY in 7 signatures. It wasn't negligence:
// the engines IMPLEMENT the same contract, so the orchestrator can call them
// interchangeably. But written by hand 7 times, the contract could silently
// diverge — you'd add a knob in one engine and the other would ignore it. Now
// it's ONE type.
export interface BrainCallOpts {
  /** The response's token ceiling. */
  maxTokens?: number
  /** How "free" the response is (0 = strict, 1 = creative). */
  temperature?: number
  /** How much reasoning models think internally. */
  reasoning?: 'low' | 'medium' | 'high'
  /** `required` = must call a tool; `auto` = decides on its own. */
  toolChoice?: 'auto' | 'required'
  /** When forcing a tool (`required`), restrict WHICH tools the model may pick
   *  (Gemini `allowedFunctionNames`) — e.g. only the „doing" tools, never the
   *  display-only ones, so a forced turn can't be satisfied with a fake card. */
  allowedFunctionNames?: string[]
  /** Custom timeout in milliseconds for the engine call. */
  timeoutMs?: number
}

// OCHII PE REZULTATUL UNEI UNELTE (9 aug, ownerul: „sistemul nu dă lui Kelion
// poza reală pentru analiză"): o unealtă care are o captură reală (browserul,
// la fiecare pas) o lipește după acest marcaj la coada rezultatului text.
// Orchestratorul o desface și o pune în conversație ca IMAGINE (inline_data) —
// modelul chiar O VEDE, nu primește doar un URL pe care nu-l poate privi.
export const OCHI_MARCAJ = '\u001F[OCHI]'

export interface OrMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  // String for plain text; array for multimodal blocks in the house (OpenAI-chat)
  // format ({type:'text'|'image_url'|'audio_url'} blocks) — this is how the
  // brain SEES pictures/camera and HEARS the raw voice (geminiDirect.ts maps
  // them to inline_data).
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
  /** Semnătura de gândire Gemini 3.x (wo-msex5yey): modelul o atașează apelului
   *  de unealtă și CERE s-o primească înapoi la replay — altfel HTTP 400
   *  („Function call is missing a thought_signature"). Opțională: 2.5 n-o are. */
  thoughtSignature?: string
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

// The image-generation result shape (produced by geminiImage in geminiDirect.ts;
// consumed by image.ts). mime + bytes on success; a NAMED error otherwise —
// never an invented success.
export type OrImage = { mime: string; buf: Buffer; costUsd: number } | { error: string }

// ── REZOLVAREA MODELULUI PE TREPTE — GEMINI-ONLY ─────────────────────────────
// Nu mai există catalog viu de furnizor: singurele modele ale creierului sunt
// treptele Gemini din config.brain (toate `google-direct/…`). O alegere salvată
// („wanted") e acceptată DOAR dacă e tot google-direct/* — orice altceva (id
// vechi de OpenRouter rămas într-un KV, un id inventat) cade pe defaultul
// treptei, și `fellBack` o spune (o înlocuire tăcută de creier e exact tiparul
// interzis de regula #1).

/** Defaultul treptei, garantat Gemini: dacă cineva pune în env un model care NU
 *  e google-direct/*, nu-l lăsăm să deraieze creierul — cădem pe defaultul din
 *  cod (lacătul Gemini, 3 aug). */
function fallbackTreapta(tier: ModelTier): string {
  // DOUĂ SLOTURI, SIGILATE (7 aug — măsurat de owner pe cheia lui: chat pe Pro =
  // 3,6s…45s; pe flash-lite = 0,6s, cu unelte+vedere+auz intacte). Treapta de CHAT
  // merge pe modelul RAPID; `work` și `top` rămân pe Pro, unde se face gândirea
  // grea (agenți, autonomie, și escaladarea `ask_brain` chemată din chat).
  // Sursa rămâne config-ul, în cod, FĂRĂ env — fiecare slot cu poarta lui de familie.
  if (tier === 'chat') return modelRapidDirect()
  return modelUnicDirect()
}

export async function resolveModelChecked(
  tier: ModelTier,
  wanted?: string | null,
): Promise<{ model: string; fellBack: boolean }> {
  // SIGILAT: modelul creierului e UNIC și BLOCAT — orice „wanted" (alegere salvată
  // în KV, selector UI, id vechi din env) e IGNORAT; se întoarce mereu modelul unic.
  // `fellBack=true` semnalează doar că s-a cerut altceva (pentru telemetrie/onestitate).
  const model = fallbackTreapta(tier)
  const fellBack = !!wanted && wanted !== model
  return { model, fellBack }
}

export async function resolveModel(tier: ModelTier, wanted?: string | null): Promise<string> {
  return (await resolveModelChecked(tier, wanted)).model
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
// 3-RUNG LADDER: chat (flash) → work (flash, cu unelte + gândire) → top
// (gemini-2.5-pro) DOAR la dificultate cu adevărat mare.
export const ESCALATE_TOP_AT = 85

// EXECUTION INTENT (Adrian, Jul 25: "escalation goes from the cheapest capable
// model up to truly hard tasks, and returns to live chat") — real analysis showed
// that the cheap chat model simply did NOT call tools on the owner's execution
// orders (it talked about them instead of doing them). The correct solution:
// stay cheap by default, escalate ONLY on real action requests — and
// automatically return to the cheap rung on the next reply (heavy is computed
// per-turn, from the current text, not kept latched).
// WIDENED (Adrian, Jul 27 evening: "it doesn't know what to do, it just says
// it's doing it" — everyday commands: "open youtube", "play a song", "search X",
// "run an audit" were NOT recognized as orders → they stayed on the conversation
// model, which only narrates. Any command verb = an EXECUTION turn.)
const ACTION_INTENT = /(repar[ăa]|remediaz|execut[ăa]?|ruleaz[ăa]|public[ăa]|deploy|livrez|livreaz[ăa]|scrie\s*cod|corecteaz[ăa]|\bfix\b|adaug[ăa]|schimb[ăa]|instaleaz[ăa]|creeaz[ăa]|[șs]terge|modific[ăa]|\bcommit\b|\bmerge\b|\bpr\b|\bbranch\b|runbook|workflow|restart|backup|afi[șs]eaz[ăa]|arat[ăa](-mi)?\b|diagnostic|deschide|porne[șs]te|opre[șs]te|\bpune\b|caut[ăa]|c[âa]nt[ăa]|salveaz[ăa]|trimite|cite[șs]te|verific[ăa]|uit[ăa]-te|ascult[ăa]|deseneaz[ăa]|genereaz[ăa]|construie[șs]te|\bf[ăa]\b|\baudit\b|raporteaz[ăa]|\braport\b|noteaz[ăa]|programeaz[ăa]|tradu\b|calculeaz[ăa]|rezerv[ăa]|comand[ăa]|monitorizeaz[ăa])/i
export function hasActionIntent(text: string): boolean {
  return ACTION_INTENT.test(text || '')
}
