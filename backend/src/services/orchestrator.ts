import { OCHI_MARCAJ } from './brainContract.js'
import type { AnthropicTool, OrMessage, OrToolCall } from './brainContract.js'
import {
  GEMINI_DIRECT_PREFIX,
  geminiDirectChat,
  geminiDirectChatStream,
} from './geminiDirect.js'
import { filtruRepetitie } from './fluxUnic.js'
import { parseFakeToolCalls, stripToolMarkup } from './toolMarkup.js'

// ── THE ORCHESTRATOR — one brain: GEMINI DIRECT ─────────────────────────────
// (Extirparea OpenRouter/OpenAI, 3 aug: creierul e Gemini-ONLY.) Runs a
// conversation WITH tool-use through the Gemini model (`google-direct/…`):
// same tools, same persona (the system message), same memory (arriving in
// `messages`). The loop: call the model → if it asks for tools, run them
// (callback) → append the results → repeat, until the model gives a final
// answer. The REAL cost accumulates across all rounds.

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
//
// THE HOLE THAT LET "Deschid Gmail…" THROUGH (Adrian, 3 aug — "el zice că preia
// sarcina audio sau în scris dar nu o dă creierului spre rezolvare"): a weak free
// brain NARRATES the action in bare present tense at the START of a sentence
// ("Deschid Gmail.", "Caut ultimul email.", "Trimit mesajul.") with NO tool call.
// The old pattern caught only past deeds ("am deschis") and a narrow set of
// present forms ("îți deschid", "o să deschid", "deschid acum") — so a
// sentence-initial "Deschid Gmail" slipped past BOTH gates and was accepted as
// the finished turn. The last two branches now also catch a first-person present
// ACTION verb at the start of a line/sentence (RO) or "I'm opening/searching…"
// (EN) → the deed gate fires and forces execute-or-retract. `m` flag so the
// anchor matches later lines too, not just the very first character.
const DEED_CLAIM_RE =
  /\b(?:am|l-?am|le-?am|ți-?am|ti-?am)\s+(?:trimis|salvat|deschis|reparat|publicat|cre[ia]at|pornit|activat|afi[șs]at|ad[ăa]ugat|[șs]ters|configurat|instalat|rulat|executat|setat|actualizat|modificat|[îi]nchis)\b|\bi['’]?ve\s+(?:sent|saved|opened|created|fixed|published|started|deleted|done|updated|set)\b|\bhave\s+(?:sent|saved|opened|created|fixed|published)\b|(?:\b(?:m[ăa]\s+ocup|m[ăa]\s+apuc|[îi][țt]i\s+(?:deschid|ar[ăa]t|trimit|salvez|caut|pornesc|pun)|o\s+s[ăa]\s+(?:deschid|caut|trimit|salvez|pornesc|rulez|verific)|imediat\s+(?:deschid|caut|pornesc)|deschid\s+acum|pornesc\s+acum|caut\s+acum)\b)|(?:^|[.!?…\n]\s*)(?:deschid|caut|trimit|salvez|pornesc|rulez|execut|activez|instalez|configurez|adaug|[șs]terg|creez|repar|preiau|descarc|[îi]ncarc|generez|construiesc|afi[șs]ez|actualizez)\s+\S|\bi(?:'|’)?m\s+(?:opening|searching|sending|saving|starting|running|creating|generating|building)\b/im

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
 * @param model      Gemini-direct id (e.g. google-direct/gemini-2.5-flash)
 * @param messages   the conversation (system + history + current turn)
 * @param tools      the tools in Anthropic format (the ones from chat.ts)
 * @param execTool   runs a tool: (name, argsJson) → text result
 */
