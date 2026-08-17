// NOTIFICĂRI PUSH PE TELEFON (ordinul din 14 aug: „toate aplicațiile trebuiesc"
// — a treia bifă din listă, „notificări pe telefon"). Rostul REAL: anunțurile
// santinelei („PR #X e verde — gata de merge") și restul notificărilor de admin
// să-l ajungă pe owner și când NU e pe kelionai.app — pe telefon, prin Web Push.
//
// DE CE Web Push cu VAPID și NU un cont Firebase: protocolul standard (RFC 8030/
// 8291/8292) e chiar canalul pe care browserele îl folosesc (Chrome îl duce prin
// FCM pe sub, Firefox/Safari prin ale lor) — dar cu VAPID nu trebuie NICIUN cont,
// nicio cheie de la Google, zero muncă de owner: perechea de chei se generează
// SINGURĂ la prima folosire și trăiește în kv_state. Regula casei („nu mai bag
// bani", zero pași manuali) e respectată prin construcție.
import webpush from 'web-push'
import { getPool, dbEnabled, saveKv, loadKv } from '../db.js'
import { config } from '../config.js'

const CHEIE_KV = 'push:vapid'
const SUBIECT = 'mailto:contact@kelionai.app'

interface CheiVapid {
  publicKey: string
  privateKey: string
}

let cheiInMemorie: CheiVapid | null = null

/** Perechea VAPID: generată O DATĂ, păstrată în kv_state, refolosită mereu.
 *  (O cheie nouă la fiecare boot ar invalida TOATE abonările vechi — telefonul
 *  ownerului ar „amuți" tăcut după fiecare deploy.) */
async function cheiVapid(): Promise<CheiVapid | null> {
  if (cheiInMemorie) return cheiInMemorie
  if (!dbEnabled()) return null
  try {
    const salvat = await loadKv(CHEIE_KV)
    if (salvat) {
      cheiInMemorie = JSON.parse(salvat) as CheiVapid
      return cheiInMemorie
    }
    const noi = webpush.generateVAPIDKeys()
    await saveKv(CHEIE_KV, JSON.stringify(noi))
    cheiInMemorie = noi
    return noi
  } catch {
    return null
  }
}

async function tabelAbonari(): Promise<void> {
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      endpoint TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
}

/** Cheia publică pentru browser (pushManager.subscribe). null = „nu pot" cinstit
 *  (DB oprită), niciodată o cheie inventată. */
export async function cheiePublicaPush(): Promise<string | null> {
  const chei = await cheiVapid()
  return chei?.publicKey ?? null
}

export interface AbonarePush {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

/** Înregistrează (sau reînnoiește) abonarea unui browser. Endpoint-ul e cheia:
 *  același telefon re-abonat nu naște duplicate. */
export async function aboneazaPush(email: string, abonare: AbonarePush): Promise<boolean> {
  if (!dbEnabled()) return false
  if (!abonare?.endpoint || !abonare.keys?.p256dh || !abonare.keys?.auth) return false
  try {
    await tabelAbonari()
    await getPool().query(
      `INSERT INTO push_subscriptions (endpoint, email, p256dh, auth) VALUES ($1,$2,$3,$4)
       ON CONFLICT (endpoint) DO UPDATE SET email=$2, p256dh=$3, auth=$4`,
      [abonare.endpoint, email, abonare.keys.p256dh, abonare.keys.auth],
    )
    return true
  } catch {
    return false
  }
}

/** Scoate abonarea unui browser. Doar pe a ta (email + endpoint împreună). */
export async function dezaboneazaPush(email: string, endpoint: string): Promise<boolean> {
  if (!dbEnabled() || !endpoint) return false
  try {
    await tabelAbonari()
    const r = await getPool().query(
      'DELETE FROM push_subscriptions WHERE endpoint=$1 AND email=$2',
      [endpoint, email],
    )
    return (r.rowCount ?? 0) > 0
  } catch {
    return false
  }
}

/** Trimite notificarea pe toate telefoanele ownerului. Întoarce câte au primit
 *  REAL (0 = niciun abonat sau totul a picat — cifră măsurată, nu speranță).
 *  Un endpoint mort (404/410 de la browserul care și-a șters abonarea) se
 *  curăță singur — tabelul nu adună cadavre. */
export async function trimitePushAdmin(
  titlu: string,
  mesaj: string,
  payload?: Record<string, unknown>,
): Promise<number> {
  if (!dbEnabled()) return 0
  const chei = await cheiVapid()
  if (!chei) return 0
  try {
    await tabelAbonari()
    const r = await getPool().query<{ endpoint: string; p256dh: string; auth: string }>(
      'SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE email=$1',
      [config.adminEmail],
    )
    let trimise = 0
    for (const rand of r.rows) {
      try {
        await webpush.sendNotification(
          { endpoint: rand.endpoint, keys: { p256dh: rand.p256dh, auth: rand.auth } },
          JSON.stringify({ titlu, mesaj, ...payload }),
          { vapidDetails: { subject: SUBIECT, publicKey: chei.publicKey, privateKey: chei.privateKey } },
        )
        trimise++
      } catch (e) {
        const cod = (e as { statusCode?: number })?.statusCode
        if (cod === 404 || cod === 410)
          await getPool()
            .query('DELETE FROM push_subscriptions WHERE endpoint=$1', [rand.endpoint])
            .catch(() => undefined)
      }
    }
    return trimise
  } catch {
    return 0
  }
}
