import {
  openrouterChat,
  openrouterChatStream,
  type AnthropicTool,
  type OrMessage,
  type OrToolCall,
} from './openrouter.js'
import {
  GEMINI_DIRECT_PREFIX,
  geminiDirectChat,
  geminiDirectChatStream,
} from './geminiDirect.js'
import { filtruRepetitie } from './fluxUnic.js'

// ── THE ORCHESTRATOR — one brain, any model ─────────────────────────────────
// Runs a conversation WITH tool-use through a chosen model (GPT/Gemini/Claude
// via OpenRouter), IDENTICALLY regardless of model: same tools, same persona
// (the system message), same memory (arriving in `messages`). The loop: call
// the model → if it asks for tools, run them (callback) → append the results
// → repeat, until the model gives a final answer. The REAL cost accumulates
// across all rounds.

export interface OrchestratorResult {
  text: string
  costUsd: number
  model: string
  rounds: number
}

export interface OrchestratorOpts {
  maxRounds?: number
  maxTokens?: number
  temperature?: number
  /** Internal reasoning for the thinking models (Fable/Claude/GPT-o). */
  reasoning?: 'low' | 'medium' | 'high'
  onText?: (text: string) => void
  /** THE DEED GATE (Adrian, Jul 27): if the model CLAIMS an action without
   *  having called any tool, we mechanically force it to execute or retract. */
  deedGate?: boolean
  /** On the FIRST round forces the model to call a tool (tool_choice:'required')
   *  — for the owner's ACTION turns, so it executes instead of narrating.
   *  Later rounds return to 'auto' (otherwise it would call tools forever). */
  forceToolsFirstRound?: boolean
}

