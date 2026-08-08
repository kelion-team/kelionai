import type { FastifyInstance } from 'fastify'
import { config } from '../config.js'
import { getSessionUser } from '../session.js'
import { getSpeechLang, setSpeechLangPref, saveMessage, citesteSold, debitWallet, recordCost, loadKv, saveKv, getVoiceprint, saveVoiceprint, saveGuestVoice, latestPendingGuest } from '../db.js'
import { grantUnlock, isArmed, hasUnlock, marcheazaVoce } from '../services/adminLock.js'
import { VOICE_USD_PER_MINUTE } from '../services/cost.js'
import { trackSpeechLang } from '../services/lang.js'
import { matchApprovedGuest, activeGuestWindow } from '../services/guestVoices.js'
import { VOICE_MATCH_THRESHOLD, esteAmprentaNeurala, sameSpeakerNeural } from '../services/voiceMatch.js'
import { amprentaNeuralaGata, voiceEmbedding, pcm16kDinWavDataUri } from '../services/voiceEmbedding.js'
import { inferGender, type VoiceFeatures } from './voiceprint.js'
import { vectorDistance } from '../db.js'

// ── LIVE VOICE — CREIERUL UNIC (OpenAI scos 3 aug; STT scos total 5 aug) ──────
// Sesiunea vocală: urechea e VAD LOCAL pe client (fără STT), fraza brută (audio)
// merge la creierul unic Gemini 3 Pro (/api/chat), care AUDE și decide singur
// adresarea; gura e Chirp 3 HD (sintetizată de server, trimisă ca {audio}). Ruta
// asta rămâne DOAR pentru verdictul de timbru + facturare (transcript/tick).
//
// Endpoints left, each with a single job:
//   /api/realtime/session    : DEZACTIVAT — întoarce 410. Clientul nu mai
//                              deschide nicio sesiune WebRTC OpenAI; ruta rămâne
//                              doar ca un client vechi să primească un răspuns
//                              clar, nu o pană de rețea.
//   /api/realtime/tick       : per-minute billing of the live voice connection.
//   /api/realtime/transcript : language anchoring + the voiceprint padlock
//                              (voice unlock for admin). It does NOT save
//                              messages — /api/chat owns the history now.
export async function realtimeRoutes(app: FastifyInstance): Promise<void> {
  // OPENAI SCOS COMPLET (Adrian, 3 aug: „OpenAI scos din toată aplicația").
  // Nu se mai relayează niciun SDP către OpenAI. Ruta răspunde 410 „disabled"
  // ca orice client rămas în urmă să afle clar, nu să pară o pană intermitentă.
  app.post('/api/realtime/session', async (_req, reply) =>
    reply.code(410).send({ error: 'realtime_disabled', code: 'realtime_not_configured', retryable: false }),
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
      if (billSec <= 0) {
        const s0 = await citesteSold(user.email)
        return reply.send({ ok: true, charged: 0, ...(s0.citit ? { balance: s0.sold } : { soldNecitit: s0.motiv }) })
      }
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
      // `stop` TAIE vocea. Un sold necitit nu are voie s-o taie — înainte,
      // `getBalance` picat întorcea 0 și vocea se oprea „fiindcă n-ai bani".
      const sold = await citesteSold(user.email)
      // We signal the client if it ran out of credit → it stops the voice.
      // `charged` reports what was ACTUALLY debited (0 for the owner).
      return reply.send({
        ok: true,
        charged: isOwner ? 0 : cost,
        ...(sold.citit ? { balance: sold.sold } : { soldNecitit: sold.motiv }),
        stop: Boolean(config.revolut.payLink) && user.role !== 'admin' && sold.citit && sold.sold <= 0,
      })
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
  app.post<{ Body: { role?: string; text?: string; voiceFeatures?: VoiceFeatures; save?: boolean; audio?: string } }>(
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
      // POARTA POZITIVĂ (Adrian, 3 aug: „vocea actuală la creier fără să eșueze,
      // OBLIGATORIU doar vocea user/admin — admin în admin, fiecare user în contul
      // lui"). `holder` e ADEVĂRAT doar când există o referință ȘI vocea CHIAR se
      // potrivește cu proprietarul ACESTUI cont. Clientul folosește exact acest
      // semnal ca să ducă vocea la creier FĂRĂ să fie nevoie de „Kelion" la fiecare
      // tură (full-duplex real) — dar NUMAI pentru proprietarul verificat. TV-ul /
      // străinii rămân blocați de amprentă (foreignVoice), iar în perioada de
      // înrolare (fără referință) rămâne poarta de nume, ca să nu treacă nimeni.
      let holder: boolean | undefined
      const isAdmin = user.email.toLowerCase() === config.adminEmail
      const vf = req.body?.voiceFeatures
      // AMPRENTĂ VOCALĂ NEURALĂ (Adrian, 6 aug: „amprenta e ADN, nu 9 numere; să mă
      // recunoască și răgușit"): dacă avem audio brut + modelul încărcat, calculăm
      // embedding-ul de 256 (robust la variația vocii) și decidem pe COSINUS.
      const audioIn = typeof req.body?.audio === 'string' && req.body.audio.startsWith('data:audio') ? req.body.audio : ''
      let neuralEmb: number[] | null = null
      if (role === 'user' && audioIn && amprentaNeuralaGata()) {
        const pcm = pcm16kDinWavDataUri(audioIn)
        if (pcm) neuralEmb = voiceEmbedding(pcm)
      }
      if (role === 'user' && vf?.vector?.length && vf?.meta) {
        try {
          const stored = await getVoiceprint(user.email)
          const storedFeat = stored?.features ?? []
          // Amprenta stocată e NEURALĂ (256) sau VECHE (9/64, incompatibilă)? O
          // amprentă veche pe calea neurală = ca și lipsă → RE-ÎNROLARE cu embedding-ul
          // neural (așa se vindecă „nu mă mai recunoaște / merge la altcineva").
          const refNeural = esteAmprentaNeurala(storedFeat)
          const useNeural = !!neuralEmb
          const hasRef = useNeural ? refNeural : storedFeat.length > 0
          const isHolder = useNeural
            ? refNeural && sameSpeakerNeural(neuralEmb!, storedFeat)
            : hasRef && vectorDistance(vf.vector, storedFeat) < VOICE_MATCH_THRESHOLD
          // HOLE CLOSED (the security audit, Jul 27): with the padlock ARMED, the
          // first enrolment of the admin REFERENCE is accepted ONLY from an
          // already unlocked session (typed secret) or with the padlock unarmed.
          const enrolAllowed = !isAdmin || !(await isArmed()) || hasUnlock(req, user.email)
          if ((!hasRef && enrolAllowed) || isHolder) {
            void saveVoiceprint(
              {
                email: user.email,
                name: user.name || stored?.name || user.email.split('@')[0],
                // Gender from the MEDIAN pitch (spike-proof); on adaptation the
                // stored gender wins inside saveVoiceprint.
                gender: inferGender(vf.meta.pitchMedian ?? vf.meta.pitchMean),
                isAdmin,
                // Neural când îl avem (256, robust); altfel vectorul vechi de 9.
                features: useNeural ? neuralEmb! : vf.vector,
                featureMeta: vf.meta,
                audioClip: '',
              },
              // Prima înrolare = referință proaspătă; voce potrivită = adaptare
              // (medie de embedding-uri — îmbunătățește referința, gen stabil).
              { adapt: hasRef && isHolder },
            )
          }
          foreignVoice = hasRef && !isHolder ? true : undefined
          // Semnal POZITIV de proprietar verificat: referință + potrivire.
          holder = hasRef && isHolder ? true : undefined
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
      if (text && role === 'user' && isAdmin) return reply.send({ ok: true, lang: 'ro', foreignVoice, adminUnlocked, guest, guestPending, holder })
      if (text && role === 'user' && !isAdmin) {
        // LANGUAGE DETECTION FROM VOICE (Jul 24 audit, P4): a new language
        // confirmed on 2 consecutive messages → persisted per user; the client
        // pins it ON THE SPOT in the Realtime session (session.update).
        const current = await getSpeechLang(user.email)
        const committed = trackSpeechLang(user.email, text, current)
        if (committed) void setSpeechLangPref(user.email, committed)
        if (committed) return reply.send({ ok: true, lang: committed.slice(0, 2).toLowerCase(), foreignVoice, guest, guestPending, holder })
      }
      // FĂRĂ TEXT (voce ambientală — clientul nu mai trimite transcript, doar
      // amprenta): tot întoarcem verdictul de timbru COMPLET, inclusiv
      // adminUnlocked, ca butonul de admin să se aprindă și pe calea nouă.
      return reply.send({ ok: true, foreignVoice, adminUnlocked, guest, guestPending, holder })
    },
  )
}
