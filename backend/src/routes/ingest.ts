import type { FastifyInstance } from 'fastify'
import { getSessionUser } from '../session.js'
import { documentToMarkdown } from '../services/markitdown.js'

// Accept an uploaded document (base64) and return its Markdown text, so the
// frontend can attach a PDF / Word / Excel / PowerPoint the user shares and let
// Kelion read it. Auth-gated; size-capped to what the body limit allows.
export async function ingestRoutes(app: FastifyInstance): Promise<void> {
  // P13 (owner, 15 aug: „trebuie sa-i maresti spatiu de incarcare in chat").
  // MĂSURAT: ruta stătea pe bodyLimit-ul GLOBAL de 25MB (index.ts) — cu
  // umflarea base64 (4/3), un fișier de ~18MB umplea țeava; frontend-ul
  // oglindea cinstit limita și refuza. Limita proprie urcă la 100MB (ca
  // /api/chat) — capul REAL rămâne Cloudflare (100MB pe cerere); globalul de
  // 25MB rămâne neschimbat pentru restul rutelor.
  app.post<{ Body: { filename?: string; data?: string } }>('/api/ingest', {
    bodyLimit: 100_000_000,
  }, async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    const raw = req.body?.data
    if (!raw || typeof raw !== 'string') return reply.code(400).send({ error: 'no_file' })
    try {
      const b64 = raw.includes(',') ? raw.slice(raw.indexOf(',') + 1) : raw
      const bytes = Buffer.from(b64, 'base64')
      if (bytes.length < 8) return reply.code(400).send({ error: 'empty_file' })
      const markdown = await documentToMarkdown(bytes, req.body?.filename ?? 'file')
      // Cap what we return / feed to the model so a huge doc can't blow the prompt.
      return reply.send({ markdown: markdown.slice(0, 120_000) })
    } catch (e) {
      return reply
        .code(502)
        .send({ error: 'convert_failed', message: e instanceof Error ? e.message.slice(0, 200) : 'failed' })
    }
  })
}
