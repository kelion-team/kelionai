// ── Deterministic language guardian ───────────────────────────────────────
// A tiny, dependency-free language detector used to GUARANTEE Kelion never
// answers in a language other than the one set on the user. It scores a piece
// of text against the languages Kelion realistically uses (the ones that have
// actually caused drift: Romanian, Spanish, Portuguese, French, Italian,
// English, German) using high-frequency function words plus a few script
// signals. It is intentionally CONSERVATIVE: it returns a code only when one
// language clearly wins, and null when unsure — so the guardian never "fixes"
// a reply it isn't confident about.

const STOPWORDS: Record<string, string[]> = {
  ro: ['și', 'este', 'sunt', 'pentru', 'nu', 'că', 'cu', 'la', 'în', 'te', 'să', 'ție', 'poți', 'mulțumesc', 'bună', 'salut', 'acum', 'aici', 'ești', 'așa', 'către', 'dumneavoastră'],
  es: ['el', 'la', 'los', 'las', 'que', 'para', 'con', 'una', 'por', 'usted', 'gracias', 'hola', 'está', 'puedo', 'ahora', 'aquí', 'buenos', 'días', 'tarea', 'listo', 'desarrollador'],
  pt: ['você', 'não', 'para', 'com', 'uma', 'obrigado', 'olá', 'está', 'agora', 'aqui', 'bom', 'dia', 'posso', 'coisa', 'então', 'boa', 'noite'],
  fr: ['le', 'la', 'les', 'des', 'que', 'pour', 'avec', 'une', 'vous', 'merci', 'bonjour', 'est', 'maintenant', 'ici', 'je', 'suis', 'nous'],
  it: ['il', 'la', 'che', 'per', 'con', 'una', 'lei', 'grazie', 'ciao', 'sono', 'adesso', 'qui', 'posso', 'buongiorno', 'cosa'],
  en: ['the', 'and', 'you', 'for', 'with', 'that', 'this', 'thanks', 'hello', 'now', 'here', 'can', 'your', 'good', 'morning', 'done', 'task', 'developer'],
  de: ['der', 'die', 'das', 'und', 'für', 'mit', 'nicht', 'sie', 'danke', 'hallo', 'jetzt', 'hier', 'kann', 'ich', 'guten'],
}

// Strong single-word language signals. When a short utterance contains one of
// these, we commit immediately instead of waiting for a full sentence.
const CLEAR_KEYWORDS: Record<string, string[]> = {
  ro: ['bună', 'salut', 'mulțumesc', 'noroc', 'salutare', 'ție', 'poți', 'ești', 'așa', 'către'],
  es: ['hola', 'gracias', 'claro', 'buenos', 'días', 'está', 'puedo', 'listo', 'tarea'],
  pt: ['olá', 'obrigado', 'bom', 'dia', 'boa', 'noite', 'você', 'então', 'coisa'],
  fr: ['bonjour', 'merci', 'suis', 'nous', 'maintenant', 'bonsoir', 'salut'],
  it: ['ciao', 'grazie', 'buongiorno', 'sono', 'posso', 'cosa', 'adesso'],
  en: ['hello', 'thanks', 'morning', 'developer', 'done', 'task', 'good'],
  de: ['hallo', 'danke', 'guten', 'kann', 'ich', 'jetzt'],
}

// Characters that strongly indicate a specific language (cheap tie-breakers).
const SCRIPT_HINTS: { re: RegExp; lang: string; w: number }[] = [
  { re: /[țțşșăîâ]/gi, lang: 'ro', w: 2 },
  { re: /[ñ¿¡]/gi, lang: 'es', w: 3 },
  { re: /[ãõ]/gi, lang: 'pt', w: 3 },
  { re: /[àâçéèêëîïôûùü]/gi, lang: 'fr', w: 1 },
  { re: /[àèéìòù]/gi, lang: 'it', w: 1 },
  { re: /[äöüß]/gi, lang: 'de', w: 2 },
]

/** Normalise any locale/tag to a 2-letter primary code ("ro-RO" → "ro"). */
export function primaryLang(tag: string | undefined | null): string | null {
  const m = /^([a-z]{2})/i.exec((tag ?? '').trim())
  return m ? m[1].toLowerCase() : null
}

