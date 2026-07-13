import 'dotenv/config'

function required(name: string): string {
  const v = process.env[name]
  if (!v || v.trim() === '') {
    // Audit 9 iul: nu mai aruncăm eroare la import pentru a preveni crash-ul silențios al serverului
    // Validarea se va face la runtime când serviciul respectiv este accesat.
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
  // CREIERUL — Kimi (primar) → GLM (rezervă). Anthropic/Max a fost SCOS COMPLET
  // (ordinul lui Adrian, 12 iul: „renunț la Anthropic, rămâne Kimi și GLM").
  // Ambele endpoint-uri sunt compatibile Anthropic-API, deci folosim același SDK
  // doar cu baseURL + cheie schimbate. Opțional la boot; /api/chat dă eroare
  // clară dacă lipsesc. Trimmed: un spațiu/newline lipit ar fi respins ca 401.
  // Cheile din Railway env: KIMI_API_KEY, GLM_API_KEY (acceptăm și numele scurte
  // KIMI_KEY/GLM_KEY, ca pe VPS).
  kimiKey: (process.env.KIMI_API_KEY ?? process.env.KIMI_KEY ?? '').trim(),
  glmKey: (process.env.GLM_API_KEY ?? process.env.GLM_KEY ?? '').trim(),
  // Autonomie în lesă (Adrian, 9 iul): plafonul de acțiuni autonome (reparații
  // auto declanșate de supervizor / verificare live) pe o fereastră rulantă de
  // 24h. Peste el, autonomia ÎNGHEAȚĂ și Kelion cere OK — ca să nu macine la
  // infinit pe cota lui Adrian. Reglabil din env; implicit 20.
  autonomyDailyMax: Math.max(1, Number(process.env.AUTONOMY_DAILY_MAX ?? '20') || 20),
  // Optional so the app boots without a DB (chat just isn't persisted then).
  databaseUrl: process.env.DATABASE_URL ?? '',
  // Google Cloud Text-to-Speech (Chirp 3 HD). Two auth paths (prefer the
  // service account, which is what the backup provides). When neither is set,
  // the frontend falls back to the browser voice.
  googleServiceAccountJson: process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? '',
  googleTtsKey: process.env.GOOGLE_TTS_API_KEY ?? process.env.GOOGLE_API_KEY ?? '',
  // Chirp 3 HD voice style (male, academic). Voice = `${lang}-Chirp3-HD-${style}`.
  ttsVoiceStyle: process.env.GOOGLE_TTS_VOICE ?? process.env.KELION_GOOGLE_CHIRP_TTS_STYLE ?? 'Charon',
  // Serper.dev — real live Google web search for the web_search tool. Optional.
  serperKey: process.env.SERPER_API_KEY ?? '',
  // Google Maps Embed API key — when set, routes are shown on Google Maps (with
  // traffic); otherwise we fall back to our own Leaflet/OSM route map.
  googleMapsKey: process.env.GOOGLE_MAPS_KEY ?? '',
  // Gemini (Google Generative Language API) — used ONLY to clean up low-confidence
  // speech transcripts before they reach Claude (hearing-level correction, not
  // reasoning). Optional: when unset, transcripts pass through uncorrected.
  geminiKey: process.env.GEMINI_API_KEY ?? '',
  geminiModel: process.env.GEMINI_MODEL ?? 'gemini-2.5-flash',
  // Stripe — prepaid credit wallet. Users buy credit; usage is metered against
  // it at cost ÷ marginDivisor so 25% of revenue is our margin. Optional so the
  // app still boots (and stays free/ungated) before Stripe is configured.
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY ?? '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? '',
    currency: (process.env.STRIPE_CURRENCY ?? 'gbp').toLowerCase(),
    // Credit model (Adrian, 13 iul: „va fi 30% platformă"): on top-up the user
    // KEEPS `userShare` (70%) as spendable credit and `1 - userShare` (30%) is
    // the platform's cut — taken up front, not on consumption. The user then
    // spends their credit at REAL provider cost (1:1) din pacul comun Kimi/GLM.
    // NOTĂ: dacă USER_SHARE e setat în Railway (era 0.75), trebuie pus 0.70 sau
    // șters, altfel env-ul câștigă peste acest implicit.
    userShare: Number(process.env.USER_SHARE ?? 0.7),
    // The user's wallet is shown in CREDITS; 1 credit = this much display currency.
    creditValue: Number(process.env.CREDIT_VALUE ?? 0.1),
    // USD→display-currency conversion (provider costs are USD; wallet is GBP).
    usdToCurrency: Number(process.env.USD_TO_CURRENCY ?? 0.8),
  },
  // Email (contact@kelionai.app on Namecheap Private Email — IMAP/SMTP). Kelion
  // reads incoming mail, replies in the sender's language in the royal-letter
  // format, and forwards the important ones to the admin. The PASSWORD is never
  // in code — set MAIL_PASS in the deploy env; empty = the mail feature is off.
  mail: {
    imapHost: process.env.MAIL_IMAP_HOST ?? 'mail.privateemail.com',
    imapPort: Number(process.env.MAIL_IMAP_PORT ?? 993),
    smtpHost: process.env.MAIL_SMTP_HOST ?? 'mail.privateemail.com',
    smtpPort: Number(process.env.MAIL_SMTP_PORT ?? 465),
    user: (process.env.MAIL_USER ?? 'contact@kelionai.app').trim(),
    pass: process.env.MAIL_PASS ?? '',
    // Where "truly important" mail gets forwarded (defaults to the admin).
    forwardTo: (process.env.MAIL_FORWARD_TO ?? process.env.ADMIN_EMAIL ?? 'adrianenc11@gmail.com')
      .trim()
      .toLowerCase(),
  },
  // Free trial ("demo") for the landing page: a full-access taste, time-boxed,
  // with a daily cap so it can never drain the provider pool.
  demo: {
    // 10 minute cu TOATE atributele active (ordin Adrian, 10 iul) — demo-ul vinde.
    seconds: Number(process.env.DEMO_SECONDS ?? 600), // 10 minutes
    capPerDay: Number(process.env.DEMO_CAP_PER_DAY ?? 10),
  },
  // SALES ARE OPEN: any Google account signs in as a customer — the prepaid
  // wallet is the real gate (no credit → clean stop, nothing consumed). Set
  // OPEN_SIGNUP=0 to close the doors back down to the allowlist below.
  openSignup: (process.env.OPEN_SIGNUP ?? '1') !== '0',
  // Fallback gate when signup is closed — only these emails may enter.
  allowlist: (process.env.ALLOWLIST ?? 'adrianenc11@gmail.com')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
  adminEmail: (process.env.ADMIN_EMAIL ?? 'adrianenc11@gmail.com').toLowerCase(),
  // Admin bridge: routes the ADMIN's Kelion chat to the owner's local Claude
  // Code (his subscription) instead of the paid API. Shared secret between this
  // server and the local worker on the owner's PC. Optional — unset = bridge off.
  bridgeSecret: (process.env.BRIDGE_SECRET ?? '').trim(),
  // LiveKit self-hosted on the VPS (full-duplex voice). Generated automatically
  // by bridge/kelion-livekit; empty until the VPS script runs.
  livekit: {
    url: (process.env.LIVEKIT_URL ?? '').trim(),
    apiKey: (process.env.LIVEKIT_API_KEY ?? '').trim(),
    apiSecret: (process.env.LIVEKIT_API_SECRET ?? '').trim(),
  },
  frontendDist: process.env.FRONTEND_DIST ?? '../frontend/dist',
  frontendOrigin: process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173',
} as const

export function isAllowed(email: string): boolean {
  return config.openSignup || config.allowlist.includes(email.toLowerCase())
}

export function roleFor(email: string): 'admin' | 'customer' {
  return email.toLowerCase() === config.adminEmail ? 'admin' : 'customer'
}
