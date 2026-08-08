import type { FastifyInstance } from 'fastify'
import type { RawData } from 'ws'
import { getSessionUser } from '../session.js'
import {
  deschideVocalLive,
  vocalLiveDisponibila,
  construiesteInstructiune,
  VOCAL_LIVE_MODEL,
  VOCAL_LIVE_VOICE,
  type VocalLive,
} from '../services/vocalLive.js'
import { TOATE_UNELTELE_ADMIN } from '../services/brainToolDefs.js'
import type { UnealtaVocala } from '../services/vocalLive.js'
import { execSharedAdminTool } from '../services/adminTools.js'
import { saveMessage, getRecentHistory, saveKv, loadKv } from '../db.js'

// ── RUTA VOCII UNIFICATE — CALE SEPARATĂ ȘI EXCLUSIVĂ (4 aug 2026) ───────────
//
// Owner: „atenție că vei avea 2 voci în același timp". Corect — de-aia asta e o
// cale COMPLET SEPARATĂ, care ÎNLOCUIEȘTE lanțul vechi (ureche Chirp/Live →
// creier /api/chat → gură Chirp 3 HD), NU se adaugă peste el. Frontendul pornește
// FIE calea veche, FIE asta — niciodată amândouă. Aici, un singur glas: modelul
// Live aude, gândește ȘI vorbește el însuși (gura veche Chirp nu intră deloc).
//
// 8 AUG („execută cu Gemini") — două lucruri care lipseau ca să fie drum întreg:
//   1. MEMORIA: sesiunea pornea de la zero — Kelion era un străin politicos la
//      fiecare apăsare de microfon. Acum instrucțiunea de setup cară ultimele
//      schimburi (construiesteInstructiune, pură, probată).
//   2. ISTORICUL: nimic din ce se vorbea nu se salva — conversația vocală
//      dispărea fără urmă. Acum transcrierile finale intră în același istoric ca
//      mesajele scrise (saveMessage), deci următoarea sesiune le are drept
//      memorie. Cercul se închide.
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

// ── UNELTELE SESIUNII LIVE — DOAR SETUL DOVEDIT (8 aug, „pornește la voce,
// dar nimic") ────────────────────────────────────────────────────────────────
// Ruta trimitea TOATE cele 58 de unelte de admin, prin `as any[]`. Două
// probleme, ambele REALE:
//   1. NEDOVEDIT: proba din 7 aug a dovedit sesiunea live cu O SINGURĂ unealtă
//      simplă (`cauta`) — nimeni n-a văzut vreodată 58 de declarații acceptate.
//   2. SCHEMĂ GREȘITĂ, ascunsă de cast: uneltele de admin au câmpul
//      `input_schema`, sesiunea live cere `parameters` — deci fiecare
//      declarație pleca spre Google cu schema UNDEFINED. Exact felul de
//      nepotrivire pe care TypeScript l-ar fi prins, dacă nu-l amuțea `as any`.
// Consecința potrivea perfect simptomul: setup refuzat → sesiunea moare → un
// warn invizibil în consolă → cădere pe calea veche (care avea surzenia).
// Setul de mai jos e mic, conversațional, cu scheme plate — în spiritul
// fazelor: vocea vorbește; lucrul greu vine după ce se dovedește.
const UNELTE_LIVE = new Set(['list_updates', 'get_real_cost', 'stare_masurata', 'memorie_ia', 'memorie_lista', 'list_memories'])

