// ── O SINGURĂ VOCE ÎN TOATE TABURILE (Adrian, 4 aug: „am 2 voci... rămâne
// doar cel mai performant, pe celălalt îl scoți") ────────────────────────────
//
// Boala, măsurată din captura ownerului: DOUĂ taburi Kelionai deschise,
// amândouă cu microfonul aprins. Zăvorul vechi (BroadcastChannel din
// realtimeVoice) acoperea DOAR sesiunea live: când tabul nou o prelua, tabul
// vechi cădea pe dictarea de rezervă (alt drum, nesupravegheat) și vorbeau
// amândouă — una cu vocea bună, una cu cea robotică. Iar revenirea singură a
// vocii (4 aug) făcea ping-pong între taburi la nesfârșit.
//
// Regula de aici: tabul care PORNEȘTE ultimul vocea o ține pe TOATĂ (live,
// TTS, dictare sau sinteză de alertă); celelalte taburi se ZĂVORĂSC — nu
// pornesc nicio redare audio/voce cât timp aud inima tabului activ.
// Dacă tabul activ moare (închis, navigat), inima tace >25s (sau vine „rămas-bun"
// la închidere) și un tab zăvorât reia vocea singur. Apăsarea manuală pe
// microfon ridică zăvorul oriunde prin takeover.

export interface MesajVoce {
  /** un tab a pornit vocea — celelalte se opresc și se zăvorăsc */
  takeover?: string
  /** bătaia de inimă a tabului care ține vocea (la ~10s) */
  inima?: string
  /** tabul care ținea vocea se închide — un tab zăvorât poate prelua */
  ramasBun?: string
}

/** Cât rabdă un tab zăvorât fără nicio inimă străină înainte să reia vocea. */
export const INIMA_MOARTA_MS = 25_000
/** Cât de des bate inima tabului care ține vocea. */
export const INIMA_BATE_MS = 10_000

export const CANAL_VOCE = 'kelion-voice'
export const CHEIE_TAB_ACTIV_VOCE = 'kelion_active_voice_tab'
export const CHEIE_ULTIMA_INIMA_VOCE = 'kelion_active_voice_heartbeat'

export function idTabVoce(): string {
  return `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function deschideCanalVoce(): BroadcastChannel | null {
  try {
    return new BroadcastChannel(CANAL_VOCE)
  } catch {
    return null // browser vechi — rămâne doar garda din realtimeVoice
  }
}



/** Pur (testabil): ce face un tab când sosește un mesaj pe canal.
 *  Întoarce acțiunea; efectele (opriri, porniri) le face apelantul. */
export function judecaMesajVoce(
  m: MesajVoce | null,
  eu: string,
  zavorat: boolean,
): 'zavoraste' | 'inima' | 'reia' | 'nimic' {
  if (!m) return 'nimic'
  if (m.takeover && m.takeover !== eu) return 'zavoraste'
  if (m.inima && m.inima !== eu) {
    // Dacă primim inimă de la alt tab și noi nu eram zăvorâți, înseamnă că altul e activ -> ne zăvorâm
    return zavorat ? 'inima' : 'zavoraste'
  }
  if (m.ramasBun && m.ramasBun !== eu && zavorat) return 'reia'
  return 'nimic'
}

/** Pur (testabil): un tab zăvorât reia vocea doar când inima străină a tăcut. */
export function inimaAMurit(ultimaInimaLa: number, acum: number): boolean {
  return acum - ultimaInimaLa > INIMA_MOARTA_MS
}

/** Pur (testabil): determină dacă un tab poate rosti / reda sunet pe baza stării zăvorului. */
export function potRostiVoce(eu: string, activTabId: string | null, zavorat: boolean): boolean {
  if (zavorat) return false
  if (!activTabId) return true
  return activTabId === eu
}

/** Emite mesaj de preluare voce pe tot canalul și actualizează stocarea comună */
export function emiteTakeover(bc: BroadcastChannel | null, eu: string): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(CHEIE_TAB_ACTIV_VOCE, eu)
      localStorage.setItem(CHEIE_ULTIMA_INIMA_VOCE, String(Date.now()))
    }
  } catch {
    /* ignore storage errors */
  }
  bc?.postMessage({ takeover: eu })
}

/** Emite bătaie de inimă pentru tabul activ */
export function emiteInima(bc: BroadcastChannel | null, eu: string): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(CHEIE_TAB_ACTIV_VOCE, eu)
      localStorage.setItem(CHEIE_ULTIMA_INIMA_VOCE, String(Date.now()))
    }
  } catch {
    /* ignore storage errors */
  }
  bc?.postMessage({ inima: eu })
}

/** Emite rămas bun la închiderea tabului activ */
export function emiteRamasBun(bc: BroadcastChannel | null, eu: string): void {
  try {
    if (typeof localStorage !== 'undefined') {
      if (localStorage.getItem(CHEIE_TAB_ACTIV_VOCE) === eu) {
        localStorage.removeItem(CHEIE_TAB_ACTIV_VOCE)
        localStorage.removeItem(CHEIE_ULTIMA_INIMA_VOCE)
      }
    }
  } catch {
    /* ignore storage errors */
  }
  bc?.postMessage({ ramasBun: eu })
}


