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
import { config } from '../config.js'

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
}

/** Variabilele fără de care o capabilitate anume moare. Lista e scrisă de mână
 *  dinadins: „tot ce e în env" ar include și lucruri care n-au treabă cu noi. */
const ASTEPTATE: { name: string; what: string; breaks: string }[] = [
  { name: 'OPENAI_API_KEY', what: 'vocea live + TTS + STT de rezervă', breaks: 'vocea nu pornește deloc' },
  { name: 'OPENROUTER_API_KEY', what: 'creierul (chat, gândire, traduceri)', breaks: 'nu răspunde nimic' },
  { name: 'DATABASE_URL', what: 'baza de date', breaks: 'conturi, credite, istoric — toate' },
  { name: 'SESSION_SECRET', what: 'sesiunile de login', breaks: 'nimeni nu poate rămâne logat' },
  { name: 'STRIPE_SECRET_KEY', what: 'plățile', breaks: 'nu se pot cumpăra credite' },
  { name: 'STRIPE_WEBHOOK_SECRET', what: 'confirmarea plăților de la Stripe', breaks: 'plata trece dar creditele nu intră' },
  { name: 'STRIPE_PUBLISHABLE_KEY', what: 'afișarea numărului cardului în panou', breaks: 'butonul „Vezi numărul cardului" nu apare' },
  { name: 'GOOGLE_CLIENT_ID', what: 'login cu Google', breaks: 'butonul Google nu merge' },
  { name: 'GOOGLE_CLIENT_SECRET', what: 'login cu Google', breaks: 'butonul Google nu merge' },
  { name: 'GEMINI_API_KEY', what: 'creier de rezervă + vedere', breaks: 'cade pe modele mai slabe' },
  { name: 'SERPER_API_KEY', what: 'căutarea pe web', breaks: 'nu poate căuta nimic pe internet' },
  { name: 'GOOGLE_MAPS_KEY', what: 'hărți, locuri, trasee bune', breaks: 'rămâne doar harta gratuită (OSM)' },
  { name: 'GOOGLE_TTS_API_KEY', what: 'vocea sintetizată Google', breaks: 'TTS-ul cade pe OpenAI' },
  { name: 'GOOGLE_API_KEY', what: 'alternativă pentru TTS/Gemini', breaks: '—' },
  { name: 'GOOGLE_SERVICE_ACCOUNT_JSON', what: 'Chirp 3 HD (auz/voce de calitate)', breaks: 'STT/TTS cad pe OpenAI' },
  { name: 'MAIL_USER', what: 'cutia contact@', breaks: 'nu se citesc/trimit emailuri' },
  { name: 'MAIL_PASS', what: 'cutia contact@', breaks: 'nu se citesc/trimit emailuri' },
  { name: 'GITHUB_TOKEN', what: 'mâinile lui Kelion pe runbook-uri', breaks: 'nu poate publica singur' },
  { name: 'BRIDGE_SECRET', what: 'raportările constructorului', breaks: 'constructorul nu poate raporta progresul' },
]

export function envCheck(): EnvVarState[] {
  return ASTEPTATE.map((v) => {
    const raw = process.env[v.name]
    return {
      name: v.name,
      what: v.what,
      present: raw != null,
      length: (raw ?? '').length,
      breaks: v.breaks,
    }
  })
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
