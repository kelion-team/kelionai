import { describe, it, expect } from 'vitest'
import { fetchRecentInbox, isAutomated, htmlToText, parseIncomingEmail } from './mailbox.js'

describe('Mailbox service', () => {
  it('spune DE CE nu poate citi când mailul nu e configurat (nu „cutie goală")', async () => {
    // MAIL_PASS is unset in the test environment, so mailEnabled() is false.
    // ACTUALIZAT (auditul admin, 3 aug): vechiul [] strivea „goală" / „IMAP
    // picat" / „neconfigurat" într-o singură stare — acum răspunsul poartă
    // ok/motiv, iar UI-ul desenează trei texte diferite.
    const r = await fetchRecentInbox(10)
    expect(r.ok).toBe(false)
    expect(r.motiv).toBe('mail_neconfigurat')
    expect(r.emails).toEqual([])
  })

  it('does not treat X-Auto-Response-Suppress as automated mail', () => {
    // Exchange users set this header on OUTGOING mail to suppress auto-replies
    // at the recipient. It must NOT cause legitimate customer emails to be
    // silently dropped from the admin Inbox.
    const headers = new Map<string, unknown>([['x-auto-response-suppress', 'OOF']])
    expect(isAutomated(headers, 'customer@example.com')).toBe(false)
  })

  it('still drops real machine mail', () => {
    expect(isAutomated(new Map(), 'noreply@example.com')).toBe(true)
    expect(isAutomated(new Map(), 'mailer-daemon@example.com')).toBe(true)
    expect(isAutomated(new Map([['auto-submitted', 'auto-generated']]), 'a@b.com')).toBe(true)
    expect(isAutomated(new Map([['precedence', 'bulk']]), 'a@b.com')).toBe(true)
    expect(isAutomated(new Map([['list-id', '<list.example.com>']]), 'a@b.com')).toBe(true)
    expect(isAutomated(new Map([['x-autoreply', 'yes']]), 'a@b.com')).toBe(true)
  })

  it('parses MIME metadata, headers and multipart bodies with bounded postal-mime', async () => {
    const source = Buffer.from(
      [
        'From: Client Test <client@example.com>',
        'To: contact@example.com',
        'Subject: MIME contract',
        'Date: Tue, 18 Aug 2026 01:00:00 +0000',
        'Auto-Submitted: auto-generated',
        'MIME-Version: 1.0',
        'Content-Type: multipart/alternative; boundary="kelion-audit"',
        '',
        '--kelion-audit',
        'Content-Type: text/plain; charset=utf-8',
        '',
        'PROBA_MAIL_TEXT_OK',
        '--kelion-audit',
        'Content-Type: text/html; charset=utf-8',
        '',
        '<p>PROBA_MAIL_HTML_OK</p>',
        '--kelion-audit--',
      ].join('\r\n'),
    )

    const parsed = await parseIncomingEmail(source)
    expect(parsed.fromAddr).toBe('client@example.com')
    expect(parsed.fromName).toBe('Client Test')
    expect(parsed.subject).toBe('MIME contract')
    expect(parsed.body).toContain('PROBA_MAIL_TEXT_OK')
    expect(parsed.headers.get('auto-submitted')).toBe('auto-generated')
    expect(parsed.receivedAt?.toISOString()).toBe('2026-08-18T01:00:00.000Z')
    expect(isAutomated(parsed.headers, parsed.fromAddr)).toBe(true)
  })

  it('converts HTML-only bodies to readable plain text', () => {
    expect(htmlToText('<p>Hello <b>world</b></p><br>Next line')).toBe('Hello world\n\nNext line')
    expect(htmlToText('  <div>Spaces &nbsp; stay</div>  ')).toBe('Spaces   stay')
    expect(htmlToText('&lt;tag&gt; &amp; "quote"')).toBe('<tag> & "quote"')
  })
})
