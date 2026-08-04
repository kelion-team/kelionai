import 'dotenv/config'

// ── A KEY WRITTEN UNDER A DIFFERENT NAME IS NOT A MISSING KEY ──────────────
//
// Adrian, 30 Jul, twice: "all the keys have been written dozens of times."
// He was right, and the fault was this code. Look at what used to be below:
//   OPENAI_API_KEY     or  OPENAI_KEY      → two accepted names
//   OPENROUTER_API_KEY or  OPENROUTER_KEY  → two accepted names
//   GOOGLE_TTS_API_KEY or  GOOGLE_API_KEY  → two accepted names
//   GOOGLE_MAPS_KEY                        → ONE only, and without "_API_"
//   SERPER_API_KEY, GEMINI_API_KEY         → one each
// Someone had already hit the "I typed a different name" problem three times
// and patched it with aliases — but exactly on the ones that didn't work, no
// alias existed. And `MAPS` is the only one written without `_API_`, so the
// variant anyone normal would type (`GOOGLE_MAPS_API_KEY`) hit nothing. A key
// written under a reasonable name MUST be found; otherwise the user retypes it
// forever and we keep telling him "it's missing".
function env(...names: string[]): string {
  for (const n of names) {
    const v = process.env[n]
    if (v != null && v.trim() !== '') return v.trim()
  }
  return ''
}

/** All accepted names for each key. Exported so the admin panel can say
 *  "you typed X, I read Y" instead of "missing". */
