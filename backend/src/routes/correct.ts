import type { FastifyInstance } from 'fastify'
import { config } from '../config.js'
import { getSessionUser } from '../session.js'

// Transcript validation/correction ("audio equalization in Kelion's ear"). A
// speech-to-text transcript can contain mishearings; before it reaches Claude
// we clean it with Gemini (a Google engine — keeps hearing-level language
// understanding on Google, reasoning on Claude). The frontend calls this ONLY
// when the recognizer's confidence is low (high-confidence text passes straight
// through, for latency). Returns the cleaned text, or the original on any error.

const GL_URL = 'https://generativelanguage.googleapis.com/v1beta/models'

export async function correctRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: { text?: string; context?: string; lang?: string } }>(
    '/api/correct',
    async (req, reply) => {
      const user = getSessionUser(req)
      if (!user) return reply.code(401).send({ error: 'unauthorized' })

      const text = req.body?.text?.trim()
      if (!text) return reply.code(400).send({ error: 'bad_request' })
      // No key → behave as a pass-through so the chat never breaks.
      if (!config.geminiKey) return reply.send({ text })

      const context = req.body?.context?.trim() ?? ''
      const prompt =
        'You correct speech-to-text transcripts. The text below was produced by ' +
        'automatic speech recognition and may contain mishearings (wrong/garbled ' +
        'words). Fix ONLY clear recognition errors using the conversation context; ' +
        'keep the original meaning, language and wording wherever it is already ' +
        'plausible. Do NOT answer, translate, add, or remove content. Return ONLY ' +
        'the corrected transcript, nothing else.' +
        (context ? `\n\nRecent context:\n${context}` : '') +
        `\n\nTranscript:\n${text}`

      try {
        const url = `${GL_URL}/${config.geminiModel}:generateContent`
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.geminiKey },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0, maxOutputTokens: 256 },
          }),
        })
        if (!res.ok) {
          app.log.warn({ status: res.status }, 'gemini correct failed')
          return reply.send({ text })
        }
        const j = (await res.json()) as {
          candidates?: { content?: { parts?: { text?: string }[] } }[]
        }
        const out = j.candidates?.[0]?.content?.parts?.[0]?.text?.trim()
        return reply.send({ text: out && out.length > 0 ? out : text })
      } catch (err) {
        app.log.error(err)
        return reply.send({ text }) // never break the chat
      }
    },
  )
}
