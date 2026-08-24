import 'dotenv/config'
import { readFileSync, statSync } from 'node:fs'
import { BILLING_POLICY } from './services/billingPolicy.js'
import {
  OFFLINE_SYNC_DEFAULT_MAX_TEXT_CHARS,
  OFFLINE_SYNC_DEFAULT_MAX_TURNS,
} from './shared/offlineSyncPolicy.js'

// ── A KEY WRITTEN UNDER A DIFFERENT NAME IS NOT A MISSING KEY ──────────────
//
// Adrian, 30 Jul, twice: "all the keys have been written dozens of times."
// He was right, and the fault was this code. Look at what used to be below:
//   OPENAI_API_KEY                         → canonical runtime key
//   GOOGLE_TTS_API_KEY or  GOOGLE_API_KEY  → two accepted names
//   GOOGLE_MAPS_KEY                        → ONE only, and without "_API_"
//   SERPER_API_KEY                         → one canonical name
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
    const secretFile = process.env[`${n}_FILE`]?.trim()
    if (secretFile) {
      try {
        if (statSync(secretFile).size > 65_536) throw new Error('secret_file_too_large')
        const fromFile = readFileSync(secretFile, 'utf8').trim()
        if (fromFile) return fromFile
      } catch {
        if (process.env.NODE_ENV === 'production') {
          throw new Error(`${n}_FILE nu poate fi citit în siguranță`)
        }
      }
    }
  }
  return ''
}

/** All accepted names for each key. Exported so the admin panel can say
 *  "you typed X, I read Y" instead of "missing". */
export const ENV_ALIASES: Record<string, string[]> = {
  databaseUrl: ['DATABASE_URL', 'POSTGRES_URL'],
  serperKey: ['SERPER_API_KEY', 'SERPER_KEY'],
  // (googleMapsKey scos, 3 aug — cheia nu avea niciun consumator; vezi nota
  // de la fostul câmp config.googleMapsKey de mai jos.)
  // OpenAI is the single online AI provider. Runtime inference accepts only
  // the project-scoped key; the Codex worker authenticates separately.
  openaiKey: ['OPENAI_API_KEY'],
  openaiLuna: ['OPENAI_LUNA_MODEL'],
  openaiMedium: ['OPENAI_MEDIUM_MODEL'],
  openaiHeavy: ['OPENAI_HEAVY_MODEL'],
  openaiMax: ['OPENAI_MAX_MODEL'],
  openaiRealtime: ['OPENAI_REALTIME_MODEL'],
  openaiRealtimeTranscription: ['OPENAI_REALTIME_TRANSCRIPTION_MODEL'],
  openaiCallTranscription: ['OPENAI_CALL_TRANSCRIPTION_MODEL'],
  openaiTts: ['OPENAI_TTS_MODEL'],
  openaiImage: ['OPENAI_IMAGE_MODEL'],
  codexWorkerSecret: ['CODEX_WORKER_SECRET'],
  constructorPublisherSecret: ['CONSTRUCTOR_PUBLISHER_SECRET'],
  constructorReleaseSecret: ['CONSTRUCTOR_RELEASE_SECRET'],
  browserWorkerSecret: ['BROWSER_WORKER_SECRET'],
  converterWorkerSecret: ['CONVERTER_WORKER_SECRET'],
  vapidPublicKey: ['VAPID_PUBLIC_KEY'],
  revolutMerchantSecretKey: ['REVOLUT_MERCHANT_SECRET_KEY'],
  revolutWebhookSigningSecret: ['REVOLUT_WEBHOOK_SIGNING_SECRET'],
  visitorChatTtlSeconds: ['VISITOR_CHAT_TTL_SECONDS'],
  visitorAnalyticsRetentionDays: ['VISITOR_ANALYTICS_RETENTION_DAYS'],
  mailPass: ['MAIL_PASS', 'MAIL_PASSWORD'],
  sessionSecret: ['SESSION_SECRET'],
  googleTokenEncryptionKey: ['GOOGLE_TOKEN_ENCRYPTION_KEY'],
  googleTokenEncryptionPreviousKey: ['GOOGLE_TOKEN_ENCRYPTION_PREVIOUS_KEY'],
  githubToken: ['GITHUB_TOKEN', 'KELION_GITHUB_TOKEN'],
}

function required(name: string): string {
  const v = env(name)
  if (!v || v.trim() === '') {
    // FAIL-FAST ÎN PRODUCȚIE (audit 9 aug): „required" care întoarce '' nu
    // cere nimic — un SESSION_SECRET lipsă lăsa serverul să booteze tăcut,
    // login-ul dădea 500 și TOATE cookie-urile mureau mut. Mai bine o pornire
    // care ȚIPĂ (anti-fantoma publicării o prinde pe loc: containerul nu urcă,
    // live rămâne pe versiunea bună) decât un server care minte. Toate cele 4
    // nume gardate aici sunt deja obligatorii și în poarta de env din deploy.sh.
    if (process.env.NODE_ENV === 'production') {
      throw new Error(`env obligatoriu LIPSĂ sau GOL: ${name} — completează-l în kelionai.env (poarta din deploy.sh îl cere și ea)`)
    }
    return ''
  }
  return v
}

