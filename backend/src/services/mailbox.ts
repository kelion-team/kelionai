// row 19 live
import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import { config } from '../config.js'
import { mailEnabled, sendMail, royalLetterHtml, makeRef, letterDate } from './mail.js'
import { brainComplete } from './brain.js'
import { saveInboundEmail, setInboundReplied, knownInboundUids } from '../db.js'
import { detectLang, langLabel } from './lang.js'

// MAILBOX ORGANIZATION (Adrian, Jul 25: "it should organize the emails").
// After processing a message, Kelion MOVES it into a dedicated IMAP folder, so
// the inbox stays clean and the admin can see at a glance what got answered,
// what waits for a manual reply and what is machine mail. ASCII names, no
// spaces/diacritics, so they don't clash with the server's hierarchy/UTF-7
// delimiters. Reversible (can be moved back anytime) and instantly off via env
// if the owner doesn't want it.
const ORGANIZE = (process.env.MAIL_ORGANIZE ?? '1') !== '0'
const FOLDER_ANSWERED = 'Kelion-Answered' // client we auto-replied to
const FOLDER_MANUAL = 'Kelion-ToAnswer' // real human, but we couldn't reply → you
const FOLDER_AUTO = 'Kelion-Automated' // machine mail (bounces, alerts, lists)

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
  // The delimiters also include the hyphen (Jul 25): `billing-alert@`,
  // `system-notification@` slipped past the guard (only [.@+] was accepted) and
  // got a client letter.
  if (/(^|[.@+_-])(no-?reply|do-?not-?reply|mailer-daemon|postmaster|bounce|notifications?|alerts?)([.@+_-]|$)/.test(f)) {
    return true
  }
  const auto = String(headers.get('auto-submitted') ?? '').toLowerCase()
  if (auto && auto !== 'no') return true // RFC 3834 out-of-office / auto-generated
  const prec = String(headers.get('precedence') ?? '').toLowerCase()
  if (prec === 'bulk' || prec === 'auto_reply' || prec === 'list' || prec === 'junk') return true
  if (headers.has('list-id') || headers.has('list-unsubscribe')) return true // mailing list
  if (headers.has('x-autoreply') || headers.has('x-autorespond')) return true
  // NOTE: X-Auto-Response-Suppress is set by the SENDER (e.g. Exchange) to tell
  // recipients NOT to auto-reply; it does NOT mean this incoming message is
  // automated. Treating it as machine mail silently dropped legitimate customer
  // emails, so we deliberately do NOT check it here.
  return false
}

// THE JUL 25 LOOP: the alert sent from alerts@kelionai.app landed in contact@
// and the robot replied to it like a client ("Dear client..."). We NEVER
// auto-reply to senders from our own domain or to technical addresses — only
// real humans get an auto-reply.
export function isInternalSender(from: string): boolean {
  const f = (from || '').toLowerCase()
  if (f.includes('@kelionai.app')) return true
  if (/(^|<)(alerts?|no-?reply|noreply|mailer-daemon|postmaster|bounce)[@.]/.test(f)) return true
  return false
}

