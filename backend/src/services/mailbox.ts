// row 19 live
import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import { config } from '../config.js'
import { mailEnabled, sendMail, royalLetterHtml, makeRef, letterDate } from './mail.js'
import { brainComplete } from './brain.js'
import { saveInboundEmail, setInboundReplied } from '../db.js'
import { detectLang } from './lang.js'

// ROW 19 — the contact@ mailbox reader. Polls IMAP for new messages; for each,
// was answered. Everything is gated by mailEnabled() and best-effort — a mail
// hiccup never crashes the app.

let running = false

function esc(s: string): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Minimal HTML→plain-text fallback for HTML-only emails, so the body stored in
// inbound_emails and shown in the admin Inbox is never empty just because the
// sender used HTML without a plain-text part.
export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim()
}

// LOOP GUARD — the one thing an auto-replying mailbox must get right. We NEVER
// reply to ourselves or to a machine (bounces, out-of-office, mailing lists,
// no-reply addresses), otherwise Kelion's royal letter provokes another auto
// message and the two servers ping-pong forever. Detect it from the sender
// address and the standard auto-response headers.
export function isAutomated(headers: Map<string, unknown>, fromAddr: string): boolean {
  const f = fromAddr.toLowerCase()
  if (f === config.mail.user.toLowerCase()) return true // our own address
  if (/(^|[.@+])(no-?reply|do-?not-?reply|mailer-daemon|postmaster|bounce|notifications?)([.@+]|$)/.test(f)) {
    return true
  }
  const auto = String(headers.get('auto-submitted') ?? '').toLowerCase()
  if (auto && auto !== 'no') return true // RFC 3834 out-of-office / auto-generated
  const prec = String(headers.get('precedence') ?? '').toLowerCase()
  if (prec === 'bulk' || prec === 'auto_reply' || prec === 'list' || prec === 'junk') return true
  if (headers.has('list-id') || headers.has('list-unsubscribe')) return true // mailing list
  if (headers.has('x-autoreply') || headers.has('x-autorespond')) {
    return true
  }
  // NOTE: X-Auto-Response-Suppress is set by the SENDER (e.g. Exchange) to tell
  // recipients NOT to auto-reply; it does NOT mean this incoming message is
  // automated. Treating it as machine mail silently dropped legitimate customer
  // emails, so we deliberately do NOT check it here.
  return false
}

// Ask the Secretary (the brain, DIRECT — Kimi/GLM) to draft the reply body. First
// line = the salutation ("Dear John," / "Stimate Ion,"), the rest = paragraphs.
// Returns null if the brain is unreachable — the caller then just forwards to the
// admin. Zero external-provider dependency: Kimi/GLM direct.
async function draftReply(from: string, subject: string, body: string): Promise<string | null> {
  const prompt =
    'Ești Secretarul biroului Kelionai. Un client a scris la contact@kelionai.app. ' +
    'Redactează DOAR corpul unui răspuns politicos, cald și profesionist, ÎN LIMBA clientului ' +
    '(detecteaz-o din mesajul lui). Prima linie = salutul (ex: „Dear John," sau „Stimate domnule Ion,"). ' +
    'Apoi 1–3 paragrafe scurte, la obiect. NU adăuga antet, semnătură sau „Kelionai" — se pun automat. ' +
    'Nu inventa promisiuni pe care nu le putem ține.\n\n' +
    `De la: ${from}\nSubiect: ${subject}\n\nMesaj:\n${body.slice(0, 4000)}`
  const draft = await brainComplete(prompt, 1024)
  return draft && draft.trim() ? draft.trim() : null
}

