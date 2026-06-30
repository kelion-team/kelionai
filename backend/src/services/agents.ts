import Anthropic from '@anthropic-ai/sdk'
import { config } from '../config.js'
import { getMemories, addMemory } from '../db.js'

// Kelion's brain is a small set of cooperating agents (see routes/chat.ts):
//   1. Router      — classifies each turn so deep reasoning is used only when it
//                    helps (keeps simple/voice turns instant).
//   2. Conversation— the Opus persona that talks (the main streamed response).
//   3. Reasoning   — Opus extended thinking, switched on for COMPLEX turns.
//   4. Skills      — the tool-use loop (Google, web, maps…).
//   5. Memory      — recalls what Kelion knows about the user, and learns +
//                    saves new durable facts after each turn.
// This module hosts the Router and Memory agents (cheap Haiku work); the
// Conversation/Reasoning/Skills agents live in the chat route's streaming loop.

const HAIKU = 'claude-haiku-4-5-20251001'

// ── Router agent ──────────────────────────────────────────────────────────
// Instant, deterministic complexity gate. A serial LLM classifier on every turn
// would add latency to the realtime voice path; this catches the cases where
// deep reasoning earns its cost (analysis, multi-step problems, planning, math).
const COMPLEX = new RegExp(
  [
    'de ce', 'explic', 'analiz', 'compar', 'demonstr', 'calcul', 'rezolv',
    'strateg', 'pas cu pas', 'argument', 'pro (si|și) contra', 'planuie',
    'why', 'explain', 'analyz', 'compare', 'prove', 'calculate', 'reason',
    'step by step', 'design', 'architect', 'trade-?off', 'debug', 'optimi',
  ].join('|'),
  'i',
)

export function routeComplexity(text: string): 'simple' | 'complex' {
  if (text.length > 320) return 'complex'
  return COMPLEX.test(text) ? 'complex' : 'simple'
}

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
