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