/** Secrets that may be injected directly only in development/tests. Production
 * accepts the mounted `*_FILE` form exclusively, so the value never appears in
 * container metadata or a generic application KV. */
function fileOnlySecret(name: string): string {
  const direct = process.env[name]?.trim() ?? ''
  const secretFile = process.env[`${name}_FILE`]?.trim() ?? ''
  const production = process.env.NODE_ENV === 'production'
  if (production && direct) throw new Error(`${name} trebuie montat exclusiv prin ${name}_FILE`)
  if (!secretFile) return production ? '' : direct
  try {
    if (statSync(secretFile).size > 65_536) throw new Error('secret_file_too_large')
    return readFileSync(secretFile, 'utf8').trim()
  } catch {
    if (production) throw new Error(`${name}_FILE nu poate fi citit în siguranță`)
    return ''
  }
}

const isProd = process.env.NODE_ENV === 'production'
const codexWorkerEnabled = process.env.CODEX_WORKER_ENABLED === '1'
const constructorPublisherEnabled = process.env.CONSTRUCTOR_PUBLISHER_ENABLED === '1'
const constructorReleaseEnabled = process.env.CONSTRUCTOR_RELEASE_ENABLED === '1'
const pushEnabled = process.env.PUSH_ENABLED === '1'

function constructorServiceSecret(name: string, enabled: boolean): string {
  const value = fileOnlySecret(name)
  if (isProd && enabled && value.length < 32) {
    throw new Error(`${name}_FILE trebuie să conțină cel puțin 32 de caractere când serviciul este activ`)
  }
  return value
}

function configuredPushHosts(): string[] {
  const hosts = (process.env.PUSH_ENDPOINT_HOSTS ?? '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean)
  if (hosts.some((host) => !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host))) {
    throw new Error('PUSH_ENDPOINT_HOSTS conține un domeniu invalid')
  }
  if (pushEnabled && hosts.length === 0) throw new Error('PUSH_ENDPOINT_HOSTS este obligatoriu când push este activ')
  return [...new Set(hosts)]
}

const pushPublicKey = env(...ENV_ALIASES.vapidPublicKey)
const pushPrivateKey = fileOnlySecret('VAPID_PRIVATE_KEY')
const pushEndpointHosts = configuredPushHosts()
if (pushEnabled) {
  if (!/^[A-Za-z0-9_-]{87}$/.test(pushPublicKey)) throw new Error('VAPID_PUBLIC_KEY este invalidă')
  if (!/^[A-Za-z0-9_-]{43}$/.test(pushPrivateKey)) throw new Error('VAPID_PRIVATE_KEY_FILE conține o cheie invalidă')
}

type ProductConfig = {
  appName: string
  appVersion: string
  publicAppOrigin: string
  githubRepository: string
  supportEmail: string
  nativeScheme: string
  nativeOrigins: string[]
  nativeRedirects: { ios: string; desktop: string }
  androidApplicationId: string
  iosBundleId: string
}

function loadProductConfig(): ProductConfig {
  try {
    const parsed = JSON.parse(readFileSync(new URL('../../config/product.json', import.meta.url), 'utf8')) as Partial<ProductConfig>
    const origin = new URL(String(parsed.publicAppOrigin ?? ''))
    if (origin.protocol !== 'https:' || origin.origin !== parsed.publicAppOrigin) throw new Error('origin_invalid')
    if (!/^[A-Za-z][A-Za-z0-9 ._-]{1,63}$/.test(String(parsed.appName ?? ''))) throw new Error('app_name_invalid')
    if (!/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(String(parsed.appVersion ?? ''))) throw new Error('app_version_invalid')
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(parsed.supportEmail ?? ''))) throw new Error('support_email_invalid')
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(String(parsed.githubRepository ?? ''))) throw new Error('repository_invalid')
    if (!/^[a-z][a-z0-9+.-]{1,31}$/.test(String(parsed.nativeScheme ?? ''))) throw new Error('native_scheme_invalid')
    if (!Array.isArray(parsed.nativeOrigins) || parsed.nativeOrigins.length === 0) throw new Error('native_origins_invalid')
    const nativeOriginStrings = parsed.nativeOrigins.map((raw) => String(raw))
    const nativeOrigins = nativeOriginStrings.map((raw) => new URL(raw))
    if (nativeOrigins.some((u, index) => u.origin !== 'null' && u.origin !== nativeOriginStrings[index])) {
      throw new Error('native_origins_invalid')
    }
    if (nativeOrigins.some((u) => !['capacitor:', 'tauri:', 'http:'].includes(u.protocol))) {
      throw new Error('native_origins_invalid')
    }
    const iosRedirect = new URL(String(parsed.nativeRedirects?.ios ?? ''))
    const desktopRedirect = new URL(String(parsed.nativeRedirects?.desktop ?? ''))
    if (iosRedirect.origin !== origin.origin || iosRedirect.pathname !== '/auth/native/complete' || iosRedirect.search || iosRedirect.hash) {
      throw new Error('native_ios_redirect_invalid')
    }
    if (desktopRedirect.protocol !== `${parsed.nativeScheme}:` || desktopRedirect.hostname !== 'auth' || desktopRedirect.pathname !== '/native/complete') {
      throw new Error('native_desktop_redirect_invalid')
    }
    if (![parsed.androidApplicationId, parsed.iosBundleId].every((v) => /^[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)+$/.test(String(v ?? '')))) {
      throw new Error('package_id_invalid')
    }
    return parsed as ProductConfig
  } catch {
    throw new Error('config/product.json lipsește sau este invalid')
  }
}

