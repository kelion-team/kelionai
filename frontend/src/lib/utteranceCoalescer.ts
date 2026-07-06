// COALESCER DE FRAZĂ — leagă bucățile transcrise de VOX într-un singur gând.
// De ce există: microfonul (audioIO.ts) taie pe tăcere (SILENCE_MS, azi 450ms —
// prag calibrat de Adrian pentru viteză, NU se atinge aici). O pauză naturală de
// respirație/gândire în mijlocul unei propoziții e mai lungă decât atât, dar mult
// mai scurtă decât o pauză reală de final-de-gând — rezultă fraze tăiate în bucăți
// disparate trimise separat creierului ("Eu sunt în setare." / "un" / ...).
// Fix strict la nivel de text: fiecare fragment transcris intră aici, nu direct la
// creier; dacă mai vine un fragment în `windowMs`, se unesc — abia la prima tăcere
// REALĂ (fără fragment nou o vreme) se trimite o singură frază completă.

export interface UtteranceCoalescer {
  push(text: string): void
  flushNow(): void
  cancel(): void
}

export function createUtteranceCoalescer(
  onFlush: (text: string) => void,
  windowMs = 900,
): UtteranceCoalescer {
  let buffer: string[] = []
  let timer: number | null = null

  const clearTimer = (): void => {
    if (timer !== null) {
      window.clearTimeout(timer)
      timer = null
    }
  }

  const flush = (): void => {
    clearTimer()
    if (buffer.length === 0) return
    const text = buffer.join(' ')
    buffer = []
    onFlush(text)
  }

  return {
    push(text: string) {
      const t = text.trim()
      if (!t) return
      buffer.push(t)
      // debounce clasic: fiecare fragment nou amână trimiterea, nu o grăbește
      clearTimer()
      timer = window.setTimeout(flush, windowMs)
    },
    flushNow() {
      flush()
    },
    cancel() {
      clearTimer()
      buffer = []
    },
  }
}
