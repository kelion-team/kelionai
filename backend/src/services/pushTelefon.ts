import webpush from 'web-push'
import { getPool, dbEnabled } from '../db.js'
import { config } from '../config.js'
import { esteAdminKelion } from './adminIdentity.js'
import { replaceControlCharacters } from '../shared/textSanitization.js'

export interface AbonarePush {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

function baza64UrlCanonica(raw: unknown, bytes: number): string | null {
  if (typeof raw !== 'string' || !/^[A-Za-z0-9_-]+$/.test(raw)) return null
  try {
    const decoded = Buffer.from(raw, 'base64url')
    return decoded.length === bytes && decoded.toString('base64url') === raw ? raw : null
  } catch {
    return null
  }
}

export function normalizeazaEndpointPush(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length < 12 || raw.length > 2_048) return null
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) return null
    const host = url.hostname.toLowerCase()
    const permis = config.push.endpointHosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))
    return permis ? url.toString() : null
  } catch {
    return null
  }
}

export function normalizeazaAbonarePush(abonare: unknown): AbonarePush | null {
  if (!abonare || typeof abonare !== 'object') return null
  const value = abonare as Partial<AbonarePush>
  const endpoint = normalizeazaEndpointPush(value.endpoint)
  const p256dh = baza64UrlCanonica(value.keys?.p256dh, 65)
  const auth = baza64UrlCanonica(value.keys?.auth, 16)
  if (!endpoint || !p256dh || !auth) return null
  const publicPoint = Buffer.from(p256dh, 'base64url')
  if (publicPoint[0] !== 4) return null
  return { endpoint, keys: { p256dh, auth } }
}

function pushDisponibil(): boolean {
  return config.push.enabled && Boolean(config.push.publicKey && config.push.privateKey && config.push.endpointHosts.length)
}

/** Public application-server key. Push remains fail-closed until deployment
 * mounts the VAPID private key and supplies an explicit endpoint allowlist. */
export async function cheiePublicaPush(): Promise<string | null> {
  return pushDisponibil() ? config.push.publicKey : null
}

/** Stores only a validated subscription belonging to the configured Google
 * admin. An advisory lock makes the per-account quota deterministic even when
 * two browsers subscribe concurrently. */
export async function aboneazaPush(email: string, abonare: AbonarePush): Promise<boolean> {
  const owner = email.trim().toLowerCase()
  const validata = normalizeazaAbonarePush(abonare)
  if (!pushDisponibil() || !dbEnabled() || !esteAdminKelion(owner) || !validata) return false
  try {
    const result = await getPool().query<{ endpoint: string }>(
      `WITH locked AS MATERIALIZED (
         SELECT pg_advisory_xact_lock(hashtextextended($1, 0))
       ), quota AS (
         SELECT count(*)::int AS total,
                bool_or(endpoint=$2) AS already_owned
         FROM push_subscriptions, locked
         WHERE email=$1
       )
       INSERT INTO push_subscriptions (endpoint, email, p256dh, auth)
       SELECT $2,$1,$3,$4 FROM quota
       WHERE coalesce(already_owned, false) OR total < $5
       ON CONFLICT (endpoint) DO UPDATE
         SET p256dh=EXCLUDED.p256dh, auth=EXCLUDED.auth
         WHERE push_subscriptions.email=EXCLUDED.email
       RETURNING endpoint`,
      [owner, validata.endpoint, validata.keys.p256dh, validata.keys.auth, config.push.maxSubscriptions],
    )
    return Boolean(result.rows[0])
  } catch {
    return false
  }
}

/** Consent withdrawal is idempotent and can affect only the current admin's
 * endpoint. A successful query is success even when the row was already gone. */
export async function dezaboneazaPush(email: string, rawEndpoint: string): Promise<boolean> {
  const owner = email.trim().toLowerCase()
  const endpoint = normalizeazaEndpointPush(rawEndpoint)
  if (!pushDisponibil() || !dbEnabled() || !esteAdminKelion(owner) || !endpoint) return false
  try {
    await getPool().query(
      'DELETE FROM push_subscriptions WHERE endpoint=$1 AND email=$2',
      [endpoint, owner],
    )
    return true
  } catch {
    return false
  }
}

function textNotificare(raw: unknown, max: number): string {
  return replaceControlCharacters(String(raw ?? ''), ' ').trim().slice(0, max)
}

function payloadNotificare(raw: Record<string, unknown> | undefined): Record<string, string | number | boolean | null> {
  const safe: Record<string, string | number | boolean | null> = {}
  for (const [key, value] of Object.entries(raw ?? {}).slice(0, 12)) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(key)) continue
    if (key === 'url') {
      const path = typeof value === 'string' ? value : ''
      if (/^\/[A-Za-z0-9/_-]{0,300}$/.test(path)) safe.url = path
      continue
    }
    if (typeof value === 'string') safe[key] = textNotificare(value, 300)
    else if (typeof value === 'boolean' || value === null) safe[key] = value
    else if (typeof value === 'number' && Number.isFinite(value)) safe[key] = value
  }
  return safe
}

/** Sends a bounded notification only to validated subscriptions of the
 * configured admin. Provider failures are counted as failures; dead endpoints
 * are removed with the same owner constraint. */
export async function trimitePushAdmin(
  titlu: string,
  mesaj: string,
  payload?: Record<string, unknown>,
): Promise<number> {
  if (!pushDisponibil() || !dbEnabled() || !config.adminEmail) return 0
  const title = textNotificare(titlu, 80)
  const body = textNotificare(mesaj, 240)
  if (!title || !body) return 0
  try {
    const result = await getPool().query<{ endpoint: string; p256dh: string; auth: string }>(
      'SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE email=$1',
      [config.adminEmail],
    )
    let delivered = 0
    for (const row of result.rows.slice(0, config.push.maxSubscriptions)) {
      const subscription = normalizeazaAbonarePush({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } })
      if (!subscription) continue
      try {
        await webpush.sendNotification(
          subscription,
          JSON.stringify({ titlu: title, mesaj: body, ...payloadNotificare(payload) }),
          {
            vapidDetails: {
              subject: `mailto:${config.product.supportEmail}`,
              publicKey: config.push.publicKey,
              privateKey: config.push.privateKey,
            },
            TTL: 300,
          },
        )
        delivered++
      } catch (error) {
        const status = (error as { statusCode?: number })?.statusCode
        if (status === 404 || status === 410) {
          await getPool()
            .query('DELETE FROM push_subscriptions WHERE endpoint=$1 AND email=$2', [subscription.endpoint, config.adminEmail])
            .catch(() => undefined)
        }
      }
    }
    return delivered
  } catch {
    return 0
  }
}