const productConfig = loadProductConfig()

type EndpointConfig = {
  openaiApiBase: string
  serperApiBase: string
  stooqBase: string
  binanceRestBase: string
  binanceWebSocketBase: string
  yahooFinanceBase: string
  cartoTileBase: string
  googleOAuthAuthorizeUrl: string
  googleOAuthTokenUrl: string
  googleUserInfoUrl: string
  googleApisBase: string
  nominatimApiBase: string
  osrmRoutingBase: string
  revolutMerchantProductionBase: string
  revolutMerchantSandboxBase: string
  revolutCheckoutProductionOrigin: string
  revolutCheckoutSandboxOrigin: string
}

function validEndpoint(raw: string, protocols: readonly string[]): string {
  const url = new URL(raw)
  if (!protocols.includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('endpoint_invalid')
  }
  return url.toString().replace(/\/$/, '')
}

function loadEndpointConfig(): EndpointConfig {
  try {
    const parsed = JSON.parse(readFileSync(new URL('../../config/endpoints.json', import.meta.url), 'utf8')) as {
      version?: unknown
      external?: Partial<EndpointConfig>
    }
    if (parsed.version !== 1 || !parsed.external) throw new Error('endpoint_version_invalid')
    const external = parsed.external
    return {
      openaiApiBase: validEndpoint(String(external.openaiApiBase ?? ''), ['https:']),
      serperApiBase: validEndpoint(String(external.serperApiBase ?? ''), ['https:']),
      stooqBase: validEndpoint(String(external.stooqBase ?? ''), ['https:']),
      binanceRestBase: validEndpoint(String(external.binanceRestBase ?? ''), ['https:']),
      binanceWebSocketBase: validEndpoint(String(external.binanceWebSocketBase ?? ''), ['wss:']),
      yahooFinanceBase: validEndpoint(String(external.yahooFinanceBase ?? ''), ['https:']),
      cartoTileBase: validEndpoint(String(external.cartoTileBase ?? ''), ['https:']),
      googleOAuthAuthorizeUrl: validEndpoint(String(external.googleOAuthAuthorizeUrl ?? ''), ['https:']),
      googleOAuthTokenUrl: validEndpoint(String(external.googleOAuthTokenUrl ?? ''), ['https:']),
      googleUserInfoUrl: validEndpoint(String(external.googleUserInfoUrl ?? ''), ['https:']),
      googleApisBase: validEndpoint(String(external.googleApisBase ?? ''), ['https:']),
      nominatimApiBase: validEndpoint(String(external.nominatimApiBase ?? ''), ['https:']),
      osrmRoutingBase: validEndpoint(String(external.osrmRoutingBase ?? ''), ['https:']),
      revolutMerchantProductionBase: validEndpoint(String(external.revolutMerchantProductionBase ?? ''), ['https:']),
      revolutMerchantSandboxBase: validEndpoint(String(external.revolutMerchantSandboxBase ?? ''), ['https:']),
      revolutCheckoutProductionOrigin: validEndpoint(String(external.revolutCheckoutProductionOrigin ?? ''), ['https:']),
      revolutCheckoutSandboxOrigin: validEndpoint(String(external.revolutCheckoutSandboxOrigin ?? ''), ['https:']),
    }
  } catch {
    throw new Error('config/endpoints.json lipsește sau este invalid')
  }
}

const endpointConfig = loadEndpointConfig()

type PaymentMode = 'disabled' | 'sandbox' | 'production'

function paymentMode(): PaymentMode {
  const value = (process.env.PAYMENT_MODE ?? 'disabled').trim().toLowerCase()
  if (value !== 'disabled' && value !== 'sandbox' && value !== 'production') {
    throw new Error('PAYMENT_MODE trebuie să fie disabled, sandbox sau production')
  }
  return value
}

