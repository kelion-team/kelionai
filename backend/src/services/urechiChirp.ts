import { config } from '../config.js'
import { saveInboundEmail } from '../db.js'
import { sendMail } from './mail.js'

// ── THE CHIRP EARS KEEPER + SENTINEL (Adrian, Aug 2, direct order: „un sistem
// de monitorizare care ține sub control peste tot folosirea Chirp 3 HD, și
// dacă pică dă mesaj adminului imediat") ─────────────────────────────────────
// LIVE PROOF (Adrian's console + server journal, Aug 2):
//   server:  «asr-stream: eroare Google streamingRecognize: 10 ABORTED:
//             Stream timed out after receiving no more client requests.»
//   client:  «[voce] urechea Chirp a murit (silent) — sesiunea se reface pe
//             urechile OpenAI»  +  «voce realtime a picat (1/3):
//             urechi-chirp-silent»
// THE REAL CAUSE (verified in code): frontend/src/lib/micStream.ts sends audio
// ONLY while the local VAD hears voice (+3.2s tail) — deliberately, so silence
// isn't billed. But Google's streamingRecognize ABORTS after ~10s without ANY
// client request. Silence → no frames → Google kills the stream → the old code
// pushed {type:'error'} to the browser → the session declared the Chirp ear
// DEAD and rebuilt on the PAID OpenAI ears. An idle timeout, fully repairable,
// was treated as a fatal error.
// THE FIX (in routes/asr-stream.ts, driven by the helpers below):
//   1. KEEPALIVE — while the stream is open but the speaker is silent, the
//      server writes a 100 ms frame of digital silence every few seconds.
//      Google never idles out; the ear stays warm. Cost: ~1.2 audio-seconds
//      per minute of silence — negligible vs. an OpenAI-ear fallback.
//   2. TRANSPARENT RECONNECT — if Google still drops the stream (network,
//      max stream lifetime), we reopen it WITHOUT telling the client. The
//      browser never declares the ear dead for a transient cause.
//   3. The OpenAI-ear fallback stays ONLY for real persistent errors (auth /
//      bad key / bad config, or a storm of reconnects that exhausts the
//      budget) — and THAT is exactly when the admin gets paged instantly.

// 100 ms of LINEAR16 16 kHz mono digital silence = 1600 samples × 2 bytes.
export const CADRU_LINISTE: Buffer = Buffer.alloc(3200)

// Google aborts an unfed stream at ~10s; we feed it well before that.
export const KEEPALIVE_IDLE_MS = 5_000 // write silence when no audio for this long
export const KEEPALIVE_CHECK_MS = 1_000 // how often the timer checks

// Reconnect budget: at most this many transparent reconnects per window;
// beyond that the cause is NOT transient — we fall back and page the admin.
export const RECONECTARI_MAX = 5
export const RECONNECT_WINDOW_MS = 60_000

// Health window: an auth/config error or a fallback younger than this means
// the ears are SICK (reported in system_health).
export const FEREASTRA_SANATATE_MS = 15 * 60_000

// Anti-spam: at most one admin alert per cause per cooldown (in-memory is
// enough — alerts are about NOW, and a restart re-arming one alert is fine).
export const ALERTA_COOLDOWN_MS = 30 * 60_000

export type CauzaChirp = 'idle_timeout' | 'tranzitorie' | 'auth' | 'config'

// Classify a google-gax error. gax errors carry a NUMERIC `code` (the gRPC
// status): 10 ABORTED (idle/stream timeout, max lifetime), 14 UNAVAILABLE,
// 13 INTERNAL (incl. RST_STREAM), 4 DEADLINE_EXCEEDED, 8 RESOURCE_EXHAUSTED
// are all TRANSIENT — reconnect fixes them. 16 UNAUTHENTICATED and
// 7 PERMISSION_DENIED mean the key/account — NO reconnect will heal those.
// 3 INVALID_ARGUMENT means our request (model/region/config) — persistent too.
export function clasificaEroareGoogle(e: unknown): CauzaChirp {
  const err = e as { code?: number | string; message?: string; details?: string }
  const msg = String(err?.message ?? err?.details ?? e ?? '')
  const code = Number(err?.code)
  if (code === 16 || code === 7) return 'auth'
  if (code === 3) return 'config'
  // The proven live signature: «10 ABORTED: Stream timed out after receiving
  // no more client requests» — pure idle death, the cheapest to repair.
  if (/stream timed out|no more client requests/i.test(msg)) return 'idle_timeout'
  if (code === 10 && /aborted|maximum stream duration/i.test(msg)) return 'tranzitorie'
  if (code === 14 || code === 13 || code === 4 || code === 8) return 'tranzitorie'
  if (/RST_STREAM|UNAVAILABLE|DEADLINE|RESOURCE_EXHAUSTED/i.test(msg)) return 'tranzitorie'
  if (/UNAUTHENTICATED|PERMISSION_DENIED|invalid.? (api.?)?key|credentials/i.test(msg)) return 'auth'
  // Unknown: treat as transient — the reconnect budget bounds the damage, and
  // an unknown error that keeps recurring still ends in fallback + alert.
  return 'tranzitorie'
}

