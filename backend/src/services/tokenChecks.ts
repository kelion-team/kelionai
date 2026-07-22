import { config } from '../config.js'
import { verifyKeys } from './brain.js'
import { getStripeBalance } from './stripe.js'
import { mailEnabled } from './mail.js'
import { ImapFlow } from 'imapflow'
import nodemailer from 'nodemailer'

export interface TokenCheck {
  name: string
  status: 'ok' | 'not_configured' | 'fail' | `fail_${number}`
  detail?: string
  requiredScope?: string
}

async function timed<T>(ms: number, fn: () => Promise<T>): Promise<T> {
  return await Promise.race([
    fn(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), ms),
    ),
  ])
}

async function fetchStatus(url: string, init: RequestInit): Promise<{ ok: boolean; status: number; text: string }> {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) })
    const text = await res.text().catch(() => '')
    return { ok: res.ok, status: res.status, text }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, status: 0, text: msg }
  }
}

// 1. Creierul — Kimi (primar) + GLM (rezervă)
async function checkBrainKeys(): Promise<TokenCheck[]> {
  try {
    const v = await timed(20_000, () => verifyKeys())
    return [
      {
        name: 'Kimi API key',
        status: v.primary === 'ok' ? 'ok' : (v.primary === 'not_configured' ? 'not_configured' : (v.primary.startsWith('fail_') ? (v.primary as `fail_${number}`) : 'fail')),
        detail: v.primary === 'ok' ? 'autentificare + credit OK' : v.primary,
        requiredScope: 'Mesaje API (coding)',
      },
      {
        name: 'GLM API key',
        status: v.reserve === 'ok' ? 'ok' : (v.reserve === 'not_configured' ? 'not_configured' : (v.reserve.startsWith('fail_') ? (v.reserve as `fail_${number}`) : 'fail')),
        detail: v.reserve === 'ok' ? 'autentificare + credit OK' : v.reserve,
        requiredScope: 'Mesaje API (format Messages)',
      },
    ]
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return [
      { name: 'Kimi API key', status: 'fail', detail: msg, requiredScope: 'Mesaje API (coding)' },
      { name: 'GLM API key', status: 'fail', detail: msg, requiredScope: 'Mesaje API (format Messages)' },
    ]
  }
}

// 2. Stripe — cheia secretă trebuie să poată citi balance
async function checkStripe(): Promise<TokenCheck> {
  if (!config.stripe.secretKey) {
    return { name: 'Stripe secret key', status: 'not_configured', requiredScope: 'Balance + Checkout' }
  }
  try {
    const balance = await timed(15_000, () => getStripeBalance())
    if (balance) {
      return { name: 'Stripe secret key', status: 'ok', detail: `balance disponibil ${balance.available} ${balance.currency}`, requiredScope: 'Balance + Checkout' }
    }
    return { name: 'Stripe secret key', status: 'fail', detail: 'getStripeBalance a returnat null', requiredScope: 'Balance + Checkout' }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { name: 'Stripe secret key', status: 'fail', detail: msg, requiredScope: 'Balance + Checkout' }
  }
}

// 3. Google service account — folosit la TTS, ASR, Gemini, imagini
async function checkGoogleServiceAccount(): Promise<TokenCheck> {
  if (!config.googleServiceAccountJson) {
    return { name: 'Google service account', status: 'not_configured', requiredScope: 'cloud-platform + generative-language' }
  }
  try {
    const { GoogleAuth } = await import('google-auth-library')
    const creds = JSON.parse(config.googleServiceAccountJson) as Record<string, unknown>
    const auth = new GoogleAuth({
      credentials: creds,
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    })
    const token = await timed(15_000, async () => (await auth.getClient()).getAccessToken())
    if (!token?.token) {
      return { name: 'Google service account', status: 'fail', detail: 'nu a putut obține access token', requiredScope: 'cloud-platform + generative-language' }
    }
    return { name: 'Google service account', status: 'ok', detail: `client_email: ${creds.client_email ?? 'n/a'}`, requiredScope: 'cloud-platform + generative-language' }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { name: 'Google service account', status: 'fail', detail: msg, requiredScope: 'cloud-platform + generative-language' }
  }
}