// OCHII PE REZULTAT (9 aug, ownerul: „sistemul nu dă lui Kelion poza reală
// pentru analiză"): un rezultat de unealtă poate purta o captură reală după
// OCHI_MARCAJ (browserul o lipește la fiecare pas). Textul curat intră ca
// rezultat de unealtă, iar captura intră imediat după, ca IMAGINE într-un rând
// user — modelul chiar O VEDE (geminiDirect o mapează pe inline_data), nu doar
// primește un URL pe care nu-l poate privi.
export function impingeRezultat(convo: OrMessage[], id: string, out: string): void {
  const taietura = out.indexOf(OCHI_MARCAJ)
  if (taietura < 0) {
    convo.push({ role: 'tool', tool_call_id: id, content: out })
    return
  }
  const curat = out.slice(0, taietura)
  const b64 = out.slice(taietura + OCHI_MARCAJ.length)
  convo.push({ role: 'tool', tool_call_id: id, content: curat })
  convo.push({
    role: 'user',
    content: [
      { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}` } },
      {
        type: 'text',
        text: '[OCHII TĂI — captura reală a paginii din browser, chiar acum. Analizezi CE SE VEDE aici, nu din amintiri sau din textul paginii.]',
      },
    ],
  })
}

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
    // GEMINI-ONLY (3 aug — extirparea OpenRouter): orice model al creierului
    // poartă prefixul google-direct/ și merge prin API-ul Google. Un id fără
    // prefix nu mai are niciun motor în spate — eroare NUMITĂ, nu o cădere
    // tăcută pe un furnizor care nu mai există.
    if (!model.startsWith(GEMINI_DIRECT_PREFIX)) {
      throw new Error(`model_necunoscut: „${model}" — creierul e Gemini-only (google-direct/*)`)
    }
    const gModel = model.slice(GEMINI_DIRECT_PREFIX.length)
    // PROFILING (Aug 2 — the 38-second weather turn): every brain round gets
    // its real duration in the log, so a slow turn shows WHERE the seconds go
    // (the model, the tool, or the number of rounds) instead of being guessed.
    const tRunda = Date.now()
    let res
    try {
      res = onTextFiltrat
        ? await geminiDirectChatStream(gModel, convo, tools, onTextFiltrat, callOpts)
        : await geminiDirectChat(gModel, convo, tools, callOpts)
    } catch (e) {
      // BANII RUNDELOR DEJA PLĂTITE NU SE EVAPORĂ CU EXCEPȚIA (audit 9 aug):
      // rundele 1..N-1 au fost apeluri REALE, plătite la Google, dar totalCost
      // era local și murea cu throw-ul — nici înregistrat, nici debitat.
      // Eroarea cară costul; catch-ul din chat.ts îl adună și îl înregistrează.
      if (totalCost > 0 && e instanceof Error) {
        const purtator = e as Error & { costUsd?: number }
        purtator.costUsd = (purtator.costUsd ?? 0) + totalCost
      }
      throw e
    }
    totalCost += res.costUsd
    served = res.model
    console.log(`[TIMP] ${served} runda ${round}: ${Date.now() - tRunda}ms (${res.toolCalls.length} apeluri de unelte)`)
    // Without streaming (background agents) the text doesn't go through the
    // filter piece by piece — we pass it whole here, so deduping is the same
    // on both paths.
    if (!onTextFiltrat && res.text) flux.bucata(res.text)
    // Close the round: what was left pending is a clean repeat and gets dropped.
    const coada = flux.inchideRunda()
    if (coada && emite) emite(coada)
    const rundaGoala = flux.rundaAFostGoala()
    allText = flux.emis()

    // AUDIO-UL SE AUDE O SINGURĂ DATĂ (agenții de debug, 3 aug): blocul
    // `audio_url` (sute de KB base64) rămânea în convo și se RE-URCA la Gemini
    // la FIECARE rundă de unelte (până la 8) — lățime de bandă și latență
    // arse degeaba. După prima rundă modelul l-a auzit deja; rundele următoare
    // păstrează doar textul (transcriptul e oricum în mesaj).
    if (round === 1) {
      for (const m of convo) {
        if (!Array.isArray(m.content)) continue
        const blocuri = m.content as { type: string; text?: string }[]
        if (!blocuri.some((b) => b.type === 'audio_url')) continue
        const faraAudio = blocuri.filter((b) => b.type !== 'audio_url')
        m.content = faraAudio.length ? faraAudio : '(mesaj vocal — audio deja ascultat)'
      }
    }

    if (res.toolCalls.length === 0) {
      // ── THE FAKE-CALL INTERPRETER (Adrian, Aug 2) ──────────────────────────
      //
      // Him: "everything you give it by voice never reaches the brain; in
      // writing it only says 'Am preluat sarcina'".
      //
      // Live cause (server journal): weak free models TYPE the tool call as
      // text — `<|tool_call>call:system_health{}<tool_call|>` — instead of
      // invoking it. The old path HID that text from the human and ended the
      // turn empty: the ack was heard, then silence, and nothing was ever
      // executed. Now we run what the model MEANT: parse the typed call (only
      // names really offered this turn, only valid JSON args), execute it,
      // hand the result back and let the turn continue — exactly as if the
      // model had called the tool properly.
      const fakeCalls = res.text
        ? parseFakeToolCalls(res.text, new Set(tools.map((t) => t.name)))
        : []
      if (fakeCalls.length > 0) {
        console.error(
          `[orchestrator] runda ${round}: modelul a TASTAT apelul în loc să-l cheme ` +
            `— îl execut eu (${fakeCalls.map((f) => f.name).join(', ')}) [${served}]`,
        )
        // Same spin guard as the real-call path: nothing new + the very same
        // typed calls twice in a row = a stuck model, we stop paying rounds.
        const semnF = fakeCalls
          .map((f) => `${f.name}(${f.argsJson.slice(0, 300)})`)
          .join('|')
        if (rundaGoala && semnF === semnaturaTrecuta) {
          console.error(`[orchestrator] runda ${round}: aceleași apeluri tastate de două ori → opresc bucla (${served})`)
          return { text: stripToolMarkup(allText), costUsd: totalCost, model: served, rounds: round }
        }
        semnaturaTrecuta = semnF
        anyToolCalled = true
        const calls: OrToolCall[] = fakeCalls.map((f, i) => ({
          id: `fake_${round}_${i}`,
          type: 'function',
          function: { name: f.name, arguments: f.argsJson },
        }))
        // The assistant turn is kept with the markup STRIPPED — history must
        // not teach the model that typing calls is the way to make them.
        convo.push({ role: 'assistant', content: stripToolMarkup(res.text ?? ''), tool_calls: calls })
        for (const call of calls) {
          let out = ''
          try {
            out = await execTool(call.function.name, call.function.arguments || '{}')
          } catch (e) {
            out = `tool_error: ${String(e).slice(0, 200)}`
          }
          impingeRezultat(convo, call.id, out)
        }
        continue
      }
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
            'POARTA FAPTEI: ai spus că faci sau că ai făcut o acțiune (ex. ' +
            '„Deschid Gmail", „am trimis"), dar nu ai chemat NICIO unealtă — ' +
            'deci acțiunea NU s-a întâmplat. Ori cheamă ACUM unealta care ' +
            'execută cu adevărat, ori retrage sincer afirmația și spune clar ' +
            'ce anume nu poți face și de ce.',
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
      // allText is returned CLEAN: history must never contain typed fake calls.
      return { text: stripToolMarkup(allText), costUsd: totalCost, model: served, rounds: round }
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
      return { text: stripToolMarkup(allText), costUsd: totalCost, model: served, rounds: round }
    }
    semnaturaTrecuta = semnatura

    anyToolCalled = true
    // The assistant message ASKING for the tools (keeps tool_calls for linkage).
    convo.push({ role: 'assistant', content: res.text ?? '', tool_calls: res.toolCalls })
    // TOOLS IN PARALLEL (Aug 2 — the latency mission): the model's calls from
    // ONE round are independent by definition (it receives all results at
    // once), so running them one-by-one only stacked their latencies (a
    // search + a map + a weather = 3 serial HTTP waits). They now leave
    // TOGETHER; the results are appended in the EXACT order of the calls, so
    // the conversation the model sees is byte-identical to the serial path.
    // Correctness is untouched: the same tools run, with the same arguments,
    // and a failing tool still becomes its own tool_error, never a lost turn.
    const tUnelte = Date.now()
    const iesiri = await Promise.all(
      (res.toolCalls as OrToolCall[]).map(async (call) => {
        try {
          return await execTool(call.function.name, call.function.arguments || '{}')
        } catch (e) {
          return `tool_error: ${String(e).slice(0, 200)}`
        }
      }),
    )
    if (iesiri.length > 1) console.log(`[TIMP] ${iesiri.length} unelte în paralel: ${Date.now() - tUnelte}ms`)
    for (let i = 0; i < res.toolCalls.length; i++) {
      impingeRezultat(convo, res.toolCalls[i].id, iesiri[i])
    }
  }

  // Too many tool rounds — return what we have, without blocking the user.
  return { text: stripToolMarkup(allText), costUsd: totalCost, model: served, rounds: maxRounds }
}