// Should THIS error push the client onto the paid OpenAI ears? True ONLY for
// persistent causes (auth/config) or when the reconnect budget is exhausted.
// An idle timeout or a transient drop must NEVER reach this — it reconnects.
export function trebuieFallbackDupaEroare(
  cauza: CauzaChirp,
  reconectariInFereastra: number,
  max: number = RECONECTARI_MAX,
): boolean {
  if (cauza === 'auth' || cauza === 'config') return true
  return reconectariInFereastra >= max
}

// Keepalive predicate: is it time to feed Google a silence frame? (Simulated
// in tests — the timer in asr-stream.ts calls this with the real clock.)
export function trebuieCadruDeLiniste(
  ultimulAudioLa: number,
  acum: number,
  idleMs: number = KEEPALIVE_IDLE_MS,
): boolean {
  return acum - ultimulAudioLa >= idleMs
}

// ── COUNTERS (process-local — the ears' pulse, read by system_health) ──────
interface PulsUrechi {
  streamuriDeschise: number
  reconectari: number
  eroriIdle: number
  eroriTranzitorii: number
  eroriAuth: number
  eroriConfig: number
  fallbackuri: number // how many times we pushed a client onto the PAID OpenAI ears
  ultimaEroare: string | null
  ultimaEroareLa: number // ms epoch, 0 = never
  ultimaCaderePersistLa: number // ms epoch of the last fallback/auth/config event
  ultimaCadereCauza: string | null // what kind of persistent drop that was
}

const puls: PulsUrechi = {
  streamuriDeschise: 0,
  reconectari: 0,
  eroriIdle: 0,
  eroriTranzitorii: 0,
  eroriAuth: 0,
  eroriConfig: 0,
  fallbackuri: 0,
  ultimaEroare: null,
  ultimaEroareLa: 0,
  ultimaCaderePersistLa: 0,
  ultimaCadereCauza: null,
}

export function noteazaStreamChirp(): void {
  puls.streamuriDeschise++
}

export function noteazaReconectareChirp(): void {
  puls.reconectari++
}

export function noteazaEroareChirp(cauza: CauzaChirp, detaliu: string, acum = Date.now()): void {
  if (cauza === 'idle_timeout') puls.eroriIdle++
  else if (cauza === 'auth') puls.eroriAuth++
  else if (cauza === 'config') puls.eroriConfig++
  else puls.eroriTranzitorii++
  puls.ultimaEroare = `[${cauza}] ${detaliu.slice(0, 200)}`
  puls.ultimaEroareLa = acum
  if (cauza === 'auth' || cauza === 'config') {
    puls.ultimaCaderePersistLa = acum
    puls.ultimaCadereCauza = cauza
  }
}

export function noteazaFallbackChirp(detaliu: string, acum = Date.now()): void {
  puls.fallbackuri++
  puls.ultimaCaderePersistLa = acum
  puls.ultimaCadereCauza = 'tranzitorii_epuizate'
  puls.ultimaEroare = `[fallback] ${detaliu.slice(0, 200)}`
  puls.ultimaEroareLa = acum
}

/** Test hook — a fresh pulse for each test. */
export function resetUrechiChirp(): void {
  puls.streamuriDeschise = 0
  puls.reconectari = 0
  puls.eroriIdle = 0
  puls.eroriTranzitorii = 0
  puls.eroriAuth = 0
  puls.eroriConfig = 0
  puls.fallbackuri = 0
  puls.ultimaEroare = null
  puls.ultimaEroareLa = 0
  puls.ultimaCaderePersistLa = 0
  puls.ultimaCadereCauza = null
  ultimeleAlerte.clear()
}

