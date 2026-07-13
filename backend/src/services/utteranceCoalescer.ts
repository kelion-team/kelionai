// COALESCER INTELIGENT DE FRAZĂ — leagă bucățile transcrise de voce într-un
// singur gând, fără să trimită la creier fragmente ciuntite, scurte sau fără sens.
//
// Folosit de front în două căi: streaming WS (micStream.ts) și batch (audioIO.ts).
// Logica pură (fără timer) e exportată pentru teste.

export interface UtteranceFragment {
  text: string
  confidence?: number
  isFinal?: boolean
}

export interface CoalescedUtterance {
  text: string
  confidence: number
  needsConfirmation: boolean
}

export interface UtteranceCoalescerOptions {
  onFlush: (result: CoalescedUtterance) => void
  windowMs?: number
  minConfidence?: number
  confirmationThreshold?: number
  minWords?: number
  minChars?: number
  maxWordsForConfirmation?: number
}

export interface UtteranceCoalescer {
  push(fragment: string | UtteranceFragment): void
  flushNow(): void
  cancel(): void
}

// Cuvinte de umplutură care nu aduc sens; filtrate individual, nu ca părți de cuvânt.
export const FILLER_WORDS = new Set([
  'um',
  'uh',
  'ah',
  'eh',
  'hm',
  'mm',
  'mhm',
  'hmm',
  'pff',
  'psst',
  'shh',
  'er',
  'uhm',
  'ahem',
  'huh',
])

// Praguri implicite — calibrate pentru vorbit natural în română/engleză.
export const DEFAULT_MIN_CONFIDENCE = 0.5
export const DEFAULT_CONFIRMATION_THRESHOLD = 0.75
export const DEFAULT_MIN_WORDS = 2
export const DEFAULT_MIN_CHARS = 5
export const DEFAULT_MAX_WORDS_FOR_CONFIRMATION = 3
export const DEFAULT_WINDOW_MS = 1100

function normalize(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .trim()
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}

function isFillerWord(w: string): boolean {
  return FILLER_WORDS.has(w.toLowerCase().replace(/[^a-zăâîșț]/gi, ''))
}

function isAllFillers(text: string): boolean {
  const words = text.split(/\s+/).filter(Boolean)
  return words.length > 0 && words.every(isFillerWord)
}

function isStopWordFragment(text: string): boolean {
  return /^\s*(stop|stai|opre[șs]te(?:-te)?|oprire|gata|las[ăa](?:\s*asta)?|anuleaz[ăa]|renun[țt][ăa])\s*$/i.test(
    text,
  )
}

/** Decide dacă un fragment izolat merită să intre în buffer. */
export function shouldAcceptFragment(
  fragment: UtteranceFragment,
  minConfidence = DEFAULT_MIN_CONFIDENCE,
  minWords = DEFAULT_MIN_WORDS,
  minChars = DEFAULT_MIN_CHARS,
): boolean {
  const text = normalize(fragment.text)
  if (!text) return false
  // Comenzi de stop clare — acceptate chiar dacă sunt scurte.
  if (isStopWordFragment(text)) return true
  // Respinge dacă e doar umplutură.
  if (isAllFillers(text)) return false
  // Prea scurt și prea puține cuvinte → probabil zgomot/fragment ciuntit.
  if (wordCount(text) < minWords && text.length < minChars) return false
  // Confidență prea mică → respinge (când avem scor).
  if (typeof fragment.confidence === 'number' && fragment.confidence < minConfidence) return false
  return true
}

/** Curăță umpluturile de la margini și normalizează spațiile. */
function cleanText(text: string): string {
  return normalize(text)
    .split(/\s+/)
    .filter((w) => !isFillerWord(w))
    .join(' ')
}

/**
 * Coalescează o listă de fragmente într-o singură propoziție. Returnează null
 * dacă nimic nu trece filtrele.
 */
export function coalesceBuffer(
  fragments: UtteranceFragment[],
  confirmationThreshold = DEFAULT_CONFIRMATION_THRESHOLD,
  maxWordsForConfirmation = DEFAULT_MAX_WORDS_FOR_CONFIRMATION,
  minConfidence = DEFAULT_MIN_CONFIDENCE,
  minWords = DEFAULT_MIN_WORDS,
  minChars = DEFAULT_MIN_CHARS,
): CoalescedUtterance | null {
  const accepted = fragments
    .filter((f) => shouldAcceptFragment(f, minConfidence, minWords, minChars))
    .map((f) => ({ ...f, text: cleanText(f.text) }))
    .filter((f) => f.text.length > 0)

  if (accepted.length === 0) return null

  const text = accepted.map((f) => f.text).join(' ')
  const cleaned = normalize(text)
  if (!cleaned) return null

  // Confidență medie ponderată de lungimea fiecărui fragment.
  let weightedConfidence = 0
  let totalWeight = 0
  for (const f of accepted) {
    const weight = Math.max(1, f.text.length)
    weightedConfidence += (f.confidence ?? 0.85) * weight
    totalWeight += weight
  }
  const confidence = totalWeight > 0 ? weightedConfidence / totalWeight : 0.85

  // Mesaj ambiguu: puține cuvinte sau confidență sub prag → cere confirmare.
  // EXCEPTÂND comenzile clare de stop, care trebuie să execute imediat.
  const words = wordCount(cleaned)
  const needsConfirmation =
    !isStopWordFragment(cleaned) &&
    (words <= maxWordsForConfirmation || confidence < confirmationThreshold)

  return { text: cleaned, confidence, needsConfirmation }
}

/** Crează un coalescer cu timer, gata de folosit în browser. */
export function createUtteranceCoalescer(
  onFlush: (result: CoalescedUtterance) => void,
  options: Partial<Omit<UtteranceCoalescerOptions, 'onFlush'>> = {},
): UtteranceCoalescer {
  const {
    windowMs = DEFAULT_WINDOW_MS,
    minConfidence = DEFAULT_MIN_CONFIDENCE,
    confirmationThreshold = DEFAULT_CONFIRMATION_THRESHOLD,
    minWords = DEFAULT_MIN_WORDS,
    minChars = DEFAULT_MIN_CHARS,
    maxWordsForConfirmation = DEFAULT_MAX_WORDS_FOR_CONFIRMATION,
  } = options

  let buffer: UtteranceFragment[] = []
  let timer: ReturnType<typeof setTimeout> | null = null

  const clearTimer = (): void => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  const flush = (): void => {
    clearTimer()
    if (buffer.length === 0) return
    const result = coalesceBuffer(
      buffer,
      confirmationThreshold,
      maxWordsForConfirmation,
      minConfidence,
      minWords,
      minChars,
    )
    buffer = []
    if (result) onFlush(result)
  }

  return {
    push(fragment: string | UtteranceFragment) {
      const parsed: UtteranceFragment =
        typeof fragment === 'string' ? { text: fragment } : fragment
      if (!shouldAcceptFragment(parsed, minConfidence, minWords, minChars)) return
      buffer.push(parsed)
      clearTimer()
      timer = setTimeout(flush, windowMs)
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
