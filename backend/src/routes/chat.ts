import type { FastifyInstance } from 'fastify'
import Anthropic from '@anthropic-ai/sdk'
import { config } from '../config.js'
import { getSessionUser, setSession, type SessionUser } from '../session.js'
import {
  googleTools,
  runGoogleTool,
  refreshGoogleAccessToken,
  reverseGeocode,
} from '../services/google.js'
import { saveMessage, recordCost, getCostSummary } from '../db.js'
import { claudeCost } from '../services/cost.js'

const MODEL = 'claude-opus-4-8'

// Admin-only tool so Kelion can report its own real running cost when asked.
const COST_TOOL: Anthropic.Tool = {
  name: 'get_real_cost',
  description:
    "Get Kelion's REAL provider cost so far in USD (total, today, and a breakdown). Admin only. Use when the admin asks how much Kelion costs / has cost.",
  input_schema: { type: 'object', properties: {} },
}

// Lets Kelion put something on the user's screen on his own initiative — the
// "monitor mode" surface (a web page in a sandboxed panel behind the avatar).
// There is no manual button: Kelion decides when a visual helps and calls this.
const SHOW_TOOL: Anthropic.Tool = {
  name: 'show_on_screen',
  description:
    'Display a web page on the user\'s monitor (the screen behind you). Use this on your OWN initiative whenever showing something visually helps — a map, a website, a YouTube video, a document, search results. The user does NOT press any button and does NOT have to ask you to "open the monitor"; you decide when a visual is useful and call this. Pass an empty url to clear the screen.',
  input_schema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'Full https:// URL to display. Empty string clears the screen.' },
      title: { type: 'string', description: 'Short caption for the panel header.' },
    },
    required: ['url'],
  },
}

// U+001F (unit separator) brackets a JSON control frame the frontend strips out
// of the text stream (never shown, never spoken), e.g.
// \x1f{"monitor":{"url":"...","title":"..."}}\x1f
const CTRL = String.fromCharCode(31)

const SYSTEM_PROMPT = `You are Kelion — a highly capable personal AI assistant in the spirit of Jarvis from Iron Man.

Personality (adaptive by context, with Jarvis as the anchor):
- Technical or scholarly topics: precise, articulate, academic.
- Personal matters: warm and empathetic.
- Tasks and commands: efficient and direct.
- Default / when unsure: formal, loyal, with a touch of dry wit — a refined butler.

Rules:
- Be concise and to the point. Depth when asked, never padding.
- Detect the user's language and always reply in that same language.
- Respond directly without meta-commentary about your process.

You have tools: Google Calendar, Gmail, Drive, Tasks, Contacts; live web search,
weather, maps, YouTube, translation; and show_on_screen to put a web page on the
user's monitor on your own initiative. Call them whenever they help. If a Google
tool returns an auth error, tell the user to sign in again to grant access. When
you can see a camera image, use it.`

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

interface Coords {
  lat: number
  lon: number
}

