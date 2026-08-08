import type { FastifyInstance } from 'fastify'
import type { RawData } from 'ws'
import { config } from '../config.js'
import { getSessionUser } from '../session.js'
import {
  deschideVocalLive,
  vocalLiveDisponibila,
  construiesteInstructiune,
  estimareCostAudioUsd,
  octetiDinBase64,
  VOCAL_LIVE_MODEL,
  VOCAL_LIVE_VOICE,
  type VocalLive,
} from '../services/vocalLive.js'
import { TOATE_UNELTELE_ADMIN } from '../services/brainToolDefs.js'
import type { UnealtaVocala } from '../services/vocalLive.js'
import { execSharedAdminTool } from '../services/adminTools.js'
import { saveMessage, getRecentHistory, saveKv, loadKv, recordCost } from '../db.js'

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
//   client → server:  cadre BINARE = PCM16 mono 16kHz de la microfon;
//                     JSON { type:'coords', lat, lon } = GPS-ul device-ului
//                     (8 aug: „nu are acces la gps, meteo" — fără el, ușa
//                     creierului rula meteo/hărți fără loc).
//   server → client:  JSON —
//     { type:'gata' }                              sesiunea Live e deschisă
//     { type:'audio', data:<base64 PCM 24kHz> }    glasul lui Kelion, de redat
//     { type:'user', text, final }                 ce aude (subtitrare)
//     { type:'kelion', text, final }               ce spune (subtitrare)
//     { type:'control', frame }                    cadru de ECRAN de la creier
//                                                  (monitor/doc/card — la
//                                                  handleControl, ca la scris)
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

// ── UȘA SPRE CREIERUL ÎNTREG (8 aug, ownerul, pe live: „kelion nu are acces
// la unelte, vocea merge, și atât" + „nu are acces la gps, meteo" + „modelul
// să rămână acesta, pe el construim") ────────────────────────────────────────
// Sesiunea live declara DOAR uneltele de administrare (sursă/DB/repo) — niciuna
// din uneltele de zi cu zi ale creierului (căutare, meteo, YouTube, hărți,
// mail, imagini, monitor: alea trăiesc în registrul chatului, ~76, cu execuția
// împletită în /api/chat). În loc să duplicăm executorul, sesiunea live
// primește O USĂ: unealta de mai jos duce cererea în /api/chat (aceeași
// sesiune de utilizator, același creier, aceleași unelte, aceeași
// contabilizare), iar rezultatul se întoarce modelului live care îl SPUNE.
// Cadrele de ECRAN (monitor/doc/card) din tură se retrimit browserului prin
// WS, la același handleControl ca la chatul scris. Exact arhitectura cerută:
// „să fie la fel ca la chatul live, doar că acum are și creier".
const UNEALTA_CREIER: UnealtaVocala = {
  name: 'cere_creierului',
  description:
    'Execută ORICE sarcină care cere unelte, informație din lume sau acțiune: căutare pe web, știri, ' +
    'METEO, muzică/YouTube, hărți/trasee/GPS, e-mail, calendar, generat imagini, deschis pagini sau ' +
    'panouri pe monitor, costuri, orice lucru concret. Cheam-o cu cererea utilizatorului formulată ' +
    'COMPLET, în limba lui. Creierul aplicației o execută cu uneltele lui și îți întoarce rezultatul.',
  parameters: {
    type: 'object',
    properties: { cerere: { type: 'string', description: 'cererea utilizatorului, completă, în limba lui' } },
    required: ['cerere'],
  },
}

/** Caracterul de control al fluxului /api/chat (chat.ts scrie
 *  `CTRL + JSON + CTRL` printre bucățile de text — oglinda parserului din
 *  frontend/src/lib/chat.ts). */
const CTRL = String.fromCharCode(31)

/** O tură COMPLETĂ pe creierul clasic, prin chiar ruta /api/chat (cookie-ul
 *  sesiunii omului → aceleași drepturi, aceleași unelte, aceeași
 *  contabilizare). Întoarce textul final; cadrele de control trec prin
 *  `laControl` pe măsură ce se despachetează. Orice eșec vine NUMIT. */