// Nume de limbă în engleză, pentru instrucțiuni către modele (ex: „reply in
// Romanian"). Partajat între chat și voce ca să nu dublăm harta în două locuri.
const LANG_LABELS: Record<string, string> = {
  ro: 'Romanian', en: 'English', fr: 'French', es: 'Spanish', pt: 'Portuguese',
  it: 'Italian', de: 'German', nl: 'Dutch', pl: 'Polish', ru: 'Russian',
  uk: 'Ukrainian', tr: 'Turkish', ar: 'Arabic', zh: 'Chinese', ja: 'Japanese',
  ko: 'Korean', hi: 'Hindi',
}

/** English label for a language tag ("ro-RO" → "Romanian"); fallback English. */
export function langLabel(tag: string | undefined | null): string {
  return LANG_LABELS[primaryLang(tag) ?? 'en'] ?? 'English'
}

/**
 * Best-guess language of `text`, or null when not confident. Returns a 2-letter
 * code. Needs a real amount of text and a clear winner to commit.
 *
 * `previousLang` is used as a fallback for very short or ambiguous utterances
 * ("da", "ok", "thanks") so the conversation does not lose its established
 * language. It is NOT used to override strong new-language signals.
 */
export function detectLang(text: string, previousLang?: string | null): string | null {
  const clean = text
    .toLowerCase()
    .replace(/[^\p{L}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!clean) return null

  const tokens = clean.split(' ')
  const set = new Set(tokens)

  // Heuristic 1: short, clear keywords (e.g. "bună", "hola", "danke").
  // Commit immediately when exactly one language has a clear keyword hit.
  let keywordHit: string | null = null
  for (const [lang, words] of Object.entries(CLEAR_KEYWORDS)) {
    if (words.some((w) => set.has(w))) {
      if (keywordHit) {
        keywordHit = null // ambiguous keyword mix → fall through to scoring
        break
      }
      keywordHit = lang
    }
  }
  if (keywordHit) return keywordHit

  // Heuristic 2: very short/ambiguous utterances inherit the previous language.
  const shortThreshold = 8
  if (clean.length < shortThreshold) {
    const fallback = primaryLang(previousLang)
    if (fallback && STOPWORDS[fallback]) return fallback
    return null
  }

  const scores: Record<string, number> = {}
  for (const [lang, words] of Object.entries(STOPWORDS)) {
    let s = 0
    for (const w of words) if (set.has(w)) s += 1
    scores[lang] = s
  }
  for (const h of SCRIPT_HINTS) {
    const n = (text.match(h.re) ?? []).length
    if (n > 0) scores[h.lang] = (scores[h.lang] ?? 0) + Math.min(4, n) * h.w
  }

  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1])
  const [topLang, topScore] = ranked[0]
  const second = ranked[1]?.[1] ?? 0
  // Commit only on a clear, non-trivial win (guards against false positives on
  // proper nouns, code, or mixed short text).
  if (topScore >= 2 && topScore >= second + 2) return topLang

  // Heuristic 3: ambiguous longer text also falls back to the previous language
  // when available, so a drifting middle sentence does not reset the conversation.
  const fallback = primaryLang(previousLang)
  if (fallback && STOPWORDS[fallback]) return fallback
  return null
}

// ── Server-side speech-language tracking ──────────────────────────────────
// The speech language (what Kelion hears + speaks) used to be detected in the
// browser with franc and persisted from there. Moved HERE (owner's order: as
// much of the app as possible on the server): /api/chat detects the language
// of every message the user writes and commits a switch only after the SAME
// new language on TWO consecutive messages — a one-off mis-detection (e.g.
// diacritic-less Romanian read as Spanish) never flips the remembered choice.

// 2-letter code (what detectLang returns) → the BCP-47 speech tag the client's
// recognizer + the TTS voice use.
const BCP47: Record<string, string> = {
  ro: 'ro-RO', es: 'es-ES', pt: 'pt-BR', fr: 'fr-FR', it: 'it-IT',
  en: 'en-US', de: 'de-DE',
}