// Ask the Secretary (the brain, DIRECT) to draft the reply body. First line =
// the salutation ("Dear John," / "Stimate Ion,"), the rest = paragraphs. Returns
// null if the brain is unreachable — the caller then just forwards to the admin.
// `langName` = the language DETECTED from the client's message (e.g. "Romanian",
// "German"), given EXPLICITLY to the model: the reply comes out GUARANTEED in
// the received language (Adrian, Jul 25), not left to the chance of
// auto-detection in the reply body.
// `langName` = null when the local detector isn't sure about the language → the
// model identifies it itself from the message and replies in it (any language,
// not just the 7).
async function draftReply(from: string, subject: string, body: string, langName: string | null): Promise<string | null> {
  const prompt =
    'Ești Secretarul biroului Kelionai. Un client a scris la contact@kelionai.app. ' +
    // REAL FACTS (Jul 26, Adrian's test: the brain invented "travel companion
    // app" — without factual context, the model improvises what the firm is).
    // The reply uses ONLY the facts here, nothing invented about the product.
    'CE ESTE Kelionai (folosește DOAR faptele astea, nu inventa altele): un asistent AI live pe kelionai.app — ' +
    'un avatar 3D cu care vorbești prin voce sau scris, care vede prin cameră, caută pe web, ' +
    'știe hărți/vreme/Google și răspunde mereu în limba clientului. Începi simplu: intri pe kelionai.app ' +
    'și te conectezi cu contul Google. ' +
    'Redactează DOAR corpul unui răspuns politicos, cald și profesionist, ' +
    (langName
      ? `OBLIGATORIU în limba ${langName} (limba în care a scris clientul — răspunde în ACEEAȘI limbă, nu în alta). `
      : 'OBLIGATORIU în ACEEAȘI limbă în care e scris mesajul clientului de mai jos — identific-o singur din text, ORICARE ar fi (poloneză, rusă, olandeză, turcă, orice) — NICIODATĂ în altă limbă decât a clientului. ') +
    'Prima linie = salutul (ex: „Dear John," sau „Stimate domnule Ion,"). ' +
    'Apoi 1–3 paragrafe scurte, la obiect. NU adăuga antet, semnătură sau „Kelionai" — se pun automat. ' +
    'Nu inventa promisiuni pe care nu le putem ține.\n\n' +
    `De la: ${from}\nSubiect: ${subject}\n\nMesaj:\n${body.slice(0, 4000)}`
  const draft = await brainComplete(prompt, 1024)
  return draft && draft.trim() ? draft.trim() : null
}

// Creates (best-effort) the organization folders once per connection.
// "already exists" throws → we swallow it; any other error doesn't block the poll.
async function ensureFolders(client: ImapFlow): Promise<void> {
  if (!ORGANIZE) return
  for (const path of [FOLDER_ANSWERED, FOLDER_MANUAL, FOLDER_AUTO]) {
    try {
      await client.mailboxCreate(path)
    } catch {
      /* already exists — normal */
    }
  }
}

// Moves the message (by UID) from INBOX into the right folder. Best-effort: if
// the move fails, it falls back to marking it "read" so the message isn't
// reprocessed forever.
async function fileInto(
  client: ImapFlow,
  uid: number,
  dest: string,
  extraFlags: string[] = [],
): Promise<void> {
  if (extraFlags.length) {
    await client.messageFlagsAdd({ uid }, extraFlags, { uid: true }).catch(() => {})
  }
  if (!ORGANIZE) {
    await client.messageFlagsAdd({ uid }, ['\\Seen'], { uid: true }).catch(() => {})
    return
  }
  try {
    await client.messageMove({ uid }, dest, { uid: true })
  } catch (e) {
    console.error(`[mailbox] move→${dest} failed:`, (e as Error).message)
    await client.messageFlagsAdd({ uid }, ['\\Seen'], { uid: true }).catch(() => {})
  }
}

