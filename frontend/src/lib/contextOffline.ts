// Context offline limitat la semnalele măsurate pe care apelantul le furnizează:
// coordonate cerute explicit pentru tură și indicii audio locale neconcludente.

export interface SemnaleContext {
  lat?: number
  lon?: number
  /** Indiciu FFT local, nu identificare semantică sigură a unui eveniment. */
  sunetAmbiental?: 'zgomot_brusc' | 'conversatie_posibila' | 'muzica_posibila' | 'liniste'
}

/** Semnalele → un bloc SCURT de context pentru creierul local (limbaj de sistem,
 *  engleză; creierul răspunde în limba userului). PUR (testabil). Doar ce e
 *  MĂSURAT; gol dacă n-avem nimic. */
export function contextPentruCreier(s: SemnaleContext): string {
  const parti: string[] = []
  if (typeof s.lat === 'number' && typeof s.lon === 'number') {
    parti.push(`location: ${s.lat.toFixed(4)}, ${s.lon.toFixed(4)}`)
  }
  if (s.sunetAmbiental && s.sunetAmbiental !== 'liniste') {
    const indiciu =
      s.sunetAmbiental === 'zgomot_brusc'
        ? 'a sudden unclassified sound'
        : s.sunetAmbiental === 'conversatie_posibila'
          ? 'possible speech-like audio'
          : 'possible music-like audio'
    parti.push(`local audio heuristic: ${indiciu} (clue only, not a confirmed event)`)
  }
  if (!parti.length) return ''
  return (
    `Measured device context available for this offline turn: ` +
    parti.join('; ') +
    `. Use it naturally and briefly when it helps (like a human companion who notices), never robotically; never invent a value that is not listed here.`
  )
}
