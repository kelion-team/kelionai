// PRONUNȚIE ACADEMICĂ (Adrian, 10 iul: „mod academic — termeni tehnici, absolut
// tot"). Chirp 3 HD citește textul brut și adesea stâlcește acronimele tehnice
// (spune „ap" în loc de „a pe i" pentru API). Aici, chiar înainte de sinteză,
// respellăm un set CURAT de acronime tehnice literă-cu-literă în limba țintă,
// ca să fie rostite corect, academic. E un strat PUR pe text→voce: NU atinge
// microfonul / detecția vocii, deci nu poate strica ascultarea.
//
// Regulă de siguranță: modificăm DOAR jetoane cu majuscule aflate în lista
// curată de mai jos. Orice alt cuvânt (nume proprii cu majuscule, cuvinte
// normale, interjecții) rămâne NEATINS — deci normalizarea nu poate înrăutăți
// niciodată vorbirea obișnuită. Ușor de extins: când auzi un termen rostit
// greșit, îl adaugi în TECH_ACRONYMS și, dacă e cazul, în tabelul de litere.

// Numele literelor pe limbă. Avem RO (limba proprietarului) și EN; pentru orice
// altă limbă lăsăm textul neatins (mai sigur decât o respellare greșită).
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

// Acronime tehnice pe care Chirp le stâlcește de regulă — rostite literă cu
// literă. Cele de DOUĂ litere ambigue, citite în mod normal CA CUVINTE (OK, AI,
// IT, OS, GO, ID, PC, TV) sunt lăsate ANUME pe dinafară, ca să nu le mutilăm.
const TECH_ACRONYMS = new Set([
  'API', 'SSH', 'HTTP', 'HTTPS', 'URL', 'URI', 'HTML', 'CSS', 'XML', 'JSON',
  'YAML', 'SQL', 'VPS', 'VPN', 'CPU', 'GPU', 'RAM', 'ROM', 'SSD', 'HDD', 'USB',
  'GPS', 'PDF', 'DNS', 'SSL', 'TLS', 'CLI', 'GUI', 'SDK', 'IDE', 'TCP', 'UDP',
  'FTP', 'SMTP', 'IMAP', 'CSV', 'SVG', 'PNG', 'JPG', 'JPEG', 'GIF', 'RPC', 'JWT',
  'CORS', 'CDN', 'ORM', 'CRUD', 'NPM', 'PHP', 'ASCII', 'UUID', 'GUID', 'LAN',
  'WAN', 'WWW', 'MP3', 'MP4', 'RSS', 'OTP', 'PIN', 'SIM', 'RGB', 'PDF', 'SEO',
])

function spellOut(word: string, table: Record<string, string>): string {
  const parts: string[] = []
  for (const ch of word) {
    // Literă → numele ei în limba țintă; cifră → o lăsăm (Chirp o citește ca
    // număr); orice altceva rămâne pe loc.
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
  if (!table) return text // limbă fără tabel de litere → nu atingem nimic
  // Doar jetoane cu MAJUSCULE (2–8 caractere, litere+cifre), delimitate curat.
  return text.replace(/\b[A-Z][A-Z0-9]{1,7}\b/g, (m) => {
    const lettersOnly = m.replace(/[0-9]/g, '')
    if (!TECH_ACRONYMS.has(m) && !TECH_ACRONYMS.has(lettersOnly)) return m
    return spellOut(m, table)
  })
}
