// ── #9 MOȘTENIRE DIGITALĂ (owner, 22 aug 2026: „uimește-mă") ────────────────
//
// Protocol pre-aranjat: dacă nu te conectezi N zile consecutive (configurabil),
// Kelion execută:
//   1. Notifică persoana de contact desemnată
//   2. Trimite mesajul tău pre-scris
//   3. Oferă acces la conturile pe care le-ai autorizat
//
// Ca un testament digital, dar viu — Kelion știe ce contează pentru tine.
// Configurat din panoul admin (contact + mesaj + zile + conturi).
//
// PERSISTENT: config + ultima activitate sunt în kv_state (DB). La restart
// server, nu se pierd — protocolul se declanșează corect după N zile reale.

import { saveKv, loadKv } from '../db.js'

export interface ConfigMostenire {
  activat: boolean
  zileInactivitate: number // default 7
  contactEmail: string
  mesajPersonal: string
  conturiAutorizate: string[] // liste de servicii pentru care ofer acces
}

const KV_CONFIG = 'mostenire_config'
const KV_ULTIMA_ACTIVITATE = 'mostenire_ultima_activitate'
const KV_PROTOCOL_EXECUTAT = 'mostenire_protocol_executat'

const CONFIG_DEFAULT: ConfigMostenire = {
  activat: false,
  zileInactivitate: 7,
  contactEmail: '',
  mesajPersonal: '',
  conturiAutorizate: [],
}

let configCache: ConfigMostenire = { ...CONFIG_DEFAULT }
let ultimaActivitateCache = Date.now()
let protocolExecutatCache = false
let incarcat = false

/** Încarcă starea din DB la pornire. Idempotent. */
async function incarcaDinDb(): Promise<void> {
  if (incarcat) return
  incarcat = true
  try {
    const [cfgRaw, actRaw, protRaw] = await Promise.all([
      loadKv(KV_CONFIG),
      loadKv(KV_ULTIMA_ACTIVITATE),
      loadKv(KV_PROTOCOL_EXECUTAT),
    ])
    if (cfgRaw) {
      const parsed = JSON.parse(cfgRaw) as Partial<ConfigMostenire>
      configCache = { ...CONFIG_DEFAULT, ...parsed }
    }
    if (actRaw) {
      const ts = Number(actRaw)
      if (!Number.isNaN(ts) && ts > 0) ultimaActivitateCache = ts
    }
    if (protRaw) protocolExecutatCache = protRaw === 'true'
  } catch {
    // DB indisponibil la boot — merge cu defaults, reîncearcă la următoarea scriere
  }
}

/** Marchează activitate (apelat la fiecare interacțiune). */
export async function marcheazaActivitateMostenire(): Promise<void> {
  ultimaActivitateCache = Date.now()
  // Dacă a fost o pauză dar protocolul a fost executat, reset
  if (protocolExecutatCache) {
    protocolExecutatCache = false
    await saveKv(KV_PROTOCOL_EXECUTAT, 'false').catch(() => undefined)
  }
  await saveKv(KV_ULTIMA_ACTIVITATE, String(ultimaActivitateCache)).catch(() => undefined)
}

/** Actualizează configul moștenirii (din panoul admin). Persistent. */
export async function setConfigMostenire(nou: Partial<ConfigMostenire>): Promise<void> {
  await incarcaDinDb()
  configCache = { ...configCache, ...nou }
  await saveKv(KV_CONFIG, JSON.stringify(configCache)).catch(() => undefined)
}

/** Configul curent. */
export async function getConfigMostenire(): Promise<ConfigMostenire> {
  await incarcaDinDb()
  return configCache
}

/** Verifică dacă protocolul trebuie executat. Apelat periodic (cron). */
export async function verificaMostenire(email: string): Promise<boolean> {
  await incarcaDinDb()
  if (!configCache.activat || protocolExecutatCache) return false
  const zileTrecute = (Date.now() - ultimaActivitateCache) / (24 * 60 * 60_000)
  if (zileTrecute < configCache.zileInactivitate) return false

  protocolExecutatCache = true
  await saveKv(KV_PROTOCOL_EXECUTAT, 'true').catch(() => undefined)

  try {
    // 1. Trimite email către persoana de contact — TODO: necesită serviciu de
    //    email (Google API sau SMTP). Momentan doar marcăm + salvăm dovada.
    //    NU minte — nu spune „am trimis" dacă nu am trimis.
    if (configCache.contactEmail) {
      // Email-ul NU se trimite încă — nu e implementat serviciul de email.
      // Când va fi, se va adăuga aici cu verificare reală.
    }

    // 2. Salvează ca memorie (dovadă că protocolul a fost executat)
    const { addMemory } = await import('../db.js')
    await addMemory(email, `[MOȘTENIRE] Protocol declanșat la ${new Date().toISOString()} — contact configurat: ${configCache.contactEmail || 'niciunul'}. NOTĂ: trimiterea efectivă de email NU e implementată încă.`, 'kelion', {
      tip: 'fact',
      importanta: 1.0,
      expiraInMs: 3650 * 24 * 60 * 60 * 1000, // 10 ani — permanent
    }).catch(() => undefined)
  } catch {
    // Protocolul a eșuat parțial — dar nu mai reîncercăm (protocolExecutat = true)
  }

  return true
}

/** Starea protocolului (pentru afișare în panou). */
export async function stareMostenire(): Promise<{
  activat: boolean
  zileInactivitate: number
  zileDeLaUltimaActivitate: number
  protocolExecutat: boolean
  contactConfigurat: boolean
}> {
  await incarcaDinDb()
  return {
    activat: configCache.activat,
    zileInactivitate: configCache.zileInactivitate,
    zileDeLaUltimaActivitate: Math.floor((Date.now() - ultimaActivitateCache) / (24 * 60 * 60_000)),
    protocolExecutat: protocolExecutatCache,
    contactConfigurat: !!configCache.contactEmail,
  }
}
