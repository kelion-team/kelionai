import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'node:crypto'
import type { RawData } from 'ws'
import { validateWebSocketSession, webSocketSessionUser } from '../session.js'
import {
  inregistreazaPrezenta,
  scoatePrezenta,
  gestioneazaMesaj,
  seteazaGeneratorId,
  type ConexiuneApel,
} from '../services/apel.js'
import { traduVorbire, intentApel } from '../services/apelTraducere.js'

export const APEL_MESSAGE_MAX_BYTES = 3_500_000
const APEL_MEDIA_QUEUE_MAX = 3
const APEL_MEDIA_PER_MINUTE = 24
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function rawDataBytes(data: RawData): number {
  if (Buffer.isBuffer(data)) return data.byteLength
  if (Array.isArray(data)) return data.reduce((total, chunk) => total + chunk.byteLength, 0)
  if (data instanceof ArrayBuffer) return data.byteLength
  return 0
}

// ── MESSENGER KELION↔KELION — WebSocket-ul de prezență + semnalizare (Faza 1) ────
// Fiecare user logat ține deschis /api/apel cât e în aplicație (ca să POATĂ fi
// sunat). Autentificare pe cookie-ul de sesiune, exact ca /api/vocal-live
// (getSessionUser citește și din antetul brut la upgrade-ul WS). Logica pură stă
// în services/apel.ts — aici doar legăm socketul de ea și curățăm la închidere.
export async function apelRoutes(app: FastifyInstance): Promise<void> {
  // Id-uri de apel unice în producție (serviciul are un contor determinist pentru teste).
  seteazaGeneratorId(() => `apel_${randomUUID()}`)

  app.get('/api/apel', {
    websocket: true,
    preValidation: (req, reply) => validateWebSocketSession(req, reply, 'apel'),
  }, (socket, req) => {
    const user = webSocketSessionUser(req, socket)
    if (!user) return
    const email = user.email.toLowerCase()
    let inchis = false
    let queuedMedia = 0
    let mediaChain: Promise<void> = Promise.resolve()
    let rateWindowStartedAt = Date.now()
    let mediaInWindow = 0
    const seenMedia = new Set<string>()
    const con: ConexiuneApel = {
      trimite(mesaj: unknown) {
        if (inchis) return
        try {
          socket.send(JSON.stringify(mesaj))
        } catch {
          /* socket picat */
        }
      },
    }
    inregistreazaPrezenta(email, con)
    con.trimite({ type: 'gata' }) // clientul știe că prezența e activă

    const mediaAllowed = (utteranceId: string): 'ok' | 'duplicate' | 'rate_limited' | 'busy' | 'invalid' => {
      if (!UUID_RE.test(utteranceId)) return 'invalid'
      if (seenMedia.has(utteranceId)) return 'duplicate'
      const now = Date.now()
      if (now - rateWindowStartedAt >= 60_000) {
        rateWindowStartedAt = now
        mediaInWindow = 0
      }
      if (mediaInWindow >= APEL_MEDIA_PER_MINUTE) return 'rate_limited'
      if (queuedMedia >= APEL_MEDIA_QUEUE_MAX) return 'busy'
      mediaInWindow++
      seenMedia.add(utteranceId)
      if (seenMedia.size > 256) seenMedia.delete(seenMedia.values().next().value as string)
      return 'ok'
    }

    const enqueueMedia = (task: () => Promise<void>): void => {
      queuedMedia++
      mediaChain = mediaChain
        .then(task)
        .catch((error) => app.log.error({ err: error }, 'apel: procesare media eșuată'))
        .finally(() => { queuedMedia-- })
    }

    socket.on('message', (data: RawData) => {
      if (rawDataBytes(data) > APEL_MESSAGE_MAX_BYTES) {
        con.trimite({ type: 'apel-eroare', code: 'message_too_large' })
        try { socket.close(1009, 'message_too_large') } catch { /* deja închis */ }
        return
      }
      let m: unknown
      try {
        m = JSON.parse(String(data))
      } catch {
        return
      }
      // FAZA 2: o frază rostită → traducere live la celălalt (async, nu blochează
      // semnalizarea). Restul (accept/refuz/închide) rămâne pe calea pură.
      const tip = m && typeof m === 'object' ? (m as { type?: unknown }).type : undefined
      if (tip === 'vorbire') {
        const mm = m as { callId?: unknown; utteranceId?: unknown }
        const callId = typeof mm.callId === 'string' ? mm.callId : ''
        const utteranceId = typeof mm.utteranceId === 'string' ? mm.utteranceId.toLowerCase() : ''
        const allowed = mediaAllowed(utteranceId)
        if (allowed !== 'ok') {
          con.trimite({ type: 'apel-eroare', callId, utteranceId, code: allowed })
          return
        }
        enqueueMedia(async () => {
          const outcome = await traduVorbire(email, m)
          if (!outcome.ok) con.trimite({ type: 'apel-eroare', callId, utteranceId, code: outcome.code })
          else con.trimite({ type: 'apel-confirmat', callId, utteranceId, state: outcome.state })
        })
        return
      }
      // HANDS-FREE: cât sună, ce spune cel sunat („răspunde"/„refuză") decide apelul.
      if (tip === 'comanda-apel') {
        const mm = m as { callId?: unknown; utteranceId?: unknown; audio?: unknown; mime?: unknown }
        const callId = typeof mm.callId === 'string' ? mm.callId : ''
        const utteranceId = typeof mm.utteranceId === 'string' ? mm.utteranceId.toLowerCase() : ''
        const audio = typeof mm.audio === 'string' ? mm.audio : ''
        const mime = typeof mm.mime === 'string' ? mm.mime : 'audio/webm'
        if (callId && audio) {
          const allowed = mediaAllowed(utteranceId)
          if (allowed !== 'ok') {
            con.trimite({ type: 'apel-eroare', callId, utteranceId, code: allowed })
            return
          }
          enqueueMedia(async () => {
            const intent = await intentApel(email, callId, utteranceId, audio, mime)
            if (intent === 'answer') gestioneazaMesaj(email, { type: 'accept', callId })
            else if (intent === 'decline') gestioneazaMesaj(email, { type: 'decline', callId })
          })
        }
        return
      }
      gestioneazaMesaj(email, m)
    })

    socket.on('close', () => {
      inchis = true
      scoatePrezenta(email, con)
      app.log.info('apel: WS închis')
    })
    socket.on('error', () => {
      inchis = true
      scoatePrezenta(email, con)
      try {
        socket.close()
      } catch {
        /* deja închis */
      }
    })
  })
}
