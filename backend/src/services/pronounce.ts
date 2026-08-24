// ACADEMIC PRONUNCIATION (Adrian, 10 Jul: "academic mode — technical terms,
// absolutely everything"). Speech engines can mispronounce technical acronyms.
// Here, right before synthesis, we respell a CURATED set
// of technical acronyms letter-by-letter in the target language, so they are
// pronounced correctly, academically. It is a PURE text→voice layer: it does
// NOT touch the microphone / voice detection, so it cannot break listening.
//
// Safety rule: we modify ONLY uppercase tokens found in the curated list
// below. Any other word (capitalized proper nouns, normal words,
// interjections) stays UNTOUCHED — so normalization can never make ordinary
// speech worse. Easy to extend: when you hear a term mispronounced, add it
// to TECH_ACRONYMS and, if needed, to the letter table.

// The names of the letters per language. We have RO (the owner's language)
// and EN; for any other language we leave the text untouched (safer than a
// wrong respelling).
const LETTER_SOUNDS: Record<string, Record<string, string>> = {
  ro: {
    A: 'a', B: 'be', C: 'ce', D: 'de', E: 'e', F: 'ef', G: 'ge', H: 'haș',
    I: 'i', J: 'jî', K: 'ka', L: 'el', M: 'em', N: 'en', O: 'o', P: 'pe',
    Q: 'chiu', R: 'er', S: 'es', T: 'te', U: 'u', V: 've', W: 'dublu ve',
    X: 'ics', Y: 'igrec', Z: 'zet',
  },
  en: {
    A: 'ay', B: 'bee', C: 'see', D: 'dee', E: 'ee', F: 'ef', G: 'jee', H: 'aitch',
    I: 'eye', J: 'jay', K: 'kay', L: 'el', M: 'em', N: 'en', O: 'oh', P: 'pee',
    Q: 'cue', R: 'ar', S: 'ess', T: 'tee', U: 'you', V: 'vee', W: 'double-u',
    X: 'eks', Y: 'wy', Z: 'zee',
  },
}

// Technical acronyms speech engines often mispronounce — spoken letter by letter.
// The ambiguous TWO-letter ones, normally read AS WORDS (OK, AI, IT, OS, GO,
// ID, PC, TV) are deliberately left out, so we don't mutilate them. LIKEWISE
// the uppercase tokens that ARE also common words (PIN, SIM, ROM, RAM, GIF,
// WAN, LAN, SEO, PDF, CSV…) — removed from the split list so the TTS no
// longer speaks "stray letters, cut, out of context" (reported bug).
const COMMON_WORDS = new Set([
  'PIN', 'SIM', 'ROM', 'GIF', 'RAM', 'WAN', 'LAN', 'SEO', 'PDF', 'CSV', 'RSS',
  'OTP', 'RGB', 'GUI', 'CLI', 'IDE', 'SDK', 'SQL', 'PHP', 'CSS', 'SVG',
])
const TECH_ACRONYMS = new Set([
  'API', 'SSH', 'HTTP', 'HTTPS', 'URL', 'URI', 'HTML', 'XML', 'JSON',
  'YAML', 'VPS', 'VPN', 'CPU', 'GPU', 'SSD', 'HDD', 'USB',
  'GPS', 'DNS', 'SSL', 'TLS', 'TCP', 'UDP',
  'FTP', 'SMTP', 'IMAP', 'PNG', 'JPG', 'JPEG', 'RPC', 'JWT',
  'CORS', 'CDN', 'ORM', 'CRUD', 'NPM', 'ASCII', 'UUID', 'GUID',
  'WWW', 'MP3', 'MP4',
])

// ── TEMPERATURES (Adrian, Aug 2 — live bug: the mouth said „27°C" RAW) ─────
// Speech engines may read „27°C" as „twenty-seven-see" or drop the unit.
// The fix is textual: „27°C" → „27 de grade Celsius" (ro) / „27 degrees
// Celsius" (en) BEFORE synthesis, so the model reads an ordinary sentence.
// Romanian agreement: 1 → „grad", 2–19 → „grade", everything else (0, 20+,
// decimals, negatives by absolute value) → „de grade". „27° C" (with the
// space Google's own transcription emits) and „ºC" (ordinal glyph) included.
function roGradeWord(numRaw: string): string {
  const n = Math.abs(parseFloat(numRaw.replace(',', '.')))
  if (Number.isInteger(n) && n === 1) return 'grad'
  if (Number.isInteger(n) && n >= 2 && n <= 19) return 'grade'
  return 'de grade'
}

function pronounceTemperatures(text: string, langBase: string): string {
  if (langBase !== 'ro' && langBase !== 'en') return text // same rule as the acronyms
  // The lookbehind keeps a RANGE („20-27°C") intact: the „-" glued to a digit
  // is a dash, not a minus — only the last number gets the unit.
  return text.replace(/(?<![\d.,])([−-]?\s*\d+(?:[.,]\d+)?)\s*[°º]\s*([CFcf])\b/g, (m, numRaw: string, unit: string) => {
    const neg = /^[−-]/.test(numRaw.trim())
    const num = numRaw.replace(/^[−-]\s*/, '')
    const celsius = unit.toUpperCase() === 'C'
    if (langBase === 'ro') {
      const prefix = neg ? 'minus ' : ''
      return `${prefix}${num} ${roGradeWord(num)} ${celsius ? 'Celsius' : 'Fahrenheit'}`
    }
    const n = Math.abs(parseFloat(num.replace(',', '.')))
    const word = n === 1 && Number.isInteger(n) ? 'degree' : 'degrees'
    const prefix = neg ? 'minus ' : ''
    return `${prefix}${num} ${word} ${celsius ? 'Celsius' : 'Fahrenheit'}`
  })
}

function spellOut(word: string, table: Record<string, string>): string {
  const parts: string[] = []
  for (const ch of word) {
    // Letter → its name in the target language; digits and punctuation stay in place.
    parts.push(table[ch] ?? ch)
  }
  return parts.join(' ')
}

/**
 * Respell known technical acronyms letter-by-letter for the target language so
 * a speech engine can pronounce them consistently. `langBase` is the 2-letter code (e.g.
 * "ro", "en"). Whole-word, curated matches only — everything else is untouched.
 */
export function academicPronounce(text: string, langBase: string): string {
  const table = LETTER_SOUNDS[langBase]
  if (!table) return text // language without a letter table → we touch nothing
  // Temperatures FIRST („27°C" → „27 de grade Celsius"): they contain no
  // uppercase tokens the acronym pass could mangle, and the acronym pass
  // would otherwise see the bare „C" (too short to match anyway).
  const withTemperatures = pronounceTemperatures(text, langBase)
  // Only UPPERCASE tokens (2–8 characters, letters+digits), cleanly delimited.
  return withTemperatures.replace(/\b[A-Z][A-Z0-9]{1,7}\b/g, (m) => {
    // Common word (PIN, SIM, ROM, GIF, RAM…) → leave it intact so the speech
    // engine reads it as a normal word, not letter-by-letter. Otherwise TTS
    // spoke "stray letters, cut, out of context" (reported bug).
    if (COMMON_WORDS.has(m)) return m
    const lettersOnly = m.replace(/[0-9]/g, '')
    if (!TECH_ACRONYMS.has(m) && !TECH_ACRONYMS.has(lettersOnly)) return m
    return spellOut(m, table)
  })
}
