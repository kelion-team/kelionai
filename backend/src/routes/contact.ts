import type { FastifyInstance } from 'fastify'
import { config } from '../config.js'
import { saveContactMessage, marcheazaContactEmailat } from '../db.js'
import { mailEnabled, sendMail } from '../services/mail.js'
import { replaceControlCharacters } from '../shared/textSanitization.js'

const DEPARTMENTS = new Set(['General enquiry', 'Support', 'Sales', 'Press and media', 'Legal'])
const SUBMISSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function oneLine(value: unknown, max: number): string {
  return replaceControlCharacters(String(value ?? ''), ' ').replace(/\s+/g, ' ').trim().slice(0, max)
}

function html(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character] ?? character)
}

export async function contactRoutes(app: FastifyInstance): Promise<void> {
  app.post<{
    Body: {
      submissionId?: string
      department?: string
      name?: string
      email?: string
      subject?: string
      message?: string
      lang?: string
    }
  }>('/api/contact', { config: { rateLimit: { max: 6, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = req.body ?? {}
    const submissionId = String(body.submissionId ?? '').trim()
    const name = oneLine(body.name, 120)
    const email = oneLine(body.email, 200).toLowerCase()
    const subject = oneLine(body.subject, 200)
    const message = String(body.message ?? '').split(String.fromCharCode(0)).join('').trim().slice(0, 8_000)
    const requestedDepartment = oneLine(body.department, 80)
    const department = DEPARTMENTS.has(requestedDepartment) ? requestedDepartment : 'General enquiry'
    const lang = /^[a-z]{2}(?:-[a-z]{2})?$/i.test(String(body.lang ?? ''))
      ? String(body.lang).toLowerCase().slice(0, 5)
      : 'en'

    if (!SUBMISSION_ID.test(submissionId)
      || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)
      || !message) {
      return reply.code(400).send({ error: 'bad_request' })
    }

    const stored = await saveContactMessage({
      submissionId,
      name,
      email,
      subject,
      message,
      department,
      lang,
      emailed: false,
    })
    if (stored == null) return reply.code(503).send({ error: 'contact_store_unavailable' })
    if (stored.emailed) return reply.send({ ok: true, stored: true, delivered: true })

    // Never send an automatic email to the anonymous address supplied in the
    // form: without email verification that would be an outbound spam relay.
    // The durable inbox row is the authoritative receipt. Forwarding to the
    // configured internal address is optional and its result is reported exactly.
    if (!mailEnabled() || !config.mail.forwardTo) {
      return reply.send({ ok: true, stored: true, delivered: false })
    }

    const delivered = await sendMail({
      to: config.mail.forwardTo,
      subject: `[Contact · ${department}] ${subject || 'no subject'}`,
      html: `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#111">
        <h2>New contact — ${html(department)}</h2>
        <p><strong>From:</strong> ${html(name) || '(no name)'} &lt;${html(email)}&gt;</p>
        <p><strong>Language:</strong> ${html(lang)}</p>
        <p><strong>Subject:</strong> ${html(subject) || '(none)'}</p>
        <hr><p style="white-space:pre-wrap">${html(message)}</p>
      </div>`,
      replyTo: email,
    }).catch(() => false)
    if (delivered) await marcheazaContactEmailat(stored.id)
    return reply.send({ ok: true, stored: true, delivered })
  })
}
