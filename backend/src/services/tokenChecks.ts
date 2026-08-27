import { config } from '../config.js'
import { dbEnabled, getPool } from '../db.js'
import { verifyKeys } from './brain.js'
import { mailEnabled, smtpTransport } from './mail.js'
import { getSerperBalance } from './serperBalance.js'
import { getConstructorChainStatus, type ConstructorChainLeg } from './constructorChainStatus.js'
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

// 1. Creierul unic OpenAI — ping real prin aceeași cale Responses ca chatul.
async function checkBrainKeys(): Promise<TokenCheck[]> {
  try {
    const v = await timed(20_000, () => verifyKeys())
    return [
      {
        name: 'Creierul OpenAI (Responses)',
        status: v.primary === 'ok' ? 'ok' : (v.primary === 'not_configured' ? 'not_configured' : (v.primary.startsWith('fail_') ? (v.primary as `fail_${number}`) : 'fail')),
        detail: v.primary === 'ok' ? 'ping prin drumul creierului OK' : v.primary,
        requiredScope: 'OpenAI Responses API (OPENAI_API_KEY)',
      },
    ]
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return [
      { name: 'Creierul OpenAI (Responses)', status: 'fail', detail: msg, requiredScope: 'OpenAI Responses API (OPENAI_API_KEY)' },
    ]
  }
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


// Session-domain secret — visitor handles and stable safety identifiers.
function checkSessionSecret(): TokenCheck {
  if (!config.sessionSecret) {
    return { name: 'SESSION_SECRET', status: 'not_configured', requiredScope: 'HMAC intern; cookie-ul de sesiune rămâne opac' }
  }
  if (config.sessionSecret.length < 32) {
    return { name: 'SESSION_SECRET', status: 'fail', detail: 'prea scurt (< 32 caractere)', requiredScope: 'Semnare cookie-uri sesiune' }
  }
  return { name: 'SESSION_SECRET', status: 'ok', detail: `lungime ${config.sessionSecret.length}`, requiredScope: 'HMAC intern; cookie-ul de sesiune rămâne opac' }
}

function checkGoogleTokenEncryption(): TokenCheck {
  const length = config.googleTokenEncryptionKey.length
  if (length < 32) return { name: 'GOOGLE_TOKEN_ENCRYPTION_KEY', status: 'fail', detail: 'lipsește sau este prea scurt', requiredScope: 'criptare OAuth la repaus' }
  return { name: 'GOOGLE_TOKEN_ENCRYPTION_KEY', status: 'ok', detail: `lungime ${length}`, requiredScope: 'criptare OAuth la repaus' }
}

async function checkGitHubReleaseOAuth(fetcher: typeof fetch = fetch): Promise<TokenCheck> {
  const scope = 'GitHub repo exact: Pull requests write; Checks/Actions/Contents/Administration read'
  const token = config.githubReleaseOAuthToken
  const repository = config.githubRepo
  if (!token || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    return { name: 'GitHub OAuth (Admin release)', status: 'not_configured', requiredScope: scope }
  }
  const headers = {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${token}`,
    'x-github-api-version': '2022-11-28',
  }
  const request = async (path: string): Promise<Response> => {
    const response = await timed(10_000, () => fetcher(`https://api.github.com${path}`, {
      headers,
      signal: AbortSignal.timeout(10_000),
    }))
    if (!response.ok) throw new Error(`github_http_${response.status}`)
    return response
  }
  try {
    const [userResponse, repoResponse] = await Promise.all([
      request('/user'),
      request(`/repos/${repository}`),
    ])
    const user = await userResponse.json() as { id?: unknown; login?: unknown }
    const repo = await repoResponse.json() as {
      full_name?: unknown
      permissions?: { push?: unknown; maintain?: unknown; admin?: unknown }
    }
    const login = String(user.login ?? '')
    const userId = Number(user.id)
    if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(login) || !Number.isSafeInteger(userId) || userId <= 0) {
      throw new Error('github_identity_invalid')
    }
    if (String(repo.full_name ?? '').toLowerCase() !== repository.toLowerCase()
      || !(repo.permissions?.push === true || repo.permissions?.maintain === true || repo.permissions?.admin === true)) {
      throw new Error('github_repo_write_role_missing')
    }
    const encodedLogin = encodeURIComponent(login)
    const probes = await Promise.all([
      request(`/repos/${repository}/collaborators/${encodedLogin}/permission`),
      request(`/repos/${repository}/branches/master/protection`),
      request(`/repos/${repository}/actions/workflows/pr-verify.yml`),
      request(`/repos/${repository}/contents/.github/workflows/pr-verify.yml?ref=master`),
      request(`/repos/${repository}/commits/master/check-runs?per_page=1`),
      request(`/repos/${repository}/pulls?state=open&per_page=1`),
    ])
    const permission = await probes[0].json() as { permission?: unknown; user?: { id?: unknown; login?: unknown } }
    if (Number(permission.user?.id) !== userId
      || String(permission.user?.login ?? '').toLowerCase() !== login.toLowerCase()
      || !['write', 'maintain', 'admin'].includes(String(permission.permission ?? ''))) {
      throw new Error('github_repo_permission_mismatch')
    }
    return {
      name: 'GitHub OAuth (Admin release)',
      status: 'ok',
      detail: 'repo, rol write+, protecție, Actions, Contents, Checks și PR răspund live',
      requiredScope: scope,
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    const statusCode = detail.match(/^github_http_(\d{3})$/)?.[1]
    return {
      name: 'GitHub OAuth (Admin release)',
      status: statusCode ? `fail_${Number(statusCode)}` : 'fail',
      detail,
      requiredScope: scope,
    }
  }
}