// Non-Latin scripts identify their language directly — cheap and unambiguous.
// Order matters: kana before generic CJK (Japanese also uses kanji), the
// Ukrainian-only letters before generic Cyrillic.
const SCRIPT_LANGS: { re: RegExp; code: string }[] = [
  { re: /[぀-ヿ]/, code: 'ja-JP' }, // hiragana + katakana
  { re: /[가-힯]/, code: 'ko-KR' }, // hangul
  { re: /[一-鿿]/, code: 'zh-CN' }, // CJK ideographs (after kana!)
  { re: /[іїєґ]/i, code: 'uk-UA' }, // Ukrainian-only Cyrillic letters
  { re: /[Ѐ-ӿ]/, code: 'ru-RU' }, // generic Cyrillic
  { re: /[؀-ۿ]/, code: 'ar-XA' }, // Arabic
  { re: /[฀-๿]/, code: 'th-TH' }, // Thai
  { re: /[ऀ-ॿ]/, code: 'hi-IN' }, // Devanagari
  { re: /[Ͱ-Ͽ]/, code: 'el-GR' }, // Greek
]

/** Best-guess SPEECH language (BCP-47) of a message, or null when unsure. */
export function detectSpeechLang(text: string, previousLang?: string | null): string | null {
  const clean = (text ?? '').trim()
  if (!clean) return null
  for (const s of SCRIPT_LANGS) if (s.re.test(clean)) return s.code
  const two = detectLang(clean, previousLang)
  return two ? (BCP47[two] ?? null) : null
}

// Limbile pe care aplicația le SUPORTĂ efectiv (i18n + persona vocii). NICIODATĂ
// nu persistăm o limbă în afara acestui set: dovada live (24 iul) — vorbirea
// românească era auzită ca RUSĂ, iar o comitere oarbă ar fi fixat „ru" pentru
// user și ar fi otrăvit toate sesiunile. O transcriere aiurea (rusă, ucraineană
// etc.) e ignorată; limba stabilită rămâne cea reală (sau engleza default).
// EXPORTAT (25 iul): și preferința EXPLICITĂ din Setări trece prin aceeași
// gardă — până azi doar detecția automată era limitată la cele 7 limbi, iar
// din UI se putea persista ORICE limbă (inclusiv rusa), ocolind regula finală.
export const SUPPORTED_LANGS = new Set(['en', 'ro', 'fr', 'es', 'pt', 'it', 'de'])

// Per-user "pending switch" state: a NEW language seen once, waiting for its
// confirming second message. In-memory is fine — losing it merely re-asks for
// the confirmation, it can never corrupt the stored preference.
const pendingSwitch = new Map<string, string>()

/**
 * Track the language of one incoming user message. Returns the BCP-47 code to
 * COMMIT (persist + announce to the client) when the same new language has now
 * been seen on two consecutive messages, else null.
 */
export function trackSpeechLang(
  email: string,
  text: string,
  current: string | null | undefined,
): string | null {
  const seed = detectSpeechLang(text, current)
  if (!seed) return null
  const base = (c: string): string => c.toLowerCase().split('-')[0]
  // GARDĂ: nu comitem NICIODATĂ o limbă în afara setului suportat (o transcriere
  // greșită — ex. română auzită ca rusă — nu are voie să devină preferința).
  if (!SUPPORTED_LANGS.has(base(seed))) return null
  if (current && base(seed) === base(current)) {
    pendingSwitch.delete(email) // matches the established language — no switch
    return null
  }
  const pending = pendingSwitch.get(email)
  if (pending && base(pending) === base(seed)) {
    pendingSwitch.delete(email) // confirmed twice in a row → commit
    return seed
  }
  if (pendingSwitch.size > 1000) pendingSwitch.clear() // bounded, best-effort
  pendingSwitch.set(email, seed)
  return null
}

/**
 * The guardian verdict for a produced reply against the user's SET language.
 * Returns 'ok' (matches or nothing to judge), or 'wrong' with the detected
 * language when it is confidently a DIFFERENT language.
 */
export function checkLang(
  text: string,
  setLangTag: string | null | undefined,
): { ok: true } | { ok: false; detected: string } {
  const want = primaryLang(setLangTag)
  if (!want) return { ok: true } // no established language → nothing to enforce
  const got = detectLang(text)
  if (got && got !== want) return { ok: false, detected: got }
  return { ok: true }
}
