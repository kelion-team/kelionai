import { config } from '../config.js'
import { dbEnabled, getPool } from '../db.js'
import { verifyKeys } from './brain.js'
import { mailEnabled, smtpTransport } from './mail.js'
import { getSerperBalance } from './serperBalance.js'
import { ImapFlow } from 'imapflow'

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

// 1. The brain — Gemini direct, unic (OpenRouter/OpenAI extirpate, 3 aug).
// Un ping REAL prin exact drumul creierului (verifyKeys → geminiDirectChat),
// nu doar prezența cheii — aia o verifică separat checkGemini.
async function checkBrainKeys(): Promise<TokenCheck[]> {
  try {
    const v = await timed(20_000, () => verifyKeys())
    return [
      {
        name: 'Creierul Gemini (chat direct)',
        status: v.primary === 'ok' ? 'ok' : (v.primary === 'not_configured' ? 'not_configured' : (v.primary.startsWith('fail_') ? (v.primary as `fail_${number}`) : 'fail')),
        detail: v.primary === 'ok' ? 'ping prin drumul creierului OK' : v.primary,
        requiredScope: 'Generative Language API (cheia GEMINI_API_KEY)',
      },
    ]
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return [
      { name: 'Creierul Gemini (chat direct)', status: 'fail', detail: msg, requiredScope: 'Generative Language API (cheia GEMINI_API_KEY)' },
    ]
  }
}

// 2. Payments — the Revolut link (collection) + the Enable Banking keys
// (reading transactions, for automatic crediting with a unique code)
function checkPlati(): TokenCheck[] {
  const link: TokenCheck = config.revolut.payLink
    ? { name: 'Revolut pay link', status: 'ok', detail: 'configurat', requiredScope: 'Payment link activ' }
    : { name: 'Revolut pay link', status: 'not_configured', requiredScope: 'REVOLUT_PAY_LINK în env' }
  const eb: TokenCheck =
    config.enableBanking.appId && config.enableBanking.privateKeyB64
      ? { name: 'Enable Banking (citire plăți)', status: 'ok', detail: 'appId + cheie privată prezente', requiredScope: 'AIS pe contul Revolut' }
      : { name: 'Enable Banking (citire plăți)', status: 'not_configured', requiredScope: 'ENABLE_BANKING_APP_ID + ENABLE_BANKING_PRIVATE_KEY_B64' }
  return [link, eb]
}

// 3. Google service account — used for TTS, ASR, Gemini, images
/** CHECK LIVE al contului de serviciu Google: chiar OBȚINE un access token de la
 *  Google (nu doar parsează JSON-ul). Exportat DINADINS ca becul de credit
 *  (creditAI) ȘI tabelul de token-uri să folosească ACEEAȘI măsurătoare reală —
 *  „verde" = Google a răspuns, nu „JSON-ul e valid". O cheie revocată/dezactivată
 *  parsează în continuare, dar aici PICĂ (owner, 19 aug: becul verde din JSON.parse). */
export async function contServiciuGoogleServesteLive(): Promise<{ ok: boolean; detaliu: string }> {
  if (!config.googleServiceAccountJson) return { ok: false, detaliu: 'niciun cont de serviciu configurat' }
  try {
    const { GoogleAuth } = await import('google-auth-library')
    const creds = JSON.parse(config.googleServiceAccountJson) as Record<string, unknown>
    const auth = new GoogleAuth({ credentials: creds, scopes: ['https://www.googleapis.com/auth/cloud-platform'] })
    const token = await timed(15_000, async () => (await auth.getClient()).getAccessToken())
    return token?.token
      ? { ok: true, detaliu: `client_email: ${creds.client_email ?? 'n/a'}` }
      : { ok: false, detaliu: 'nu a putut obține access token (cheie revocată/dezactivată?)' }
  } catch (e) {
    return { ok: false, detaliu: e instanceof Error ? e.message : String(e) }
  }
}

async function checkGoogleServiceAccount(): Promise<TokenCheck> {
  const scope = 'cloud-platform + generative-language'
  if (!config.googleServiceAccountJson) {
    return { name: 'Google service account', status: 'not_configured', requiredScope: scope }
  }
  const r = await contServiciuGoogleServesteLive()
  return r.ok
    ? { name: 'Google service account', status: 'ok', detail: r.detaliu, requiredScope: scope }
    : { name: 'Google service account', status: 'fail', detail: r.detaliu, requiredScope: scope }
}

