import Anthropic from '@anthropic-ai/sdk'
import { config } from '../config.js'
import { getMemories, addMemory, recordCost } from '../db.js'
import { claudeCost } from './cost.js'

// Kelion's brain: the Conversation + Skills (tool-use) agents run in the chat
// route's streaming loop (low-latency Opus); this module hosts the Memory agent
// — it recalls what Kelion knows about the user and, after each turn, learns +
// saves new durable facts (cheap Haiku, off the response path).

const HAIKU = 'claude-haiku-4-5-20251001'

// ── Memory agent (recall) ─────────────────────────────────────────────────
// Pull durable facts about the user into the system prompt so Kelion is
// continuous across sessions instead of amnesiac every time.
export async function recallMemories(email: string): Promise<string> {
  const mems = await getMemories(email, 40)
  if (mems.length === 0) return ''
  const lines = mems.map((m) => `- ${m.content}`).join('\n')
  return (
    `\n\nWhat you already know about this user from earlier conversations ` +
    `(use it naturally to stay continuous — do NOT recite it back):\n${lines}`
  )
}

// ── Memory agent (learn) ──────────────────────────────────────────────────
// After a turn, Haiku distils any NEW durable facts about the user and saves
// them. Runs off the response path (fire-and-forget) so it never adds latency.
export async function learnFromTurn(
  email: string,
  userMsg: string,
  assistantMsg: string,
): Promise<void> {
  if (!config.anthropicKey || (!userMsg.trim() && !assistantMsg.trim())) return
  try {
    const existing = await getMemories(email, 80)
    const known = existing.map((m) => m.content).join('\n') || '(nothing yet)'
    const client = new Anthropic({ apiKey: config.anthropicKey })
    const res = await client.messages.create({
      model: HAIKU,
      max_tokens: 400,
      system:
        'You maintain long-term memory about ONE user for a personal assistant. ' +
        'From the latest exchange, extract only DURABLE, reusable facts about the ' +
        'user — identity, stable preferences, relationships, ongoing projects, ' +
        'recurring context. Ignore ephemeral/one-off details and anything already ' +
        'known. Output ONLY a JSON array of short factual strings about the user ' +
        '(e.g. ["Lives in Witney, UK","Prefers concise answers"]). Output [] if ' +
        'there is nothing genuinely new and durable.',
      messages: [
        {
          role: 'user',
          content:
            `Already known about the user:\n${known}\n\n` +
            `Latest exchange:\nUser: ${userMsg}\nAssistant: ${assistantMsg}`,
        },
      ],
    })
    // Meter the Memory agent's real cost too (admin accounting completeness).
    void recordCost(email, 'memory', claudeCost(HAIKU, res.usage.input_tokens, res.usage.output_tokens))
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
    for (const fact of parseFacts(text).slice(0, 6)) await addMemory(email, fact)
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