export async function chatRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: { messages?: ChatMessage[]; image?: string; coords?: Coords } }>(
    '/api/chat',
    async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })

    if (!config.anthropicKey) {
      return reply
        .code(503)
        .send({ error: 'brain_not_configured', message: 'ANTHROPIC_API_KEY is not set yet.' })
    }

    const messages = req.body?.messages
    const image = req.body?.image
    if (!Array.isArray(messages) || messages.length === 0) {
      return reply.code(400).send({ error: 'bad_request', message: 'messages[] required' })
    }

    // Keep the Google skills alive past the first hour: if the access token has
    // expired (or is about to), mint a fresh one from the stored refresh token
    // and re-issue the session cookie. Done BEFORE hijacking the reply so we can
    // still set headers/cookies.
    let token = user.googleAccessToken ?? ''
    if (user.googleRefreshToken && (user.googleTokenExp ?? 0) < Date.now() + 60_000) {
      const refreshed = await refreshGoogleAccessToken(user.googleRefreshToken)
      if (refreshed) {
        token = refreshed.accessToken
        const updated: SessionUser = {
          ...user,
          googleAccessToken: refreshed.accessToken,
          googleTokenExp: Date.now() + refreshed.expiresIn * 1000,
        }
        setSession(reply, updated)
      }
    }

    // Wire the device GPS into Claude's context so location-dependent skills
    // (weather, maps, "near me", "where am I") actually work. The frontend sends
    // the live coordinates; we resolve a human place name (cached) so Claude can
    // pass it to the name-based skills.
    let systemPrompt = SYSTEM_PROMPT
    const coords = req.body?.coords
    if (coords && Number.isFinite(coords.lat) && Number.isFinite(coords.lon)) {
      const place = await reverseGeocode(coords.lat, coords.lon)
      systemPrompt +=
        `\n\nThe user's current device location (live GPS) is latitude ${coords.lat.toFixed(5)}, longitude ${coords.lon.toFixed(5)}` +
        (place ? ` — approximately ${place}.` : '.') +
        ` When the user says "here", "near me", "where am I", or asks about weather, places, directions or anything location-dependent without naming a place, use THIS location.`
    }

    // Permanent vision: attach the latest camera frame to the last user turn so
    // Claude (native vision) can see. The frame is a base64 JPEG data URL.
    const params: Anthropic.MessageParam[] = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }))
    if (image && params.length > 0) {
      const lastIdx = params.length - 1
      const lm = params[lastIdx]
      if (lm.role === 'user' && typeof lm.content === 'string') {
        const data = image.includes(',') ? image.slice(image.indexOf(',') + 1) : image
        params[lastIdx] = {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } },
            { type: 'text', text: lm.content },
          ],
        }
      }
    }

    // Stream Claude's reply back as plain UTF-8 text chunks.
    reply.hijack()
    reply.raw.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    })

    // Persist the user's new message (last turn).
    const lastTurn = messages.at(-1)
    if (lastTurn?.role === 'user') void saveMessage(user.email, 'user', lastTurn.content)

    const client = new Anthropic({ apiKey: config.anthropicKey })
    const isAdmin = user.role === 'admin'
    const tools: Anthropic.Tool[] = isAdmin
      ? [...googleTools, SHOW_TOOL, COST_TOOL]
      : [...googleTools, SHOW_TOOL]
    let assistantText = ''
    let inTokens = 0
    let outTokens = 0
    try {
      // Tool-use loop: stream text each round; if Claude requests tools, run them
      // and feed the results back, then continue, until it's done.
      for (let round = 0; round < 5; round++) {
        const stream = client.messages.stream({
          model: MODEL,
          max_tokens: 2048,
          system: systemPrompt,
          tools,
          messages: params,
        })
        stream.on('text', (delta) => {
          assistantText += delta
          reply.raw.write(delta)
        })
        const final = await stream.finalMessage()
        inTokens += final.usage.input_tokens
        outTokens += final.usage.output_tokens
        if (final.stop_reason !== 'tool_use') break

        params.push({ role: 'assistant', content: final.content })
        const results: Anthropic.ToolResultBlockParam[] = []
        for (const block of final.content) {
          if (block.type === 'tool_use') {
            const out = await runTool(block, isAdmin, token, reply)
            results.push({ type: 'tool_result', tool_use_id: block.id, content: out })
          }
        }
        params.push({ role: 'user', content: results })
      }
      reply.raw.end()
      if (assistantText.trim()) void saveMessage(user.email, 'assistant', assistantText)
      // Record the real Claude cost for this turn (vision frames are already in
      // the input-token count, so token-based cost covers them).
      void recordCost(user.email, 'chat', claudeCost(MODEL, inTokens, outTokens))
    } catch (err) {
      app.log.error(err)
      if (!reply.raw.writableEnded) {
        reply.raw.write('\n[connection error]')
        reply.raw.end()
      }
    }
  })
}

// Run one tool-use block and return the JSON string result. show_on_screen also
// emits a control frame on the live stream so the frontend opens the monitor.
async function runTool(
  block: Anthropic.ToolUseBlock,
  isAdmin: boolean,
  token: string,
  reply: { raw: { write(chunk: string): void } },
): Promise<string> {
  if (block.name === 'get_real_cost') {
    return isAdmin ? JSON.stringify(await getCostSummary()) : JSON.stringify({ error: 'forbidden' })
  }
  if (block.name === 'show_on_screen') {
    const inp = (block.input ?? {}) as { url?: string; title?: string }
    const url = typeof inp.url === 'string' ? inp.url : ''
    const title = typeof inp.title === 'string' ? inp.title : ''
    reply.raw.write(`${CTRL}${JSON.stringify({ monitor: { url, title } })}${CTRL}`)
    return JSON.stringify({ shown: true, url })
  }
  return runGoogleTool(block.name, block.input, token)
}