// 4. Google TTS API key (fallback când nu e service account)
async function checkGoogleTtsKey(): Promise<TokenCheck> {
  if (config.googleServiceAccountJson) {
    return { name: 'Google TTS API key', status: 'not_configured', detail: 'folosit service account', requiredScope: 'Cloud Text-to-Speech API' }
  }
  if (!config.googleTtsKey) {
    return { name: 'Google TTS API key', status: 'not_configured', requiredScope: 'Cloud Text-to-Speech API' }
  }
  const url = `https://texttospeech.googleapis.com/v1/voices?key=${config.googleTtsKey}`
  const r = await fetchStatus(url, {})
  if (r.ok) {
    return { name: 'Google TTS API key', status: 'ok', detail: 'voices list OK', requiredScope: 'Cloud Text-to-Speech API' }
  }
  return { name: 'Google TTS API key', status: `fail_${r.status}` as `fail_${number}`, detail: r.text.slice(0, 200), requiredScope: 'Cloud Text-to-Speech API' }
}

// 5. Serper — web search real
async function checkSerper(): Promise<TokenCheck> {
  if (!config.serperKey) {
    return { name: 'Serper API key', status: 'not_configured', requiredScope: 'Google Search API' }
  }
  const r = await fetchStatus('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'X-API-KEY': config.serperKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: 'kelionai.app', num: 1 }),
  })
  if (r.ok) {
    return { name: 'Serper API key', status: 'ok', detail: 'search OK', requiredScope: 'Google Search API' }
  }
  return { name: 'Serper API key', status: `fail_${r.status}` as `fail_${number}`, detail: r.text.slice(0, 200), requiredScope: 'Google Search API' }
}