async function processOne(client: ImapFlow, uid: number, source: Buffer, _alreadySeen = false): Promise<void> {
  const parsed = await simpleParser(source)
  const fromAddr = parsed.from?.value?.[0]?.address ?? ''
  const fromName = parsed.from?.value?.[0]?.name ?? ''
  const subject = parsed.subject ?? '(fără subiect)'
  const body = (parsed.text || (parsed.html ? htmlToText(parsed.html.toString()) : '') || '').slice(0, 20000)
  if (!fromAddr) return

  // Loop guard: mark machine mail (bounces, auto-replies, lists, our own) seen
  // and drop it — replying would start an endless mail ping-pong.
  // isInternalSender covers the JUL 25 LOOP: any @kelionai.app address (e.g.
  // alerts@) is system, not a client — it NEVER gets an auto-reply and no
  // forward either (the admin already has it directly from the alert).
  if (isAutomated(parsed.headers, fromAddr) || isInternalSender(fromAddr)) {
    // Machine mail → the "Automated" folder (organization), never reply/forward.
    await fileInto(client, uid, FOLDER_AUTO)
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

  // Messages older than 7 days (the backlog left over from an outage, like the
  // Jul 24–26 one) do NOT get an auto-reply and are NOT forwarded in a burst —
  // a "welcome" arriving weeks after the message does more harm than silence.
  // They're saved to the DB (above) and go to Kelion-ToAnswer, where the admin
  // sees them and decides. FRESH mail keeps its full flow.
  const ageMs = parsed.date ? Date.now() - parsed.date.getTime() : 0
  if (ageMs > 7 * 24 * 3600_000) {
    console.log(`[mailbox] backlog vechi (>7 zile), fără auto-reply: ${subject}`)
    await fileInto(client, uid, FOLDER_MANUAL, ['\\Seen'])
    return
  }

  // We detect the language BEFORE drafting and give it EXPLICITLY to the model
  // → the reply comes out guaranteed in the received language (Adrian, Jul 25:
  // "reply in the received language"). ANY LANGUAGE (Adrian, Jul 26: "received
  // in German, is the reply in German? or any language?"): the local detector
  // knows only 7 languages for sure — before, anything else (Polish, Russian,
  // Dutch…) fell back to ENGLISH. Now, when the detector isn't sure, we no
  // longer force English: the brain gets the order to identify the message's
  // language itself and reply exactly in it (models recognize any language far
  // better than our word list).
  const lang = detectLang(body)
  const draft = await draftReply(fromAddr, subject, body, lang ? langLabel(lang) : null)

  // The truth for the admin (Jul 25): the forward below declared "reply sent"
  // based on the EXISTENCE of the draft, not on the sending — if SMTP failed on
  // the reply but worked on the forward, the admin falsely believed the client
  // received it.
  let replySent = false

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
    replySent = await sendMail({
      to: fromAddr,
      subject: `Re: ${subject}`,
      html,
      text: `${salutation}\n\n${letterBody}\n\n— Kelionai, Office of Correspondence`,
      replyTo: config.mail.user,
    })
    if (replySent) {
      await setInboundReplied(String(uid), draft, lang ?? 'auto')
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
      (replySent
        ? `<hr><p><b>Răspuns trimis automat de Kelion:</b></p><p style="white-space:pre-wrap">${esc(draft ?? '')}</p>`
        : '<hr><p><i>NU s-a trimis răspuns automat (creier indisponibil sau eșec la trimitere) — răspunde tu.</i></p>'),
    text: `De la: ${fromName} <${fromAddr}>\nSubiect: ${subject}\n\n${body}\n\n---\n${replySent ? draft : '(fără răspuns automat — răspunde tu)'}`,
  })

  // ORGANIZATION (Adrian, Jul 25): we move the message into the right folder,
  // so the inbox stays clean and the admin sees each message's state at a glance:
  //  • automatic reply sent → "Kelion-Answered" (+ \Answered flag, IMAP semantics)
  //  • real human without a reply (brain down / SMTP failed) → "Kelion-ToAnswer" (you)
  // `alreadySeen` no longer matters for the move — the message leaves INBOX
  // anyway; fileInto marks \Seen only in the fallback (when the move fails).
  if (replySent) {
    await fileInto(client, uid, FOLDER_ANSWERED, ['\\Seen', '\\Answered'])
  } else {
    await fileInto(client, uid, FOLDER_MANUAL, ['\\Seen'])
  }
}

// The IMAP client configured from env (host/port/secure/auth). It used to be
// copied identically in poll() and fetchRecentInbox() — a single source (the
// permanent principle: unique, no duplicates).
function newImapClient(): ImapFlow {
  return new ImapFlow({
    host: config.mail.imapHost,
    port: config.mail.imapPort,
    secure: true,
    auth: { user: config.mail.user, pass: config.mail.pass },
    logger: false,
  })
}

