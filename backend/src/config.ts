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
  anthropicKey: process.env.ANTHROPIC_API_KEY ?? '',
  // Google Cloud Text-to-Speech (Chirp 3 HD). Two auth paths (prefer the
  // service account, which is what the backup provides). When neither is set,
  // the frontend falls back to the browser voice.
  googleServiceAccountJson: process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? '',
  googleTtsKey: process.env.GOOGLE_TTS_API_KEY ?? process.env.GOOGLE_API_KEY ?? '',
  // Chirp 3 HD voice style (male, academic). Voice = `${lang}-Chirp3-HD-${style}`.
  ttsVoiceStyle: process.env.GOOGLE_TTS_VOICE ?? process.env.KELION_GOOGLE_CHIRP_TTS_STYLE ?? 'Charon',
  // Serper.dev — real live Google web search for the web_search tool. Optional.
  serperKey: process.env.SERPER_API_KEY ?? '',
  // v1 access gate — only these emails may enter. Lower-cased for comparison.
  allowlist: (process.env.ALLOWLIST ?? 'adrianenc11@gmail.com')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
  adminEmail: (process.env.ADMIN_EMAIL ?? 'adrianenc11@gmail.com').toLowerCase(),
  frontendDist: process.env.FRONTEND_DIST ?? '../frontend/dist',
  frontendOrigin: process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173',
} as const

export function isAllowed(email: string): boolean {
  return config.allowlist.includes(email.toLowerCase())
}

export function roleFor(email: string): 'admin' | 'customer' {
  return email.toLowerCase() === config.adminEmail ? 'admin' : 'customer'
}
