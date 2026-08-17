import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'node:crypto'
import { getSessionUser } from '../session.js'
import {
  inregistreazaPrezenta,
  scoatePrezenta,
  gestioneazaMesaj,
  seteazaGeneratorId,
  type ConexiuneApel,
} from '../services/apel.js'
import { traduVorbire, intentApel } from '../services/apelTraducere.js'

// ── MESSENGER KELION↔KELION — WebSocket-ul de prezență + semnalizare (Faza 1) ────
// Fiecare user logat ține deschis /api/apel cât e în aplicație (ca să POATĂ fi
// sunat). Autentificare pe cookie-ul de sesiune, exact ca /api/vocal-live
// (getSessionUser citește și din antetul brut la upgrade-ul WS). Logica pură stă
// în services/apel.ts — aici doar legăm socketul de ea și curățăm la închidere.
export async function apelRoutes(app: FastifyInstance): Promise<void> {
  // Id-uri de apel unice în producție (serviciul are un contor determinist pentru teste).
  seteazaGeneratorId(() => `apel_${randomUUID()}`)

  app.get('/api/apel', { websocket: true }, (socket, req) => {
    const user = getSessionUser(req)
    if (!user) {
      try {
        socket.close(1008, 'unauthorized')
      } catch {
        /* deja închis */
      }
      return
    }
    const email = user.email.toLowerCase()
    let inchis = false
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

    socket.on('message', (data: unknown) => {
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
        void traduVorbire(email, m)
        return
      }
      // HANDS-FREE: cât sună, ce spune cel sunat („răspunde"/„refuză") decide apelul.
      if (tip === 'comanda-apel') {
        const mm = m as { callId?: unknown; audio?: unknown; mime?: unknown }
        const callId = typeof mm.callId === 'string' ? mm.callId : ''
        const audio = typeof mm.audio === 'string' ? mm.audio : ''
        const mime = typeof mm.mime === 'string' ? mm.mime : 'audio/webm'
        if (callId && audio) {
          void intentApel(email, audio, mime).then((intent) => {
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