async function poll(): Promise<void> {
  if (!mailEnabled() || running) return
  running = true
  const client = newImapClient()
  try {
    await client.connect()
    const lock = await client.getMailboxLock('INBOX')
    try {
      // ROW 19, rewritten Jul 26 (the "Socket timeout" outage). The old version
      // downloaded the FULL BODY of the last 100 messages on EVERY poll (fetch
      // with {source:true} on an interval); on an inbox of hundreds of messages
      // the transfer exceeded the imapflow socket timeout → "Socket timeout" +
      // "poll failed: Connection not available" on EVERY cycle and not a single
      // mail ever processed (direct login worked instantly — only the massive
      // fetch died). Now: first ONLY the UIDs (a cheap command), we compare
      // them with what's already in the DB and download the body ONLY for new
      // messages — usually 0–2 per cycle. Dedupe stays on UID in the DB, read
      // messages stay untouched (no flag changes), exactly as before.
      const uids = await client.search({ all: true }, { uid: true })
      if (uids && Array.isArray(uids) && uids.length > 0) {
        uids.sort((a, b) => b - a)
        const recent = uids.slice(0, 100)
        const known = await knownInboundUids(recent.map(String))
        const fresh = recent.filter((u) => !known.has(String(u)))
        // Safety net after a long outage: at most 25 messages per cycle (the
        // rest, on the next cycles) — an accumulated backlog must not trigger
        // dozens of replies and forwards at once.
        const batch = fresh.slice(0, 25)
        if (fresh.length > batch.length) {
          console.log(`[mailbox] backlog: ${fresh.length} mesaje neprocesate, iau ${batch.length} acum`)
        }
        if (batch.length > 0) {
          // Separate fix, found at the same test: ensureFolders existed but was
          // NEVER called anywhere → the organization folders never got created
          // and every move fell to the fallback. We call it when we actually
          // have something to move.
          await ensureFolders(client)
          batch.sort((a, b) => a - b) // we process chronologically
          for (const uid of batch) {
            try {
              const msg = await client.fetchOne(String(uid), { source: true, flags: true }, { uid: true })
              if (msg && msg.source) {
                await processOne(client, uid, msg.source, msg.flags?.has('\\Seen') ?? false)
              }
            } catch (e) {
              console.error('[mailbox] one failed:', (e as Error).message)
            }
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

// LIVE INBOX (Adrian, Jul 10: "I see an empty Inbox although the mailbox has
// 493 messages"). Historical cause: the poller (row 19) read ONLY UNREAD mail
// and marked it read; mail already read (in Outlook) appeared nowhere. This
// reads the REAL mailbox through IMAP — the last `limit` messages, regardless
// of read/unread — ONLY for display in the admin. It marks NOTHING read
// (fetches only envelope + flags, not the body) and replies to NOTHING. Opens
// a short connection, on demand.
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

// AUDIT ADMIN (3 aug, Inbox): [] însemna și „cutia e goală", și „IMAP a picat",
// și „MAIL_PASS lipsește" — trei stări strivite într-un singur gol, iar UI-ul
// afișa un text ambiguu. Acum răspunsul spune CE s-a măsurat: `ok:false` +
// `motiv` ('mail_neconfigurat' sau mesajul erorii IMAP) = citire eșuată;
// `ok:true` + emails [] = cutia INBOX chiar e goală.
export interface InboxLiveResult {
  ok: boolean
  motiv: string | null
  emails: InboxLiveItem[]
}

export async function fetchRecentInbox(limit = 40): Promise<InboxLiveResult> {
  if (!mailEnabled()) return { ok: false, motiv: 'mail_neconfigurat', emails: [] }
  const client = newImapClient()
  const out: InboxLiveItem[] = []
  try {
    await client.connect()
    const lock = await client.getMailboxLock('INBOX')
    try {
      const mb = client.mailbox
      const total = mb ? mb.exists : 0
      if (total > 0) {
        // UID SEARCH + UID FETCH: we figure out EXACTLY which are the last
        // `limit` messages (the highest UIDs), then fetch only those. This
        // avoids the sequence-number-vs-UID confusion and we don't read the
        // whole inbox.
        const uids = await client.search({ all: true }, { uid: true })
        if (!uids || !Array.isArray(uids)) return { ok: true, motiv: null, emails: out }
        uids.sort((a, b) => b - a)
        const wantedUids = new Set(uids.slice(0, limit))
        if (wantedUids.size > 0) {
          const min = Math.min(...wantedUids)
          const max = Math.max(...wantedUids)
          // uid: true → the query is a UID range, not a sequence number.
          for await (const msg of client.fetch(`${min}:${max}`, { envelope: true, flags: true }, { uid: true })) {
            // Fallback: some servers may send messages without a UID on this
            // query; we skip them, we can't process/dedupe without a stable UID.
            if (!msg.uid || !wantedUids.has(msg.uid)) continue
            const f = msg.envelope?.from?.[0]
            const rawDate = msg.envelope?.date
            out.push({
              uid: msg.uid,
              from: f?.address ?? '',
              fromName: f?.name ?? '',
              subject: msg.envelope?.subject ?? '(fără subiect)',
              // We validate the envelope date; an empty or invalid string would give `Invalid Date`.
              date: isValidEnvelopeDate(rawDate) ? new Date(rawDate).toISOString() : new Date().toISOString(),
              seen: msg.flags?.has('\\Seen') ?? false,
            })
          }
          // Sort descending by UID (newest first) — slice correctly.
          out.sort((a, b) => b.uid - a.uid)
        }
      }
    } finally {
      lock.release()
    }
  } catch (e) {
    console.error('[mailbox] live fetch failed:', (e as Error).message)
    // Citirea a PICAT — nu o servim drept cutie goală (regula #1).
    return { ok: false, motiv: (e as Error).message, emails: out }
  } finally {
    try {
      await client.logout()
    } catch {
      /* ignore */
    }
  }
  return { ok: true, motiv: null, emails: out }
}

// ── ȘTERGEREA DIN INBOX (Adrian, 3 aug: „posibilitate să șterg de aici câte
// una sau prin selecție toate") ──────────────────────────────────────────────
// Ștergem pe UID-uri EXACTE (cele afișate în panou), niciodată „tot inboxul":
// întâi încercăm mutarea în coșul REAL al serverului (folderul cu special-use
// \Trash, descoperit la conexiune — recuperabil de acolo), și doar dacă serverul
// n-are coș cădem pe ștergerea IMAP directă (\Deleted + expunge). Întoarcem
// câte s-au șters DE FAPT — cifra vine din operațiile reușite, nu din cerere.
export async function deleteInboxMessages(uids: number[]): Promise<{ sterse: number; detaliu: string }> {
  const curate = [...new Set(uids)].filter((u) => Number.isInteger(u) && u > 0)
  if (!mailEnabled()) return { sterse: 0, detaliu: 'mail neconfigurat (MAIL_PASS lipsă)' }
  if (!curate.length) return { sterse: 0, detaliu: 'niciun UID valid' }
  const client = newImapClient()
  let sterse = 0
  let detaliu = ''
  try {
    await client.connect()
    // Coșul real al serverului, dacă există (ex: "Trash", "Deleted Items").
    let trash: string | null = null
    try {
      const foldere = await client.list()
      trash = foldere.find((f) => f.specialUse === '\\Trash')?.path ?? null
    } catch {
      trash = null
    }
    const lock = await client.getMailboxLock('INBOX')
    try {
      for (const uid of curate) {
        try {
          if (trash) await client.messageMove({ uid }, trash, { uid: true })
          else await client.messageDelete({ uid }, { uid: true })
          sterse++
        } catch (e) {
          console.error(`[mailbox] ștergere uid=${uid} a picat:`, (e as Error).message)
        }
      }
      detaliu = trash ? `mutate în coșul serverului („${trash}")` : 'șterse definitiv (serverul n-are coș)'
    } finally {
      lock.release()
    }
  } catch (e) {
    return { sterse, detaliu: `conexiunea IMAP a picat: ${(e as Error).message}` }
  } finally {
    try {
      await client.logout()
    } catch {
      /* ignore */
    }
  }
  return { sterse, detaliu }
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
