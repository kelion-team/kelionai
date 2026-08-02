import type { TextBlock } from './brain-types.js'
import { config } from '../config.js'
import { getMemories, searchMemories, semanticMemories, addMemory, recordCost } from '../db.js'
import { brainCostUsd } from './cost.js'
import { brain } from './brain.js'

// Memory runs on the default chat model (OpenRouter). Kimi/GLM removed.
const MEMORY_MODEL = config.openrouter.chatDefault

export async function recallMemories(email: string, agent = 'kelion', hint = ''): Promise<string> {
  const recent = await getMemories(email, 40, agent)
  let mems = recent
  if (hint.trim()) {
    const words = [...new Set(hint.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? [])]
    const [relevant, semantic] = await Promise.all([
      searchMemories(email, agent, words, 12),
      semanticMemories(email, agent, hint, 8),
    ])
    const seen = new Set(recent.map((m) => m.content))
    mems = [...recent]
    for (const m of [...relevant, ...semantic]) {
      if (!seen.has(m.content)) {
        seen.add(m.content)
        mems.push(m)
      }
    }
  }
  if (mems.length === 0) return ''
  const lines = mems.map((m) => `- ${m.content}`).join('\n')
  return (
    `\n\nWhat you already know about this user from earlier conversations. ` +
    `Use it naturally to stay continuous, and when the user asks about one of ` +
    `these facts, answer with it directly — just never volunteer recitations of ` +
    `this list unprompted:\n${lines}`
  )
}

export async function learnFromTurn(
  email: string,
  userMsg: string,
  assistantMsg: string,
  agent = 'kelion',
): Promise<void> {
  if (!config.openrouter.key || (!userMsg.trim() && !assistantMsg.trim())) return
  const explicit = userMsg.match(
    /(?:re[țt]ine(?:\s+pentru\s+viitor)?|[țt]ine\s+minte|nu\s+uita|memoreaz[ăa]|remember(?:\s+this|\s+that)?|keep\s+in\s+mind)[:,]?\s+(.{6,300})/i,
  )
  if (explicit?.[1]) await addMemory(email, explicit[1].trim(), agent)
  try {
    const existing = await getMemories(email, 80, agent)
    const known = existing.map((m) => m.content).join('\n') || '(nothing yet)'
    const res = await brain.messages.create({
      model: MEMORY_MODEL,
      max_tokens: 400,
      system:
        'You maintain long-term memory about ONE user for a personal assistant. ' +
        'From the latest exchange, extract only DURABLE, reusable facts about the ' +
        'user — identity, stable preferences, relationships, ongoing projects, ' +
        'recurring context. Ignore ephemeral/one-off details and anything already ' +
        "known. Write each fact in the USER'S OWN language (the language they " +
        'speak in the exchange), so their own words can find it again later. ' +
        'EXCEPTION to "already known": if the user EXPLICITLY asks to remember ' +
        'something ("remember this", "reține", "ține minte"), ALWAYS output that ' +
        'fact even if it is already known — restating refreshes it. Output ONLY a ' +
        'JSON array of short factual strings about the user ' +
        '(e.g. ["Locuiește în Witney, UK","Prefers concise answers"]). Output [] ' +
        'if there is nothing new and nothing explicitly asked to be remembered.',
      messages: [
        {
          role: 'user',
          content:
            `Already known about the user:\n${known}\n\n` +
            `Latest exchange:\nUser: ${userMsg}\nAssistant: ${assistantMsg}`,
        },
      ],
    })
    // REAL COST FIRST (the owner's rule: "show real, stop fabricating"): the
    // adapter returns the provider's own `usage.cost` for the call that
    // answered — booked as 'memory', a MEASUREMENT (db.ts COSTURI_MASURATE).
    // Only when the provider didn't itemize it do we estimate, and then under
    // a different kind ('memory_est') so the ledger never mixes the two.
    if (typeof res.costUsd === 'number' && res.costUsd > 0) {
      void recordCost(email, 'memory', res.costUsd)
    } else {
      const est = await brainCostUsd(res.model || MEMORY_MODEL, res.usage.input_tokens, res.usage.output_tokens).catch(() => null)
      if (est && est.usd > 0) void recordCost(email, 'memory_est', est.usd)
    }
    const text = res.content
      .filter((b): b is TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
    for (const fact of parseFacts(text).slice(0, 6)) await addMemory(email, fact, agent)
  } catch {
    // Memory is best-effort — a failure must never affect the conversation.
  }
}

function parseFacts(text: string): string[] {
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start === -1 || end <= start) return []
  try {
    const arr = JSON.parse(text.slice(start, end + 1)) as unknown
    if (!Array.isArray(arr)) return []
    return arr
      .filter((x): x is string => typeof x === 'string')
      .map((s) => s.trim())
      .filter((s) => s.length > 2 && s.length < 240)
  } catch {
    return []
  }
}