function unelteleSesiuniiLive(): UnealtaVocala[] {
  return (TOATE_UNELTELE_ADMIN as Array<{ name: string; description: string; input_schema?: Record<string, unknown> }>)
    .filter((t) => UNELTE_LIVE.has(t.name))
    .map((t) => ({
      name: t.name,
      description: t.description,
      // `input_schema` → `parameters`: traducerea care lipsea. Fără schemă
      // reală, un obiect gol VALID — nu undefined.
      parameters: t.input_schema ?? { type: 'object', properties: {} },
    }))
}

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
    let live: VocalLive | null = null
    // Microfonul clientului pornește imediat după deschiderea WS-ului, dar
    // sesiunea Live se deschide DUPĂ citirea istoricului (mai jos). Cadrele din
    // fereastra aia nu se aruncă — se țin aici și se varsă la deschidere,
    // altfel primele cuvinte ale omului ar dispărea exact ca în bugul vechi
    // „nu mă aude la prima frază".
    const preCoada: Buffer[] = []

    const trimite = (o: unknown): void => {
      if (inchis) return
      try {
        socket.send(JSON.stringify(o))
      } catch {
        /* socket picat — close-ul curăță */
      }
    }

    // ── ISTORICUL SESIUNII VOCALE ────────────────────────────────────────────
    // Transcrierile vin în bucăți; se adună aici și se salvează la sfârșit de
    // tură — aceleași rânduri de istoric ca la chatul scris, deci următoarea
    // sesiune (vocală SAU scrisă) continuă conversația, n-o ia de la zero.
    let bufUser = ''
    let bufKelion = ''
    const salveazaTura = (): void => {
      const u = bufUser.trim()
      const k = bufKelion.trim()
      bufUser = ''
      bufKelion = ''
      if (u) void saveMessage(user.email, 'user', u).catch(() => {})
      if (k) void saveMessage(user.email, 'assistant', k).catch(() => {})
    }

    socket.on('message', (data: RawData, isBinary: boolean) => {
      if (!isBinary) return
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer)
      if (live) live.scrieAudio(buf)
      else {
        preCoada.push(buf)
        if (preCoada.length > 200) preCoada.shift() // plafon ~20s, ca în motor
      }
    })
    socket.on('close', () => {
      inchis = true
      salveazaTura() // o tură neterminată la închidere nu se pierde
      live?.inchide()
      app.log.info('vocal-live: WS închis')
    })
    socket.on('error', () => {
      inchis = true
      live?.inchide()
    })

    void (async () => {
      // Memoria: ultimele schimburi din istoric intră în instrucțiunea de setup.
      // O citire picată NU blochează vocea — sesiunea pornește fără memorie și
      // spune asta în jurnal (mai bine o voce uitucă decât niciuna).
      let istoric: Array<{ role: string; content: string }> = []
      try {
        istoric = await getRecentHistory(user.email, 12)
      } catch {
        app.log.warn('vocal-live: istoricul nu s-a putut citi — sesiunea pornește fără memorie')
      }
      const nume = user.name || user.email.split('@')[0]
      const instructiune = construiesteInstructiune(PERSONA_KELION, nume, istoric)

      // CONVERSAȚIA SUPRAVIEȚUIEȘTE REPORNIRII (8 aug, ownerul: „trebuie să nu
      // mai moară… chiar dacă se întrerupe 1 sec, e suficient să se redeschidă
      // și să continue chatul logic"). Mânerul de reluare Google trăia doar în
      // memoria procesului — o publicare îl pierdea și conversația murea. Acum
      // se persistă în kv la fiecare împrospătare (frânat la 5s) și se citește
      // aici: procesul nou reia ACEEAȘI sesiune, cu tot contextul ei. Un mâner
      // stătut nu strică: setup-ul cu el pică înainte de `gata`, iar degradarea
      // măsurată din motor reia curat, fără el.
      const KV_RELUARE = `vocal-live:reluare:${user.email.toLowerCase()}`
      let reluareInitial: string | undefined
      try {
        const brut = await loadKv(KV_RELUARE)
        if (brut) {
          const j = JSON.parse(brut) as { h?: string; t?: number }
          if (j.h && typeof j.t === 'number' && Date.now() - j.t < 10 * 60_000) {
            reluareInitial = j.h
            app.log.info('vocal-live: reiau sesiunea Google cu handle persistat (conversația continuă)')
          }
        }
      } catch {
        /* fără handle — sesiune proaspătă, nu blocăm vocea */
      }
      let ultimaSalvareHandle = 0

      if (inchis) return
      live = deschideVocalLive(instructiune, unelteleSesiuniiLive(), {
        onGata: () => trimite({ type: 'gata' }),
        onAudioIesire: (data) => trimite({ type: 'audio', data }),
        onTranscriereUser: (text, final) => {
          bufUser += text
          trimite({ type: 'user', text, final })
        },
        onTranscriereKelion: (text, final) => {
          bufKelion += text
          trimite({ type: 'kelion', text, final })
        },
        onUnealta: async (apel) => {
          try {
            const rezultat = await execSharedAdminTool(apel.name, apel.args as any, { email: user.email })
            if (rezultat !== null) {
              live?.raspundeUnealta(apel.id, apel.name, { rezultat })
            } else {
              live?.raspundeUnealta(apel.id, apel.name, { rezultat: 'Unealtă nesuportată în voce.' })
            }
          } catch (err: any) {
            app.log.error(`Eroare unealtă ${apel.name}: ${err.message}`)
            live?.raspundeUnealta(apel.id, apel.name, { eroare: err.message })
          }
        },
        onIntrerupt: () => trimite({ type: 'intrerupt' }),
        onTuraGata: () => {
          salveazaTura()
          trimite({ type: 'tura_gata' })
        },
        onEroare: (motiv) => {
          trimite({ type: 'eroare', motiv })
          app.log.warn(`vocal-live: ${motiv}`)
        },
        onInfo: (msg) => app.log.info(`vocal-live: ${msg}`),
        onHandleReluare: (handle) => {
          const acum = Date.now()
          if (acum - ultimaSalvareHandle < 5_000) return
          ultimaSalvareHandle = acum
          void saveKv(KV_RELUARE, JSON.stringify({ h: handle, t: acum })).catch(() => {})
        },
      }, reluareInitial)
      if (!live) {
        try {
          socket.close(1011, 'vocal_live_indisponibil')
        } catch {
          /* deja închis */
        }
        return
      }
      for (const b of preCoada.splice(0)) live.scrieAudio(b)
      app.log.info(
        `vocal-live: WS conectat (user=${user.role}, model=${VOCAL_LIVE_MODEL}, voce=${VOCAL_LIVE_VOICE}, memorie=${istoric.length} rânduri)`,
      )
    })()
  })
}