export const ENV_ALIASES: Record<string, string[]> = {
  databaseUrl: ['DATABASE_URL', 'POSTGRES_URL'],
  googleServiceAccountJson: ['GOOGLE_SERVICE_ACCOUNT_JSON', 'GOOGLE_SERVICE_ACCOUNT', 'GCP_SERVICE_ACCOUNT_JSON'],
  googleTtsKey: ['GOOGLE_TTS_API_KEY', 'GOOGLE_TTS_KEY', 'GOOGLE_API_KEY'],
  serperKey: ['SERPER_API_KEY', 'SERPER_KEY'],
  // (googleMapsKey scos, 3 aug — cheia nu avea niciun consumator; vezi nota
  // de la fostul câmp config.googleMapsKey de mai jos.)
  geminiKey: ['GEMINI_API_KEY', 'GEMINI_KEY', 'GOOGLE_GEMINI_API_KEY'],
  julesKey: ['JULES_API_KEY', 'JULES_KEY'],
  mailPass: ['MAIL_PASS', 'MAIL_PASSWORD'],
  bridgeSecret: ['BRIDGE_SECRET'],
  sessionSecret: ['SESSION_SECRET'],
  githubToken: ['GITHUB_TOKEN', 'KELION_GITHUB_TOKEN'],
  useLocalVosk: ['USE_LOCAL_VOSK'],
  localVoskUrl: ['LOCAL_VOSK_URL'],
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
  useLocalVosk: env(...ENV_ALIASES.useLocalVosk) === '1',
  localVoskUrl: env(...ENV_ALIASES.localVoskUrl),
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
  // Chirp 3 HD voice style — MALE in every language (Adrian, Aug 2: "voce
  // masculina in orice limba"). Default Charon (male). services/tts.ts has a
  // hard guard: any known FEMALE style is rewritten to Charon before the API.
  ttsVoiceStyle: process.env.GOOGLE_TTS_VOICE ?? process.env.KELION_GOOGLE_CHIRP_TTS_STYLE ?? 'Charon',
  serperKey: env(...ENV_ALIASES.serperKey),
  // (Câmpul `googleMapsKey` a fost ȘTERS — auditul admin, 3 aug: nu-l citea
  // NIMENI. mapsSearch/mapsDirections/geocode merg exclusiv pe Nominatim OSM
  // + OSRM, cu sau fără cheie; rândul lui din env-check împingea ownerul să
  // configureze o cheie fără niciun efect — încălcarea regulii #4.)
  geminiKey: env(...ENV_ALIASES.geminiKey),
  // Jules — agentul asincron oficial Google (3 aug): cheia API din vps-keys.
  julesKey: env(...ENV_ALIASES.julesKey),
  // Creierul DIRECT (chat + VEDERE + AUDIO — Gemini e multimodal, un singur
  // model face tot). 4 aug 2026: trecut de la 'gemini-2.5-flash' (gen. veche) la
  // 'gemini-3.6-flash' — generația cea mai nouă, măsurat pe cheia ownerului că
  // acceptă imagine ȘI audio (IMAGINE 200✓ | AUDIO 200✓), deci nu strică
  // vederea/vocea. Suprascriibil din env (GEMINI_MODEL).
  geminiModel: process.env.GEMINI_MODEL ?? 'gemini-3.6-flash',
  // VIDEO — Veo prin cheia Gemini. NICIUN nivel gratuit (măsurat pe pagina
  // oficială de prețuri, 2 aug 2026) — de-aia plata cere alegerea conștientă
  // VIDEO_ALLOW_PAID=1, ca la constructor: nimic plătit din greșeală.
  videoModel: process.env.VIDEO_MODEL ?? 'veo-3.1-fast-generate-preview',
  videoAllowPaid: process.env.VIDEO_ALLOW_PAID === '1',
  // ── CREIERUL = GEMINI DIRECT, UNIC (Adrian, 3 aug, ordin repetat: „openrouter
  // și open ai scos din toată aplicația") ────────────────────────────────────
  // OpenRouter și OpenAI au fost EXTIRPATE complet (3 aug): creierul e Gemini
  // direct pe cheia Tier 2 a ownerului, căutarea e Serper, vocea e Google
  // Chirp 3 (urechi + gură). Treptele de mai jos sunt SINGURELE modele ale
  // creierului; toate poartă prefixul `google-direct/` (vezi geminiDirect.ts).
  // LACĂT ÎN COD (Adrian, 3 aug: „blochează-le cu cod ca să nu se mai schimbe
  // la orice update"): default sigur = Gemini, în cod, nu în env (care se poate
  // reseta). Lacătul (scripts/verifica-gemini.mjs + lacat.test.ts) pinuiește
  // toate trei treptele.
  brain: {
    // 4 aug 2026: toate treptele mutate de la generația 2.5 la 'gemini-3.6-flash'
    // — cea mai nouă, mai rapidă, mai ieftină, și măsurat multimodală (text +
    // apel de unealtă + imagine + audio, toate 200✓ pe cheia ownerului). „Tot pe
    // cel mai evoluat" (ordinul ownerului, 4 aug). Rămâne Gemini direct (lacătul).
    chatDefault: (process.env.BRAIN_CHAT_MODEL ?? 'google-direct/gemini-3.6-flash').trim(),
    workDefault: (process.env.BRAIN_WORK_MODEL ?? 'google-direct/gemini-3.6-flash').trim(),
    // Treapta 'top' — TOT 'gemini-3.6-flash'. Ownerul (4 aug): „dacă e bun, ieftin
    // și face tot, de ce 2 trepte?". Corect: un singur model multimodal, rapid și
    // ieftin acoperă toate treptele; nu inventăm o treaptă „pro" mai scumpă degeaba.
    // Rămâne suprascriibil din env dacă vreodată vrei o escaladare pe alt model.
    topDefault: (process.env.BRAIN_TOP_MODEL ?? 'google-direct/gemini-3.6-flash').trim(),
  },
  // ── COLLECTING MONEY THROUGH REVOLUT (Adrian, 30 Jul: "Stripe goes out
  // completely and Pro comes in") ────────────────────────────────────────────
  // The Revolut Pro account has no Merchant API (that's Business only), so
  // there's no webhook to credit the user by itself. What it DOES have is a
  // payment link hosted by Revolut: the user pays there, and the credits are
  // granted by the admin from the panel (`grantCredit`, which already
  // existed).
  //
  // The link lives in env, not in code: it changes without publishing, and
  // if it's missing the button SAYS it's not configured, instead of taking
  // the user into a void.
  revolut: {
    payLink: (process.env.REVOLUT_PAY_LINK ?? '').trim(),
    // The Gmail label where the owner routes Revolut payment emails; the
    // email-reader searches ONLY here (Adrian, 3 aug: „acolo trebuie să ajungă
    // emailurile și de acolo să se caute").
    mailLabel: (process.env.REVOLUT_MAIL_LABEL ?? 'Revolut_kelionai_plati').trim(),
  },
  // ── READING TRANSACTIONS FROM THE REVOLUT ACCOUNT (Open Banking) ─────────
  // How the app finds out a user paid, when Revolut Pro has no webhook: it
  // looks at the account transactions and searches for the code in the
  // reference.
  // Provider: ENABLE BANKING (enablebanking.com) — GoCardless/Nordigen closed
  // new accounts at the end of 2025, so it's dead for us (verified 31 Jul
  // 2026). The Enable Banking account is free in "Restricted Production" mode
  // (reading your own accounts). READ-ONLY ACCESS — no money moves.
  //
  // Authentication is via RS256 JWT: `appId` = the application id from the
  // Control Panel, `privateKeyB64` = the RSA private key as base64 (one line
  // — env files can't hold multi-line PEM). `accountUid` may be missing: the
  // account is linked through PSD2 consent and saved in kv_state (see
  // openBanking.ts).
  enableBanking: {
    appId: (process.env.ENABLE_BANKING_APP_ID ?? '').trim(),
    privateKeyB64: (process.env.ENABLE_BANKING_PRIVATE_KEY_B64 ?? '').trim(),
    accountUid: (process.env.ENABLE_BANKING_ACCOUNT_UID ?? '').trim(),
    aspspName: (process.env.ENABLE_BANKING_ASPSP_NAME ?? 'Revolut').trim(),
    aspspCountry: (process.env.ENABLE_BANKING_ASPSP_COUNTRY ?? 'GB').trim(),
  },
  // ── THE APP'S MONEY (Revolut + unique code; Stripe is HISTORY — 31 Jul
  // 2026) ───────────────────────────────────────────────────────────────────
  // Only the wallet math lives here: display currency, what one credit is
  // worth, and the top-up split (75% user credits / 25% admin fund that pays
  // the AI keys). Collection and payment detection: Revolut (payLink) + the
  // Enable Banking reader in openBanking.ts. No processor between the user
  // and Adrian's money.
  billing: {
    currency: (process.env.BILLING_CURRENCY ?? 'gbp').toLowerCase(),
    userShare: Number(process.env.USER_SHARE ?? 0.75),
    creditValue: Number(process.env.CREDIT_VALUE ?? 0.1),
    // ── THE TOP-UP RULES, AS OWNER SETTINGS (not buried constants) ──────────
    // Adrian, 24 Jul: "first top-up = £20 minimum (brain activation), then any
    // multiple of £5". Adrian, Aug 1 (auto top-up): the prepared pack obeys the
    // same rule and is capped at £500. Until now these lived as bare numbers
    // inside routes/billing.ts — money values written in code, invisible to
    // the man whose money they move. They are OWNER DECISIONS, so they live
    // here: documented, env-editable without a deploy.
    firstTopupMin: Number(process.env.BILLING_FIRST_TOPUP_MIN ?? 20),
    topupStep: Number(process.env.BILLING_TOPUP_STEP ?? 5),
    topupMin: Number(process.env.BILLING_TOPUP_MIN ?? 5),
    topupMax: Number(process.env.BILLING_TOPUP_MAX ?? 500),
    // The auto top-up DEFAULTS a brand-new user starts from (threshold in
    // CREDITS, amount in display currency). Same rule: owner settings, not
    // magic numbers inside db.ts.
    autoRechargeThreshold: Number(process.env.AUTORECHARGE_DEFAULT_THRESHOLD ?? 20),
    autoRechargeAmount: Number(process.env.AUTORECHARGE_DEFAULT_AMOUNT ?? 10),
    // The USD→£ hand rate was deleted: the only place that used it converted
    // REAL provider costs (USD) into £ with a hand-written rate — a converted
    // figure presented as a measured one (the exact fabrication punga.ts
    // killed). The owner's cost view is USD end to end now (spentUsd).
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
