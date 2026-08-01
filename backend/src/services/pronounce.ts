// ACADEMIC PRONUNCIATION (Adrian, 10 Jul: "academic mode — technical terms,
// absolutely everything"). Chirp 3 HD reads the raw text and often butchers
// technical acronyms. Here, right before synthesis, we respell a CURATED set
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

// Technical acronyms Chirp usually butchers — spoken letter by letter.
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

function spellOut(word: string, table: Record<string, string>): string {
  const parts: string[] = []
  for (const ch of word) {
    // Letter → its name in the target language; digit → we leave it (Chirp
    // reads it as a number); anything else stays in place.
    parts.push(table[ch] ?? ch)
  }
  return parts.join(' ')
}

/**
 * Respell known technical acronyms letter-by-letter for the target language so
 * Chirp 3 HD pronounces them correctly. `langBase` is the 2-letter code (e.g.
 * "ro", "en"). Whole-word, curated matches only — everything else is untouched.
 */
export function academicPronounce(text: string, langBase: string): string {
  const table = LETTER_SOUNDS[langBase]
  if (!table) return text // language without a letter table → we touch nothing
  // Only UPPERCASE tokens (2–8 characters, letters+digits), cleanly delimited.
  return text.replace(/\b[A-Z][A-Z0-9]{1,7}\b/g, (m) => {
    // Common word (PIN, SIM, ROM, GIF, RAM…) → we leave it INTACT: Chirp
    // reads it as a normal word, not letter-by-letter. Otherwise the TTS
    // spoke "stray letters, cut, out of context" (reported bug).
    if (COMMON_WORDS.has(m)) return m
    const lettersOnly = m.replace(/[0-9]/g, '')
    if (!TECH_ACRONYMS.has(m) && !TECH_ACRONYMS.has(lettersOnly)) return m
    return spellOut(m, table)
  })
}
