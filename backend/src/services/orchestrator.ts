import {
  openrouterChat,
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

  for (let round = 1; round <= maxRounds; round++) {
    const res = await openrouterChat(model, convo, tools, {
      maxTokens: opts.maxTokens,
      temperature: opts.temperature,
    })
    totalCost += res.costUsd
    served = res.model

    if (res.toolCalls.length === 0) {
      if (res.text) opts.onText?.(res.text)
      return { text: res.text, costUsd: totalCost, model: served, rounds: round }
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
  return { text: '', costUsd: totalCost, model: served, rounds: maxRounds }
}
