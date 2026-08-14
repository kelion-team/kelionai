// ── FABLE 5 (Claude) = REZERVA CONSTRUCTORULUI (owner, 14 aug 2026) ──────────
// Owner, verbatim: „schimbă-mi constructorul cu gemeni ultra… și când nu merge
// repara vreau să cadă pe fable 5". Constructorul cere creierul PRIN APP
// (/api/constructor/creier): principal = Gemini (creierul aplicației, cheia +
// creditul stau AICI, nu în constructor). Când Gemini nu poate repara, aceeași
// rută cade pe Fable 5 — tot AICI, în app, ca și cheia Anthropic să stea în app
// (constructorul NU ține chei de furnizor, regula din 13 aug).
//
// Anthropic expune un endpoint OpenAI-COMPATIBIL (api.anthropic.com/v1/chat/
// completions) → mesajele + uneltele constructorului (deja în format OpenAI) trec
// DIRECT, fără conversie. Răspunsul iese în ACELAȘI format OpenAI ca de la creierul
// 2 Gemini, deci restul buclei constructorului nu știe că a schimbat creierul.
//
// FĂRĂ CHEIE = REZERVĂ INACTIVĂ, spus ONEST: `fable5Disponibil()` e false, ruta
// rămâne DOAR pe Gemini. Nu se inventează un răspuns și nu se cheltuie pe ascuns.

const FABLE_URL = process.env.CONSTRUCTOR_FABLE_URL || 'https://api.anthropic.com/v1/chat/completions'
const FABLE_MODEL = process.env.CONSTRUCTOR_FABLE_MODEL || 'claude-fable-5'

/** Cheia Fable 5 (Claude). Stă în app (`ANTHROPIC_API_KEY` pe VPS), NU în constructor. */
export function fable5Key(): string {
  return (process.env.ANTHROPIC_API_KEY ?? process.env.CONSTRUCTOR_FABLE_KEY ?? process.env.FABLE_KEY ?? '').trim()
}

/** Rezerva Fable 5 e configurată (cheie pusă)? Fără ea, ruta rămâne pe Gemini. */
export function fable5Disponibil(): boolean {
  return Boolean(fable5Key())
}

interface OpenAiToolCall {
  id?: string
  type?: string
  function?: { name?: string; arguments?: string }
}

/** Răspunsul pe care-l așteaptă constructorul, IDENTIC cu al creierului 2 Gemini. */
export interface RaspunsCreier {
  choices: { message: { role: 'assistant'; content: string; tool_calls?: OpenAiToolCall[] } }[]
  usage: { total_tokens: number }
  modelServit: string
}

/** Cheamă Fable 5 prin endpointul OpenAI-compatibil al Anthropic. Mesajele +
 *  uneltele sunt DEJA în format OpenAI → se trimit direct. Aruncă la orice eșec
 *  (ruta îl clasifică și îl întoarce constructorului, care reia onest). */
export async function fable5Chat(
  messages: unknown[],
  tools: unknown[],
  opts: { timeoutMs?: number } = {},
): Promise<RaspunsCreier> {
  const key = fable5Key()
  if (!key) throw new Error('fable5_neconfigurat: lipsește ANTHROPIC_API_KEY în app')
  const body: Record<string, unknown> = {
    model: FABLE_MODEL,
    messages,
    max_tokens: 8192,
    temperature: 0.7,
  }
  // Uneltele constructorului sunt în format OpenAI → trec direct; fără unelte nu
  // trimitem câmpul (unele endpoint-uri resping `tools: []`).
  // FORȚĂM CHEMAREA UNELTEI (owner, 14 aug: „nu ai fost în stare să legi Fable 5"):
  // pe `auto`, Fable 5 putea răspunde cu TEXT în loc să cheme o unealtă → exact
  // „tura sterilă" pe care am reparat-o la Gemini (ANY), dar o uitasem AICI, pe
  // rezervă. Constructorul e agentic — n-are ture de vorbă; pe fiecare tură TREBUIE
  // să cheme o unealtă (explorează / scrie / verifică sau `finish`). `required` =
  // modul ANY al endpointului OpenAI-compat Anthropic.
  if (Array.isArray(tools) && tools.length) {
    body.tools = tools
    body.tool_choice = 'required'
  }
  let r: Response
  try {
    r = await fetch(FABLE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(Math.max(30_000, opts.timeoutMs ?? 120_000)),
    })
  } catch (e) {
    throw new Error(`fable5 rețea: ${String((e as Error)?.message ?? e).slice(0, 200)}`)
  }
  const text = await r.text().catch(() => '')
  if (!r.ok) throw new Error(`fable5 ${r.status}: ${text.slice(0, 200)}`)
  let parsed: {
    choices?: { message?: { content?: unknown; tool_calls?: unknown } }[]
    usage?: { total_tokens?: unknown }
  }
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error(`fable5 JSON rupt (${text.length} caractere)`)
  }
  const message = parsed?.choices?.[0]?.message
  if (!message) throw new Error('fable5: răspuns fără candidați')
  const content = typeof message.content === 'string' ? message.content : ''
  const toolCalls = Array.isArray(message.tool_calls) ? (message.tool_calls as OpenAiToolCall[]) : []
  if (!content.trim() && !toolCalls.length) throw new Error('fable5: răspuns gol (fără text/tool)')
  const out: RaspunsCreier['choices'][0]['message'] = { role: 'assistant', content }
  if (toolCalls.length) out.tool_calls = toolCalls
  const total = Number(parsed?.usage?.total_tokens)
  return {
    choices: [{ message: out }],
    usage: { total_tokens: Number.isFinite(total) ? total : 0 },
    modelServit: `fable5/${FABLE_MODEL}`,
  }
}
