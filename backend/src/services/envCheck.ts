// ── WHICH KEYS THE SERVER SEES RIGHT NOW ────────────────────────────────────
//
// Adrian, 30 Jul: "the keys have been written dozens of times."
//
// The panel can say a key is not configured even when it was written elsewhere.
// Both can be true — a key can be written and still not
// reach the running process: written in a different file than the one given
// to docker, written after the container started and never reloaded, or set
// as a GitHub secret without `vps-set-env` ever having been run.
//
// The difference between the three shows in a second if you ask the PROCESS,
// not the person. This module does exactly that: it looks into `process.env`
// of the app answering right now and says, for each expected name, whether
// it is there.
//
// WHAT IT NEVER DOES: return values. Not whole, not truncated, not "the
// first characters". Half a key is still a leaked key. Only the names are
// returned, whether present, and how many characters they have — just enough
// to tell "missing" from "present but empty" or "present but truncated".
import { config, ENV_ALIASES } from '../config.js'
import { readFileSync, statSync } from 'node:fs'

export interface EnvVarState {
  /** The EXACT name of the variable, as the code looks for it. */
  name: string
  /** What it is for, in plain terms. */
  what: string
  /** Is it in the process running NOW? */
  present: boolean
  /** How many characters it has (0 = present but empty). Never the content. */
  length: number
  /** Without it, what breaks. */
  breaks: string
  /** Under WHICH name it was found. It can be an alias, not the main name —
   *  that is why it is shown: "you wrote it as GOOGLE_MAPS_API_KEY" is
   *  information, not a detail. */
  foundAs?: string
  /** All the names I look under. So the person doesn't have to guess. */
  accepts: string[]
}

/** The variables without which a specific capability dies. The list is
 *  hand-written on purpose: "everything in env" would also include things
 *  that have nothing to do with us. */
type VariabilaAsteptata = { name: string; what: string; breaks: string; alias?: string[] }

const cuFisier = (names: string[]): string[] => names.flatMap((name) => [name, `${name}_FILE`])

const ASTEPTATE_BAZA: VariabilaAsteptata[] = [
  { alias: cuFisier(ENV_ALIASES.openaiKey), name: 'OPENAI_API_KEY', what: 'creierul unic, vedere, imagini, transcriere și voce Realtime', breaks: 'funcțiile cloud OpenAI nu răspund; continuitatea locală rămâne disponibilă' },
  { alias: cuFisier(ENV_ALIASES.openaiAdminKey), name: 'OPENAI_ADMIN_KEY', what: 'costurile și usage-ul OpenAI din Kelion Admin', breaks: 'doar costurile/usage-ul furnizorului rămân necitibile; inferența nu este afectată' },
  { alias: cuFisier(ENV_ALIASES.databaseUrl), name: 'DATABASE_URL', what: 'baza de date', breaks: 'conturi, credite, istoric — toate' },
  { alias: cuFisier(ENV_ALIASES.sessionSecret), name: 'SESSION_SECRET', what: 'sesiunile de login', breaks: 'nimeni nu poate rămâne logat' },
  { alias: cuFisier(ENV_ALIASES.googleTokenEncryptionKey), name: 'GOOGLE_TOKEN_ENCRYPTION_KEY', what: 'criptarea credentialelor Google în baza de date', breaks: 'conectarea funcțiilor Google este refuzată sigur' },
  { name: 'GOOGLE_CLIENT_ID', what: 'login cu Google', breaks: 'butonul Google nu merge' },
  { alias: ['GOOGLE_CLIENT_SECRET', 'GOOGLE_CLIENT_SECRET_FILE'], name: 'GOOGLE_CLIENT_SECRET', what: 'login cu Google', breaks: 'butonul Google nu merge' },
  { alias: cuFisier(ENV_ALIASES.serperKey), name: 'SERPER_API_KEY', what: 'căutarea pe web', breaks: 'nu poate căuta nimic pe internet' },
  // (Rândul MAIL_USER a fost SCOS — auditul admin, 3 aug: are default
  // contact@kelionai.app în config.ts, iar mailEnabled() depinde DOAR de
  // MAIL_PASS. Cu MAIL_USER absent mailurile merg normal — ⚠-ul de aici era
  // o alarmă falsă care-l trimitea pe owner să seteze o cheie inutilă.)
  { alias: cuFisier(ENV_ALIASES.mailPass), name: 'MAIL_PASS', what: 'cutia contact@', breaks: 'nu se citesc/trimit emailuri' },
  { alias: cuFisier(ENV_ALIASES.codexWorkerSecret), name: 'CODEX_WORKER_SECRET', what: 'autentificarea HMAC a cozii Constructor', breaks: 'workerul separat nu poate revendica joburi' },
  { alias: cuFisier(ENV_ALIASES.constructorPublisherSecret), name: 'CONSTRUCTOR_PUBLISHER_SECRET', what: 'autentificarea HMAC a publicării Constructor', breaks: 'publisherul separat nu poate prelua și publica handoff-uri' },
  { alias: cuFisier(ENV_ALIASES.constructorReleaseSecret), name: 'CONSTRUCTOR_RELEASE_SECRET', what: 'autentificarea HMAC a release-ului Constructor', breaks: 'releaserul separat nu poate prelua și urmări deploy-uri' },
  { alias: cuFisier(ENV_ALIASES.githubReleaseOAuthToken), name: 'GITHUB_RELEASE_OAUTH_TOKEN', what: 'verificarea GitHub din consola Admin', breaks: 'Admin nu poate valida protecția, aprobările și controalele release-ului' },
]