// 4. Google TTS API key (fallback when there is no service account)
async function checkGoogleTtsKey(): Promise<TokenCheck> {
  // AUDIT ADMIN (3 aug): cu SA prezent, o cheie SETATĂ era raportată „⚪
  // neconfigurat" fără nicio măsurătoare — pe același ecran cu „✅
  // GOOGLE_TTS_API_KEY, N caractere" din tabelul de sus. Acum: dacă cheia
  // există o testăm ORICUM (e rezerva reală a gurii) și spunem că nu e cea
  // folosită; „neconfigurat" rămâne doar când chiar lipsește.
  if (!config.googleTtsKey) {
    return {
      name: 'Google TTS API key',
      status: 'not_configured',
      detail: config.googleServiceAccountJson ? 'lipsește (gura merge pe service account)' : undefined,
      requiredScope: 'Cloud Text-to-Speech API',
    }
  }
  const url = `https://texttospeech.googleapis.com/v1/voices?key=${config.googleTtsKey}`
  const r = await fetchStatus(url, {})
  if (r.ok) {
    return {
      name: 'Google TTS API key',
      status: 'ok',
      detail: config.googleServiceAccountJson
        ? 'validă, dar nefolosită — service account are prioritate'
        : 'voices list OK',
      requiredScope: 'Cloud Text-to-Speech API',
    }
  }
  return { name: 'Google TTS API key', status: `fail_${r.status}` as `fail_${number}`, detail: r.text.slice(0, 200), requiredScope: 'Cloud Text-to-Speech API' }
}

// 4b. Serper — SINGURUL motor de căutare al aplicației (post-extirpare, 3 aug),
// cheie plătită cu credit propriu. AUDIT ADMIN (3 aug): lipsea complet din
// „verificarea LIVE", deși comentariul rutei promite „TOATE cheile cu drepturi"
// — ownerul n-avea unde să vadă dacă SERPER_API_KEY servește sau a rămas fără
// credit. Refolosim serviciul serperBalance (citirea reală /account, cache 5m).
async function checkSerper(): Promise<TokenCheck> {
  const scope = 'google.serper.dev/account (SERPER_API_KEY)'
  try {
    const b = await timed(20_000, () => getSerperBalance())
    if (b.ok) {
      return { name: 'Serper (căutarea web)', status: 'ok', detail: `${b.balance} căutări rămase`, requiredScope: scope }
    }
    if (b.error === 'not_configured') {
      return { name: 'Serper (căutarea web)', status: 'not_configured', requiredScope: scope }
    }
    return { name: 'Serper (căutarea web)', status: 'fail', detail: b.error, requiredScope: scope }
  } catch (e) {
    return { name: 'Serper (căutarea web)', status: 'fail', detail: e instanceof Error ? e.message : String(e), requiredScope: scope }
  }
}

// (Verificarea cheii OpenAI a fost ȘTEARSĂ, 3 aug — OpenAI extirpat complet:
// vocea e Google Chirp 3, creierul e Gemini. Nu mai există nicio cheie OpenAI.)

// 5b. Google OAuth — the app's login. Only the presence of client id +
// secret (no external call: Google offers no cheap verification of the pair
// without a real flow).
function checkGoogleOAuth(): TokenCheck {
  if (!config.google.clientId || !config.google.clientSecret) {
    return { name: 'Google OAuth (login)', status: 'not_configured', requiredScope: 'OAuth 2.0 client (login + Connect Google)' }
  }
  return { name: 'Google OAuth (login)', status: 'ok', detail: 'client id + secret prezente', requiredScope: 'OAuth 2.0 client (login + Connect Google)' }
}

// 5c. PostgreSQL — the database (a real SELECT 1, not just the URL's presence)
async function checkDb(): Promise<TokenCheck> {
  if (!dbEnabled()) {
    return { name: 'PostgreSQL', status: 'not_configured', requiredScope: 'DATABASE_URL' }
  }
  try {
    await timed(15_000, () => getPool().query('SELECT 1'))
    return { name: 'PostgreSQL', status: 'ok', detail: 'SELECT 1 OK', requiredScope: 'DATABASE_URL' }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { name: 'PostgreSQL', status: 'fail', detail: msg, requiredScope: 'DATABASE_URL' }
  }
}

// 6. Gemini API key — STT proofreading, images, grounded search fallback
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
    const tx = smtpTransport()
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


// 11. Session secret — not an external token, but critical for security
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
  const [brain, googleSa, googleTts, serper, gemini, smtp, imap, db, googleOauth, session] = await Promise.all([
    checkBrainKeys(),
    checkGoogleServiceAccount(),
    checkGoogleTtsKey(),
    checkSerper(),
    checkGemini(),
    checkMailSmtp(),
    checkMailImap(),
    checkDb(),
    Promise.resolve(checkGoogleOAuth()),
    Promise.resolve(checkSessionSecret()),
  ])
  return [
    ...brain,
    ...checkPlati(),
    googleSa,
    googleTts,
    serper,
    gemini,
    smtp,
    imap,
    db,
    googleOauth,
    session,
  ]
}
