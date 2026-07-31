import 'dotenv/config'

// ── UN NUME SCRIS ALTFEL NU E O CHEIE LIPSĂ ─────────────────────────────────
//
// Adrian, 30 iul, de două ori: „toate cheile au fost scrise de zeci de ori."
// Avea dreptate, iar vina e a codului ăstuia. Uită-te la ce era mai jos:
//   OPENAI_API_KEY     sau OPENAI_KEY      → două nume acceptate
//   OPENROUTER_API_KEY sau OPENROUTER_KEY  → două nume acceptate
//   GOOGLE_TTS_API_KEY sau GOOGLE_API_KEY  → două nume acceptate
//   GOOGLE_MAPS_KEY                        → UNUL singur, și fără „_API_"
//   SERPER_API_KEY, GEMINI_API_KEY         → câte unul
// Cineva a lovit deja de trei ori problema „am scris alt nume" și a peticit-o cu
// alias-uri — dar exact pe cele care nu mergeau, alias nu exista. Iar `MAPS` e
// singura scrisă fără `_API_`, deci varianta pe care o scrie oricine normal
// (`GOOGLE_MAPS_API_KEY`) nimerea în gol. O cheie scrisă cu un nume rezonabil
// TREBUIE găsită; altfel omul o rescrie la nesfârșit și noi îi spunem „lipsește".
function env(...names: string[]): string {
  for (const n of names) {
    const v = process.env[n]
    if (v != null && v.trim() !== '') return v.trim()
  }
  return ''
}

/** Toate numele acceptate pentru fiecare cheie. Exportat ca panoul de admin să
 *  poată spune „ai scris X, eu citesc Y" în loc de „lipsește". */
export const ENV_ALIASES: Record<string, string[]> = {
  databaseUrl: ['DATABASE_URL', 'POSTGRES_URL'],
  googleServiceAccountJson: ['GOOGLE_SERVICE_ACCOUNT_JSON', 'GOOGLE_SERVICE_ACCOUNT', 'GCP_SERVICE_ACCOUNT_JSON'],
  googleTtsKey: ['GOOGLE_TTS_API_KEY', 'GOOGLE_TTS_KEY', 'GOOGLE_API_KEY'],
  serperKey: ['SERPER_API_KEY', 'SERPER_KEY'],
  googleMapsKey: ['GOOGLE_MAPS_KEY', 'GOOGLE_MAPS_API_KEY', 'MAPS_API_KEY', 'GOOGLE_MAP_KEY'],
  geminiKey: ['GEMINI_API_KEY', 'GEMINI_KEY', 'GOOGLE_GEMINI_API_KEY'],
  openaiKey: ['OPENAI_API_KEY', 'OPENAI_KEY'],
  openrouterKey: ['OPENROUTER_API_KEY', 'OPENROUTER_KEY'],
  stripeSecretKey: ['STRIPE_SECRET_KEY', 'STRIPE_SK'],
  stripePublishableKey: ['STRIPE_PUBLISHABLE_KEY', 'STRIPE_PUBLIC_KEY', 'STRIPE_PK'],
  stripeWebhookSecret: ['STRIPE_WEBHOOK_SECRET', 'STRIPE_WH_SECRET'],
  mailPass: ['MAIL_PASS', 'MAIL_PASSWORD'],
  bridgeSecret: ['BRIDGE_SECRET'],
  sessionSecret: ['SESSION_SECRET'],
  githubToken: ['GITHUB_TOKEN', 'KELION_GITHUB_TOKEN'],
}

function required(name: string): string {
  const v = process.env[name]
  if (!v || v.trim() === '') {
    return ''
  }
  return v
}

const isProd = process.env.NODE_ENV === 'production'