function asteptate(): VariabilaAsteptata[] {
  const payment: VariabilaAsteptata[] = config.revolutMerchant.enabled
    ? [
        { name: 'PAYMENT_MODE', what: 'modul plăților Merchant', breaks: 'checkout-ul este refuzat sigur' },
        { name: 'PAYMENT_CONTRACT_VERIFIED', what: 'activarea contractuală Merchant', breaks: 'checkout-ul este refuzat sigur' },
        { alias: cuFisier(ENV_ALIASES.revolutMerchantSecretKey), name: 'REVOLUT_MERCHANT_SECRET_KEY', what: 'crearea comenzilor Merchant', breaks: 'checkout-ul este refuzat sigur' },
        { alias: cuFisier(ENV_ALIASES.revolutWebhookSigningSecret), name: 'REVOLUT_WEBHOOK_SIGNING_SECRET', what: 'verificarea evenimentelor de plată', breaks: 'niciun sold nu este creditat automat' },
        { name: 'REVOLUT_MERCHANT_API_VERSION', what: 'versiunea contractului Merchant', breaks: 'checkout-ul este refuzat sigur' },
        { name: 'REVOLUT_ORDER_EXPIRY', what: 'expirarea comenzilor Merchant', breaks: 'checkout-ul este refuzat sigur' },
      ]
    : []
  const push: VariabilaAsteptata[] = config.push.enabled
    ? [
        { alias: ENV_ALIASES.vapidPublicKey, name: 'VAPID_PUBLIC_KEY', what: 'abonarea Web Push', breaks: 'notificările telefonului sunt dezactivate' },
        { name: 'VAPID_PRIVATE_KEY_FILE', what: 'semnarea Web Push', breaks: 'notificările telefonului sunt dezactivate' },
        { name: 'PUSH_ENDPOINT_HOSTS', what: 'allowlist-ul furnizorilor Web Push', breaks: 'abonările sunt refuzate sigur' },
      ]
    : []
  return [...ASTEPTATE_BAZA, ...payment, ...push]
}

export function envCheck(): EnvVarState[] {
  return asteptate().map((v) => {
    // I look under ALL accepted names, not just the main one. A name
    // written differently is not a missing key — see the comment in config.ts.
    const nume = v.alias ?? [v.name]
    let gasit: string | undefined
    let raw: string | undefined
    let primulPrezent: { name: string; value: string } | undefined
    for (const numeAcceptat of nume) {
      const envValue = process.env[numeAcceptat]
      if (envValue == null) continue
      let resolved = envValue
      if (numeAcceptat.endsWith('_FILE')) {
        try {
          const secretPath = envValue.trim()
          const stat = statSync(secretPath)
          if (!secretPath || !stat.isFile() || stat.size > 65_536) throw new Error('secret_file_invalid')
          resolved = readFileSync(secretPath, 'utf8')
        } catch {
          // Variabila există, dar secretul pe care îl indică nu este utilizabil.
          // Raportăm prezent-gol, nu lungimea liniștitoare a căii.
          resolved = ''
        }
      }
      primulPrezent ??= { name: numeAcceptat, value: resolved }
      if (resolved.trim() !== '') {
        gasit = numeAcceptat
        raw = resolved
        break
      }
    }
    if (raw == null && primulPrezent) {
      gasit = primulPrezent.name
      raw = primulPrezent.value
    }
    return {
      name: v.name,
      what: v.what,
      present: raw != null,
      // LUNGIMEA PE VALOAREA TRIMUITĂ (auditul admin, 3 aug): o cheie setată
      // doar din spații apărea „✅ prezentă, 1 caracter", deși config.env() o
      // trimuiește și toate serviciile o văd ca inexistentă — panoul spunea
      // „e acolo", aplicația se purta ca și cum lipsește. Whitespace-only =
      // „prezentă dar GOALĂ" (length 0), aliniat cu ce vede config.env().
      length: (raw ?? '').trim().length,
      breaks: v.breaks,
      foundAs: gasit,
      accepts: nume,
    }
  })
}

