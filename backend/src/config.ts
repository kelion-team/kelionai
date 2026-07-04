import 'dotenv/config'

function required(name: string): string {
  const v = process.env[name]
  if (!v || v.trim() === '') {
    throw new Error(`Missing required env var: ${name}`)
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
  // Optional so the app still boots before the key is added. The /api/chat
  // route returns a clear error if it's missing.
  // Trimmed: a stray space or newline pasted into the env var would otherwise be
  // sent verbatim and rejected by Anthropic as a 401 (invalid key).
  anthropicKey: (process.env.ANTHROPIC_API_KEY ?? '').trim(),
  // Reserve Anthropic key (a second billing account). The brain calls the
  // primary key; if that account is unusable (out of credit, auth/billing/rate
  // error) it fails over to this one automatically, so the brain never dies from
  // one account running dry. Optional — when unset there is simply no fallback.
  anthropicKeyReserve: (process.env.ANTHROPIC_API_KEY_RESERVE ?? '').trim(),
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
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY ?? '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? '',
    currency: (process.env.STRIPE_CURRENCY ?? 'gbp').toLowerCase(),
    // Credit model: on top-up the user KEEPS `userShare` (75%) as spendable
    // credit and `1 - userShare` (25%) is our profit — taken up front, not on
    // consumption. The user then spends their credit at REAL provider cost (1:1).
    userShare: Number(process.env.USER_SHARE ?? 0.75),
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
    seconds: Number(process.env.DEMO_SECONDS ?? 180), // 3 minutes
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
  frontendDist: process.env.FRONTEND_DIST ?? '../frontend/dist',
  frontendOrigin: process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173',
} as const

export function isAllowed(email: string): boolean {
  return config.openSignup || config.allowlist.includes(email.toLowerCase())
}

export function roleFor(email: string): 'admin' | 'customer' {
  return email.toLowerCase() === config.adminEmail ? 'admin' : 'customer'
}
