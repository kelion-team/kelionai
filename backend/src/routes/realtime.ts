import type { FastifyInstance } from 'fastify'
import { config } from '../config.js'
import { getSessionUser } from '../session.js'
import { getSpeechLang, setSpeechLangPref, saveMessage, getBalance, debitWallet, recordCost, loadKv, saveKv, getVoiceprint, saveVoiceprint, getVoicePref, saveGuestVoice, latestPendingGuest } from '../db.js'
import { grantUnlock, isArmed, hasUnlock, marcheazaVoce } from '../services/adminLock.js'
import { VOICE_USD_PER_MINUTE } from '../services/cost.js'
import { trackSpeechLang } from '../services/lang.js'
import { openaiRealtimeAnswer } from '../services/realtime.js'
import { isQuotaError, alertOpenAiQuota } from '../services/openaiAlert.js'
import { matchApprovedGuest, activeGuestWindow } from '../services/guestVoices.js'
import { inferGender, type VoiceFeatures } from './voiceprint.js'
import { vectorDistance } from '../db.js'

// ── LIVE VOICE (OpenAI Realtime) — THE NEW ARCHITECTURE (Adrian, Aug 1) ──────
// The voice session is PURE EARS AND MOUTH (see services/realtime.ts). There
// are NO voice tools and NO escalation endpoint here anymore: the ONE brain
// (POST /api/chat — same pipeline, tools, escalation ladder and billing as
// writing) thinks and acts; the Realtime model only transcribes and speaks the
// brain's words.
//
// Endpoints left, each with a single job:
//   /api/realtime/session    : SDP proxy (start the WebRTC call, pin the voice
//                              + transcription language, voice paywall).
//   /api/realtime/tick       : per-minute billing of the Realtime connection.
//   /api/realtime/transcript : language anchoring + the voiceprint padlock
//                              (voice unlock for admin). It does NOT save
//                              messages — /api/chat owns the history now.
export async function realtimeRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: { sdp?: string; language?: string; ears?: string } }>(
    '/api/realtime/session',
    async (req, reply) => {
      const user = getSessionUser(req)
      if (!user) return reply.code(401).send({ error: 'unauthorized' })

      // VOICE PAYWALL (Jul 25): no credit → no session; the admin is exempt.
      // Without a configured payment link, the app is free.
      const isAdminPay = user.email.toLowerCase() === config.adminEmail
      if (
        config.revolut.payLink &&
        !isAdminPay &&
        (await getBalance(user.email)) <= 0
      ) {
        return reply.code(402).send({ error: 'no_credit' })
      }

      const raw = String(req.body?.sdp ?? '')
      if (!raw.trim()) return reply.code(400).send({ error: 'bad_request: sdp required' })
      // NO trim(): the SDP must end with \r\n — .trim() cut it and OpenAI's
      // parser (pion) gave "unmarshal SDP: EOF" (the cause of "it can't hear me").
      const offer = raw.endsWith('\n') ? raw : raw + '\r\n'

      // LANGUAGE (Adrian, Jul 24 — FINAL rule: "default startup English; ADMIN =
      // Romanian always; the rest of the users: detect and keep per user"). The
      // ADMIN speaks fixed ROMANIAN — we pin the transcription to Romanian too.
      // The rest: the PERSISTED language; none → EMPTY → English, then mirror.
      const isAdmin = user.email.toLowerCase() === config.adminEmail
      let lang: string
      if (isAdmin) {
        lang = 'ro'
      } else {
        lang = String((await getSpeechLang(user.email)) || '').slice(0, 2).toLowerCase()
        if (!/^[a-z]{2}$/.test(lang)) lang = ''
      }

      // THE VOICE CHOSEN BY THIS PERSON, not one for everyone (Adrian, Jul 30).
      const vocePref = await getVoicePref(user.email).catch(() => null)
      // THE BIG STEP (Aug 1): 'chirp' = the live ears are Google Chirp 3 —
      // this session is PURE MOUTH (no input transcription, no VAD).
      const urechiChirp = String(req.body?.ears ?? '') === 'chirp'
      const res = await openaiRealtimeAnswer(offer, lang, isAdmin, vocePref, urechiChirp)
      if (!res.ok) {
        // The REAL reason for the refusal goes into the log — otherwise F12
        // shows only "502" and the diagnosis is blind (Adrian, Jul 24).
        req.log.warn(
          { upstreamStatus: res.status, upstreamError: res.error, sdpLen: offer.length, sdpHead: offer.slice(0, 40) },
          'realtime upstream refusal',
        )
        // ACCOUNT WITHOUT CREDIT: notify the admin by email IMMEDIATELY.
        if (isQuotaError(res.error)) alertOpenAiQuota()
        const code = res.status === 503 ? 503 : 502
        return reply.code(code).send({
          error: 'realtime_upstream',
          status: res.status,
          code: res.code,
          retryable: res.code !== 'realtime_not_configured' && res.code !== 'upstream_refuz',
        })
      }
      // The client reads the response as text (SDP answer) → setRemoteDescription.
      return reply.header('content-type', 'application/sdp').send(res.sdp)
    },
  )

  // VOICE BILLING BY THE MINUTE (Adrian, Jul 25): while voice is active, the
  // client "pulses" every ~20s; the server debits the REALLY connected seconds.
  // SERVER CLOCK (Jul 29 audit): we bill the time measured between two pulses
  // (60s/pulse ceiling); on the first pulse (or a gap over 90s) we use the
  // client's estimate, also capped.
  app.post<{ Body: { seconds?: number } }>(
    '/api/realtime/tick',
    async (req, reply) => {
      const user = getSessionUser(req)
      if (!user) return reply.code(401).send({ error: 'unauthorized' })
      const now = Date.now()
      const KEY = `voice_tick:${user.email}`
      const last = Number(await loadKv(KEY).catch(() => null)) || 0
      void saveKv(KEY, String(now)).catch(() => {})
      const serverGap = now - last
      const billSec =
        last > 0 && serverGap > 0 && serverGap <= 90_000
          ? Math.min(60, Math.round(serverGap / 1000))
          : Math.max(0, Math.min(60, Number(req.body?.seconds ?? 0)))
      if (billSec <= 0) return reply.send({ ok: true, charged: 0, balance: await getBalance(user.email) })
      const cost = (billSec / 60) * VOICE_USD_PER_MINUTE
      void recordCost(user.email, 'voice_minutes', cost)
      // THE OWNER DOESN'T PAY HIMSELF (Adrian, Aug 2 — his £10 vanished during
      // his OWN testing: 482 voice-minute debits in one morning = £5.73/day
      // drained from the admin wallet by the admin's own app). The Jul 25
      // "everyone pays, even the admin" rule dies here: the admin's usage is
      // still RECORDED (the Money tab keeps honest visibility) but never
      // DEBITED. Paying users are debited exactly as before — the per-minute
      // price is the product, the free provider tier is the owner's margin.
      const isOwner = user.email.toLowerCase() === config.adminEmail
      if (!isOwner) void debitWallet(user.email, cost, `voice_min:${billSec}s`)
      const bal = await getBalance(user.email)
      // We signal the client if it ran out of credit → it stops the voice.
      // `charged` reports what was ACTUALLY debited (0 for the owner).
      return reply.send({ ok: true, charged: isOwner ? 0 : cost, balance: bal, stop: Boolean(config.revolut.payLink) && user.role !== 'admin' && bal <= 0 })
    },
  )

  // LANGUAGE ANCHORING + THE VOICEPRINT PADLOCK.
  //
  // This endpoint NO LONGER saves chat messages (Aug 1): the spoken turn goes
  // through /api/chat, which owns the history (one single save, the same as
  // writing). What stays here, because the live session needs it mid-flight:
  //   • language detection/commit → the client pins the transcription language
  //     in the Realtime session (no more "random language");
  //   • the voiceprint check → the admin padlock (unlock by voice) and the
  //     foreign-voice flag.
  app.post<{ Body: { role?: string; text?: string; voiceFeatures?: VoiceFeatures; save?: boolean } }>(
    '/api/realtime/transcript',
    async (req, reply) => {
      const user = getSessionUser(req)
      if (!user) return reply.code(401).send({ error: 'unauthorized' })
      const text = String(req.body?.text ?? '').trim()
      const role = req.body?.role === 'assistant' ? 'assistant' : 'user'
      // COMPAT ONLY (no current client uses it): an explicit save:true still
      // archives the text. The new client never asks for it — /api/chat saves.
      if (text && req.body?.save === true) await saveMessage(user.email, role, text)

      // VOICEPRINT ON THE MAIN VOICE (Adrian, Jul 26): the client extracts the
      // print from the Realtime session's microphone and sends it with every
      // spoken turn; here we compare it with the holder's reference (the SAME
      // logic and threshold as in chat.ts).
      let foreignVoice: boolean | undefined
      // THE GUEST VERDICT (Adrian, Aug 1): a foreign voice is IGNORED
      // COMPLETELY — unless it matches an approved guest of this account
      // (`guest`) or the holder just opened a guest window (`guestPending`,
      // print stored unapproved until the holder confirms). The client drops
      // the turn whenever foreignVoice is true WITHOUT one of these two.
      let guest: { id: number; name: string; relation: string } | undefined
      let guestPending: { id: number; name: string; relation: string } | undefined
      // THE ADMIN PADLOCK (Adrian, Jul 27): a MATCHING print on an already
      // existing reference opens the Admin button (signed cookie) — the first
      // enrolment does NOT unlock.
      let adminUnlocked: boolean | undefined
      const isAdmin = user.email.toLowerCase() === config.adminEmail
      const vf = req.body?.voiceFeatures
      if (role === 'user' && vf?.vector?.length && vf?.meta) {
        try {
          const stored = await getVoiceprint(user.email)
          const hasRef = !!stored?.features?.length
          const dist = hasRef ? vectorDistance(vf.vector, stored!.features) : Infinity
          const isHolder = dist < 0.38
          // HOLE CLOSED (the security audit, Jul 27): with the padlock ARMED, the
          // first enrolment of the admin REFERENCE is accepted ONLY from an
          // already unlocked session (typed secret) or with the padlock unarmed.
          const enrolAllowed = !isAdmin || !(await isArmed()) || hasUnlock(req, user.email)
          if ((!hasRef && enrolAllowed) || (hasRef && isHolder)) {
            void saveVoiceprint(
              {
                email: user.email,
                name: user.name || stored?.name || user.email.split('@')[0],
                // Gender from the MEDIAN pitch (spike-proof); on adaptation the
                // stored gender wins inside saveVoiceprint.
                gender: inferGender(vf.meta.pitchMedian ?? vf.meta.pitchMean),
                isAdmin,
                features: vf.vector,
                featureMeta: vf.meta,
                audioClip: '',
              },
              // First enrolment = fresh reference; a matching voice = gentle
              // adaptation (blend, stable gender).
              { adapt: hasRef && isHolder },
            )
          }
          foreignVoice = hasRef && !isHolder ? true : undefined
          // GUEST RECOGNITION — only when it is NOT the holder.
          if (foreignVoice) {
            // 1. An APPROVED guest's timbre? → allowed, with guest rights.
            const match = await matchApprovedGuest(user.email, vf.vector).catch(() => null)
            if (match) {
              guest = { id: match.id, name: match.name, relation: match.relation }
            } else {
              // 2. The holder just opened a window ("vorbește și cu X")? → the
              // print is stored PENDING; the brain asks the holder to confirm.
              const win = activeGuestWindow(user.email)
              if (win) {
                const pending = await latestPendingGuest(user.email).catch(() => null)
                if (pending) {
                  // Same window, another utterance — reuse the pending row.
                  guestPending = { id: pending.id, name: pending.name, relation: pending.relation }
                } else {
                  const id = await saveGuestVoice({
                    accountEmail: user.email,
                    name: win.name,
                    relation: win.relation,
                    features: vf.vector,
                    featureMeta: vf.meta,
                  }).catch(() => null)
                  if (id) guestPending = { id, name: win.name, relation: win.relation }
                }
              }
            }
          }
          if (isAdmin && hasRef && isHolder) {
            grantUnlock(reply, user.email, 'voce')
            // AND ON THE SERVER, for the tools that don't have the request at
            // hand: from here starts the 15-minute window in which he can touch
            // the card (Adrian, Jul 31: "so it operates only when I ask it, by voice").
            marcheazaVoce(user.email)
            adminUnlocked = true
          }
        } catch {
          /* the voiceprint never blocks the transcript */
        }
      }
      // ADMIN: the live session stays anchored on Romanian at EVERY turn.
      if (text && role === 'user' && isAdmin) return reply.send({ ok: true, lang: 'ro', foreignVoice, adminUnlocked, guest, guestPending })
      if (text && role === 'user' && !isAdmin) {
        // LANGUAGE DETECTION FROM VOICE (Jul 24 audit, P4): a new language
        // confirmed on 2 consecutive messages → persisted per user; the client
        // pins it ON THE SPOT in the Realtime session (session.update).
        const current = await getSpeechLang(user.email)
        const committed = trackSpeechLang(user.email, text, current)
        if (committed) void setSpeechLangPref(user.email, committed)
        if (committed) return reply.send({ ok: true, lang: committed.slice(0, 2).toLowerCase(), foreignVoice, guest, guestPending })
      }
      return reply.send({ ok: true, foreignVoice, guest, guestPending })
    },
  )
}
