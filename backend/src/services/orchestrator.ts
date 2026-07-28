import {
  openrouterChat,
  openrouterChatStream,
  type AnthropicTool,
  type OrChatResult,
  type OrMessage,
  type OrToolCall,
} from './openrouter.js'
import {
  GEMINI_DIRECT_PREFIX,
  geminiDirectChat,
  geminiDirectChatStream,
} from './geminiDirect.js'

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
   *  chemat vreo unealtă de ACȚIUNE, îl obligăm mecanic să execute sau să retragă. */
  deedGate?: boolean
  /** UNELTELE PASIVE — cele care doar CITESC/raportează (read_source, db_query,
   *  system_health, ask_brain...). A le chema NU e o faptă: nu dezarmează poarta
   *  și nu oprește forțarea. Orice unealtă care nu e aici e considerată ACȚIUNE. */
  passiveTools?: Set<string>
  /** Ține tool_choice:'required' până când chiar RULEAZĂ o unealtă de acțiune
   *  (plafonat la FORCE_MAX_ROUNDS) — pentru turele de ORDIN: execută, nu nara. */
  forceToolsUntilAction?: boolean
  /** CREIERUL DE ABONAMENT: cheia OpenRouter proprie a ownerului. Când e dată,
   *  tura grea a adminului merge pe modelul puternic plătit din creditul lui,
   *  nu din punga centrală. Ignorată pe calea gemini-direct. */
  apiKey?: string
}

// Cât timp poate ține forțarea de la începutul turei. Peste asta, dacă modelul
// tot n-a făcut nimic, îl lăsăm să vorbească (poarta faptei rămâne de pază).
const FORCE_MAX_ROUNDS = 3
// De câte ori poate interveni poarta faptei într-o tură (plafon anti-buclă).
const DEED_GATE_MAX = 2

