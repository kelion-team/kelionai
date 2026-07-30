// ── CE CHEI VEDE SERVERUL CHIAR ACUM ─────────────────────────────────────────
//
// Adrian, 30 iul: „toate cheile au fost scrise de zeci de ori."
//
// Iar panoul spunea, în același timp, „(neconfigurat) Google Maps / Google TTS /
// Serper". Amândouă pot fi adevărate — cheia poate fi SCRISĂ și totuși să nu
// ajungă în procesul care rulează: scrisă în alt fișier decât cel dat lui
// docker, scrisă după pornirea containerului și niciodată reîncărcată, sau pusă
// ca secret în GitHub fără să fi rulat vreodată `vps-set-env`.
//
// Diferența dintre cele trei se vede într-o secundă dacă întrebi PROCESUL, nu
// omul. Modulul ăsta face exact atât: se uită în `process.env` al aplicației
// care răspunde acum și spune, pe fiecare nume așteptat, dacă e acolo.
//
// CE NU FACE, NICIODATĂ: nu întoarce valori. Nici întregi, nici trunchiate, nici
// „primele caractere". O cheie pe jumătate e tot o cheie scursă. Se întorc doar
// numele, dacă e prezentă, și câte caractere are — atât cât să deosebești „nu e"
// de „e, dar e goală" sau „e, dar e trunchiată".
import { config, ENV_ALIASES } from '../config.js'

export interface EnvVarState {
  /** Numele EXACT al variabilei, cum îl caută codul. */
  name: string
  /** La ce folosește, pe înțelesul omului. */
  what: string
  /** E în procesul care rulează ACUM? */
  present: boolean
  /** Câte caractere are (0 = prezentă dar goală). Niciodată conținutul. */
  length: number
  /** Fără ea, ce nu merge. */
  breaks: string
  /** Sub CE nume a fost găsită. Poate fi un alias, nu numele principal — de-aia
   *  se arată: „ai scris-o ca GOOGLE_MAPS_API_KEY" e o informație, nu un detaliu. */
  foundAs?: string
  /** Toate numele sub care o caut. Ca omul să nu ghicească. */
  accepts: string[]
}

/** Variabilele fără de care o capabilitate anume moare. Lista e scrisă de mână
 *  dinadins: „tot ce e în env" ar include și lucruri care n-au treabă cu noi. */
const ASTEPTATE: { name: string; what: string; breaks: string; alias?: string[] }[] = [
  { alias: ENV_ALIASES.openaiKey, name: 'OPENAI_API_KEY', what: 'vocea live + TTS + STT de rezervă', breaks: 'vocea nu pornește deloc' },
  { alias: ENV_ALIASES.openrouterKey, name: 'OPENROUTER_API_KEY', what: 'creierul (chat, gândire, traduceri)', breaks: 'nu răspunde nimic' },
  { alias: ENV_ALIASES.databaseUrl, name: 'DATABASE_URL', what: 'baza de date', breaks: 'conturi, credite, istoric — toate' },
  { alias: ENV_ALIASES.sessionSecret, name: 'SESSION_SECRET', what: 'sesiunile de login', breaks: 'nimeni nu poate rămâne logat' },
  { alias: ENV_ALIASES.stripeSecretKey, name: 'STRIPE_SECRET_KEY', what: 'plățile', breaks: 'nu se pot cumpăra credite' },
  { alias: ENV_ALIASES.stripeWebhookSecret, name: 'STRIPE_WEBHOOK_SECRET', what: 'confirmarea plăților de la Stripe', breaks: 'plata trece dar creditele nu intră' },
  { alias: ENV_ALIASES.stripePublishableKey, name: 'STRIPE_PUBLISHABLE_KEY', what: 'afișarea numărului cardului în panou', breaks: 'butonul „Vezi numărul cardului" nu apare' },
  { name: 'GOOGLE_CLIENT_ID', what: 'login cu Google', breaks: 'butonul Google nu merge' },
  { name: 'GOOGLE_CLIENT_SECRET', what: 'login cu Google', breaks: 'butonul Google nu merge' },
  { alias: ENV_ALIASES.geminiKey, name: 'GEMINI_API_KEY', what: 'creier de rezervă + vedere', breaks: 'cade pe modele mai slabe' },
  { alias: ENV_ALIASES.serperKey, name: 'SERPER_API_KEY', what: 'căutarea pe web', breaks: 'nu poate căuta nimic pe internet' },
  { alias: ENV_ALIASES.googleMapsKey, name: 'GOOGLE_MAPS_KEY', what: 'hărți, locuri, trasee bune', breaks: 'rămâne doar harta gratuită (OSM)' },
  { alias: ENV_ALIASES.googleTtsKey, name: 'GOOGLE_TTS_API_KEY', what: 'vocea sintetizată Google', breaks: 'TTS-ul cade pe OpenAI' },
  { name: 'GOOGLE_API_KEY', what: 'alternativă pentru TTS/Gemini', breaks: '—' },
  { alias: ENV_ALIASES.googleServiceAccountJson, name: 'GOOGLE_SERVICE_ACCOUNT_JSON', what: 'Chirp 3 HD (auz/voce de calitate)', breaks: 'STT/TTS cad pe OpenAI' },
  { name: 'MAIL_USER', what: 'cutia contact@', breaks: 'nu se citesc/trimit emailuri' },
  { alias: ENV_ALIASES.mailPass, name: 'MAIL_PASS', what: 'cutia contact@', breaks: 'nu se citesc/trimit emailuri' },
  { alias: ENV_ALIASES.githubToken, name: 'GITHUB_TOKEN', what: 'mâinile lui Kelion pe runbook-uri', breaks: 'nu poate publica singur' },
  { alias: ENV_ALIASES.bridgeSecret, name: 'BRIDGE_SECRET', what: 'raportările constructorului', breaks: 'constructorul nu poate raporta progresul' },
]

