// row 19 live
import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import { config } from '../config.js'
import { mailEnabled, sendMail, royalLetterHtml, makeRef, letterDate } from './mail.js'
import { bridgeAsk } from '../routes/bridge.js'
import { saveInboundEmail, setInboundReplied } from '../db.js'
import { detectLang } from './lang.js'

// ROW 19 — the contact@ mailbox reader. Polls IMAP for new messages; for each,
// the Secretary (Linux brain, subscription) drafts a courteous reply IN THE
// SENDER'S LANGUAGE, we send it as a royal letter, forward the original + draft
// to the admin, and store everything so the admin SEES what came in and how it
// was answered. Everything is gated by mailEnabled() and best-effort — a mail
// hiccup never crashes the app.

let running = false

function esc(s: string): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// LOOP GUARD — the one thing an auto-replying mailbox must get right. We NEVER
// reply to ourselves or to a machine (bounces, out-of-office, mailing lists,
// no-reply addresses), otherwise Kelion's royal letter provokes another auto
// message and the two servers ping-pong forever. Detect it from the sender
// address and the standard auto-response headers.
function isAutomated(headers: Map<string, unknown>, fromAddr: string): boolean {
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
  if (headers.has('x-autoreply') || headers.has('x-autorespond') || headers.has('x-auto-response-suppress')) {
    return true
  }
  return false
}

// Ask the Secretary (subscription) to draft the reply body. First line = the
// salutation ("Dear John," / "Stimate Ion,"), the rest = paragraphs. Returns
// null if the bridge is offline — the caller then just forwards to the admin.
async function draftReply(from: string, subject: string, body: string): Promise<string | null> {
  const prompt =
    'Ești Secretarul biroului Kelionai. Un client a scris la contact@kelionai.app. ' +
    'Redactează DOAR corpul unui răspuns politicos, cald și profesionist, ÎN LIMBA clientului ' +
    '(detecteaz-o din mesajul lui). Prima linie = salutul (ex: „Dear John," sau „Stimate domnule Ion,"). ' +
    'Apoi 1–3 paragrafe scurte, la obiect. NU adăuga antet, semnătură sau „Kelionai" — se pun automat. ' +
    'Nu inventa promisiuni pe care nu le putem ține.\n\n' +
    `De la: ${from}\nSubiect: ${subject}\n\nMesaj:\n${body.slice(0, 4000)}`
  const draft = await bridgeAsk(prompt, [], 120_000)
  return draft && draft.trim() ? draft.trim() : null
}

async function processOne(client: ImapFlow, uid: number, source: Buffer): Promise<void> {
  const parsed = await simpleParser(source)
  const fromAddr = parsed.from?.value?.[0]?.address ?? ''
  const fromName = parsed.from?.value?.[0]?.name ?? ''
  const subject = parsed.subject ?? '(fără subiect)'
  const body = (parsed.text ?? parsed.html ?? '').toString().slice(0, 20000)
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
    await sendMail({
      to: fromAddr,
      subject: `Re: ${subject}`,
      html,
      text: `${salutation}\n\n${letterBody}\n\n— Kelionai, Office of Correspondence`,
      replyTo: config.mail.user,
    })
    await setInboundReplied(String(uid), draft, lang)
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

  // Mark seen so it isn't picked up again.
  await client.messageFlagsAdd({ uid }, ['\\Seen'], { uid: true })
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
      const uids = await client.search({ seen: false }, { uid: true })
      for (const uid of (uids || []).slice(0, 20)) {
        try {
          const msg = await client.fetchOne(String(uid), { source: true }, { uid: true })
          if (msg && msg.source) await processOne(client, uid, msg.source)
        } catch (e) {
          console.error('[mailbox] one failed:', (e as Error).message)
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

// INBOX LIVE (Adrian, 10 iul: „văd Inbox gol deși cutia are 493 mesaje"). Cauza:
// poller-ul de mai sus ia DOAR mailul NECITIT și-l marchează citit; mailul deja
// citit (în Outlook) nu apare nicăieri. Asta citește cutia REALĂ prin IMAP —
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
        const start = Math.max(1, total - limit + 1)
        // envelope + flags DOAR → nu atingem corpul, deci nu marchează citit.
        for await (const msg of client.fetch(`${start}:*`, { envelope: true, flags: true })) {
          const f = msg.envelope?.from?.[0]
          out.push({
            uid: msg.uid,
            from: f?.address ?? '',
            fromName: f?.name ?? '',
            subject: msg.envelope?.subject ?? '(fără subiect)',
            date: (msg.envelope?.date ?? new Date()).toISOString(),
            seen: msg.flags?.has('\\Seen') ?? false,
          })
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
  return out.reverse().slice(0, limit) // cele mai noi primele
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
