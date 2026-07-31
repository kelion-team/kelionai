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

// ── ORCHESTRATORUL — un creier, orice model ─────────────────────────────────
// Rulează o conversație CU tool-use printr-un model ales (GPT/Gemini/Claude prin
// OpenRouter), IDENTIC indiferent de model: aceleași unelte, aceeași persona
// (mesajul system), aceeași memorie (venită în `messages`). Bucla: cheamă modelul
// → dacă cere unelte, le execută (callback) → adaugă rezultatele → reia, până
// modelul răspunde final. Costul REAL se acumulează pe toate turele.

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
  /** Raționament intern pentru modelele cu gândire (Fable/Claude/GPT-o). */
  reasoning?: 'low' | 'medium' | 'high'
  onText?: (text: string) => void
  /** POARTA FAPTEI (Adrian, 27 iul): dacă modelul AFIRMĂ o acțiune fără să fi
   *  chemat vreo unealtă, îl obligăm mecanic să execute sau să retragă. */
  deedGate?: boolean
  /** Pe PRIMA rundă forțează modelul să cheme o unealtă (tool_choice:'required')
   *  — pentru turele de ACȚIUNE ale ownerului, ca să execute, nu să nareze.
   *  Rundele următoare revin la 'auto' (altfel ar chema unelte la infinit). */
  forceToolsFirstRound?: boolean
}

