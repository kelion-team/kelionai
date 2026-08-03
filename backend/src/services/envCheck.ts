// ── WHICH KEYS THE SERVER SEES RIGHT NOW ────────────────────────────────────
//
// Adrian, 30 Jul: "the keys have been written dozens of times."
//
// And the panel was saying, at the same time, "(not configured) Google Maps /
// Google TTS / Serper". Both can be true — a key can be WRITTEN and still not
// reach the running process: written in a different file than the one given
// to docker, written after the container started and never reloaded, or set
// as a GitHub secret without `vps-set-env` ever having been run.
//
// The difference between the three shows in a second if you ask the PROCESS,
// not the person. This module does exactly that: it looks into `process.env`
// of the app answering right now and says, for each expected name, whether
// it is there.
//
// WHAT IT NEVER DOES: return values. Not whole, not truncated, not "the
// first characters". Half a key is still a leaked key. Only the names are
// returned, whether present, and how many characters they have — just enough
// to tell "missing" from "present but empty" or "present but truncated".
import { ENV_ALIASES } from '../config.js'

export interface EnvVarState {
  /** The EXACT name of the variable, as the code looks for it. */
  name: string
  /** What it is for, in plain terms. */
  what: string
  /** Is it in the process running NOW? */
  present: boolean
  /** How many characters it has (0 = present but empty). Never the content. */
  length: number
  /** Without it, what breaks. */
  breaks: string
  /** Under WHICH name it was found. It can be an alias, not the main name —
   *  that is why it is shown: "you wrote it as GOOGLE_MAPS_API_KEY" is
   *  information, not a detail. */
  foundAs?: string
  /** All the names I look under. So the person doesn't have to guess. */
  accepts: string[]
}

/** The variables without which a specific capability dies. The list is
 *  hand-written on purpose: "everything in env" would also include things
 *  that have nothing to do with us. */
const ASTEPTATE: { name: string; what: string; breaks: string; alias?: string[] }[] = [
  // (OPENAI_* și OPENROUTER_* SCOASE, 3 aug — extirparea totală: creierul e
  // Gemini, vocea e Google Chirp. Cheile alea nu mai sunt citite de nimeni.)
  { alias: ENV_ALIASES.databaseUrl, name: 'DATABASE_URL', what: 'baza de date', breaks: 'conturi, credite, istoric — toate' },
  { alias: ENV_ALIASES.sessionSecret, name: 'SESSION_SECRET', what: 'sesiunile de login', breaks: 'nimeni nu poate rămâne logat' },
  { name: 'REVOLUT_PAY_LINK', what: 'linkul de plată Revolut (cumpărarea de credite)', breaks: 'butonul de plată nu duce nicăieri' },
  { name: 'ENABLE_BANKING_APP_ID', what: 'citirea plăților din cont (Enable Banking)', breaks: 'plățile nu se creditează singure' },
  { name: 'ENABLE_BANKING_PRIVATE_KEY_B64', what: 'semnătura pentru Enable Banking', breaks: 'plățile nu se creditează singure' },
  { name: 'GOOGLE_CLIENT_ID', what: 'login cu Google', breaks: 'butonul Google nu merge' },
  { name: 'GOOGLE_CLIENT_SECRET', what: 'login cu Google', breaks: 'butonul Google nu merge' },
  { alias: ENV_ALIASES.geminiKey, name: 'GEMINI_API_KEY', what: 'CREIERUL (unic — Gemini direct) + vedere + traduceri', breaks: 'nu răspunde nimic' },
  { alias: ENV_ALIASES.serperKey, name: 'SERPER_API_KEY', what: 'căutarea pe web', breaks: 'nu poate căuta nimic pe internet' },
  // (Rândul GOOGLE_MAPS_KEY a fost SCOS — auditul admin, 3 aug: cheia n-are
  // NICIUN consumator în cod (hărțile merg exclusiv pe OSM/OSRM, cu sau fără
  // ea). Un rând care-l trimite pe owner să configureze o cheie fără efect
  // încalcă regula #4. Numele GOOGLE_MAPS_* sunt acum în setul „morților",
  // ca STRIPE/OPENAI — vezi filtrarea din envOrphans.)
  // Breaks-urile TTS/SA rescrise la adevărul din tts.ts/asr.ts (auditul admin,
  // 3 aug): calea PRIMARĂ a gurii e service account-ul; cheia API e doar
  // rezerva (tts.ts trece pe ?key= când nu e SA). Vechile texte afirmau
  // consecințe inventate („gura tace" cu SA prezent; „nu există rezervă").
  { alias: ENV_ALIASES.googleTtsKey, name: 'GOOGLE_TTS_API_KEY', what: 'vocea sintetizată Google (rezerva TTS)', breaks: 'nimic cât există GOOGLE_SERVICE_ACCOUNT_JSON — gura tace doar dacă lipsesc amândouă' },
  // (Rândul GOOGLE_API_KEY a fost SCOS — auditul admin, 3 aug: descrierea
  // „alternativă pentru TTS/Gemini" era falsă pentru Gemini (creierul citește
  // doar aliasurile GEMINI_*), iar numele e deja alias al rândului TTS de mai
  // sus — aceeași cheie fizică se număra de două ori la „prezente".)
  { alias: ENV_ALIASES.googleServiceAccountJson, name: 'GOOGLE_SERVICE_ACCOUNT_JSON', what: 'Chirp 3 HD (auz/voce de calitate)', breaks: 'auzul moare (rămâne doar Vosk local dacă USE_LOCAL_VOSK=1); gura cade pe GOOGLE_TTS_API_KEY dacă e setată, altfel tace și ea' },
  // (Rândul MAIL_USER a fost SCOS — auditul admin, 3 aug: are default
  // contact@kelionai.app în config.ts, iar mailEnabled() depinde DOAR de
  // MAIL_PASS. Cu MAIL_USER absent mailurile merg normal — ⚠-ul de aici era
  // o alarmă falsă care-l trimitea pe owner să seteze o cheie inutilă.)
  { alias: ENV_ALIASES.mailPass, name: 'MAIL_PASS', what: 'cutia contact@', breaks: 'nu se citesc/trimit emailuri' },
  { alias: ENV_ALIASES.githubToken, name: 'GITHUB_TOKEN', what: 'mâinile lui Kelion pe runbook-uri', breaks: 'nu poate publica singur' },
  { alias: ENV_ALIASES.bridgeSecret, name: 'BRIDGE_SECRET', what: 'raportările constructorului', breaks: 'constructorul nu poate raporta progresul' },
]