export interface StareUrechi {
  sanatoase: boolean
  motiv: string
  sumar: string
  streamuriDeschise: number
  reconectari: number
  fallbackuri: number
  ultimaEroare: string | null
}

export function stareUrechiChirp(acum = Date.now()): StareUrechi {
  const cadereRecenta = puls.ultimaCaderePersistLa > 0 && acum - puls.ultimaCaderePersistLa < FEREASTRA_SANATATE_MS
  const sumar =
    `${puls.streamuriDeschise} streamuri, ${puls.reconectari} reconectări transparente, ` +
    `${puls.eroriIdle} idle-timeouturi vindecate, ${puls.fallbackuri} fallback-uri pe OpenAI` +
    (puls.ultimaEroare ? ` — ultima eroare: ${puls.ultimaEroare}` : '')
  if (!cadereRecenta) {
    return { sanatoase: true, motiv: '', sumar, ...puls, ultimaEroare: puls.ultimaEroare }
  }
  const motiv =
    puls.ultimaCadereCauza === 'auth' || puls.ultimaCadereCauza === 'config'
      ? `eroare persistentă de tip ${puls.ultimaCadereCauza} la Google (${puls.ultimaEroare ?? 'necunoscută'})`
      : `furtună de erori tranzitorii nevindecabile → ${puls.fallbackuri} fallback-uri pe urechile OpenAI (plătite) — ultima: ${puls.ultimaEroare ?? 'necunoscută'}`
  return { sanatoase: false, motiv, sumar, ...puls, ultimaEroare: puls.ultimaEroare }
}

// ── THE INSTANT ADMIN PAGE ──────────────────────────────────────────────────
// TWO existing channels, both house-standard:
//   1. The Admin → Inbox tab (/api/admin/inbound reads inbound_emails): we
//      insert the alert as a message from "Kelion — monitor urechi Chirp" →
//      the admin SEES it the next time the tab refreshes, no email needed.
//   2. Email to config.adminEmail — the exact pattern of alertAdminLoop /
//      openrouterAlert, so the page reaches him even away from the panel.
// ANTI-SPAM: at most one alert per cause per ALERTA_COOLDOWN_MS.
const ultimeleAlerte = new Map<string, number>()

export async function alertaAdminUrechiChirp(
  cauza: string,
  detalii: string,
  cooldownMs: number = ALERTA_COOLDOWN_MS,
  acum = Date.now(),
): Promise<boolean> {
  const ultima = ultimeleAlerte.get(cauza) ?? 0
  if (acum - ultima < cooldownMs) return false
  ultimeleAlerte.set(cauza, acum)

  const stare = stareUrechiChirp(acum)
  const subject = `⚠️ Urechile Chirp au căzut (${cauza}) — vocea e pe urechile OpenAI`
  const body =
    `Monitorul urechilor Chirp (Google STT streaming) semnalează o cădere PERSISTENTĂ.\n\n` +
    `Cauza: ${cauza}\n` +
    `Detaliu: ${detalii.slice(0, 400)}\n\n` +
    `Pulsul urechilor: ${stare.sumar}\n\n` +
    `Până la reparare, sesiunile de voce folosesc urechile OpenAI Realtime (PLĂTITE).\n` +
    `Verifică GOOGLE_SERVICE_ACCOUNT_JSON pe VPS și jurnalul «asr-stream».\n\n` +
    `— Kelion (alertă automată, max una la ${Math.round(cooldownMs / 60000)} min pe aceeași cauză)`

  // Channel 1 — the Admin Inbox tab (instant, no external dependency).
  await saveInboundEmail({
    uid: `urechi-chirp:${cauza}:${acum}`,
    from_addr: 'urechi-chirp@kelionai.app',
    from_name: 'Kelion — monitor urechi Chirp',
    subject,
    body,
  }).catch(() => false)

  // Channel 2 — email, the house's alerting pattern (best effort: SMTP may be
  // unconfigured on a dev box; the Inbox row above already carries the page).
  const html = `<pre style="font-family:inherit;white-space:pre-wrap">${body
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')}</pre>`
  await sendMail({ to: config.adminEmail, subject: `[Kelion] ${subject}`, html, text: body }).catch(() => false)

  return true
}