export function envCheck(): EnvVarState[] {
  return ASTEPTATE.map((v) => {
    // Caut sub TOATE numele acceptate, nu doar cel principal. Un nume scris
    // altfel nu e o cheie lipsă — vezi comentariul din config.ts.
    const nume = v.alias ?? [v.name]
    const gasit = nume.find((n) => (process.env[n] ?? '').trim() !== '')
    const raw = gasit != null ? process.env[gasit] : nume.map((n) => process.env[n]).find((x) => x != null)
    return {
      name: v.name,
      what: v.what,
      present: raw != null,
      length: (raw ?? '').length,
      breaks: v.breaks,
      foundAs: gasit,
      accepts: nume,
    }
  })
}

// ── CHEI PE CARE LE AI, DAR EU NU LE CITESC ─────────────────────────────────
//
// Cazul „am scris-o de zeci de ori" are o a doua față: cheia E în proces, dar
// sub un nume pe care codul nu-l caută. Atunci „lipsește" e o minciună — omul a
// făcut treaba, eu mă uit în alt loc. Aici enumerăm exact acele nume.
//
// Doar NUMELE, niciodată valorile. Și doar numele care au legătură cu noi (după
// cuvinte-cheie), ca să nu vărsăm tot env-ul mașinii pe ecran.
const CUVINTE = /(OPENAI|OPENROUTER|ANTHROPIC|CLAUDE|GEMINI|GOOGLE|SERPER|MAPS?|STRIPE|MAIL|SMTP|IMAP|TTS|STT|VOICE|DATABASE|POSTGRES|SESSION|BRIDGE|GITHUB|KELION)/i

export function envOrphans(): string[] {
  const stiute = new Set<string>()
  for (const v of ASTEPTATE) for (const n of v.alias ?? [v.name]) stiute.add(n)
  for (const n of ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI', 'GOOGLE_TTS_VOICE',
    'GEMINI_MODEL', 'ADMIN_EMAIL', 'ALLOWLIST', 'MAIL_USER', 'MAIL_FORWARD_TO', 'MAIL_IMAP_HOST',
    'MAIL_IMAP_PORT', 'MAIL_SMTP_HOST', 'MAIL_SMTP_PORT', 'STRIPE_CURRENCY', 'NODE_ENV']) stiute.add(n)
  return Object.keys(process.env)
    .filter((n) => CUVINTE.test(n) && !stiute.has(n) && !/^(OPENAI|OPENROUTER)_(REALTIME|TTS|TRANSCRIBE|CHAT|WORK|TOP|IMAGE|SEARCH)/.test(n))
    .sort()
}

/** Rezumatul, ca panoul să poată spune într-o linie cum stă treaba. */
export function envSummary(): { total: number; lipsa: number; goale: number; nume: string[] } {
  const s = envCheck()
  const lipsa = s.filter((v) => !v.present)
  const goale = s.filter((v) => v.present && v.length === 0)
  return {
    total: s.length,
    lipsa: lipsa.length,
    goale: goale.length,
    // Numele celor care lipsesc SAU sunt goale — astea sunt de pus, nimic altceva.
    nume: [...lipsa, ...goale].map((v) => v.name),
  }
}

/** Ora la care a pornit procesul. Fără ea nu se poate răspunde la întrebarea
 *  care contează: „am scris cheia ÎNAINTE sau DUPĂ ce a pornit aplicația?" —
 *  o cheie scrisă după pornire nu intră până la repornirea containerului. */
export function processStartedAt(): string {
  return new Date(Date.now() - Math.round(process.uptime() * 1000)).toISOString()
}

/** Cheia Stripe e de test sau de live? Aceeași întrebare, alt loc. */
export function stripeMode(): 'live' | 'test' | 'lipsă' {
  if (!config.stripe.secretKey) return 'lipsă'
  return /_test_/.test(config.stripe.secretKey) ? 'test' : 'live'
}