export function envCheck(): EnvVarState[] {
  return ASTEPTATE.map((v) => {
    // I look under ALL accepted names, not just the main one. A name
    // written differently is not a missing key — see the comment in config.ts.
    const nume = v.alias ?? [v.name]
    const gasit = nume.find((n) => (process.env[n] ?? '').trim() !== '')
    const raw = gasit != null ? process.env[gasit] : nume.map((n) => process.env[n]).find((x) => x != null)
    return {
      name: v.name,
      what: v.what,
      present: raw != null,
      // LUNGIMEA PE VALOAREA TRIMUITĂ (auditul admin, 3 aug): o cheie setată
      // doar din spații apărea „✅ prezentă, 1 caracter", deși config.env() o
      // trimuiește și toate serviciile o văd ca inexistentă — panoul spunea
      // „e acolo", aplicația se purta ca și cum lipsește. Whitespace-only =
      // „prezentă dar GOALĂ" (length 0), aliniat cu ce vede config.env().
      length: (raw ?? '').trim().length,
      breaks: v.breaks,
      foundAs: gasit,
      accepts: nume,
    }
  })
}

// ── KEYS YOU HAVE, BUT I DON'T READ ─────────────────────────────────────────
//
// The "I wrote it dozens of times" case has a second face: the key IS in the
// process, but under a name the code doesn't look for. Then "missing" is a
// lie — the person did the work, I am looking elsewhere. Here we list
// exactly those names.
//
// Only the NAMES, never the values. And only names related to us (by
// keywords), so we don't spill the whole machine env on screen.
//
// STRIPE IS DELIBERATELY OUT (Adrian: "Stripe is removed completely from the
// app"): the provider is gone, so a leftover STRIPE_* key in the env is not
// "something you have under another name" — it's a corpse. Listing it as an
// orphan made the Tokens tab show three dead rows (STRIPE_CURRENCY,
// STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET) that looked like something to fix.
// OPENAI/OPENROUTER, LA FEL (3 aug — extirparea totală): furnizorii nu mai
// există în cod, deci o cheie OPENAI_*/OPENROUTER_* rămasă pe VPS e un cadavru,
// nu „ceva scris sub alt nume" — n-o listăm ca orfană.
// GOOGLE_MAPS_*, LA FEL (auditul admin, 3 aug): câmpul mort config.googleMapsKey
// a fost șters (niciun consumator — hărțile merg exclusiv pe OSM); o cheie de
// Maps rămasă în env e un cadavru, nu un orfan de reparat.
const CUVINTE = /(ANTHROPIC|CLAUDE|GEMINI|GOOGLE|SERPER|MAPS?|MAIL|SMTP|IMAP|TTS|STT|VOICE|DATABASE|POSTGRES|SESSION|BRIDGE|GITHUB|KELION)/i
const MORTI = /^(OPENAI_|OPENROUTER_|GOOGLE_MAPS?_|MAPS_API_KEY$)/

export function envOrphans(): string[] {
  const stiute = new Set<string>()
  for (const v of ASTEPTATE) for (const n of v.alias ?? [v.name]) stiute.add(n)
  for (const n of ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI', 'GOOGLE_TTS_VOICE',
    'GEMINI_MODEL', 'ADMIN_EMAIL', 'ALLOWLIST', 'MAIL_USER', 'MAIL_FORWARD_TO', 'MAIL_IMAP_HOST',
    'MAIL_IMAP_PORT', 'MAIL_SMTP_HOST', 'MAIL_SMTP_PORT', 'BILLING_CURRENCY', 'ENABLE_BANKING_ACCOUNT_UID', 'NODE_ENV']) stiute.add(n)
  return Object.keys(process.env)
    .filter((n) => CUVINTE.test(n) && !stiute.has(n) && !MORTI.test(n))
    .sort()
}

/** The summary, so the panel can say in one line how things stand. */
export function envSummary(): { total: number; lipsa: number; goale: number; nume: string[] } {
  const s = envCheck()
  const lipsa = s.filter((v) => !v.present)
  const goale = s.filter((v) => v.present && v.length === 0)
  return {
    total: s.length,
    lipsa: lipsa.length,
    goale: goale.length,
    // The names of those missing OR empty — these are the ones to set, nothing else.
    nume: [...lipsa, ...goale].map((v) => v.name),
  }
}

/** The time the process started. Without it you cannot answer the question
 *  that matters: "did I write the key BEFORE or AFTER the app started?" —
 *  a key written after startup doesn't get in until the container restarts. */
export function processStartedAt(): string {
  return new Date(Date.now() - Math.round(process.uptime() * 1000)).toISOString()
}
