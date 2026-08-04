import type { FastifyInstance } from 'fastify'
import type { RawData } from 'ws'
import { getSessionUser } from '../session.js'
import { deschideVocalLive, vocalLiveDisponibila, VOCAL_LIVE_MODEL, VOCAL_LIVE_VOICE, type VocalLive } from '../services/vocalLive.js'

// ── RUTA VOCII UNIFICATE — CALE SEPARATĂ ȘI EXCLUSIVĂ (4 aug 2026) ───────────
//
// Owner: „atenție că vei avea 2 voci în același timp". Corect — de-aia asta e o
// cale COMPLET SEPARATĂ, care ÎNLOCUIEȘTE lanțul vechi (ureche Chirp/Live →
// creier /api/chat → gură Chirp 3 HD), NU se adaugă peste el. Frontendul pornește
// FIE calea veche, FIE asta — niciodată amândouă. Aici, un singur glas: modelul
// Live aude, gândește ȘI vorbește el însuși (gura veche Chirp nu intră deloc).
//
// Contractul WS (browser ↔ server):
//   client → server:  cadre BINARE = PCM16 mono 16kHz de la microfon.
//   server → client:  JSON —
//     { type:'gata' }                              sesiunea Live e deschisă
//     { type:'audio', data:<base64 PCM 24kHz> }    glasul lui Kelion, de redat
//     { type:'user', text, final }                 ce aude (subtitrare)
//     { type:'kelion', text, final }               ce spune (subtitrare)
//     { type:'intrerupt' }                         barge-in: oprește redarea ACUM
//     { type:'tura_gata' }                         Kelion a terminat de vorbit
//     { type:'eroare', motiv }                     eroare NUMITĂ (nu murim tăcut)
//
// Persona = aceeași identitate a lui Kelion, în română, scurt. UNELTELE se
// leagă în pasul următor (căutare/skill-uri); acum e conversație vocală curată.

const PERSONA_KELION =
  'Ești Kelion, asistentul lui Adrian. Vorbești firesc, cald și SCURT, în română. ' +
  'Ce nu poți proba spui „nu pot verifica" — nu inventezi. Nu te prezinta la fiecare replică.'

export async function vocalLiveRoutes(app: FastifyInstance): Promise<void> {
  // Sonda: frontendul întreabă întâi dacă modul unificat e disponibil (are cheie
  // Gemini). Dacă nu, rămâne pe calea veche — nu deschide un WS spre gol.
  app.get('/api/vocal-live/capability', async (_req, reply) => {
    reply.header('Cache-Control', 'no-store')
    return { disponibil: vocalLiveDisponibila(), model: VOCAL_LIVE_MODEL, voce: VOCAL_LIVE_VOICE }
  })

  app.get('/api/vocal-live', { websocket: true }, (socket, req) => {
    const user = getSessionUser(req)
    if (!user) {
      try {
        socket.close(1008, 'unauthorized')
      } catch {
        /* deja închis */
      }
      return
    }
    if (!vocalLiveDisponibila()) {
      try {
        socket.close(1011, 'vocal_live_indisponibil')
      } catch {
        /* deja închis */
      }
      return
    }

    let inchis = false
    const trimite = (o: unknown): void => {
      if (inchis) return
      try {
        socket.send(JSON.stringify(o))
      } catch {
        /* socket picat — close-ul curăță */
      }
    }

    // Deschide sesiunea Live unică: aude + gândește + vorbește, un singur glas.
    const live: VocalLive | null = deschideVocalLive(PERSONA_KELION, [], {
      onGata: () => trimite({ type: 'gata' }),
      onAudioIesire: (data) => trimite({ type: 'audio', data }),
      onTranscriereUser: (text, final) => trimite({ type: 'user', text, final }),
      onTranscriereKelion: (text, final) => trimite({ type: 'kelion', text, final }),
      onUnealta: (apel) => {
        // Uneltele se leagă în pasul următor; până atunci răspundem gol ca modelul
        // să nu aștepte la nesfârșit dacă a cerut totuși una.
        live?.raspundeUnealta(apel.id, apel.name, { nelegat: true })
      },
      onIntrerupt: () => trimite({ type: 'intrerupt' }),
      onTuraGata: () => trimite({ type: 'tura_gata' }),
      onEroare: (motiv) => {
        trimite({ type: 'eroare', motiv })
        app.log.warn(`vocal-live: ${motiv}`)
      },
    })
    if (!live) {
      try {
        socket.close(1011, 'vocal_live_indisponibil')
      } catch {
        /* deja închis */
      }
      return
    }
    app.log.info(`vocal-live: WS conectat (user=${user.role}, model=${VOCAL_LIVE_MODEL}, voce=${VOCAL_LIVE_VOICE})`)

    socket.on('message', (data: RawData, isBinary: boolean) => {
      if (isBinary) {
        // Cadru de microfon: PCM16 16kHz → direct în sesiunea Live.
        live.scrieAudio(Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer))
      }
      // (Cadrele text/control se pot adăuga la nevoie — deocamdată doar audio.)
    })
    socket.on('close', () => {
      inchis = true
      live.inchide()
      app.log.info('vocal-live: WS închis')
    })
    socket.on('error', () => {
      inchis = true
      live.inchide()
    })
  })
}