async function processOne(client: ImapFlow, uid: number, source: Buffer, alreadySeen = false): Promise<void> {
  const parsed = await simpleParser(source)
  const fromAddr = parsed.from?.value?.[0]?.address ?? ''
  const fromName = parsed.from?.value?.[0]?.name ?? ''
  const subject = parsed.subject ?? '(fără subiect)'
  const body = (parsed.text || (parsed.html ? htmlToText(parsed.html.toString()) : '') || '').slice(0, 20000)
  if (!fromAddr) return

  // Loop guard: mark machine mail (bounces, auto-replies, lists, our own) seen
  // and drop it — replying would start an endless mail ping-pong.
  if (isAutomated(parsed.headers, fromAddr)) {
    await client.messageFlagsAdd({ uid }, ['\\Seen'], { uid: true }).catch(() => {})
    return
  }

  // Dedupe on IMAP UID — never process/reply to the same message twice.
  const isNew = await saveInboundEmail({
    uid: String(uid),
    from_addr: fromAddr,
    from_name: fromName,
    subject,
    body,
  })
  if (!isNew) return

  const draft = await draftReply(fromAddr, subject, body)
  const lang = detectLang(body) || 'en'

  if (draft) {
    // First line = salutation, the rest = the letter body.
    const nl = draft.indexOf('\n')
    const salutation = (nl === -1 ? draft : draft.slice(0, nl)).trim()
    const letterBody = (nl === -1 ? '' : draft.slice(nl + 1)).trim() || draft
    const html = royalLetterHtml({
      ref: makeRef(),
      date: letterDate(),
      salutation: salutation || 'Dear correspondent,',
      body: letterBody,
    })
    const replySent = await sendMail({
      to: fromAddr,
      subject: `Re: ${subject}`,
      html,
      text: `${salutation}\n\n${letterBody}\n\n— Kelionai, Office of Correspondence`,
      replyTo: config.mail.user,
    })
    if (replySent) {
      await setInboundReplied(String(uid), draft, lang)
    }
  }

  // Forward the original (and our reply, if any) to the admin so he always sees
  // what came in — nothing is silently swallowed.
  await sendMail({
    to: config.mail.forwardTo,
    subject: `[contact@] ${subject} — de la ${fromName || fromAddr}`,
    html:
      `<p><b>De la:</b> ${esc(fromName)} &lt;${esc(fromAddr)}&gt;<br><b>Subiect:</b> ${esc(subject)}</p>` +
      `<hr><p style="white-space:pre-wrap">${esc(body)}</p>` +
      (draft ? `<hr><p><b>Răspuns trimis automat de Kelion:</b></p><p style="white-space:pre-wrap">${esc(draft)}</p>` : '<hr><p><i>Puntea era jos — nu s-a trimis răspuns automat; răspunde tu.</i></p>'),
    text: `De la: ${fromName} <${fromAddr}>\nSubiect: ${subject}\n\n${body}\n\n---\n${draft ?? '(fără răspuns automat)'}`,
  })

  // Mark seen so it isn't picked up again, but only if it wasn't already seen
  // by another client (e.g. Outlook). Otherwise we leave the mailbox state alone.
  if (!alreadySeen) {
    await client.messageFlagsAdd({ uid }, ['\\Seen'], { uid: true })
  }
}

async function poll(): Promise<void> {
  if (!mailEnabled() || running) return
  running = true
  const client = new ImapFlow({
    host: config.mail.imapHost,
    port: config.mail.imapPort,
    secure: true,
    auth: { user: config.mail.user, pass: config.mail.pass },
    logger: false,
  })
  try {
    await client.connect()
    const lock = await client.getMailboxLock('INBOX')
    try {
      // ROW 19 fix: the old code only searched UNSEEN messages. If a human client
      // (Outlook, phone, webmail) read the message first, it became SEEN and the
      // poller never saw it again — so it was never saved, forwarded, or answered.
      // We now scan the last 100 messages regardless of Seen status and dedupe by
      // IMAP UID. Already-seen messages are left untouched (no flag change).
      const mb = client.mailbox
      const total = mb ? mb.exists : 0
      if (total > 0) {
        const start = Math.max(1, total - 99)
        for await (const msg of client.fetch(`${start}:*`, { source: true, flags: true }, { uid: true })) {
          try {
            if (msg && msg.source) {
              await processOne(client, msg.uid, msg.source, msg.flags?.has('\\Seen') ?? false)
            }
          } catch (e) {
            console.error('[mailbox] one failed:', (e as Error).message)
          }
        }
      }
    } finally {
      lock.release()
    }
  } catch (e) {
    console.error('[mailbox] poll failed:', (e as Error).message)
  } finally {
    try {
      await client.logout()
    } catch {
      /* ignore */
    }
    running = false
  }
}

