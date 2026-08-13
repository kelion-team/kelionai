import type { AnthropicTool, OrChatResult, OrToolCall } from './brainContract.js'

// ── CREIERUL 2 (Gemini) CA PLASĂ A CONSTRUCTORULUI — conversiile de format ───
// Owner, 13 aug: „creierul 2 nu e legat la constructor… supervizează 24/7."
// Constructorul (deploy/constructor-agent.mjs) vorbește OpenAI (chat/completions):
// unelte în format `{type:'function', function:{name, description, parameters}}`,
// răspuns `{choices:[{message:{content, tool_calls}}]}`. Creierul aplicației
// (geminiDirectChat) vorbește formatul casei (AnthropicTool + OrChatResult). Aici
// stau CELE DOUĂ punți, PURE și testabile: intră formatul constructorului, iese
// formatul creierului, și invers — ca „legătura" să poată fi PROBATĂ, nu crezută.

/** Uneltele constructorului (OpenAI function) → formatul cerut de geminiDirectChat. */
export function uneltePentruCreier2(toolsRaw: unknown[]): AnthropicTool[] {
  if (!Array.isArray(toolsRaw)) return []
  return toolsRaw
    .map((t) => {
      const f = (t as { function?: { name?: string; description?: string; parameters?: Record<string, unknown> } })
        .function
      if (!f?.name) return null
      return {
        name: f.name,
        description: f.description ?? '',
        input_schema: f.parameters ?? { type: 'object', properties: {} },
      }
    })
    .filter((t): t is AnthropicTool => t !== null)
}

/** Răspunsul creierului (OrChatResult) → formatul OpenAI pe care-l așteaptă
 *  constructorul, IDENTIC cu ce primea de la DeepInfra — deci restul buclei nu
 *  știe că a schimbat creierul. `OrToolCall` E DEJA formatul OpenAI de tool_calls,
 *  deci se pune direct, fără conversie. */
export function raspunsCreier2(r: OrChatResult): {
  choices: { message: { role: 'assistant'; content: string; tool_calls?: OrToolCall[] } }[]
  usage: { total_tokens: number }
  modelServit: string
} {
  const message: { role: 'assistant'; content: string; tool_calls?: OrToolCall[] } = {
    role: 'assistant',
    content: r.text ?? '',
  }
  if (r.toolCalls?.length) message.tool_calls = r.toolCalls
  return {
    choices: [{ message }],
    usage: { total_tokens: (r.inputTokens ?? 0) + (r.outputTokens ?? 0) },
    modelServit: `gemini/${r.model}`,
  }
}
