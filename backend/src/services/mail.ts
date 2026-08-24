import nodemailer, { type Transporter } from 'nodemailer'
import { config } from '../config.js'

// Email for the configured support mailbox (IMAP + SMTP). The
// password lives ONLY in the deploy env (config.mail.pass) — never in code.
// mailEnabled() gates every feature so the app runs fine before it's set.

export function mailEnabled(): boolean {
  return config.mail.pass !== '' && config.mail.user !== ''
}

// SMTP transport configured from env. Exported: tokenChecks.ts had it copied
// for the connection check — a single source (the permanent principle: unique, no dups).
export function smtpTransport(): Transporter {
  return nodemailer.createTransport({
    host: config.mail.smtpHost,
    port: config.mail.smtpPort,
    secure: config.mail.smtpPort === 465, // 465 = implicit TLS
    auth: { user: config.mail.user, pass: config.mail.pass },
  })
}

let transporter: Transporter | null = null
function tx(): Transporter {
  if (!transporter) transporter = smtpTransport()
  return transporter
}

export interface OutMail {
  to: string
  subject: string
  html: string
  text?: string
  replyTo?: string
}

export async function sendMail(m: OutMail): Promise<boolean> {
  if (!mailEnabled()) return false
  try {
    await tx().sendMail({
      from: `Kelionai <${config.mail.user}>`,
      to: m.to,
      subject: m.subject,
      html: m.html,
      text: m.text,
      replyTo: m.replyTo,
    })
    return true
  } catch (e) {
    console.error('[mail] send failed:', (e as Error).message)
    return false
  }
}

function esc(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// A unique, elegant reference for a piece of correspondence: KA-YEAR-NNNN.
export function makeRef(): string {
  const y = new Date().getFullYear()
  const n = Math.floor(1000 + Math.random() * 9000)
  return `KA-${y}-${n}`
}

// The date in an English long form ("3rd July 2026") — the letter's own header.
export function letterDate(d = new Date()): string {
  const day = d.getDate()
  const suffix =
    day % 10 === 1 && day !== 11
      ? 'st'
      : day % 10 === 2 && day !== 12
        ? 'nd'
        : day % 10 === 3 && day !== 13
          ? 'rd'
          : 'th'
  const month = d.toLocaleString('en-GB', { month: 'long' })
  return `${day}${suffix} ${month} ${d.getFullYear()}`
}

export interface RoyalLetter {
  ref: string
  date: string
  salutation: string // "Dear Mr Whitfield," (already localised by the caller)
  body: string // paragraphs separated by \n\n, in the recipient's language
  department?: string // "On behalf of the Office of Correspondence"
}

// The royal-letter email — the FIXED chrome (crest, KELIONAI, gold rules, seal,
// signature "Kelionai" in a cursive hand) wrapping the VARIABLE fields (ref,
// date, salutation, body). Inline styles + table layout so it renders in email
// clients. The signature uses a cursive font stack that degrades gracefully.
export function royalLetterHtml(l: RoyalLetter): string {
  const gold = '#b08d3f'
  const ink = '#1c2740'
  const dept = esc(l.department || 'On behalf of the Office of Correspondence')
  const paras = l.body
    .split(/\n{2,}/)
    .map(
      (p) =>
        `<p style="font-family:Georgia,'Times New Roman',serif;font-size:16px;line-height:1.9;color:#1a1a24;margin:0 0 16px;">${esc(
          p,
        )}</p>`,
    )
    .join('')
  return `<div style="background:#f4f1ea;padding:24px;">
  <div style="max-width:640px;margin:0 auto;background:#fffdf8;border:1px solid #e6e0d2;border-radius:4px;padding:40px 44px;font-family:Georgia,'Times New Roman',serif;">
    <div style="text-align:center;">
      <div style="display:inline-block;width:58px;height:58px;line-height:56px;border:1.5px solid ${gold};border-radius:50%;color:${gold};font-size:24px;">K</div>
      <div style="font-size:22px;letter-spacing:6px;color:#1a1a24;margin-top:10px;">KELIONAI</div>
      <div style="font-size:11px;letter-spacing:3px;color:#6b6a64;margin-top:4px;">OFFICE OF CORRESPONDENCE</div>
      <div style="width:120px;height:1px;background:${gold};margin:14px auto 0;"></div>
    </div>
    <table width="100%" style="margin:22px 0 18px;font-size:13px;color:#6b6a64;"><tr>
      <td align="left">Ref. ${esc(l.ref)}</td>
      <td align="right">${esc(l.date)}</td>
    </tr></table>
    <p style="font-family:Georgia,serif;font-size:16px;line-height:1.85;color:#1a1a24;margin:0 0 16px;">${esc(
      l.salutation,
    )}</p>
    ${paras}
    <p style="font-family:Georgia,serif;font-size:16px;line-height:1.85;color:#1a1a24;margin:20px 0 2px;">We have the honour to remain,</p>
    <p style="font-family:Georgia,serif;font-size:16px;line-height:1.85;color:#1a1a24;margin:0 0 6px;">Your most obedient servant,</p>
    <div style="font-family:'Great Vibes','Segoe Script','Brush Script MT',cursive;font-size:40px;color:${ink};line-height:1;margin:6px 0 2px;">Kelionai</div>
    <div style="font-size:12.5px;color:#6b6a64;">${dept}</div>
    <div style="font-size:12.5px;color:#6b6a64;">${esc(config.product.supportEmail)}</div>
  </div>
</div>`
}