// INBOX LIVE (Adrian, 10 iul: "văd Inbox gol deși cutia are 493 mesaje"). Cauza
// istorică: poller-ul (row 19) citea DOAR mailul NECITIT și-l marca citit; mailul
// deja citit (în Outlook) nu apărea nicăieri. Asta citește cutia REALĂ prin IMAP —
// ultimele `limit` mesaje, indiferent de citit/necitit — DOAR pentru afișare în
// admin. NU marchează nimic citit (aduce doar envelope + flags, nu corpul) și NU
// răspunde la nimic. Deschide o conexiune scurtă, la cerere.
export interface InboxLiveItem {
  uid: number
  from: string
  fromName: string
  subject: string
  date: string
  seen: boolean
}

function isValidEnvelopeDate(d: unknown): d is string | Date {
  if (d === null || d === undefined) return false
  const ts = new Date(d as string | number | Date).getTime()
  return !isNaN(ts)
}

export async function fetchRecentInbox(limit = 40): Promise<InboxLiveItem[]> {
  if (!mailEnabled()) return []
  const client = new ImapFlow({
    host: config.mail.imapHost,
    port: config.mail.imapPort,
    secure: true,
    auth: { user: config.mail.user, pass: config.mail.pass },
    logger: false,
  })
  const out: InboxLiveItem[] = []
  try {
    await client.connect()
    const lock = await client.getMailboxLock('INBOX')
    try {
      const mb = client.mailbox
      const total = mb ? mb.exists : 0
      if (total > 0) {
        // UID SEARCH + UID FETCH: ne dăm seama EXACT care sunt ultimele `limit`
        // mesaje (UID-urile cele mai mari), apoi le aducem doar pe acelea.
        // Așa evităm confuzia dintre număr secvență și UID și nu citim tot inboxul.
        const uids = await client.search({ all: true }, { uid: true })
        if (!uids || !Array.isArray(uids)) return out
        uids.sort((a, b) => b - a)
        const wantedUids = new Set(uids.slice(0, limit))
        if (wantedUids.size > 0) {
          const min = Math.min(...wantedUids)
          const max = Math.max(...wantedUids)
          // uid: true → query-ul este un UID range, nu număr secvență.
          for await (const msg of client.fetch(`${min}:${max}`, { envelope: true, flags: true }, { uid: true })) {
            // Fallback: unele servere pot trimite mesaje fără UID pe acest query;
            // le sărim, nu putem procesa/dedupa fără UID stabil.
            if (!msg.uid || !wantedUids.has(msg.uid)) continue
            const f = msg.envelope?.from?.[0]
            const rawDate = msg.envelope?.date
            out.push({
              uid: msg.uid,
              from: f?.address ?? '',
              fromName: f?.name ?? '',
              subject: msg.envelope?.subject ?? '(fără subiect)',
              // Validăm data envelope-ului; un string gol sau invalid ar da `Invalid Date`.
              date: isValidEnvelopeDate(rawDate) ? new Date(rawDate).toISOString() : new Date().toISOString(),
              seen: msg.flags?.has('\\Seen') ?? false,
            })
          }
          // Sort descrescător după UID (cele mai noi primele) — slice corect.
          out.sort((a, b) => b.uid - a.uid)
        }
      }
    } finally {
      lock.release()
    }
  } catch (e) {
    console.error('[mailbox] live fetch failed:', (e as Error).message)
  } finally {
    try {
      await client.logout()
    } catch {
      /* ignore */
    }
  }
  return out
}

// Start the mailbox poller. Off entirely until MAIL_PASS is set (mailEnabled()).
export function startMailbox(): void {
  if (!mailEnabled()) {
    console.log('[mailbox] disabled (no MAIL_PASS) — row 19 idle until configured')
    return
  }
  console.log('[mailbox] row 19 active — reading contact@ every 3 min')
  void poll()
  setInterval(() => void poll(), 3 * 60_000)
}