// Detects an ACTION claim ("am trimis/salvat/deschis/reparat...") — things
// that should be done through a tool, not just said.
const DEED_CLAIM_RE =
  /\b(?:am|l-?am|le-?am|ți-?am|ti-?am)\s+(?:trimis|salvat|deschis|reparat|publicat|cre[ia]at|pornit|activat|afi[șs]at|ad[ăa]ugat|[șs]ters|configurat|instalat|rulat|executat|setat|actualizat|modificat|[îi]nchis)\b|\bi['’]?ve\s+(?:sent|saved|opened|created|fixed|published|started|deleted|done|updated|set)\b|\bhave\s+(?:sent|saved|opened|created|fixed|published)\b|(?:\b(?:m[ăa]\s+ocup|m[ăa]\s+apuc|[îi][țt]i\s+(?:deschid|ar[ăa]t|trimit|salvez|caut|pornesc|pun)|o\s+s[ăa]\s+(?:deschid|caut|trimit|salvez|pornesc|rulez|verific)|imediat\s+(?:deschid|caut|pornesc)|deschid\s+acum|pornesc\s+acum|caut\s+acum)\b)/i

// ── "O SĂ ANALIZEZ" (Adrian, Jul 31) ─────────────────────────────────────────
// "when he says he's going to analyse, he must ACTUALLY open the monitor and
// show what he's doing!"
//
// DEED_CLAIM_RE above catches "I DID it". This one catches the promise to LOOK
// at something — the verbs a turn used to end with while nothing happened, and
// the human was left in front of an empty screen, waiting for an analysis that
// never started. "Analizez", "mă uit", "verific", "investighez", "cercetez".
//
// Future tense AND intent present ("analizez acum") — because in Romanian both
// mean the same thing: I haven't done it yet.
const ANALIZA_CLAIM_RE =
  /\b(?:o\s+s[ăa]\s+)?(?:analizez|verific|investighez|cercetez|examinez|studiez|inspectez)\b|\b(?:m[ăa]\s+uit|arunc\s+o\s+privire|dau\s+o\s+cautare|caut\s+prin|sap\s+in)\b|\b(?:let\s+me\s+)?(?:analy[sz]e|investigate|examine|inspect|look\s+into|take\s+a\s+look|check\s+the)\b|\bi(?:'|’)?ll\s+(?:analy[sz]e|check|look|investigate|examine)\b/i

/**
 * @param model      OpenRouter id (e.g. openai/gpt-4.1-mini, anthropic/claude-sonnet-5)
 * @param messages   the conversation (system + history + current turn)
 * @param tools      the tools in Anthropic format (the ones from chat.ts)
 * @param execTool   runs a tool: (name, argsJson) → text result
 */
export async function runOrchestrator(
  model: string,
  messages: OrMessage[],
  tools: AnthropicTool[],
  execTool: (name: string, argsJson: string) => Promise<string>,
  opts: OrchestratorOpts = {},
): Promise<OrchestratorResult> {
  const maxRounds = opts.maxRounds ?? 8
  const convo: OrMessage[] = [...messages]
  let totalCost = 0
  let served = model
  // ALL spoken/displayed text, across all rounds (Jul 25): the intermediate
  // rounds ("wait, let me check...") flowed through onText and were SPOKEN,
  // but only the final round went into history → on reload, pieces of what was
  // said were missing, and when the rounds ran out the turn ended completely
  // MUTE ('').
  let allText = ''
  let deedGateUsed = false
  let analizaGateUsed = false
  let anyToolCalled = false

  // ── THE SAME THING IS NEVER WRITTEN TWICE ──────────────────────────────────
  // Adrian, Jul 31: "writes the same sentence nonstop" / "in chat his written
  // reply drools out several times".
  // The cause was right here: the loop runs up to 8 rounds, and EACH round
  // forwarded its text through `onText`, with nothing comparing the new round
  // to what had already reached the human. A stuck model = the same sentence,
  // once per round. The filter lets through only what's NEW. See
  // services/fluxUnic.ts.
  const flux = filtruRepetitie()
  const emite = opts.onText
  const onTextFiltrat = emite
    ? (txt: string): void => {
        const nou = flux.bucata(txt)
        if (nou) emite(nou)
      }
    : undefined
  // The signature of last round's tool calls: "same sentence + same tools" =
  // spinning in place, not working.
  let semnaturaTrecuta = ''

  for (let round = 1; round <= maxRounds; round++) {
    // With onText → streaming (first word instantly, like the old brain).
    // Without → plain call (e.g. background agents that don't broadcast).
    // Tool forcing ONLY on the first round (if requested) and only if we have
    // tools to offer; otherwise 'required' without tools would be rejected by
    // the API.
    const toolChoice: 'required' | undefined =
      opts.forceToolsFirstRound && round === 1 && tools.length ? 'required' : undefined
    const callOpts = {
      maxTokens: opts.maxTokens,
      temperature: opts.temperature,
      reasoning: opts.reasoning,
      toolChoice,
    }
    // THE MAIN GEMINI BRAIN (Adrian, Jul 27): models with the google-direct/
    // prefix go through Google's API (the free key), not through OpenRouter —
    // same input/output shapes, the tool loop stays identical.
    const gemini = model.startsWith(GEMINI_DIRECT_PREFIX)
    const gModel = gemini ? model.slice(GEMINI_DIRECT_PREFIX.length) : model
    const res = onTextFiltrat
      ? gemini
        ? await geminiDirectChatStream(gModel, convo, tools, onTextFiltrat, callOpts)
        : await openrouterChatStream(model, convo, tools, onTextFiltrat, callOpts)
      : gemini
        ? await geminiDirectChat(gModel, convo, tools, callOpts)
        : await openrouterChat(model, convo, tools, callOpts)
    totalCost += res.costUsd
    served = res.model
    // Without streaming (background agents) the text doesn't go through the
    // filter piece by piece — we pass it whole here, so deduping is the same
    // on both paths.
    if (!onTextFiltrat && res.text) flux.bucata(res.text)
    // Close the round: what was left pending is a clean repeat and gets dropped.
    const coada = flux.inchideRunda()
    if (coada && emite) emite(coada)
    const rundaGoala = flux.rundaAFostGoala()
    allText = flux.emis()

    if (res.toolCalls.length === 0) {
      // THE DEED GATE (Adrian, Jul 27): if the model says it DID an action
      // ("am trimis/salvat/reparat...") but NEVER called any tool in the whole
      // turn, it's not a deed — it's empty talk. We force it once to execute or
      // honestly retract. Only once, so it doesn't loop.
      if (
        opts.deedGate &&
        !deedGateUsed &&
        !anyToolCalled &&
        DEED_CLAIM_RE.test(res.text || '')
      ) {
        deedGateUsed = true
        convo.push({ role: 'assistant', content: res.text ?? '' })
        convo.push({
          role: 'user',
          content:
            'POARTA FAPTEI: ai afirmat că ai făcut o acțiune, dar nu ai chemat ' +
            'NICIO unealtă — deci acțiunea NU s-a întâmplat. Ori cheamă ACUM ' +
            'unealta care execută cu adevărat, ori retrage sincer afirmația și ' +
            'spune clar ce anume nu poți face și de ce.',
        })
        continue
      }
      // ── THE ANALYSIS GATE (Adrian, Jul 31) ─────────────────────────────────
      //
      // Him: "when he says he's going to analyse, he must ACTUALLY open the
      // monitor and show what he's doing!"
      //
      // The deed gate above catches "I DID". This one catches "I WILL do" —
      // "analizez", "mă uit", "verific", "investighez". They were exactly the
      // words a turn ended with while nothing happened: the promise sounded
      // like work, and the human was left with an empty screen, waiting.
      //
      // We don't just ask it to execute. We ask it to OPEN THE MONITOR: the
      // work must be SEEN while it's being done, not narrated afterwards.
      // Once per turn, so it doesn't loop.
      if (
        opts.deedGate &&
        !analizaGateUsed &&
        !anyToolCalled &&
        ANALIZA_CLAIM_RE.test(res.text || '')
      ) {
        analizaGateUsed = true
        convo.push({ role: 'assistant', content: res.text ?? '' })
        convo.push({
          role: 'user',
          content:
            'POARTA ANALIZEI: ai spus că analizezi / te uiți / verifici, dar ' +
            'n-ai chemat NICIO unealtă — deci nu te-ai uitat la nimic. ' +
            'Fă-o ACUM, cu uneltele tale (read_source, search_source, db_query, ' +
            'system_health, runbook_log — ce se potrivește), și PUNE PE MONITOR ' +
            'ce faci, cu show_document: ce ai deschis, ce ai găsit, unde anume ' +
            '(fișier și linie). Munca se VEDE în timp ce se face, nu se ' +
            'povestește după. Dacă nu ai cu ce să analizezi, spune clar asta ' +
            'în loc să promiți.',
        })
        continue
      }
      // On streaming the text already flowed through onText; we don't re-emit it.
      return { text: allText, costUsd: totalCost, model: served, rounds: round }
    }

    // ── SPINNING IN PLACE? ───────────────────────────────────────────────────
    // Adrian, Jul 31: "writes the same sentence nonstop".
    // The filter above makes the repetition no longer VISIBLE. But if we stop
    // there, we still pay eight rounds to throw away seven — and on the free
    // models, eight calls in a burst hit the per-minute cap, so your next
    // question gets a 429, i.e. "technical problem".
    // So: a round that brought NOTHING new AND asks for exactly the same tools
    // as the round before = a stuck model. We don't let it keep spinning.
    const semnatura = res.toolCalls
      .map((c) => `${c.function.name}(${(c.function.arguments || '').slice(0, 300)})`)
      .join('|')
    if (rundaGoala && semnatura && semnatura === semnaturaTrecuta) {
      console.error(`[orchestrator] runda ${round}: nimic nou + aceleași unelte → opresc bucla (${served})`)
      return { text: allText, costUsd: totalCost, model: served, rounds: round }
    }
    semnaturaTrecuta = semnatura

    anyToolCalled = true
    // The assistant message ASKING for the tools (keeps tool_calls for linkage).
    convo.push({ role: 'assistant', content: res.text ?? '', tool_calls: res.toolCalls })
    // Run each tool and append the result as a role:'tool' message.
    for (const call of res.toolCalls as OrToolCall[]) {
      let out = ''
      try {
        out = await execTool(call.function.name, call.function.arguments || '{}')
      } catch (e) {
        out = `tool_error: ${String(e).slice(0, 200)}`
      }
      convo.push({ role: 'tool', tool_call_id: call.id, content: out })
    }
  }

  // Too many tool rounds — return what we have, without blocking the user.
  return { text: allText, costUsd: totalCost, model: served, rounds: maxRounds }
}