export const config = {
  isProd,
  port: Number(process.env.PORT ?? 8080),
  google: {
    clientId: required('GOOGLE_CLIENT_ID'),
    clientSecret: required('GOOGLE_CLIENT_SECRET'),
    redirectUri: required('GOOGLE_REDIRECT_URI'),
  },
  sessionSecret: required('SESSION_SECRET'),
  autonomyDailyMax: Math.max(1, Number(process.env.AUTONOMY_DAILY_MAX ?? '20') || 20),
  databaseUrl: env(...ENV_ALIASES.databaseUrl),
  googleServiceAccountJson: env(...ENV_ALIASES.googleServiceAccountJson),
  googleTtsKey: env(...ENV_ALIASES.googleTtsKey),
  ttsVoiceStyle: process.env.GOOGLE_TTS_VOICE ?? process.env.KELION_GOOGLE_CHIRP_TTS_STYLE ?? 'Charon',
  serperKey: env(...ENV_ALIASES.serperKey),
  googleMapsKey: env(...ENV_ALIASES.googleMapsKey),
  geminiKey: env(...ENV_ALIASES.geminiKey),
  geminiModel: process.env.GEMINI_MODEL ?? 'gemini-2.5-flash',
  // VOCE LIVE — OpenAI Realtime (WebRTC). Cheia stă DOAR pe server; browserul
  // trimite oferta SDP la /api/realtime/session, backendul o relayează la OpenAI
  // și injectează server-side modelul + o SINGURĂ voce masculină + persona/limba.
  // Auto-update model din env (fără deploy) dacă OpenAI schimbă numele.
  openai: {
    key: env(...ENV_ALIASES.openaiKey),
    realtimeModel: (process.env.OPENAI_REALTIME_MODEL ?? 'gpt-realtime').trim(),
    // CASCADĂ DE MODELE REALTIME (28 iul — dovadă live: `gpt-realtime` întorcea
    // 504 cu pagină Cloudflare pe TOATE încercările, deși cheia era validă
    // (200 pe /v1/models) și endpointul răspundea — ruta modelului primar era
    // căzută la OpenAI). Reîncercarea pe ACELAȘI model n-are nicio șansă când
    // chiar modelul e problema: încercările 2-3 trec pe modelele de rezervă.
    realtimeModelFallbacks: (process.env.OPENAI_REALTIME_MODEL_FALLBACKS ?? 'gpt-realtime-mini,gpt-4o-realtime-preview')
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean),
    // Voce masculină unică, persistentă pentru toți userii (Adrian, 24 iul:
    // „vocea e full-duplex, nu e masculină" — `cedar` suna neutru). `ash` =
    // voce CLAR masculină, caldă și naturală din catalogul Realtime (gentleman,
    // nimic strident/vulgar). Editabilă din env fără deploy.
    realtimeVoice: (process.env.OPENAI_REALTIME_VOICE ?? 'ash').trim(),
    // VOCILE PE CARE LE POATE ALEGE UN USER (Adrian, 30 iul: „își poate seta…
    // ce voce dorește… se ține minte per user"). În env, ca lista să se poată
    // schimba fără publicare, dacă OpenAI adaugă sau scoate o voce.
    // Un nume greșit NU strică vocea nimănui: sesiunea se reîncearcă automat cu
    // vocea implicită (vezi services/realtime.ts).
    realtimeVoices: (process.env.OPENAI_REALTIME_VOICES ?? 'alloy,ash,ballad,coral,echo,sage,shimmer,verse')
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean),
    // TTS pe OpenAI (aceeași cheie) — pentru salutul de pe landing + /api/tts.
    // Fără cheie Google TTS: OpenAI acoperă și asta (Adrian: „2 chei, punct").
    // `onyx` = voce masculină, consistentă cu vocea live.
    ttsModel: (process.env.OPENAI_TTS_MODEL ?? 'gpt-4o-mini-tts').trim(),
    // O SINGURĂ voce masculină în TOATĂ aplicația (Adrian, 24 iul: „unifică — acum
    // creierul o voce, chatul alta"). `ash` = EXACT vocea din Realtime (full-duplex),
    // disponibilă și la TTS → chatul scris sună IDENTIC cu vocea live, nu diferit.
    // Urmează vocea Realtime dacă e schimbată din env, ca să rămână mereu aceeași.
    ttsVoice: (process.env.OPENAI_TTS_VOICE ?? process.env.OPENAI_REALTIME_VOICE ?? 'ash').trim(),
    // STT de rezervă pe aceeași cheie OpenAI (auzul NU are voie să moară dacă
    // Realtime pică — Adrian, 24 iul: „nu mă aude"). Google STT rămâne primar
    // DOAR dacă există service account; altfel transcrie OpenAI.
    transcribeModel: (process.env.OPENAI_TRANSCRIBE_MODEL ?? 'gpt-4o-mini-transcribe').trim(),
    // DETECȚIA AUDIO în VOCE LIVE (Adrian, 24 iul: „detecția audio defectă,
    // necesar detecție ultra-performantă"). Modelul MARE `gpt-4o-transcribe`
    // (nu „mini") transcrie vorbirea userului în Realtime cu acuratețe maximă.
    realtimeTranscribeModel: (process.env.OPENAI_REALTIME_TRANSCRIBE_MODEL ?? 'gpt-4o-transcribe').trim(),
    // Cât de „nerăbdător" e VAD-ul semantic să decidă că userul a terminat de
    // vorbit: low=așteaptă mai mult (nu-l taie), high=răspunde repede. „auto" e
    // echilibrul recomandat de OpenAI.
    realtimeVadEagerness: (process.env.OPENAI_REALTIME_VAD_EAGERNESS ?? 'auto').trim(),
  },
  // CREIERUL/CHAT-UL selectabil — o SINGURĂ cheie OpenRouter pentru toate
  // modelele (GPT/Gemini/Claude). Catalogul se ia LIVE din /api/v1/models (auto-
  // update: modele noi apar fără deploy). Costul REAL vine din răspuns
  // (usage.cost) → ledger precis. Voce = OpenAI direct (OpenRouter n-are realtime).
  openrouter: {
    key: env(...ENV_ALIASES.openrouterKey),
    // Modele implicite per tier (editabile din env, fără deploy). Chat = rapid,
    // Work = raționament greu/tool-use.
    // GRATUIT IMPLICIT, TESTAT REAL (Adrian, 25 iul: „free default cu creștere
    // pe nivel de greutate"; „păstrăm în liste doar cele compatibile 100% la
    // voce și creier, vedere etc."): testat live pe OpenRouter cu apel de
    // unealtă real — `openai/gpt-oss-20b:free` chema unealta corect DAR scurgea
    // „gândire" internă murdară în content (`<|end|>` și fragmente incoerente),
    // și NU are vedere (catalogul: vision=false). `google/gemma-4-26b-a4b-it:free`
    // a ieșit CURAT (content gol, tool_call corect) ȘI are vedere reală — poze/
    // cadre de cameră merg direct pe treapta gratuită, fără escaladare.
    // (`google/gemma-4-31b-it:free`, testat în paralel, a picat pe 429 rate-limit
    // upstream chiar în timpul testului — evitat ca implicit din acest motiv.)
    // Escaladarea la treapta work (plătită) rămâne DOAR pe cereri grele/de
    // acțiune reală (taskDifficulty / hasActionIntent) — vezi selectedBrainModel
    // din chat.ts. Editabil din env dacă vrei alt model gratuit.
    chatDefault: (process.env.OPENROUTER_CHAT_MODEL ?? 'google/gemma-4-26b-a4b-it:free').trim(),
    // ── CREIERUL FULL FREE (Adrian, 27 iul: „da" pe schema $0 — creierul întreg
    // pe modele gratuite; plătită rămâne DOAR vocea OpenAI, care n-are alternativă
    // gratuită nicăieri, dovedit pe toate cele 345 de modele din catalog). ──────
    // ── CREIERUL, PUS DE ADRIAN PE 31 IUL: „pune-l creier nemotron-3-ultra" ───
    //
    // Era `nemotron-3-nano-omni-30b-a3b` — 30B totali, din care doar 3B ACTIVI.
    // Adică munca lui trecea printr-un model de treapta a treia, în timp ce cel
    // mai capabil creier gratuit din lume stătea nefolosit pe treapta 'top', pe
    // care se ajunge doar prin escaladare.
    //
    // Nemotron 3 Ultra: 550B parametri (55B activi), UN MILION de context,
    // unelte, raționament. Singurul model gratuit din catalog cu context de un
    // milion — următorul are 262k, de patru ori mai puțin.
    //
    // N-are vedere, și de-asta n-a putut fi ales până azi. Nu mai contează:
    // vederea se DELEGĂ (bestVisionModel + chat.ts) — doar tura cu poză merge
    // la un model care vede, restul rămân aici.
    //
    // CE ÎNSEAMNĂ GRATUIT AICI, măsurat, ca să nu fie surprize: $0 pe token,
    // 20 de cereri pe minut, și 1.000 pe zi — pragul de 1.000 (față de 50) se
    // deschide dacă s-au cumpărat vreodată $10 în cont, ceea ce e cazul.
    // Revenirea la altceva = o variabilă de env, fără deploy.
    workDefault: (process.env.OPENROUTER_WORK_MODEL ?? 'nvidia/nemotron-3-ultra-550b-a55b:free').trim(),
    // Treapta FINALĂ 'top' — același model. Nu mai are ce escalada peste el:
    // e cel mai capabil creier gratuit care există. Escaladarea rămâne în cod
    // pentru ziua în care treapta de sus va fi un model plătit.
    topDefault: (process.env.OPENROUTER_TOP_MODEL ?? 'nvidia/nemotron-3-ultra-550b-a55b:free').trim(),
    // Imagini prin OpenRouter (aceeași cheie) — model care întoarce imagine în
    // răspuns (`message.images[].image_url.url`). Fără cheie Gemini separată.
    imageModel: (process.env.OPENROUTER_IMAGE_MODEL ?? 'google/gemini-3.1-flash-image').trim(),
    // Căutare web prin OpenRouter: modelul de chat + plugin-ul `web` (orice model
    // îl acceptă). Fără cheie Serper. Model editabil din env.
    // FULL FREE (27 iul): modelul care rezumă căutarea e gratuit — costul rămas
    // e doar al plugin-ului web (per căutare), nu al modelului.
    searchModel: (process.env.OPENROUTER_SEARCH_MODEL ?? 'google/gemma-4-26b-a4b-it:free').trim(),
  },
  // ── ÎNCASAREA PRIN REVOLUT (Adrian, 30 iul: „Stripe se scoate total și intră
  // Pro") ──────────────────────────────────────────────────────────────────────
  // Contul Revolut Pro nu are Merchant API (aia e doar pe Business), deci nu
  // există webhook care să crediteze userul singur. Ce ARE e un link de plată
  // găzduit de Revolut: userul plătește acolo, iar creditele le acordă adminul
  // din panou (`grantCredit`, care exista deja).
  //
  // Linkul stă în env, nu în cod: se schimbă fără publicare, iar dacă lipsește
  // butonul SPUNE că nu e configurat, în loc să ducă userul într-un gol.
  revolut: {
    payLink: (process.env.REVOLUT_PAY_LINK ?? '').trim(),
  },
  // ── CITIREA TRANZACȚIILOR DIN CONTUL REVOLUT (Open Banking) ────────────────
  // Cum află aplicația că un user a plătit, când Revolut Pro n-are webhook:
  // se uită în tranzacțiile contului și caută codul din referință.
  // Cheile se iau gratuit de la bankaccountdata.gocardless.com; `accountId` e
  // contul legat după ce owner-ul dă consimțământul. ACCES DOAR DE CITIRE —
  // nu se poate mișca niciun ban prin ele.
  gocardless: {
    secretId: (process.env.GOCARDLESS_SECRET_ID ?? '').trim(),
    secretKey: (process.env.GOCARDLESS_SECRET_KEY ?? '').trim(),
    accountId: (process.env.GOCARDLESS_ACCOUNT_ID ?? '').trim(),
  },
  stripe: {
    secretKey: env(...ENV_ALIASES.stripeSecretKey),
    // Cheia PUBLICĂ (pk_live_…). NU e secret: Stripe o proiectează ca să stea în
    // pagina din browser. Aici e nevoie de ea pentru UN singur lucru — afișarea
    // numărului cardului virtual în panoul de admin prin Issuing Elements, unde
    // numărul se randează într-un iframe Stripe și NU trece prin serverul nostru.
    publishableKey: env(...ENV_ALIASES.stripePublishableKey),
    webhookSecret: env(...ENV_ALIASES.stripeWebhookSecret),
    currency: (process.env.STRIPE_CURRENCY ?? 'gbp').toLowerCase(),
    // Split banilor la fiecare alimentare: 75% devin credite pentru user, 25%
    // intră în fondul real al adminului (care plătește cheile AI). Adrian, iul:
    // „la admin știi ce trebuie cu 25%". Codul din topUpUser marca deja „user
    // 75% / margin 25%", dar implicitul era 0.7 — aliniat acum la cerință.
    userShare: Number(process.env.USER_SHARE ?? 0.75),
    creditValue: Number(process.env.CREDIT_VALUE ?? 0.1),
    usdToCurrency: Number(process.env.USD_TO_CURRENCY ?? 0.8),
  },
  mail: {
    imapHost: process.env.MAIL_IMAP_HOST ?? 'mail.privateemail.com',
    imapPort: Number(process.env.MAIL_IMAP_PORT ?? 993),
    smtpHost: process.env.MAIL_SMTP_HOST ?? 'mail.privateemail.com',
    smtpPort: Number(process.env.MAIL_SMTP_PORT ?? 465),
    user: (process.env.MAIL_USER ?? 'contact@kelionai.app').trim(),
    pass: env(...ENV_ALIASES.mailPass),
    forwardTo: (process.env.MAIL_FORWARD_TO ?? process.env.ADMIN_EMAIL ?? 'adrianenc11@gmail.com')
      .trim()
      .toLowerCase(),
  },
  openSignup: (process.env.OPEN_SIGNUP ?? '1') !== '0',
  allowlist: (process.env.ALLOWLIST ?? 'adrianenc11@gmail.com')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
  adminEmail: (process.env.ADMIN_EMAIL ?? 'adrianenc11@gmail.com').toLowerCase(),
  bridgeSecret: env(...ENV_ALIASES.bridgeSecret),
  githubToken: (process.env.GITHUB_TOKEN ?? '').trim(),
  githubRepo: (process.env.GITHUB_REPO ?? 'kelion-team/kelionai').trim(),
  frontendDist: process.env.FRONTEND_DIST ?? '../frontend/dist',
  frontendOrigin: process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173',
} as const

export function isAllowed(email: string): boolean {
  return config.openSignup || config.allowlist.includes(email.toLowerCase())
}

export function roleFor(email: string): 'admin' | 'customer' {
  return email.toLowerCase() === config.adminEmail ? 'admin' : 'customer'
}
