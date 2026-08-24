// ── CONTRACTUL CREIERULUI — tipuri + reguli PURE, fără rețea ─────────────────
// Aici trăiesc formele pe care TOT creierul le vorbește (mesaje, unelte,
// rezultate) plus euristicile pure de rutare (dificultate, intenție de acțiune)
// și rezolvarea modelului pe trepte. Contractul nu depinde de schema wire a
// furnizorului. Numele `Or*` rămân: sunt formatul
// „al casei" (stil OpenAI-chat), folosit în zeci de fișiere și teste.

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
  reasoning?: 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  /** `required` = must call a tool; `auto` = decides on its own. */
  toolChoice?: 'auto' | 'required'
  /** When forcing a tool (`required`), restrict WHICH tools the model may pick
   *  — e.g. only the „doing" tools, never the
   *  display-only ones, so a forced turn can't be satisfied with a fake card. */
  allowedFunctionNames?: string[]
  /** Custom timeout in milliseconds for the engine call. */
  timeoutMs?: number
  /** Attribution for durable provider-usage metering. Product calls must carry
   * this context; the adapter uses a system bucket only for unattributed
   * maintenance probes. No prompt or response content is stored. */
  usageContext?: { userEmail: string; surface: string }
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
  // brain sees images. Raw audio is transcribed before the Responses call.
  content: string | { type: 'text'; text: string }[] | { type: string; [k: string]: unknown }[]
  // For the tool turn: the link to the call requested by the model.
  tool_call_id?: string
  tool_calls?: OrToolCall[]
  /** Exact output items returned by Responses for a prior assistant turn.
   * They are opaque transport state: forward them unchanged, never inspect,
   * log, render or expose them to clients. This preserves encrypted reasoning
   * when `store:false` is used and keeps function-call linkage protocol-correct. */
  response_items?: ResponseCarryItem[]
}

/** Opaque JSON item returned in `response.output`. The web process only
 * carries these items to the next Responses request. */
export type ResponseCarryItem = Record<string, unknown>

// Provider-neutral function tool used by the internal orchestrator.
export interface BrainTool {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

export interface OrToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface OrChatResult {
  text: string
  toolCalls: OrToolCall[]
  /** Financial cost is reconciled outside the web process from the official
   * organization ledger. Absence means pending/unavailable, never zero. */
  costUsd?: number
  model: string
  stop: string
  responseId: string
  serviceTier: string | null
  /** REAL token counts from the provider's `usage` (0 only when the provider
   *  didn't send them). Never hand-filled — an adapter that returns literal
   *  zeros here is fabricating a measurement. */
  inputTokens: number
  outputTokens: number
  cachedInputTokens: number
  reasoningOutputTokens: number
  /** Exact `response.output`, retained only for the next model round. */
  responseItems: ResponseCarryItem[]
}

// The image-generation result shape (produced by the OpenAI image adapter;
// consumed by image.ts). mime + bytes on success; a NAMED error otherwise —
// never an invented success.
export type OrImage = { mime: string; buf: Buffer; costUsd: number } | { error: string }

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
// 3-RUNG LADDER: Luna → Terra → Sol doar la dificultate mare.
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
// P28 (auditul aplicațiilor, 15 aug seara — RUPTURA #4, măsurată): `\bf[ăa]\b`
// nu prindea NICIODATĂ „Fă-mi" — `ă` nu e `\w`, deci granița `\b` dintre „fă"
// și „-mi" nu există; 5 din comenzile meniului ▦ Aplicații (Docs, Sheets,
// Prezentări, Meet, Formulare) plecau pe faza de vorbire FĂRĂ unealta lor.
// Granițele din jurul literelor cu diacritice se scriu acum cu lookaround pe
// \p{L} (flag /u), nu cu `\b`; la fel `arat[ăa]` fără „-mi" („arată ce am…").
// + `urc[ăa]` (▶️ YouTube upload — „Urcă un clip…").
// + închide/golește (vânătorul din 22 aug, MĂSURAT: „închide monitorul" era
// clasificat VORBIRE — nimic nu obliga unealta, iar modelul confabula
// „n-am acces, oprește-l manual" — exact captura ownerului).
const ACTION_INTENT = /(repar[ăa]|remediaz|execut[ăa]?|ruleaz[ăa]|public[ăa]|deploy|livrez|livreaz[ăa]|scrie\s*cod|corecteaz[ăa]|\bfix\b|adaug[ăa]|schimb[ăa]|comut[ăa]|instaleaz[ăa]|creeaz[ăa]|[șs]terge|modific[ăa]|\bcommit\b|\bmerge\b|\bpr\b|\bbranch\b|runbook|workflow|restart|backup|afi[șs]eaz[ăa]|arat[ăa](-mi)?(?!\p{L})|diagnostic|deschide|[îi]nchide|gole[șs]te|porne[șs]te|opre[șs]te|\bpune\b|caut[ăa]|c[âa]nt[ăa]|salveaz[ăa]|trimite|cite[șs]te|verific[ăa]|uit[ăa]-te|ascult[ăa]|deseneaz[ăa]|genereaz[ăa]|construie[șs]te|(?<!\p{L})f[ăa](?!\p{L})|urc[ăa](?!\p{L})|\baudit\b|raporteaz[ăa]|\braport\b|noteaz[ăa]|programeaz[ăa]|tradu\b|calculeaz[ăa]|rezerv[ăa]|comand[ăa]|monitorizeaz[ăa])/iu
export function hasActionIntent(text: string): boolean {
  return ACTION_INTENT.test(text || '')
}