export async function turaCreierului(
  cookie: string,
  cerere: string,
  coords: { lat: number; lon: number } | null,
  imagini: string[],
  laControl: (frame: Record<string, unknown>) => void,
): Promise<{ ok: true; text: string } | { ok: false; motiv: string }> {
  let r: Response
  try {
    r = await fetch(`http://127.0.0.1:${config.port}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        messages: [{ role: 'user', content: cerere }],
        // Glasul e al modelului live — Chirp-ul chatului rămâne stins (regula
        // vocii unice) și nu plătim o sinteză pe care n-o redă nimeni.
        serverVoiceOff: true,
        coords: coords ?? undefined,
        // VEDEREA (8 aug: „hai și cu vedere, să închidem un capitol"): cadrele
        // camerei, cerute browserului LA CERERE (nu flux continuu) — ruta de
        // chat le primește exact ca de la clientul scris (max 4, sursă camera).
        images: imagini.length ? imagini.slice(-4) : undefined,
        now: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(90_000),
    })
  } catch (e) {
    return { ok: false, motiv: `creierul nu răspunde: ${e instanceof Error ? e.message.slice(0, 80) : String(e)}` }
  }
  if (!r.ok) return { ok: false, motiv: `creierul a răspuns ${r.status}` }
  const brut = await r.text()
  // Fluxul e text + cadre `CTRL json CTRL`: la split pe CTRL, segmentele impare
  // sunt cadrele. Un segment impar care nu e JSON valid se păstrează ca text —
  // mai bine un rând ciudat în rezultat decât un cadru pierdut tăcut.
  let text = ''
  const segmente = brut.split(CTRL)
  for (let i = 0; i < segmente.length; i++) {
    if (i % 2 === 0) {
      text += segmente[i]
      continue
    }
    try {
      laControl(JSON.parse(segmente[i]) as Record<string, unknown>)
    } catch {
      text += segmente[i]
    }
  }
  return { ok: true, text: text.trim() }
}

function tradu(t: { name: string; description: string; input_schema?: Record<string, unknown> }): UnealtaVocala {
  return {
    name: t.name,
    description: t.description,
    // `input_schema` → `parameters`: traducerea care lipsea. Fără schemă
    // reală, un obiect gol VALID — nu undefined.
    parameters: t.input_schema ?? { type: 'object', properties: {} },
  }
}

/** Uneltele sesiunii live, pe ROL (8 aug, ownerul: „acum e doar chat bot, da?"
 *  — măsurat: DA, sesiunea căra 6 unelte de citit și atât). La Live uneltele
 *  se declară O DATĂ la setup, nu la fiecare frază — deci inventarul plin nu
 *  costă nimic pe drumul frazei. Adminul primește TOT (cu plasa din motor:
 *  dacă Google refuză setul plin la setup, sesiunea coboară singură pe setul
 *  dovedit și scrie asta în jurnal); ceilalți rămân pe setul mic de citit. */
export function unelteleSesiuniiLive(rol: string): UnealtaVocala[] {
  const toate = TOATE_UNELTELE_ADMIN as Array<{ name: string; description: string; input_schema?: Record<string, unknown> }>
  // Ușa spre creierul întreg e PRIMA, pentru TOATE rolurile — fără ea, „vocea
  // merge, și atât" (măsurat 8 aug: sesiune acceptată, zero unelte de lume).
  if (rol === 'admin') return [UNEALTA_CREIER, ...toate.map(tradu)]
  return [UNEALTA_CREIER, ...toate.filter((t) => UNELTE_LIVE.has(t.name)).map(tradu)]
}

/** Setul mic DOVEDIT — rezerva pe care motorul o folosește dacă setup-ul cu
 *  inventarul plin e refuzat (vezi `unelteRezerva` în deschideVocalLive).
 *  Ușa spre creier rămâne ȘI aici — degradarea pierde uneltele de
 *  administrare, nu accesul la lume. */
export function unelteleDovedite(): UnealtaVocala[] {
  const toate = TOATE_UNELTELE_ADMIN as Array<{ name: string; description: string; input_schema?: Record<string, unknown> }>
  return [UNEALTA_CREIER, ...toate.filter((t) => UNELTE_LIVE.has(t.name)).map(tradu)]
}

const PERSONA_KELION =
  'Ești Kelion, asistentul lui Adrian. Vorbești firesc, cald și SCURT, în română. ' +
  'Ce nu poți proba spui „nu pot verifica" — nu inventezi. Nu te prezinta la fiecare replică. ' +
  'REGULA UNELTELOR: pentru ORICE cerere care implică informație din lume sau o acțiune — căutare, ' +
  'știri, METEO, muzică, YouTube, hărți, unde mă aflu, e-mail, calendar, imagini, deschis ceva pe ' +
  'monitor — chemi unealta cere_creierului cu cererea omului formulată complet, apoi spui pe scurt ' +
  'rezultatul. NU refuza niciodată pe motiv că n-ai unealta sau accesul: ușa e cere_creierului. ' +
  'Ce apare pe monitor NU se citește cu voce tare — o propoziție scurtă și atât.'

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

    // ── CONTABILIZAREA VOCII (8 aug: „creditul se consumă cu viteza luminii") ─
    // Până azi sesiunea live nu scria NIMIC în cost_events — pastila scădea
    // orbește pe lângă voce. Numărăm octeții chiar aici, la punctele de
    // trecere, și vărsăm estimarea (vezi estimareCostAudioUsd) sub kind
    // 'gemini' la fiecare 60s + la închidere — un restart de publicare pierde
    // cel mult ultimul minut, nu sesiunea întreagă.
    let octetiIn = 0
    let octetiOut = 0
    const varsaCostul = (): void => {
      const usd = estimareCostAudioUsd(octetiIn, octetiOut)
      octetiIn = 0
      octetiOut = 0
      if (usd > 0) void recordCost(user.email, 'gemini', usd)
    }
    const ceasCost = setInterval(varsaCostul, 60_000)

    // ANCORA REALITĂȚII (8 aug: „nu e ancorat în realitate, după coordonatele
    // gps"): browserul trimite {type:'coords', lat, lon, now, tz} chiar la
    // deschiderea socketului; deschiderea sesiunii Google o așteaptă maxim
    // 600 ms și o coace în instrucțiune. GPS-ul rămâne viu (reîmprospătat la
    // 2 min) pentru ușa creierului.
    let coords: { lat: number; lon: number } | null = null
    let ancora: { nowIso?: string; tz?: string; lat?: number; lon?: number; acc?: number } = {}
    let ancoraSosita: (() => void) | null = null
    // VEDEREA LA CERERE (8 aug: „hai și cu vedere"): când ușa se deschide,
    // serverul cere browserului cadrele camerei ({type:'cere_cadre'}) și
    // așteaptă răspunsul aici — zero trafic de imagini cât nu e nevoie.
    let primesteCadre: ((cadre: string[]) => void) | null = null

    socket.on('message', (data: RawData, isBinary: boolean) => {
      if (!isBinary) {
        try {
          const m = JSON.parse(String(data)) as {
            type?: string
            lat?: number
            lon?: number
            acc?: number
            now?: string
            tz?: string
            cadre?: unknown
          }
          if (m.type === 'coords') {
            if (Number.isFinite(m.lat) && Number.isFinite(m.lon)) {
              coords = { lat: m.lat as number, lon: m.lon as number }
            }
            ancora = {
              nowIso: typeof m.now === 'string' ? m.now : ancora.nowIso,
              tz: typeof m.tz === 'string' ? m.tz : ancora.tz,
              lat: coords?.lat,
              lon: coords?.lon,
              // precizia MĂSURATĂ a fixului GPS (±m), raportată de senzor
              acc: Number.isFinite(m.acc) ? Math.round(m.acc as number) : ancora.acc,
            }
            ancoraSosita?.()
            ancoraSosita = null
          } else if (m.type === 'cadre') {
            const cadre = Array.isArray(m.cadre) ? m.cadre.filter((c): c is string => typeof c === 'string') : []
            primesteCadre?.(cadre)
            primesteCadre = null
          }
        } catch {
          /* cadru text neînțeles — îl ignorăm, audio rămâne pe binar */
        }
        return
      }
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer)
      if (live) {
        live.scrieAudio(buf)
        octetiIn += buf.length
      } else {
        preCoada.push(buf)
        if (preCoada.length > 200) preCoada.shift() // plafon ~20s, ca în motor
      }
    })
    socket.on('close', () => {
      inchis = true
      clearInterval(ceasCost)
      varsaCostul() // restul de sub un minut nu se pierde
      salveazaTura() // o tură neterminată la închidere nu se pierde
      live?.inchide()
      app.log.info('vocal-live: WS închis')
    })
    socket.on('error', () => {
      inchis = true
      clearInterval(ceasCost)
      varsaCostul()
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
      // Ancora realității: dacă n-a sosit încă (browserul o trimite chiar la
      // deschiderea socketului), o așteptăm maxim 600 ms — sub pragul „primul
      // cuvânt sub 1s", și oricum sesiunea Google se deschide abia după.
      if (!ancora.nowIso) {
        await new Promise<void>((gata) => {
          const limita = setTimeout(() => {
            ancoraSosita = null
            gata()
          }, 600)
          ancoraSosita = () => {
            clearTimeout(limita)
            gata()
          }
        })
      }
      const instructiune = construiesteInstructiune(PERSONA_KELION, nume, istoric, ancora)

      // CONVERSAȚIA SUPRAVIEȚUIEȘTE REPORNIRII (8 aug, ownerul: „trebuie să nu
      // mai moară… chiar dacă se întrerupe 1 sec, e suficient să se redeschidă
      // și să continue chatul logic"). Mânerul de reluare Google trăia doar în
      // memoria procesului — o publicare îl pierdea și conversația murea. Acum
      // se persistă în kv la fiecare împrospătare (frânat la 5s) și se citește
      // aici: procesul nou reia ACEEAȘI sesiune, cu tot contextul ei. Un mâner
      // stătut nu strică: setup-ul cu el pică înainte de `gata`, iar degradarea
      // măsurată din motor reia curat, fără el.
      const KV_RELUARE = `vocal-live:reluare:${user.email.toLowerCase()}`
      // ── GENERAȚIA SESIUNII (8 aug, ownerul, după ușă: „calea către unelte e
      // ruptă — nu gps, nu hărți, nu youtube") ───────────────────────────────
      // MĂSURAT în jurnal: toate sesiunile de după publicarea ușii au fost
      // RELUATE cu handle persistat — iar reluarea resuscitează sesiunea VECHE
      // de la Google, cu uneltele și instrucțiunea din ziua nașterii ei. Ușa
      // exista în setup-ul nou, dar sesiunea reluată n-o vedea: „zice că are
      // alte unelte" — chiar le avea pe cele vechi. De-aia mânerul poartă acum
      // AMPRENTA capabilităților (numele uneltelor + persona): când inventarul
      // sau regulile se schimbă, mânerul din altă generație se ARUNCĂ și
      // sesiunea pornește proaspăt — cu memoria din istoric (instrucțiunea o
      // cară oricum), dar cu uneltele de AZI. O repornire de publicare fără
      // schimbare de unelte reia în continuare conversația, ca până acum.
      const genUnelte = `${unelteleSesiuniiLive(user.role)
        .map((u) => u.name)
        .join(',')}|${PERSONA_KELION.length}`
      let reluareInitial: string | undefined
      try {
        const brut = await loadKv(KV_RELUARE)
        if (brut) {
          const j = JSON.parse(brut) as { h?: string; t?: number; gen?: string }
          if (j.h && typeof j.t === 'number' && Date.now() - j.t < 10 * 60_000) {
            if (j.gen === genUnelte) {
              reluareInitial = j.h
              app.log.info('vocal-live: reiau sesiunea Google cu handle persistat (conversația continuă)')
            } else {
              app.log.info('vocal-live: handle din ALTĂ generație de unelte — sesiune proaspătă, cu uneltele de azi')
            }
          }
        }
      } catch {
        /* fără handle — sesiune proaspătă, nu blocăm vocea */
      }
      let ultimaSalvareHandle = 0

      if (inchis) return
      live = deschideVocalLive(instructiune, unelteleSesiuniiLive(user.role), {
        onGata: () => trimite({ type: 'gata' }),
        onAudioIesire: (data) => {
          octetiOut += octetiDinBase64(data)
          trimite({ type: 'audio', data })
        },
        onTranscriereUser: (text, final) => {
          bufUser += text
          trimite({ type: 'user', text, final })
        },
        onTranscriereKelion: (text, final) => {
          bufKelion += text
          trimite({ type: 'kelion', text, final })
        },
        onUnealta: async (apel) => {
          // UȘA SPRE CREIERUL ÎNTREG: cererea trece prin /api/chat cu sesiunea
          // omului — toate uneltele chatului, aceeași contabilizare. Cadrele de
          // ECRAN se retrimit browserului; cadrele de VOCE nu trec (glasul e al
          // modelului live — regula vocii unice), nici cele de mers (receipt/
          // heartbeat/lang), care ar deruta handleControl.
          if (apel.name === 'cere_creierului') {
            const cerere = String((apel.args as { cerere?: unknown }).cerere ?? '').trim()
            if (!cerere) {
              live?.raspundeUnealta(apel.id, apel.name, { eroare: 'cerere goală' })
              return
            }
            app.log.info(`vocal-live: ușa creierului — „${cerere.slice(0, 80)}"`)
            // VEDEREA: cere browserului cadrele camerei și așteaptă maxim
            // 1,5 s — fără cameră (sau fără răspuns) tura pleacă fără imagini,
            // nu se blochează.
            const cadre = await new Promise<string[]>((resolve) => {
              const limita = setTimeout(() => {
                primesteCadre = null
                resolve([])
              }, 1500)
              primesteCadre = (c) => {
                clearTimeout(limita)
                resolve(c)
              }
              trimite({ type: 'cere_cadre' })
            })
            const CADRE_ECRAN = ['monitor', 'doc', 'app', 'card', 'image', 'golesteMonitor', 'build', 'device']
            const r = await turaCreierului(req.headers.cookie ?? '', cerere, coords, cadre, (frame) => {
              if (CADRE_ECRAN.some((k) => k in frame)) trimite({ type: 'control', frame })
            })
            if (r.ok) {
              live?.raspundeUnealta(apel.id, apel.name, { rezultat: r.text || 'creierul n-a întors niciun text' })
            } else {
              app.log.warn(`vocal-live: ușa creierului a picat: ${r.motiv}`)
              live?.raspundeUnealta(apel.id, apel.name, { eroare: r.motiv })
            }
            return
          }
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
          // Mânerul se salvează CU generația lui de unelte — la următoarea
          // schimbare de capabilități, un mâner din altă generație se aruncă.
          void saveKv(KV_RELUARE, JSON.stringify({ h: handle, t: acum, gen: genUnelte })).catch(() => {})
        },
      }, reluareInitial, user.role === 'admin' ? unelteleDovedite() : undefined)
      if (!live) {
        try {
          socket.close(1011, 'vocal_live_indisponibil')
        } catch {
          /* deja închis */
        }
        return
      }
      for (const b of preCoada.splice(0)) {
        live.scrieAudio(b)
        octetiIn += b.length
      }
      app.log.info(
        `vocal-live: WS conectat (user=${user.role}, model=${VOCAL_LIVE_MODEL}, voce=${VOCAL_LIVE_VOICE}, memorie=${istoric.length} rânduri)`,
      )
    })()
  })
}