// ── KEYS YOU HAVE, BUT I DON'T READ ─────────────────────────────────────────
//
// The "I wrote it dozens of times" case has a second face: the key IS in the
// process, but under a name the code doesn't look for. Then "missing" is a
// lie — the person did the work, I am looking elsewhere. Here we list
// exactly those names.
//
// Only the NAMES, never the values. And only names related to us (by
// keywords), so we don't spill the whole machine env on screen.
//
// Sunt enumerate numai familiile consumate de runtime-ul curent. Numele
// furnizorilor retrași nu creează sarcini false pentru administrator.
const CUVINTE = /(OPENAI|GOOGLE|SERPER|MAIL|SMTP|IMAP|DATABASE|POSTGRES|SESSION|GITHUB|KELION|CODEX|BROWSER|CONVERTER|REVOLUT|PAYMENT|VAPID|PUSH)/i

export function envOrphans(): string[] {
  const stiute = new Set<string>()
  for (const v of asteptate()) for (const n of v.alias ?? [v.name]) stiute.add(n)
  for (const names of [
    ENV_ALIASES.revolutMerchantSecretKey,
    ENV_ALIASES.revolutWebhookSigningSecret,
    ENV_ALIASES.vapidPublicKey,
  ]) for (const name of cuFisier(names)) stiute.add(name)
  for (const n of ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI',
    'OPENAI_LUNA_MODEL', 'OPENAI_MEDIUM_MODEL', 'OPENAI_HEAVY_MODEL',
    'OPENAI_REALTIME_MODEL', 'OPENAI_IMAGE_MODEL', 'OPENAI_TRANSCRIBE_MODEL', 'OPENAI_VIDEO_MODEL',
    'ADMIN_EMAIL', 'ALLOWLIST', 'MAIL_USER', 'MAIL_FORWARD_TO', 'MAIL_IMAP_HOST',
    'MAIL_IMAP_PORT', 'MAIL_SMTP_HOST', 'MAIL_SMTP_PORT', 'PAYMENT_MODE',
    'PAYMENT_CONTRACT_VERIFIED', 'REVOLUT_MERCHANT_API_VERSION', 'REVOLUT_ORDER_EXPIRY',
    'PUSH_ENABLED', 'PUSH_ENDPOINT_HOSTS', 'PUSH_MAX_SUBSCRIPTIONS', 'VAPID_PRIVATE_KEY_FILE',
    'NODE_ENV']) stiute.add(n)
  return Object.keys(process.env)
    .filter((n) => CUVINTE.test(n) && !stiute.has(n))
    .sort()
}

/** The summary, so the panel can say in one line how things stand. */
export function envSummary(): { total: number; lipsa: number; goale: number; nume: string[] } {
  const s = envCheck()
  const lipsa = s.filter((v) => !v.present)
  const goale = s.filter((v) => v.present && v.length === 0)
  return {
    total: s.length,
    lipsa: lipsa.length,
    goale: goale.length,
    // The names of those missing OR empty — these are the ones to set, nothing else.
    nume: [...lipsa, ...goale].map((v) => v.name),
  }
}

/** The time the process started. Without it you cannot answer the question
 *  that matters: "did I write the key BEFORE or AFTER the app started?" —
 *  a key written after startup doesn't get in until the container restarts. */
export function processStartedAt(): string {
  return new Date(Date.now() - Math.round(process.uptime() * 1000)).toISOString()
}