// 6. Gemini API key — corectare STT, imagini, grounded search fallback
async function checkGemini(): Promise<TokenCheck> {
  if (!config.geminiKey) {
    return { name: 'Gemini API key', status: 'not_configured', requiredScope: 'Generative Language API' }
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.geminiModel}:generateContent?key=${config.geminiKey}`
  const r = await fetchStatus(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Say "ok" only.' }] }] }),
  })
  if (r.ok) {
    return { name: 'Gemini API key', status: 'ok', detail: 'generateContent OK', requiredScope: 'Generative Language API' }
  }
  return { name: 'Gemini API key', status: `fail_${r.status}` as `fail_${number}`, detail: r.text.slice(0, 200), requiredScope: 'Generative Language API' }
}

// 7. Mail SMTP
async function checkMailSmtp(): Promise<TokenCheck> {
  if (!mailEnabled()) {
    return { name: 'Mail SMTP', status: 'not_configured', requiredScope: 'SMTP send' }
  }
  try {
    const tx = nodemailer.createTransport({
      host: config.mail.smtpHost,
      port: config.mail.smtpPort,
      secure: config.mail.smtpPort === 465,
      auth: { user: config.mail.user, pass: config.mail.pass },
    })
    await timed(15_000, () => new Promise<void>((resolve, reject) => {
      tx.verify((err) => (err ? reject(err) : resolve()))
    }))
    return { name: 'Mail SMTP', status: 'ok', detail: `server ${config.mail.smtpHost}:${config.mail.smtpPort}`, requiredScope: 'SMTP send' }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { name: 'Mail SMTP', status: 'fail', detail: msg, requiredScope: 'SMTP send' }
  }
}

// 8. Mail IMAP
async function checkMailImap(): Promise<TokenCheck> {
  if (!mailEnabled()) {
    return { name: 'Mail IMAP', status: 'not_configured', requiredScope: 'IMAP read' }
  }
  const client = new ImapFlow({
    host: config.mail.imapHost,
    port: config.mail.imapPort,
    secure: config.mail.imapPort === 993,
    auth: { user: config.mail.user, pass: config.mail.pass },
    logger: false,
  })
  try {
    await timed(15_000, () => client.connect())
    await client.logout()
    return { name: 'Mail IMAP', status: 'ok', detail: `server ${config.mail.imapHost}:${config.mail.imapPort}`, requiredScope: 'IMAP read' }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { name: 'Mail IMAP', status: 'fail', detail: msg, requiredScope: 'IMAP read' }
  } finally {
    try { await client.logout() } catch { /* ignore */ }
  }
}

// 9. LiveKit self-hosted
async function checkLiveKit(): Promise<TokenCheck> {
  const { url, apiKey, apiSecret } = config.livekit
  if (!url || !apiKey || !apiSecret) {
    return { name: 'LiveKit API key/secret', status: 'not_configured', requiredScope: 'RoomService + token generate' }
  }
  try {
    const { RoomServiceClient } = await import('livekit-server-sdk')
    const httpHost = url.replace(/^ws:/, 'http:').replace(/^wss:/, 'https:')
    const client = new RoomServiceClient(httpHost, apiKey, apiSecret)
    await timed(15_000, () => client.listRooms())
    return { name: 'LiveKit API key/secret', status: 'ok', detail: `server ${url}`, requiredScope: 'RoomService + token generate' }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { name: 'LiveKit API key/secret', status: 'fail', detail: msg, requiredScope: 'RoomService + token generate' }
  }
}

// 10. GitHub token — folosit la PR/merge/deploy pe VPS
async function checkGithub(): Promise<TokenCheck> {
  const token = process.env.VPS_GITHUB_TOKEN ?? process.env.GITHUB_TOKEN ?? ''
  if (!token) {
    return { name: 'GitHub token', status: 'not_configured', requiredScope: 'Contents:write, Actions:write, Pull requests:write' }
  }
  const r = await fetchStatus('https://api.github.com/user', {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
  })
  if (r.ok) {
    return { name: 'GitHub token', status: 'ok', detail: 'GET /user OK', requiredScope: 'Contents:write, Actions:write, Pull requests:write' }
  }
  return { name: 'GitHub token', status: `fail_${r.status}` as `fail_${number}`, detail: r.text.slice(0, 200), requiredScope: 'Contents:write, Actions:write, Pull requests:write' }
}

// 11. Session secret — nu e token extern, dar e critic pentru securitate
function checkSessionSecret(): TokenCheck {
  if (!config.sessionSecret) {
    return { name: 'SESSION_SECRET', status: 'not_configured', requiredScope: 'Semnare cookie-uri sesiune' }
  }
  if (config.sessionSecret.length < 32) {
    return { name: 'SESSION_SECRET', status: 'fail', detail: 'prea scurt (< 32 caractere)', requiredScope: 'Semnare cookie-uri sesiune' }
  }
  return { name: 'SESSION_SECRET', status: 'ok', detail: `lungime ${config.sessionSecret.length}`, requiredScope: 'Semnare cookie-uri sesiune' }
}

export async function runAllTokenChecks(): Promise<TokenCheck[]> {
  const [brain, stripe, googleSa, googleTts, serper, gemini, smtp, imap, livekit, github, session] = await Promise.all([
    checkBrainKeys(),
    checkStripe(),
    checkGoogleServiceAccount(),
    checkGoogleTtsKey(),
    checkSerper(),
    checkGemini(),
    checkMailSmtp(),
    checkMailImap(),
    checkLiveKit(),
    checkGithub(),
    Promise.resolve(checkSessionSecret()),
  ])
  return [
    ...brain,
    stripe,
    googleSa,
    googleTts,
    serper,
    gemini,
    smtp,
    imap,
    livekit,
    github,
    session,
  ]
}