// Detectează o afirmație de ACȚIUNE („am trimis/salvat/deschis/reparat...") —
// lucruri care ar trebui făcute prin unealtă, nu doar spuse.
const DEED_CLAIM_RE =
  /\b(?:am|l-?am|le-?am|ți-?am|ti-?am)\s+(?:trimis|salvat|deschis|reparat|publicat|cre[ia]at|pornit|activat|afi[șs]at|ad[ăa]ugat|[șs]ters|configurat|instalat|importat|rulat|executat|setat|actualizat|modificat|[îi]nchis)\b|\bi['’]?ve\s+(?:sent|saved|opened|created|fixed|published|started|deleted|done|updated|set|installed|imported)\b|\bhave\s+(?:sent|saved|opened|created|fixed|published)\b|(?:\b(?:m[ăa]\s+ocup|m[ăa]\s+apuc|[îi][țt]i\s+(?:deschid|ar[ăa]t|trimit|salvez|caut|pornesc|pun|instalez|import|adaug|fac)|o\s+s[ăa]\s+(?:deschid|caut|trimit|salvez|pornesc|rulez|verific|instalez|import|adaug|fac)|imediat\s+(?:deschid|caut|pornesc|instalez)|deschid\s+acum|pornesc\s+acum|caut\s+acum|instalez\s+acum)\b)/i

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
  let deedGatesUsed = 0
  // FAPTA = o unealtă care chiar SCHIMBĂ ceva sau produce un rezultat real.
  // Cititul (read_source, db_query, system_health) NU e faptă — vezi passiveTools.
  const passive = opts.passiveTools ?? new Set<string>()
  let anyActionToolCalled = false
  // Runda de după poarta faptei se cere FORȚATĂ: altfel modelul „corectat"
  // răspundea tot pe 'auto' și repeta minciuna cu alte cuvinte.
  let forceNextRound = false

  for (let round = 1; round <= maxRounds; round++) {
    // Cu onText → streaming (primul cuvânt instant, ca pe vechiul creier). Fără →
    // apel simplu (ex: agenți în fundal care nu difuzează).
    // FORȚAREA PÂNĂ LA FAPTĂ (Adrian, 27 iul: „autonomia lui nu e reală").
    // Varianta veche forța DOAR runda 1: modelul o satisfăcea cu o unealtă
    // PASIVĂ (system_health, read_source), apoi rundele următoare reveneau la
    // 'auto' și NARA restul — exact comportamentul reclamat, identic pe orice
    // model. Măsurat live pe creierul gratuit (27 iul, gemma :free, 61 unelte +
    // prompt de 10k): pe 'auto' execută 0/2 (răspuns GOL), forțat execută 2/2.
    // Deci forțarea ține până când chiar rulează o unealtă de ACȚIUNE.
    const forcedNow =
      tools.length > 0 &&
      ((opts.forceToolsUntilAction && !anyActionToolCalled && round <= FORCE_MAX_ROUNDS) || forceNextRound)
    forceNextRound = false
    // CREIERUL PRINCIPAL GEMINI (Adrian, 27 iul): modelele cu prefixul
    // google-direct/ merg pe API-ul Google (cheia gratuită), nu pe OpenRouter —
    // aceleași forme de intrare/ieșire, bucla de unelte rămâne identică.
    const gemini = model.startsWith(GEMINI_DIRECT_PREFIX)
    const gModel = gemini ? model.slice(GEMINI_DIRECT_PREFIX.length) : model
    const askModel = (toolChoice: 'required' | undefined): Promise<OrChatResult> => {
      const callOpts = {
        maxTokens: opts.maxTokens,
        temperature: opts.temperature,
        reasoning: opts.reasoning,
        toolChoice,
        apiKey: opts.apiKey,
      }
      return opts.onText
        ? gemini
          ? geminiDirectChatStream(gModel, convo, tools, opts.onText, callOpts)
          : openrouterChatStream(model, convo, tools, opts.onText, callOpts)
        : gemini
          ? geminiDirectChat(gModel, convo, tools, callOpts)
          : openrouterChat(model, convo, tools, callOpts)
    }
    let res: OrChatResult
    try {
      res = await askModel(forcedNow ? 'required' : undefined)
    } catch (e) {
      // FORȚAREA NU ARE VOIE SĂ OMOARE ORDINUL: unii furnizori resping
      // tool_choice:'required' (400). Reluăm runda liber — mai bine execută
      // poate decât să pice tura cu eroare. Fără forțare, eroarea urcă normal.
      if (!forcedNow) throw e
      res = await askModel(undefined)
    }
    totalCost += res.costUsd
    served = res.model
    if (res.text) allText = allText ? `${allText}\n${res.text}` : res.text

    if (res.toolCalls.length === 0) {
      // POARTA FAPTEI (Adrian, 27 iul): dacă modelul spune că A FĂCUT o acțiune
      // („am trimis/salvat/reparat...") dar n-a chemat nicio unealtă de ACȚIUNE
      // în toată tura, nu e o faptă — e vorbă goală. Îl obligăm să execute sau
      // să retragă sincer, cu runda de corecție FORȚATĂ.
      // Condiția era `!anyToolCalled`, iar forțarea rundei 1 garanta că o unealtă
      // rulase → poarta nu mai putea declanșa NICIODATĂ exact pe turele de
      // acțiune pentru care fusese făcută. Acum contează doar faptele reale.
      if (
        opts.deedGate &&
        deedGatesUsed < DEED_GATE_MAX &&
        !anyActionToolCalled &&
        DEED_CLAIM_RE.test(res.text || '')
      ) {
        deedGatesUsed++
        forceNextRound = tools.length > 0
        convo.push({ role: 'assistant', content: res.text ?? '' })
        convo.push({
          role: 'user',
          content:
            'POARTA FAPTEI: ai afirmat că ai făcut o acțiune, dar nu ai chemat ' +
            'nicio unealtă care să o execute — deci acțiunea NU s-a întâmplat. ' +
            'Ori cheamă ACUM unealta care execută cu adevărat, ori retrage sincer ' +
            'afirmația și spune clar ce anume nu poți face și de ce. (A citi sau a ' +
            'raporta o stare NU înseamnă a face.)',
        })
        continue
      }
      // La streaming textul a curs deja prin onText; nu-l re-emitem.
      return { text: allText, costUsd: totalCost, model: served, rounds: round }
    }

    // Mesajul asistentului care CERE uneltele (păstrează tool_calls pentru legătură).
    convo.push({ role: 'assistant', content: res.text ?? '', tool_calls: res.toolCalls })
    // Execută fiecare unealtă și adaugă rezultatul ca mesaj role:'tool'.
    for (const call of res.toolCalls as OrToolCall[]) {
      if (!passive.has(call.function.name)) anyActionToolCalled = true
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
