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
// Regula de aici: tabul care PORNEȘTE ultimul vocea o ține pe TOATĂ (live sau
// dictare); celelalte taburi se ZĂVORĂSC — nu pornesc nimic singure cât timp
// aud inima tabului activ. Dacă tabul activ moare (închis, navigat), inima
// tace >25s (sau vine „rămas-bun" la închidere) și un tab zăvorât reia vocea
// singur. Apăsarea manuală pe microfon ridică zăvorul oriunde.
//
// Canalul e ACELAȘI cu al sesiunii live ('kelion-voice'): mesajul {takeover}
// al sesiunii oprește sesiunile vechi (garda din realtimeVoice), iar panoul
// îl aude și el și zăvorăște TOT lanțul vocii, nu doar sesiunea.

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

const CANAL_VOCE = 'kelion-voice'

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
 *  Întoarce acțiunea; efectele (opriri, porniri) le face panoul. */
export function judecaMesajVoce(
  m: MesajVoce | null,
  eu: string,
  zavorat: boolean,
): 'zavoraste' | 'inima' | 'reia' | 'nimic' {
  if (!m) return 'nimic'
  if (m.takeover && m.takeover !== eu) return 'zavoraste'
  if (m.inima && m.inima !== eu) return 'inima'
  if (m.ramasBun && m.ramasBun !== eu && zavorat) return 'reia'
  return 'nimic'
}

/** Pur (testabil): un tab zăvorât reia vocea doar când inima străină a tăcut. */
export function inimaAMurit(ultimaInimaLa: number, acum: number): boolean {
  return acum - ultimaInimaLa > INIMA_MOARTA_MS
}
