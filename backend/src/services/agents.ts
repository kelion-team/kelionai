import Anthropic from '@anthropic-ai/sdk'
import { config } from '../config.js'
import { getMemories, searchMemories, addMemory, recordCost } from '../db.js'
import { claudeCost } from './cost.js'
import { withAnthropicFallback } from './anthropic.js'

// Kelion's brain: the Conversation + Skills (tool-use) agents run in the chat
// route's streaming loop (low-latency Opus); this module hosts the Memory agent
// — it recalls what Kelion knows about the user and, after each turn, learns +
// saves new durable facts (cheap Haiku, off the response path).

const HAIKU = 'claude-haiku-4-5-20251001'

// ── Memory agent (recall) ─────────────────────────────────────────────────
// Pull durable facts about the user into the system prompt so Kelion is
// continuous across sessions instead of amnesiac every time.
// RECENT + RELEVANT: the latest facts, PLUS any older fact matching the words
// of the current question — so "what's my cat called?" still finds a fact
// learned hundreds of turns ago (recency alone pushed old facts out).
export async function recallMemories(email: string, agent = 'kelion', hint = ''): Promise<string> {
  const recent = await getMemories(email, 40, agent)
  let mems = recent
  if (hint.trim()) {
    const words = [...new Set(hint.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? [])]
    const relevant = await searchMemories(email, agent, words, 12)
    const seen = new Set(recent.map((m) => m.content))
    mems = [...recent, ...relevant.filter((m) => !seen.has(m.content))]
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

// ── Memory agent (learn) ──────────────────────────────────────────────────
// After a turn, Haiku distils any NEW durable facts about the user and saves
// them. Runs off the response path (fire-and-forget) so it never adds latency.
export async function learnFromTurn(
  email: string,
  userMsg: string,
  assistantMsg: string,
  agent = 'kelion',
): Promise<void> {
  if (!config.anthropicKey || (!userMsg.trim() && !assistantMsg.trim())) return
  // An EXPLICIT "remember this" is a guarantee, not a judgement call — store the
  // user's own words deterministically (upsert refreshes recency if repeated).
  // Haiku below still distils implicit facts; this path can never be skipped.
  const explicit = userMsg.match(
    /(?:re[țt]ine(?:\s+pentru\s+viitor)?|[țt]ine\s+minte|nu\s+uita|memoreaz[ăa]|remember(?:\s+this|\s+that)?|keep\s+in\s+mind)[:,]?\s+(.{6,300})/i,
  )
  if (explicit?.[1]) await addMemory(email, explicit[1].trim(), agent)
  try {
    const existing = await getMemories(email, 80, agent)
    const known = existing.map((m) => m.content).join('\n') || '(nothing yet)'
    const res = await withAnthropicFallback((c) =>
      c.messages.create({
      model: HAIKU,
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
      }),
    )
    // Meter the Memory agent's real cost too (admin accounting completeness).
    void recordCost(email, 'memory', claudeCost(HAIKU, res.usage.input_tokens, res.usage.output_tokens))
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
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