function constructorLegCheck(name: string, secretName: string, leg: ConstructorChainLeg): TokenCheck {
  const requiredScope = `${secretName} distinct (minimum 32 caractere) + heartbeat persistent sub 5 minute`
  const detail = `${leg.state}${leg.lastHeartbeat ? ` · heartbeat ${leg.lastHeartbeat}` : ''}`
  if (leg.state === 'setup_required') return { name, status: 'not_configured', detail, requiredScope }
  if (leg.state === 'ready' || leg.state === 'busy') return { name, status: 'ok', detail, requiredScope }
  return { name, status: 'fail', detail, requiredScope }
}

async function checkConstructorIdentities(): Promise<TokenCheck[]> {
  try {
    const chain = await timed(10_000, () => getConstructorChainStatus())
    return [
      constructorLegCheck('Constructor worker (HMAC + heartbeat)', 'CODEX_WORKER_SECRET_FILE', chain.legs.worker),
      constructorLegCheck('Constructor publisher (HMAC + heartbeat)', 'CONSTRUCTOR_PUBLISHER_SECRET_FILE', chain.legs.publisher),
      constructorLegCheck('Constructor release (HMAC + heartbeat)', 'CONSTRUCTOR_RELEASE_SECRET_FILE', chain.legs.release),
    ]
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return [
      { name: 'Constructor worker (HMAC + heartbeat)', status: 'fail', detail, requiredScope: 'CODEX_WORKER_SECRET_FILE + heartbeat persistent' },
      { name: 'Constructor publisher (HMAC + heartbeat)', status: 'fail', detail, requiredScope: 'CONSTRUCTOR_PUBLISHER_SECRET_FILE + heartbeat persistent' },
      { name: 'Constructor release (HMAC + heartbeat)', status: 'fail', detail, requiredScope: 'CONSTRUCTOR_RELEASE_SECRET_FILE + heartbeat persistent' },
    ]
  }
}

export async function runAllTokenChecks(): Promise<TokenCheck[]> {
  const [brain, serper, smtp, imap, db, googleOauth, session, googleTokenEncryption, githubRelease, constructor] = await Promise.all([
    checkBrainKeys(),
    checkSerper(),
    checkMailSmtp(),
    checkMailImap(),
    checkDb(),
    Promise.resolve(checkGoogleOAuth()),
    Promise.resolve(checkSessionSecret()),
    Promise.resolve(checkGoogleTokenEncryption()),
    checkGitHubReleaseOAuth(),
    checkConstructorIdentities(),
  ])
  return [
    ...brain,
    serper,
    smtp,
    imap,
    db,
    googleOauth,
    session,
    googleTokenEncryption,
    githubRelease,
    ...constructor,
  ]
}
