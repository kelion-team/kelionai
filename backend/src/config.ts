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
  googleMapsKey: ['GOOGLE_MAPS_KEY', 'GOOGLE_MAPS_API_KEY', 'MAPS_API_KEY', 'GOOGLE_MAP_KEY'],
  geminiKey: ['GEMINI_API_KEY', 'GEMINI_KEY', 'GOOGLE_GEMINI_API_KEY'],
  openaiKey: ['OPENAI_API_KEY', 'OPENAI_KEY'],
  openrouterKey: ['OPENROUTER_API_KEY', 'OPENROUTER_KEY'],
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
  // LIVE VOICE — OpenAI Realtime (WebRTC). The key lives ONLY on the server;
  // the browser sends the SDP offer to /api/realtime/session, the backend
  // relays it to OpenAI and injects server-side the model + ONE male voice +
  // persona/language. Model auto-update from env (no deploy) if OpenAI
  // changes the name.
  openai: {
    key: env(...ENV_ALIASES.openaiKey),
    realtimeModel: (process.env.OPENAI_REALTIME_MODEL ?? 'gpt-realtime').trim(),
    // REALTIME MODEL FALLBACK CHAIN (28 Jul — live proof: `gpt-realtime`
    // returned 504 with a Cloudflare page on EVERY attempt, even though the
    // key was valid (200 on /v1/models) and the endpoint responded — the
    // primary model's route was down at OpenAI). Retrying the SAME model has
    // no chance when the model itself is the problem: attempts 2-3 move on to
    // the fallback models.
    realtimeModelFallbacks: (process.env.OPENAI_REALTIME_MODEL_FALLBACKS ?? 'gpt-realtime-mini,gpt-realtime-1.5')
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean),
    // Single male voice, persistent for all users (Adrian, 24 Jul: "the voice
    // is full-duplex, it's not male" — `cedar` sounded neutral). `ash` = a
    // CLEARLY male voice, warm and natural from the Realtime catalog
    // (gentleman, nothing shrill/vulgar). Editable from env without a deploy.
    realtimeVoice: (process.env.OPENAI_REALTIME_VOICE ?? 'ash').trim(),
    // THE VOICES A USER CAN CHOOSE FROM (Adrian, 30 Jul: "he can set... which
    // voice he wants... it's remembered per user"). In env, so the list can
    // change without publishing, if OpenAI adds or removes a voice.
    // A wrong name does NOT break anyone's voice: the session automatically
    // retries with the default voice (see services/realtime.ts).
    realtimeVoices: (process.env.OPENAI_REALTIME_VOICES ?? 'alloy,ash,ballad,coral,echo,sage,shimmer,verse')
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean),
    // TTS on OpenAI (same key) — for the landing greeting + /api/tts.
    // Without a Google TTS key: OpenAI covers this too (Adrian: "2 keys,
    // period"). `onyx` = male voice, consistent with the live voice.
    ttsModel: (process.env.OPENAI_TTS_MODEL ?? 'gpt-4o-mini-tts').trim(),
    // ONE male voice across the WHOLE app (Adrian, 24 Jul: "unify — right now
    // the brain has one voice, the chat another"). `ash` = EXACTLY the voice
    // from Realtime (full-duplex), also available in TTS → written chat
    // sounds IDENTICAL to the live voice, not different. Follows the Realtime
    // voice if changed from env, so they always stay the same.
    ttsVoice: (process.env.OPENAI_TTS_VOICE ?? process.env.OPENAI_REALTIME_VOICE ?? 'ash').trim(),
    // Fallback STT on the same OpenAI key (hearing MUST NOT die if Realtime
    // goes down — Adrian, 24 Jul: "it can't hear me"). Google STT stays
    // primary ONLY if a service account exists; otherwise OpenAI transcribes.
    transcribeModel: (process.env.OPENAI_TRANSCRIBE_MODEL ?? 'gpt-4o-mini-transcribe').trim(),
    // AUDIO DETECTION in LIVE VOICE (Adrian, 24 Jul: "audio detection broken,
    // ultra-performant detection needed"). The BIG `gpt-4o-transcribe` model
    // (not "mini") transcribes the user's speech in Realtime with maximum
    // accuracy.
    realtimeTranscribeModel: (process.env.OPENAI_REALTIME_TRANSCRIBE_MODEL ?? 'gpt-4o-transcribe').trim(),
    // How "eager" the semantic VAD is to decide the user finished speaking:
    // low=waits longer (doesn't cut him off), high=responds fast. "auto" is
    // the balance recommended by OpenAI.
    realtimeVadEagerness: (process.env.OPENAI_REALTIME_VAD_EAGERNESS ?? 'auto').trim(),
  },
  // SELECTABLE BRAIN/CHAT — ONE OpenRouter key for all models
  // (GPT/Gemini/Claude). The catalog is fetched LIVE from /api/v1/models
  // (auto-update: new models appear without a deploy). The REAL cost comes
  // from the response (usage.cost) → precise ledger. Voice = OpenAI direct
  // (OpenRouter has no realtime).
  openrouter: {
    key: env(...ENV_ALIASES.openrouterKey),
    // Default models per tier (editable from env, no deploy). Chat = fast,
    // Work = heavy reasoning/tool-use.
    // FREE BY DEFAULT, REALLY TESTED (Adrian, 25 Jul: "free default with
    // scaling by difficulty level"; "we keep in the lists only the ones 100%
    // compatible with voice and brain, vision etc."): tested live on
    // OpenRouter with a real tool call — `openai/gpt-oss-20b:free` called the
    // tool correctly BUT leaked dirty internal "thinking" into the content
    // (`<|end|>` and incoherent fragments), and has NO vision (catalog:
    // vision=false). `google/gemma-4-26b-a4b-it:free` came out CLEAN (empty
    // content, correct tool_call) AND has real vision — photos/camera frames
    // work directly on the free tier, no escalation needed.
    // (`google/gemma-4-31b-it:free`, tested in parallel, failed on a 429
    // upstream rate-limit right during the test — avoided as default for
    // this reason.)
    // Escalation to the work tier (paid) stays ONLY on heavy/real-action
    // requests (taskDifficulty / hasActionIntent) — see selectedBrainModel in
    // chat.ts. Editable from env if you want a different free model.
    chatDefault: (process.env.OPENROUTER_CHAT_MODEL ?? 'google/gemma-4-26b-a4b-it:free').trim(),
    // ── FULL FREE BRAIN (Adrian, 27 Jul: "yes" to the $0 plan — the whole
    // brain on free models; paid remains ONLY the OpenAI voice, which has no
    // free alternative anywhere, proven across all 345 models in the
    // catalog). ─────────────────────────────────────────────────────────────
    // ── THE BRAIN, SET BY ADRIAN ON 31 JUL: "make the brain nemotron-3-ultra"
    //
    // It was `nemotron-3-nano-omni-30b-a3b` — 30B total, of which only 3B
    // ACTIVE. Meaning its work went through a third-tier model, while the
    // most capable free brain in the world sat unused on the 'top' tier,
    // reachable only through escalation.
    //
    // Nemotron 3 Ultra: 550B parameters (55B active), ONE MILLION context,
    // tools, reasoning. The only free model in the catalog with a
    // one-million context — the next one has 262k, four times less.
    //
    // It has no vision, and that's why it couldn't be picked until today.
    // That no longer matters: vision is DELEGATED (bestVisionModel +
    // chat.ts) — only the turn with a photo goes to a model that sees, the
    // rest stays here.
    //
    // WHAT FREE MEANS HERE, measured, so there are no surprises: $0 per
    // token, 20 requests per minute, and 1,000 per day — the 1,000 cap
    // (versus 50) unlocks if $10 has ever been bought on the account, which
    // is the case. Reverting to something else = one env variable, no
    // deploy.
    // ── 31 Jul, evening: "you broke the whole app, nothing works" ──────────
    //
    // I had put Ultra 550B on THIS tier too (the base), not just at the top.
    // Meaning EVERY owner message — even "hello" — went to a 550B model that
    // thinks internally for whole seconds, on the free tier with 20 requests
    // per minute. Result: slow at everything, and a tool turn (up to 8 calls)
    // hit 429 and the chat "didn't work". His order was "make Ultra the
    // brain" — but a brain for WORK, not a parrot for every word.
    //
    // Correct, and that was exactly the point of the tiers: a fast BASE
    // (Gemma 4 26B, 4B active — answers instantly, sees, knows tools), while
    // Ultra stays at 'top' and enters through automatic ESCALATION when the
    // task is heavy (selectedBrainModel in chat.ts). So: "hello" on Gemma,
    // "find the cause of the bug across the whole repo" on Ultra. Without him
    // pressing anything.
    workDefault: (process.env.OPENROUTER_WORK_MODEL ?? 'google/gemma-4-26b-a4b-it:free').trim(),
    // The FINAL 'top' tier — same model. There's nothing left to escalate
    // above it: it's the most capable free brain that exists. Escalation
    // stays in the code for the day the top tier becomes a paid model.
    topDefault: (process.env.OPENROUTER_TOP_MODEL ?? 'nvidia/nemotron-3-ultra-550b-a55b:free').trim(),
    // Images through OpenRouter (same key) — a model that returns an image in
    // the response (`message.images[].image_url.url`). No separate Gemini
    // key.
    imageModel: (process.env.OPENROUTER_IMAGE_MODEL ?? 'google/gemini-3.1-flash-image').trim(),
    // Web search through OpenRouter: the chat model + the `web` plugin (any
    // model accepts it). No Serper key. Model editable from env.
    // FULL FREE (27 Jul): the model summarizing the search is free — the
    // remaining cost is only the web plugin's (per search), not the model's.
    searchModel: (process.env.OPENROUTER_SEARCH_MODEL ?? 'google/gemma-4-26b-a4b-it:free').trim(),
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
