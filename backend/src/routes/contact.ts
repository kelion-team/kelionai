import type { FastifyInstance } from 'fastify'
import { config } from '../config.js'
import {
  mailEnabled,
  sendMail,
  royalLetterHtml,
  makeRef,
  letterDate,
} from '../services/mail.js'

// Localised courtesy acknowledgement for the contact form — the sender gets an
// immediate royal-letter reply IN THEIR LANGUAGE confirming receipt, while the
// full enquiry is forwarded to the owner. Default English.
const ACK: Record<string, { hi: (n: string) => string; body: string }> = {
  en: {
    hi: (n) => `Dear ${n},`,
    body:
      'We thank you most sincerely for your message, and confirm that it has been duly received.\n\nOur office shall attend to your enquiry with the utmost care and reply to you shortly, in your own language. Should the matter require the attention of our principal, it shall be forwarded to him without delay.\n\nWe remain at your entire disposal.',
  },
  ro: {
    hi: (n) => `Stimate ${n},`,
    body:
      'Vă mulțumim din suflet pentru mesajul dumneavoastră și confirmăm că a fost primit.\n\nBiroul nostru se va ocupa de solicitarea dumneavoastră cu cea mai mare grijă și vă va răspunde în scurt timp, în limba dumneavoastră. Dacă subiectul necesită atenția conducerii, va fi transmis fără întârziere.\n\nRămânem la întreaga dumneavoastră dispoziție.',
  },
  fr: {
    hi: (n) => `Cher ${n},`,
    body:
      'Nous vous remercions très sincèrement de votre message et confirmons sa bonne réception.\n\nNotre bureau traitera votre demande avec le plus grand soin et vous répondra sous peu, dans votre langue. Si l’affaire requiert l’attention de notre direction, elle lui sera transmise sans délai.\n\nNous restons à votre entière disposition.',
  },
  es: {
    hi: (n) => `Estimado ${n},`,
    body:
      'Le agradecemos muy sinceramente su mensaje y confirmamos que ha sido recibido.\n\nNuestra oficina atenderá su consulta con el mayor cuidado y le responderá en breve, en su idioma. Si el asunto requiere la atención de nuestra dirección, se le remitirá sin demora.\n\nQuedamos a su entera disposición.',
  },
  de: {
    hi: (n) => `Sehr geehrter ${n},`,
    body:
      'Wir danken Ihnen aufrichtig für Ihre Nachricht und bestätigen deren Eingang.\n\nUnser Büro wird sich Ihrer Anfrage mit größter Sorgfalt annehmen und Ihnen in Kürze in Ihrer Sprache antworten. Sollte die Angelegenheit die Aufmerksamkeit unserer Leitung erfordern, wird sie unverzüglich weitergeleitet.\n\nWir stehen Ihnen jederzeit zur Verfügung.',
  },
}

export async function contactRoutes(app: FastifyInstance): Promise<void> {
  app.post<{
    Body: {
      department?: string
      name?: string
      email?: string
      subject?: string
      message?: string
      lang?: string
    }
  }>('/api/contact', { config: { rateLimit: { max: 6, timeWindow: '1 minute' } } }, async (req, reply) => {
    const b = req.body ?? {}
    const name = String(b.name ?? '').trim().slice(0, 120)
    const email = String(b.email ?? '').trim().slice(0, 200)
    const subject = String(b.subject ?? '').trim().slice(0, 200)
    const message = String(b.message ?? '').trim().slice(0, 8000)
    const department = String(b.department ?? 'General enquiry').trim().slice(0, 80)
    const lang = String(b.lang ?? 'en').trim().slice(0, 5).toLowerCase()

    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !message) {
      return reply.code(400).send({ error: 'bad_request', message: 'email and message required' })
    }
    if (!mailEnabled()) {
      // The form is live but the mailbox isn't wired yet — accept gracefully so
      // the UI can say "received" without falsely promising delivery.
      return reply.send({ ok: true, delivered: false })
    }

    // 1) Forward the full enquiry to the owner.
    const adminHtml = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#111;">
      <h2 style="margin:0 0 12px;">New contact — ${department}</h2>
      <p><strong>From:</strong> ${name || '(no name)'} &lt;${email}&gt;</p>
      <p><strong>Language:</strong> ${lang}</p>
      <p><strong>Subject:</strong> ${subject || '(none)'}</p>
      <hr style="border:none;border-top:1px solid #ddd;margin:12px 0;">
      <p style="white-space:pre-wrap;">${message.replace(/</g, '&lt;')}</p>
    </div>`
    void sendMail({
      to: config.mail.forwardTo,
      subject: `[Contact · ${department}] ${subject || 'no subject'}`,
      html: adminHtml,
      replyTo: email,
    })

    // 2) Send the sender a royal-letter acknowledgement in their language.
    const a = ACK[lang] ?? ACK.en
    void sendMail({
      to: email,
      subject: 'Kelionai — acknowledgement of your message',
      html: royalLetterHtml({
        ref: makeRef(),
        date: letterDate(),
        salutation: a.hi(name || 'Sir or Madam'),
        body: a.body,
        department: `On behalf of ${department}`,
      }),
    })

    return reply.send({ ok: true, delivered: true })
  })
}