// Detectează o afirmație de ACȚIUNE („am trimis/salvat/deschis/reparat...") —
// lucruri care ar trebui făcute prin unealtă, nu doar spuse.
const DEED_CLAIM_RE =
  /\b(?:am|l-?am|le-?am|ți-?am|ti-?am)\s+(?:trimis|salvat|deschis|reparat|publicat|cre[ia]at|pornit|activat|afi[șs]at|ad[ăa]ugat|[șs]ters|configurat|instalat|rulat|executat|setat|actualizat|modificat|[îi]nchis)\b|\bi['’]?ve\s+(?:sent|saved|opened|created|fixed|published|started|deleted|done|updated|set)\b|\bhave\s+(?:sent|saved|opened|created|fixed|published)\b|(?:\b(?:m[ăa]\s+ocup|m[ăa]\s+apuc|[îi][țt]i\s+(?:deschid|ar[ăa]t|trimit|salvez|caut|pornesc|pun)|o\s+s[ăa]\s+(?:deschid|caut|trimit|salvez|pornesc|rulez|verific)|imediat\s+(?:deschid|caut|pornesc)|deschid\s+acum|pornesc\s+acum|caut\s+acum)\b)/i

// ── „O SĂ ANALIZEZ" (Adrian, 31 iul) ────────────────────────────────────────
// „când spune că o să analizez, trebuie FAPTIC să deschidă monitorul și să
// arate ce face!"
//
// DEED_CLAIM_RE de mai sus prinde „AM făcut". Asta prinde promisiunea de a te
// UITA la ceva — verbele cu care se încheia o tură fără să se întâmple nimic,
// iar omul rămânea în fața unui ecran gol, așteptând o analiză care nu
// începuse. „Analizez", „mă uit", „verific", „investighez", „cercetez".
//
// Timpul viitor ȘI prezentul de intenție („analizez acum") — fiindcă în
// română amândouă înseamnă același lucru: încă n-am făcut-o.
const ANALIZA_CLAIM_RE =
  /\b(?:o\s+s[ăa]\s+)?(?:analizez|verific|investighez|cercetez|examinez|studiez|inspectez)\b|\b(?:m[ăa]\s+uit|arunc\s+o\s+privire|dau\s+o\s+cautare|caut\s+prin|sap\s+in)\b|\b(?:let\s+me\s+)?(?:analy[sz]e|investigate|examine|inspect|look\s+into|take\s+a\s+look|check\s+the)\b|\bi(?:'|’)?ll\s+(?:analy[sz]e|check|look|investigate|examine)\b/i

/**
 * @param model      id OpenRouter (ex: openai/gpt-4.1-mini, anthropic/claude-sonnet-5)
 * @param messages   conversația (system + istoric + tura curentă)
 * @param tools      uneltele în format Anthropic (cele din chat.ts)
 * @param execTool   execută o unealtă: (name, argsJson) → rezultat text
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
  // TOT textul rostit/afișat, pe toate rundele (25 iul): rundele intermediare
  // („stai să verific...") curgeau prin onText și erau ROSTITE, dar doar runda
  // finală intra în istoric → la reload lipseau bucăți din ce s-a spus, iar la
  // epuizarea rundelor tura se încheia complet MUTĂ ('').
  let allText = ''
  let deedGateUsed = false
  let analizaGateUsed = false
  let anyToolCalled = false

  // ── NU SE SCRIE DE DOUĂ ORI ACELAȘI LUCRU ─────────────────────────────────
  // Adrian, 31 iul: „scrie aceeași frază nonstop" / „în chat se balează
  // răspunsul lui scris de mai multe ori".
  // Cauza era chiar aici: bucla merge până la 8 runde, iar FIECARE rundă își
  // trimitea textul mai departe prin `onText`, fără ca nimic să compare runda
  // nouă cu ce ajunsese deja la om. Model împotmolit = aceeași frază, o dată pe
  // rundă. Filtrul lasă să treacă doar ce e NOU. Vezi services/fluxUnic.ts.
  const flux = filtruRepetitie()
  const emite = opts.onText
  const onTextFiltrat = emite
    ? (txt: string): void => {
        const nou = flux.bucata(txt)
        if (nou) emite(nou)
      }
    : undefined
  // Semnătura apelurilor de unelte din runda trecută: „aceeași frază + aceleași
  // unelte" = se învârte în loc, nu lucrează.
  let semnaturaTrecuta = ''

  for (let round = 1; round <= maxRounds; round++) {
    // Cu onText → streaming (primul cuvânt instant, ca pe vechiul creier). Fără →
    // apel simplu (ex: agenți în fundal care nu difuzează).
    // Forțarea uneltei DOAR pe prima rundă (dacă cerută) și doar dacă avem
    // unelte de oferit; altfel 'required' fără tools ar fi respins de API.
    const toolChoice: 'required' | undefined =
      opts.forceToolsFirstRound && round === 1 && tools.length ? 'required' : undefined
    const callOpts = {
      maxTokens: opts.maxTokens,
      temperature: opts.temperature,
      reasoning: opts.reasoning,
      toolChoice,
    }
    // CREIERUL PRINCIPAL GEMINI (Adrian, 27 iul): modelele cu prefixul
    // google-direct/ merg pe API-ul Google (cheia gratuită), nu pe OpenRouter —
    // aceleași forme de intrare/ieșire, bucla de unelte rămâne identică.
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
    // Fără streaming (agenți în fundal) textul nu trece prin filtru la bucată —
    // îl trecem întreg aici, ca dedublarea să fie aceeași pe ambele căi.
    if (!onTextFiltrat && res.text) flux.bucata(res.text)
    // Închide runda: ce a rămas în așteptare e o repetare curată și se aruncă.
    const coada = flux.inchideRunda()
    if (coada && emite) emite(coada)
    const rundaGoala = flux.rundaAFostGoala()
    allText = flux.emis()

    if (res.toolCalls.length === 0) {
      // POARTA FAPTEI (Adrian, 27 iul): dacă modelul spune că A FĂCUT o acțiune
      // („am trimis/salvat/reparat...") dar n-a chemat NICIODATĂ vreo unealtă în
      // toată tura, nu e o faptă — e vorbă goală. Îl obligăm o dată să execute
      // sau să retragă sincer. O singură dată, ca să nu intre în buclă.
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
      // ── POARTA ANALIZEI (Adrian, 31 iul) ─────────────────────────────────
      //
      // El: „când spune că o să analizez, trebuie FAPTIC să deschidă monitorul
      // și să arate ce face!"
      //
      // Poarta faptei de mai sus prinde „AM făcut". Asta prinde „O SĂ fac" —
      // „analizez", „mă uit", „verific", „investighez". Erau exact cuvintele
      // cu care se termina o tură fără să se întâmple nimic: promisiunea suna
      // a muncă, iar omul rămânea cu ecranul gol, așteptând.
      //
      // Nu-i cerem doar să execute. Îi cerem să DESCHIDĂ MONITORUL: munca
      // trebuie să se VADĂ în timp ce se face, nu să fie povestită după.
      // O singură dată pe tură, ca să nu intre în buclă.
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
      // La streaming textul a curs deja prin onText; nu-l re-emitem.
      return { text: allText, costUsd: totalCost, model: served, rounds: round }
    }

    // ── SE ÎNVÂRTE ÎN LOC? ──────────────────────────────────────────────────
    // Adrian, 31 iul: „scrie aceeași frază nonstop".
    // Filtrul de mai sus face ca repetarea să nu se mai VADĂ. Dar dacă ne
    // oprim acolo, tot plătim opt runde ca să aruncăm șapte — și pe modelele
    // gratuite, opt apeluri într-o rafală lovesc plafonul pe minut, așa că
    // următoarea ta întrebare primește 429, adică „problemă tehnică".
    // Deci: rundă care n-a adus NIMIC nou ȘI cere exact aceleași unelte ca
    // runda dinainte = model împotmolit. Nu-l mai lăsăm să se rotească.
    const semnatura = res.toolCalls
      .map((c) => `${c.function.name}(${(c.function.arguments || '').slice(0, 300)})`)
      .join('|')
    if (rundaGoala && semnatura && semnatura === semnaturaTrecuta) {
      console.error(`[orchestrator] runda ${round}: nimic nou + aceleași unelte → opresc bucla (${served})`)
      return { text: allText, costUsd: totalCost, model: served, rounds: round }
    }
    semnaturaTrecuta = semnatura

    anyToolCalled = true
    // Mesajul asistentului care CERE uneltele (păstrează tool_calls pentru legătură).
    convo.push({ role: 'assistant', content: res.text ?? '', tool_calls: res.toolCalls })
    // Execută fiecare unealtă și adaugă rezultatul ca mesaj role:'tool'.
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

  // Prea multe runde de unelte — întoarce ce avem, fără să blocăm userul.
  return { text: allText, costUsd: totalCost, model: served, rounds: maxRounds }
}
