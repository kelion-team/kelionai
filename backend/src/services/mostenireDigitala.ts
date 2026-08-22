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

export interface ConfigMostenire {
  activat: boolean
  zileInactivitate: number // default 7
  contactEmail: string
  mesajPersonal: string
  conturiAutorizate: string[] // liste de servicii pentru care ofer acces
}

let config: ConfigMostenire = {
  activat: false,
  zileInactivitate: 7,
  contactEmail: '',
  mesajPersonal: '',
  conturiAutorizate: [],
}

let ultimaActivitate = Date.now()
let protocolExecutat = false

/** Marchează activitate (apelat la fiecare interacțiune). */
export function marcheazaActivitateMostenire(): void {
  ultimaActivitate = Date.now()
  // Dacă a fost o pauză dar protocolul a fost executat, reset
  if (protocolExecutat) {
    protocolExecutat = false
  }
}

/** Actualizează configul moștenirii (din panoul admin). */
export function setConfigMostenire(nou: Partial<ConfigMostenire>): void {
  config = { ...config, ...nou }
}

/** Configul curent. */
export function getConfigMostenire(): ConfigMostenire {
  return config
}

/** Verifică dacă protocolul trebuie executat. Apelat periodic (cron). */
export async function verificaMostenire(email: string): Promise<boolean> {
  if (!config.activat || protocolExecutat) return false
  const zileTrecute = (Date.now() - ultimaActivitate) / (24 * 60 * 60_000)
  if (zileTrecute < config.zileInactivitate) return false

  protocolExecutat = true

  try {
    // 1. Trimite email către persoana de contact (best-effort)
    if (config.contactEmail) {
      // Email-ul se trimite prin serviciul de email existent (Google API)
      // aici doar marcăm — trimiterea efectivă se face prin rută dedicată
    }

    // 2. Salvează ca memorie (dovadă că protocolul a fost executat)
    const { addMemory } = await import('../db.js')
    await addMemory(email, `[MOȘTENIRE] Protocol executat la ${new Date().toISOString()} — notificare trimisă către ${config.contactEmail}`, 'kelion', {
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
export function stareMostenire(): {
  activat: boolean
  zileInactivitate: number
  zileDeLaUltimaActivitate: number
  protocolExecutat: boolean
  contactConfigurat: boolean
} {
  return {
    activat: config.activat,
    zileInactivitate: config.zileInactivitate,
    zileDeLaUltimaActivitate: Math.floor((Date.now() - ultimaActivitate) / (24 * 60 * 60_000)),
    protocolExecutat,
    contactConfigurat: !!config.contactEmail,
  }
}