function configuredMerchantApiVersion(mode: PaymentMode): string {
  const value = (process.env.REVOLUT_MERCHANT_API_VERSION ?? '').trim()
  if (mode !== 'disabled' && !/^20\d{2}-\d{2}-\d{2}$/.test(value)) {
    throw new Error('REVOLUT_MERCHANT_API_VERSION este obligatoriu și invalid')
  }
  return value
}

function configuredMerchantOrderExpiry(mode: PaymentMode): string {
  const value = (process.env.REVOLUT_ORDER_EXPIRY ?? '').trim()
  // Hosted Checkout accepts an ISO-8601 duration. Kelion deliberately limits
  // product orders to minutes/hours so abandoned links cannot live forever.
  if (mode !== 'disabled' && !/^PT(?:[1-9]\d{0,2}M|[1-9]\d?H)$/.test(value)) {
    throw new Error('REVOLUT_ORDER_EXPIRY trebuie să fie o durată ISO-8601 în minute sau ore')
  }
  return value
}

const merchantPaymentMode = paymentMode()
const merchantSecretKey = env(...ENV_ALIASES.revolutMerchantSecretKey)
const merchantWebhookSecret = env(...ENV_ALIASES.revolutWebhookSigningSecret)
const merchantContractVerified = process.env.PAYMENT_CONTRACT_VERIFIED === 'true'
if (merchantPaymentMode !== 'disabled') {
  if (!merchantContractVerified) throw new Error('plățile nu pot fi active fără PAYMENT_CONTRACT_VERIFIED=true')
  if (merchantSecretKey.length < 32) throw new Error('REVOLUT_MERCHANT_SECRET_KEY lipsește sau este prea scurtă')
  if (merchantWebhookSecret.length < 32) throw new Error('REVOLUT_WEBHOOK_SIGNING_SECRET lipsește sau este prea scurt')
}

function endpointOverride(envName: string, fallback: string, protocols: readonly string[]): string {
  const value = process.env[envName]?.trim()
  if (!value) return fallback
  try {
    return validEndpoint(value, protocols)
  } catch {
    throw new Error(`${envName} este invalid`)
  }
}

