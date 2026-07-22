import 'dotenv/config'

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
  kimiKey: (process.env.KIMI_API_KEY ?? process.env.KIMI_KEY ?? '').trim(),
  glmKey: (process.env.GLM_API_KEY ?? process.env.GLM_KEY ?? '').trim(),
  autonomyDailyMax: Math.max(1, Number(process.env.AUTONOMY_DAILY_MAX ?? '20') || 20),
  databaseUrl: process.env.DATABASE_URL ?? '',
  googleServiceAccountJson: process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? '',
  googleTtsKey: process.env.GOOGLE_TTS_API_KEY ?? process.env.GOOGLE_API_KEY ?? '',
  ttsVoiceStyle: process.env.GOOGLE_TTS_VOICE ?? process.env.KELION_GOOGLE_CHIRP_TTS_STYLE ?? 'Charon',
  serperKey: process.env.SERPER_API_KEY ?? '',
  googleMapsKey: process.env.GOOGLE_MAPS_KEY ?? '',
  geminiKey: process.env.GEMINI_API_KEY ?? '',
  geminiModel: process.env.GEMINI_MODEL ?? 'gemini-2.5-flash',
  // VOCE LIVE — OpenAI Realtime (WebRTC). Cheia stă DOAR pe server; browserul
  // trimite oferta SDP la /api/realtime/session, backendul o relayează la OpenAI
  // și injectează server-side modelul + o SINGURĂ voce masculină + persona/limba.
  // Auto-update model din env (fără deploy) dacă OpenAI schimbă numele.
  openai: {
    key: (process.env.OPENAI_API_KEY ?? process.env.OPENAI_KEY ?? '').trim(),
    realtimeModel: (process.env.OPENAI_REALTIME_MODEL ?? 'gpt-realtime').trim(),
    // Voce masculină unică, persistentă pentru toți userii (Adrian: „o singură
    // voce, bărbat"). `cedar` = voce masculină caldă din catalogul Realtime.
    realtimeVoice: (process.env.OPENAI_REALTIME_VOICE ?? 'cedar').trim(),
  },
  // CREIERUL/CHAT-UL selectabil — o SINGURĂ cheie OpenRouter pentru toate
  // modelele (GPT/Gemini/Claude). Catalogul se ia LIVE din /api/v1/models (auto-
  // update: modele noi apar fără deploy). Costul REAL vine din răspuns
  // (usage.cost) → ledger precis. Voce = OpenAI direct (OpenRouter n-are realtime).
  openrouter: {
    key: (process.env.OPENROUTER_API_KEY ?? process.env.OPENROUTER_KEY ?? '').trim(),
    // Modele implicite per tier (editabile din env, fără deploy). Chat = rapid,
    // Work = raționament greu/tool-use.
    chatDefault: (process.env.OPENROUTER_CHAT_MODEL ?? 'openai/gpt-4.1-mini').trim(),
    workDefault: (process.env.OPENROUTER_WORK_MODEL ?? 'anthropic/claude-sonnet-5').trim(),
  },
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY ?? '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? '',
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
    pass: process.env.MAIL_PASS ?? '',
    forwardTo: (process.env.MAIL_FORWARD_TO ?? process.env.ADMIN_EMAIL ?? 'adrianenc11@gmail.com')
      .trim()
      .toLowerCase(),
  },
  demo: {
    seconds: Number(process.env.DEMO_SECONDS ?? 600),
    capPerDay: Number(process.env.DEMO_CAP_PER_DAY ?? 10),
  },
  openSignup: (process.env.OPEN_SIGNUP ?? '1') !== '0',
  allowlist: (process.env.ALLOWLIST ?? 'adrianenc11@gmail.com')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
  adminEmail: (process.env.ADMIN_EMAIL ?? 'adrianenc11@gmail.com').toLowerCase(),
  bridgeSecret: (process.env.BRIDGE_SECRET ?? '').trim(),
  livekit: {
    url: (process.env.LIVEKIT_URL ?? '').trim(),
    apiKey: (process.env.LIVEKIT_API_KEY ?? '').trim(),
    apiSecret: (process.env.LIVEKIT_API_SECRET ?? '').trim(),
  },
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
