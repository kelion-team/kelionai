import {
  openrouterChat,
  openrouterChatStream,
  type AnthropicTool,
  type OrMessage,
  type OrToolCall,
} from './openrouter.js'

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
}

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

  for (let round = 1; round <= maxRounds; round++) {
    // Cu onText → streaming (primul cuvânt instant, ca pe vechiul creier). Fără →
    // apel simplu (ex: agenți în fundal care nu difuzează).
    const res = opts.onText
      ? await openrouterChatStream(model, convo, tools, opts.onText, {
          maxTokens: opts.maxTokens,
          temperature: opts.temperature,
          reasoning: opts.reasoning,
        })
      : await openrouterChat(model, convo, tools, {
          maxTokens: opts.maxTokens,
          temperature: opts.temperature,
          reasoning: opts.reasoning,
        })
    totalCost += res.costUsd
    served = res.model
    if (res.text) allText = allText ? `${allText}\n${res.text}` : res.text

    if (res.toolCalls.length === 0) {
      // La streaming textul a curs deja prin onText; nu-l re-emitem.
      return { text: allText, costUsd: totalCost, model: served, rounds: round }
    }

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