function positiveInteger(name: string, raw: string | undefined, testFallback: number): number {
  const value = raw?.trim()
  if (!value) {
    if (isProd) throw new Error(`${name} este obligatoriu în producție`)
    return testFallback
  }
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} trebuie să fie un întreg pozitiv`)
  }
  return parsed
}

function configuredPublicOrigin(): string {
  const raw = (process.env.PUBLIC_APP_ORIGIN ?? process.env.FRONTEND_ORIGIN ?? productConfig.publicAppOrigin).trim()
  if (!raw) return ''
  try {
    const u = new URL(raw)
    const localDev = !isProd && u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname)
    if ((u.protocol !== 'https:' && !localDev) || u.username || u.password || u.pathname !== '/' || u.search || u.hash) return ''
    return u.origin
  } catch {
    return ''
  }
}

function configuredAdminEmail(): string {
  const value = env('ADMIN_EMAIL')
    .trim()
    .replace(/^["']+|["']+$/g, '')
    .trim()
    .toLowerCase()
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
  if (!valid && isProd) throw new Error('ADMIN_EMAIL este obligatoriu și trebuie să fie un email valid')
  return valid ? value : ''
}

function runtimeOpenAIKey(): string {
  const key = env(...ENV_ALIASES.openaiKey)
  // Organization Admin keys are privileged control-plane credentials. They
  // are never a fallback for runtime inference or the Codex worker.
  return key.startsWith('sk-proj-') ? key : ''
}

// Model IDs are deployment configuration. Production refuses to boot when a
// rung is missing; this avoids silently changing capability or accounting when
// a vendor alias changes. Tests/development may inject models explicitly.
function configuredModel(envName: string, aliases: string[]): string {
  const value = env(...aliases)
  if (!value && isProd) throw new Error(`${envName} este obligatoriu în producție`)
  return value
}

const modelRapidActiv = configuredModel('OPENAI_LUNA_MODEL', ENV_ALIASES.openaiLuna)
const modelUnicActiv = configuredModel('OPENAI_MEDIUM_MODEL', ENV_ALIASES.openaiMedium)
const modelProfundActiv = configuredModel('OPENAI_HEAVY_MODEL', ENV_ALIASES.openaiHeavy)

export function modelProfundCod(): string { return modelProfundActiv }
export function modelUltraCod(): string { return env(...ENV_ALIASES.openaiMax) || modelProfundActiv }
export function modelRapidDirect(): string { return `openai/${modelRapidActiv}` }
export function modelUnicDirect(): string { return `openai/${modelUnicActiv}` }
export function modelProfundDirect(): string { return `openai/${modelProfundActiv}` }
export function modelUltraDirect(): string { return `openai/${modelUltraCod()}` }

export const config = {
  isProd,
  port: Number(process.env.PORT ?? 8080),
  // În producție Caddy și aplicația folosesc aceeași rețea host. Ascultarea
  // doar pe loopback împiedică ocolirea proxy-ului (și a antetelor sanitizate
  // de el); în dezvoltare rămâne accesibilă din rețeaua locală/container.
  bindHost: env('BIND_HOST') || (isProd ? '127.0.0.1' : '0.0.0.0'),
  product: productConfig,
  endpoints: {
    ...endpointConfig,
    binanceRestBase: endpointOverride('BINANCE_REST_BASE_URL', endpointConfig.binanceRestBase, ['https:']),
    binanceWebSocketBase: endpointOverride('BINANCE_WS_BASE_URL', endpointConfig.binanceWebSocketBase, ['wss:']),
    stooqBase: endpointOverride('STOOQ_BASE_URL', endpointConfig.stooqBase, ['https:']),
    yahooFinanceBase: endpointOverride('YAHOO_FINANCE_BASE_URL', endpointConfig.yahooFinanceBase, ['https:']),
  },
  httpUserAgent: `${productConfig.appName}/${productConfig.appVersion} (+${productConfig.publicAppOrigin})`,
  google: {
    clientId: required('GOOGLE_CLIENT_ID'),
    clientSecret: required('GOOGLE_CLIENT_SECRET'),
    redirectUri: required('GOOGLE_REDIRECT_URI'),
  },
  sessionSecret: required('SESSION_SECRET'),
  /** Dedicated data-encryption secret; never derived from the cookie secret. */
  googleTokenEncryptionKey: required('GOOGLE_TOKEN_ENCRYPTION_KEY'),
  googleTokenEncryptionKeyId: (() => {
    const kid = env('GOOGLE_TOKEN_ENCRYPTION_KEY_ID') || (isProd ? '' : 'local')
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(kid)) throw new Error('GOOGLE_TOKEN_ENCRYPTION_KEY_ID invalid')
    return kid
  })(),
  googleTokenEncryptionPreviousKey: env(...ENV_ALIASES.googleTokenEncryptionPreviousKey),
  googleTokenEncryptionPreviousKeyId: env('GOOGLE_TOKEN_ENCRYPTION_PREVIOUS_KEY_ID'),
  session: {
    absoluteTtlSeconds: positiveInteger(
      'SESSION_ABSOLUTE_TTL_SECONDS',
      process.env.SESSION_ABSOLUTE_TTL_SECONDS,
      7 * 24 * 60 * 60,
    ),
    idleTtlSeconds: positiveInteger(
      'SESSION_IDLE_TTL_SECONDS',
      process.env.SESSION_IDLE_TTL_SECONDS,
      24 * 60 * 60,
    ),
    touchIntervalSeconds: positiveInteger(
      'SESSION_TOUCH_INTERVAL_SECONDS',
      process.env.SESSION_TOUCH_INTERVAL_SECONDS,
      5 * 60,
    ),
    maxActivePerAccount: positiveInteger(
      'SESSION_MAX_ACTIVE_PER_ACCOUNT',
      process.env.SESSION_MAX_ACTIVE_PER_ACCOUNT,
      5,
    ),
    recentReauthSeconds: positiveInteger(
      'SESSION_RECENT_REAUTH_SECONDS',
      process.env.SESSION_RECENT_REAUTH_SECONDS,
      10 * 60,
    ),
  },
  nativeAuth: {
    requestTtlSeconds: positiveInteger(
      'NATIVE_AUTH_REQUEST_TTL_SECONDS',
      process.env.NATIVE_AUTH_REQUEST_TTL_SECONDS,
      10 * 60,
    ),
    exchangeTtlSeconds: positiveInteger(
      'NATIVE_AUTH_EXCHANGE_TTL_SECONDS',
      process.env.NATIVE_AUTH_EXCHANGE_TTL_SECONDS,
      2 * 60,
    ),
    channelTicketTtlSeconds: (() => {
      const seconds = positiveInteger(
        'NATIVE_CHANNEL_TICKET_TTL_SECONDS',
        process.env.NATIVE_CHANNEL_TICKET_TTL_SECONDS,
        30,
      )
      if (seconds > 30) throw new Error('NATIVE_CHANNEL_TICKET_TTL_SECONDS trebuie să fie cel mult 30')
      return seconds
    })(),
  },
  offlineSync: {
    maxTurns: positiveInteger(
      'OFFLINE_SYNC_MAX_TURNS',
      process.env.OFFLINE_SYNC_MAX_TURNS,
      OFFLINE_SYNC_DEFAULT_MAX_TURNS,
    ),
    maxTextChars: positiveInteger(
      'OFFLINE_SYNC_MAX_TEXT_CHARS',
      process.env.OFFLINE_SYNC_MAX_TEXT_CHARS,
      OFFLINE_SYNC_DEFAULT_MAX_TEXT_CHARS,
    ),
    maxAgeDays: positiveInteger('OFFLINE_SYNC_MAX_AGE_DAYS', process.env.OFFLINE_SYNC_MAX_AGE_DAYS, 30),
    futureSkewSeconds: positiveInteger('OFFLINE_SYNC_FUTURE_SKEW_SECONDS', process.env.OFFLINE_SYNC_FUTURE_SKEW_SECONDS, 300),
  },
  // Optional Opus compression on the browser↔server hop.
  voiceOpus: (process.env.VOICE_OPUS ?? '') === '1',
  vocalLiveIdleTimeoutSeconds: positiveInteger(
    'VOCAL_LIVE_IDLE_TIMEOUT_SECONDS',
    process.env.VOCAL_LIVE_IDLE_TIMEOUT_SECONDS,
    10 * 60,
  ),
  // Model ladder (Luna → Terra → Sol) remains automatic and can be disabled
  // only for diagnosis.
  creierDublu: (process.env.CREIER_DUBLU ?? '') !== '0',
  get modelCreierProfund(): string {
    return modelProfundCod()
  },
  autonomyDailyMax: Math.max(1, Number(process.env.AUTONOMY_DAILY_MAX ?? '20') || 20),
  databaseUrl: env(...ENV_ALIASES.databaseUrl),
  openaiVoice: (process.env.OPENAI_VOICE ?? 'cedar').trim(), // hardcod-permis: voce OpenAI implicită, suprascrisă prin env
  serperKey: env(...ENV_ALIASES.serperKey),
  // (Câmpul `googleMapsKey` a fost ȘTERS — auditul admin, 3 aug: nu-l citea
  // NIMENI. mapsSearch/mapsDirections/geocode merg exclusiv pe Nominatim OSM
  // + OSRM, cu sau fără cheie; rândul lui din env-check împingea ownerul să
  // configureze o cheie fără niciun efect — încălcarea regulii #4.)
  // OpenAI is the only AI provider. ChatGPT/Codex subscription auth remains
  // separate in the constructor worker and never supplies this API key.
  openai: {
    key: runtimeOpenAIKey(),
    apiBaseUrl: endpointConfig.openaiApiBase,
    // Workload roles are stable product semantics; concrete model IDs live in
    // the deployment configuration and are validated without a source default.
    luna: modelRapidActiv,
    medium: modelUnicActiv,
    heavy: modelProfundActiv,
    max: configuredModel('OPENAI_MAX_MODEL', ENV_ALIASES.openaiMax) || modelProfundActiv,
    realtime: env(...ENV_ALIASES.openaiRealtime),
    realtimeTranscription: configuredModel(
      'OPENAI_REALTIME_TRANSCRIPTION_MODEL',
      ENV_ALIASES.openaiRealtimeTranscription,
    ),
    callTranscription: configuredModel(
      'OPENAI_CALL_TRANSCRIPTION_MODEL',
      ENV_ALIASES.openaiCallTranscription,
    ),
    tts: env(...ENV_ALIASES.openaiTts),
    image: configuredModel('OPENAI_IMAGE_MODEL', ENV_ALIASES.openaiImage),
  },
  codexWorker: {
    enabled: codexWorkerEnabled,
    // Secret exclusiv pentru HMAC-ul cozii interne. Nu este token Codex,
    // ChatGPT sau GitHub și nu părăsește workerul/procesul web.
    secret: constructorServiceSecret(ENV_ALIASES.codexWorkerSecret[0], codexWorkerEnabled),
    taskUrl: (process.env.CODEX_TASK_URL ?? '').trim(),
    taskId: (process.env.CODEX_WORKER_TASK_ID ?? '').trim(),
  },
  constructorPublisher: {
    enabled: constructorPublisherEnabled,
    secret: constructorServiceSecret(
      ENV_ALIASES.constructorPublisherSecret[0],
      constructorPublisherEnabled,
    ),
  },
  constructorRelease: {
    enabled: constructorReleaseEnabled,
    secret: constructorServiceSecret(
      ENV_ALIASES.constructorReleaseSecret[0],
      constructorReleaseEnabled,
    ),
  },
  browserWorker: {
    socket: env('BROWSER_WORKER_SOCKET'),
    secret: env(...ENV_ALIASES.browserWorkerSecret),
  },
  converterWorker: {
    socket: env('CONVERTER_WORKER_SOCKET'),
    secret: env(...ENV_ALIASES.converterWorkerSecret),
  },
  push: {
    enabled: pushEnabled,
    publicKey: pushPublicKey,
    privateKey: pushPrivateKey,
    endpointHosts: pushEndpointHosts,
    maxSubscriptions: pushEnabled
      ? positiveInteger('PUSH_MAX_SUBSCRIPTIONS', process.env.PUSH_MAX_SUBSCRIPTIONS, 5)
      : 0,
  },
  revolutMerchant: {
    mode: merchantPaymentMode,
    enabled: merchantPaymentMode !== 'disabled',
    contractVerified: merchantContractVerified,
    secretKey: merchantSecretKey,
    webhookSigningSecret: merchantWebhookSecret,
    apiVersion: configuredMerchantApiVersion(merchantPaymentMode),
    orderExpiry: configuredMerchantOrderExpiry(merchantPaymentMode),
    apiBaseUrl: merchantPaymentMode === 'sandbox'
      ? endpointConfig.revolutMerchantSandboxBase
      : endpointConfig.revolutMerchantProductionBase,
    checkoutOrigin: merchantPaymentMode === 'sandbox'
      ? endpointConfig.revolutCheckoutSandboxOrigin
      : endpointConfig.revolutCheckoutProductionOrigin,
  },
  release: {
    candidateMode: process.env.RELEASE_CANDIDATE_MODE === '1',
    activationFile: env('RELEASE_ACTIVATION_FILE'),
    id: env('RELEASE_ID') || env('GIT_COMMIT_SHA'),
  },
  visitor: {
    // Sunt politici de retenție/configurare operațională, nu constante ascunse
    // în rută. În producție lipsa lor oprește boot-ul.
    chatTtlSeconds: positiveInteger(
      'VISITOR_CHAT_TTL_SECONDS',
      env(...ENV_ALIASES.visitorChatTtlSeconds),
      60 * 60,
    ),
    analyticsRetentionDays: positiveInteger(
      'VISITOR_ANALYTICS_RETENTION_DAYS',
      env(...ENV_ALIASES.visitorAnalyticsRetentionDays),
      7,
    ),
  },
  privacy: {
    policyUpdated: required('PRIVACY_POLICY_UPDATED'),
    controllerName: required('DATA_CONTROLLER_NAME'),
    backupRetentionDays: positiveInteger(
      'PRIVACY_BACKUP_RETENTION_DAYS',
      process.env.PRIVACY_BACKUP_RETENTION_DAYS,
      30,
    ),
    financialRetentionYears: positiveInteger(
      'FINANCIAL_RETENTION_YEARS',
      process.env.FINANCIAL_RETENTION_YEARS,
      6,
    ),
    journalRetentionDays: positiveInteger(
      'JOURNAL_RETENTION_DAYS',
      process.env.JOURNAL_RETENTION_DAYS,
      30,
    ),
    mediaRetentionDays: positiveInteger(
      'MEDIA_RETENTION_DAYS',
      process.env.MEDIA_RETENTION_DAYS,
      30,
    ),
  },
  videoModel: (process.env.OPENAI_VIDEO_MODEL ?? '').trim(),
  videoPriceUsdMicrosPerSecond: positiveInteger(
    'OPENAI_VIDEO_PRICE_USD_MICROS_PER_SECOND',
    process.env.OPENAI_VIDEO_PRICE_USD_MICROS_PER_SECOND,
    100_000,
  ),
  // Provider-announced permanent API shutdown. It remains configurable so a
  // newly announced earlier cutoff can disable spend without a code release.
  videoShutdownAt: (() => {
    const raw = (process.env.OPENAI_VIDEO_SHUTDOWN_AT ?? '2026-09-24T00:00:00.000Z').trim()
    const timestamp = Date.parse(raw)
    if (!Number.isFinite(timestamp)) throw new Error('OPENAI_VIDEO_SHUTDOWN_AT trebuie să fie o dată ISO validă')
    return timestamp
  })(),
  videoAllowPaid: process.env.VIDEO_ALLOW_PAID === '1',
  brain: {
    get chatDefault(): string {
      return modelRapidDirect()
    },
    get workDefault(): string {
      return modelUnicDirect()
    },
    // PROFUND (22 aug): treapta a 3-a — Pro pentru raționament complex, escaladat
    // automat la dificultate mare sau prin ask_brain.
    get profundDefault(): string {
      return modelProfundDirect()
    },
    // ULTRA (22 aug): treapta a 4-a — pentru probleme maximale. Env-configurable.
    get ultraDefault(): string {
      return modelUltraDirect()
    },
    get topDefault(): string {
      return modelProfundDirect()
    },
  },
  // Money policy and provider-expense accounting are separate. Customer
  // wallets use integer GBP minor units; external provider usage uses a
  // distinct USD-micros ledger and is never debited as though it were GBP.
  billing: {
    // Versioned product policy. Money is represented only as integer pennies;
    // provider expense uses a separate USD-micros ledger.
    policyVersion: BILLING_POLICY.version,
    currency: BILLING_POLICY.currency,
    minorUnit: BILLING_POLICY.minorUnit,
    userShareBps: BILLING_POLICY.userShareBps,
    marginShareBps: BILLING_POLICY.marginShareBps,
    creditMinor: positiveInteger('CREDIT_PRICE_MINOR', process.env.CREDIT_PRICE_MINOR, 10),
    chatTurnMinor: positiveInteger('CHAT_TURN_PRICE_MINOR', process.env.CHAT_TURN_PRICE_MINOR, 1),
    voiceMinuteMinor: positiveInteger('VOICE_LIVE_MINUTE_PRICE_MINOR', process.env.VOICE_LIVE_MINUTE_PRICE_MINOR, 2),
    callUtteranceMinor: positiveInteger(
      'CALL_UTTERANCE_PRICE_MINOR',
      process.env.CALL_UTTERANCE_PRICE_MINOR,
      1,
    ),
    // ── THE TOP-UP RULES, AS OWNER SETTINGS (not buried constants) ──────────
    // Adrian, 24 Jul: "first top-up = £20 minimum (brain activation), then any
    // multiple of £5". Adrian, Aug 1 (auto top-up): the prepared pack obeys the
    // same rule and is capped at £500. Until now these lived as bare numbers
    // inside routes/billing.ts — money values written in code, invisible to
    // the man whose money they move. They are OWNER DECISIONS, so they live
    // here: documented, env-editable without a deploy.
    firstTopupMinMinor: positiveInteger('BILLING_FIRST_TOPUP_MIN_MINOR', process.env.BILLING_FIRST_TOPUP_MIN_MINOR, 2_000),
    topupStepMinor: positiveInteger('BILLING_TOPUP_STEP_MINOR', process.env.BILLING_TOPUP_STEP_MINOR, 500),
    topupMinMinor: positiveInteger('BILLING_TOPUP_MIN_MINOR', process.env.BILLING_TOPUP_MIN_MINOR, 500),
    topupMaxMinor: positiveInteger('BILLING_TOPUP_MAX_MINOR', process.env.BILLING_TOPUP_MAX_MINOR, 50_000),
    // The auto top-up DEFAULTS a brand-new user starts from (threshold in
    // CREDITS, amount in display currency). Same rule: owner settings, not
    // magic numbers inside db.ts.
    lowCreditThresholdMinor: positiveInteger('LOW_CREDIT_THRESHOLD_MINOR', process.env.LOW_CREDIT_THRESHOLD_MINOR, 200),
    suggestedTopupMinor: positiveInteger('LOW_CREDIT_TOPUP_MINOR', process.env.LOW_CREDIT_TOPUP_MINOR, 1_000),
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
    user: (process.env.MAIL_USER ?? productConfig.supportEmail).trim(),
    pass: env(...ENV_ALIASES.mailPass),
    forwardTo: (process.env.MAIL_FORWARD_TO ?? process.env.ADMIN_EMAIL ?? '')
      .trim()
      .toLowerCase(),
  },
  openSignup: (process.env.OPEN_SIGNUP ?? '1') !== '0',
  allowlist: (process.env.ALLOWLIST ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
  // A single normalized Google identity grants admin authority and tariff
  // exemption. Production fails closed when it is absent or malformed.
  adminEmail: configuredAdminEmail(),
  githubToken: (process.env.GITHUB_TOKEN ?? '').trim(),
  githubRepo: (process.env.GITHUB_REPO ?? productConfig.githubRepository).trim(),
  frontendDist: process.env.FRONTEND_DIST ?? '../frontend/dist',
  frontendOrigin: process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173',
  /** Canonical browser-facing origin used for OAuth redirects. Empty means
   * misconfigured; callers must fail closed instead of deriving it from Host. */
  publicOrigin: configuredPublicOrigin(),
  geo: {
    nominatimBaseUrl: endpointOverride('NOMINATIM_BASE_URL', endpointConfig.nominatimApiBase, ['https:']),
    osrmRoutingUrl: endpointOverride('OSRM_ROUTING_URL', endpointConfig.osrmRoutingBase, ['https:']),
  },
} as const

if (Boolean(config.googleTokenEncryptionPreviousKey) !== Boolean(config.googleTokenEncryptionPreviousKeyId)) {
  throw new Error('cheia Google anterioară și identificatorul ei trebuie configurate împreună')
}
if (config.googleTokenEncryptionPreviousKeyId
  && (!/^[A-Za-z0-9_-]{1,32}$/.test(config.googleTokenEncryptionPreviousKeyId)
    || config.googleTokenEncryptionPreviousKeyId === config.googleTokenEncryptionKeyId)) {
  throw new Error('GOOGLE_TOKEN_ENCRYPTION_PREVIOUS_KEY_ID invalid')
}

export function isAllowed(email: string): boolean {
  return config.openSignup || config.allowlist.includes(email.toLowerCase())
}

export function roleFor(email: string): 'admin' | 'customer' {
  return email.trim().toLowerCase() === config.adminEmail ? 'admin' : 'customer'
}
