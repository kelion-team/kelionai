import type { FastifyInstance } from 'fastify'
import Anthropic from '@anthropic-ai/sdk'
import { config } from '../config.js'
import { getSessionUser } from '../session.js'

const SYSTEM_PROMPT = `You are Kelion — a highly capable personal AI assistant in the spirit of Jarvis from Iron Man.

Personality (adaptive by context, with Jarvis as the anchor):
- Technical or scholarly topics: precise, articulate, academic.
- Personal matters: warm and empathetic.
- Tasks and commands: efficient and direct.
- Default / when unsure: formal, loyal, with a touch of dry wit — a refined butler.

Rules:
- Be concise and to the point. Depth when asked, never padding.
- Detect the user's language and always reply in that same language.
- Respond directly without meta-commentary about your process.`

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export async function chatRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: { messages?: ChatMessage[]; image?: string } }>(
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

    const client = new Anthropic({ apiKey: config.anthropicKey })
    try {
      const stream = client.messages.stream({
        model: 'claude-opus-4-8',
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      })
      stream.on('text', (delta) => {
        reply.raw.write(delta)
      })
      await stream.finalMessage()
      reply.raw.end()
    } catch (err) {
      app.log.error(err)
      if (!reply.raw.writableEnded) {
        reply.raw.write('\n[connection error]')
        reply.raw.end()
      }
    }
  })
}
