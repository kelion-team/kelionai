import type { FastifyInstance } from 'fastify'
import { createHash } from 'node:crypto'
import type { RawData } from 'ws'
import { config } from '../config.js'
import { getSessionUser } from '../session.js'
import {
  deschideVocalLive,
  vocalLiveDisponibila,
  construiesteInstructiune,
  oraLocalaText,
  estimareCostAudioUsd,
  estimareCostCadreUsd,
  octetiDinBase64,
  VOCAL_LIVE_MODEL,
  VOCAL_LIVE_VOICE,
  type VocalLive,
} from '../services/vocalLive.js'
import { TOATE_UNELTELE_ADMIN } from '../services/brainToolDefs.js'
import { turaAdresata } from '../services/numeStrigat.js'
import { inceputStrain, aCerutAltaLimba } from '../services/limbaRaspuns.js'
import { interpretDeviceCommand, deviceAck } from '../services/commands.js'
import { creeazaDetectorVocePeste } from '../services/vocePesteKelion.js'
import type { UnealtaVocala } from '../services/vocalLive.js'
import { execSharedAdminTool, execUserScopedTool, USER_SCOPED_TOOLS } from '../services/adminTools.js'
import { recallMemories, learnFromTurn } from '../services/agents.js'
import { saveMessage, getRecentHistory, saveKv, loadKv, deleteKv, recordCost, listBuildJobs, getSpeechLang, citesteSold, debitWallet } from '../db.js'

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
//                     creierului rula meteo/hărți fără loc);
//                     JSON { type:'cadru', data } = UN cadru de cameră (JPEG
//                     base64 brut) → intră DIRECT în sesiunea Live ca video
//                     (8 aug: „trebuie să poată folosi camera").
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

// ── PULSUL VOCII — DIAGNOSTIC PUBLIC, DOAR CIFRE (9 aug seara) ───────────────
// „Nu merge audio" fără acces la jurnalul VPS = ghicit pe rând. Contoarele
// astea spun EXACT unde moare sunetul: serverul primește audio de la Google?
// îl trimite browserului? îl suprimă vreun gard? Niciun conținut nu iese —
// doar numere și numele variantei de sesiune. GET /api/vocal-live/stare.
export const pulsVoce = {
  sesiuniDeschise: 0,
  sesiuniTotal: 0,
  cadreAudioDeLaGoogle: 0,
  cadreAudioSpreBrowser: 0,
  suprimateAdresare: 0,
  suprimateLimba: 0,
  intreruperiModel: 0,
  // Barge-in-ul SERVERULUI (9 aug seara, „vorbește peste mine"): de câte ori
  // vocea omului l-a oprit pe Kelion + câte cadre Google s-au aruncat după.
  taieriPeVoceaOmului: 0,
  suprimateDupaTaiere: 0,
  varianta: '',
  ultimaEroare: '',
  laUltimulCadru: 0,
}

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
  monitor?: Record<string, unknown> | null,
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
        // Ușa = acțiune prin definiție: creierul primește inventarul PLIN, nu
        // faza de vorbire (8 aug: „a oferit soluții dar nu poate să implementeze"
        // — cererea „trimite lista constructorului" pica pe faza de conversație
        // și creierul povestea în loc să cheme build_software).
        usaCreierului: true,
        coords: coords ?? undefined,
        // VEDEREA (8 aug: „hai și cu vedere, să închidem un capitol"): cadrele
        // camerei, cerute browserului LA CERERE (nu flux continuu) — ruta de
        // chat le primește exact ca de la clientul scris (max 4, sursă camera).
        images: imagini.length ? imagini.slice(-4) : undefined,
        // CE E PE MONITOR (10 aug): get_monitor din creier îl citește de aici,
        // deci vocea „citește ce e pe ecran" ajunge la conținutul REAL.
        monitorContent: monitor ?? undefined,
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
  'Ce apare pe monitor NU se citește cu voce tare — o propoziție scurtă și atât. ' +
  'VEDEREA (la CERERE, NU continuu): nu primești un flux permanent de la cameră — cadrele se ' +
  'taxează, așa că vin DOAR când le ceri. La „ce vezi", „uită-te", „citește ce e aici" CERI ' +
  'cadrele prin ușa cere_creierului și te uiți la imaginea de ATUNCI, proaspătă. Nu spune „văd ' +
  'acum" fără să fi cerut cadrele; nu comenta imaginea nechemat, niciodată. Dacă la cerere nu vin ' +
  'cadre, camera e oprită — o spui, nu inventezi o vedere. ' +
  'INVENTARUL TĂU COMPLET (prin cere_creierului ai TOATE astea, conectate la contul Google al ' +
  'omului): Gmail (citit/trimis e-mail), Google Calendar (evenimente), Google Drive (fișiere), ' +
  'Tasks, Contacts; căutare web live, știri, METEO, hărți/trasee/GPS, YouTube/muzică, traduceri, ' +
  'Wikipedia, conversii valutare, ora pe fus, generat imagini, deschis orice pe monitor, browser ' +
  'live pe orice site; iar pentru Adrian: constructorul (build_software — implementează cerințe), ' +
  'sursă/DB/repo/PR-uri/runbook-uri. Când omul cere ceva din lista asta, NU spui „nu am acces" — ' +
  'chemi cere_creierului. Ești CONȘTIENT de inventarul ăsta: la „ce știi să faci?" îl spui.'

export async function vocalLiveRoutes(app: FastifyInstance): Promise<void> {
  // Sonda: frontendul întreabă întâi dacă modul unificat e disponibil (are cheie
  // Gemini). Dacă nu, rămâne pe calea veche — nu deschide un WS spre gol.
  // Pulsul vocii — DOAR cifre (vezi pulsVoce, mai sus). Public: niciun conținut,
  // doar contoare; cu el, „nu merge audio" se citește de oriunde cu un curl.
  app.get('/api/vocal-live/stare', async (_req, reply) => {
    reply.header('Cache-Control', 'no-store')
    return pulsVoce
  })

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
    // ── POARTA DE CREDIT PE VOCE (10 aug — gaura „−10.280 credite"): chatul
    // scris avea paywall, sesiunea LIVE nu verifica NICIODATĂ soldul — un user
    // nou cu Google vorbea pe contul ownerului la nesfârșit, adânc pe minus.
    // Aceeași politică precisă ca la scris (chat.ts): adminul e scutit; fără
    // link de plată configurat, aplicația rămâne liberă; soldul NECITIT lasă
    // trecerea (eroarea noastră nu se plătește din buzunarul omului) — dar un
    // sold CITIT ≤ 0 închide sesiunea. Aceeași funcție bate și la deschidere,
    // și pe ceasul de 60s (o sesiune pornită cu credit se OPREȘTE la golire).
    const inchideDacaFaraCredit = (laDeschidere: boolean): void => {
      if (!config.revolut.payLink || user.role === 'admin') return
      void citesteSold(user.email).then((s) => {
        if (s.citit && s.sold <= 0) {
          try {
            socket.close(1008, 'fara_credit')
          } catch {
            /* deja închis */
          }
        } else if (laDeschidere && !s.citit) {
          app.log.error(`[VOCE][paywall] sold NECITIT la deschidere, las trecerea: ${s.motiv}`)
        }
      })
    }
    inchideDacaFaraCredit(true)

    // Pulsul numără sesiunile REAL (audit 9 aug: contoarele existau din #947,
    // dar nimeni nu le incrementa — panoul anti-minciună raporta permanent 0).
    pulsVoce.sesiuniTotal++
    pulsVoce.sesiuniDeschise++
    let sesiuneScazuta = false // close și error pot trage amândouă — scădem o dată
    const scadeSesiunea = (): void => {
      if (sesiuneScazuta) return
      sesiuneScazuta = true
      pulsVoce.sesiuniDeschise = Math.max(0, pulsVoce.sesiuniDeschise - 1)
    }

    let inchis = false
    let live: VocalLive | null = null
    // Microfonul clientului pornește imediat după deschiderea WS-ului, dar
    // sesiunea Live se deschide DUPĂ citirea istoricului (mai jos). Cadrele din
    // fereastra aia nu se aruncă — se țin aici și se varsă la deschidere,
    // altfel primele cuvinte ale omului ar dispărea exact ca în bugul vechi
    // „nu mă aude la prima frază".
    const preCoada: Buffer[] = []
    // ── TĂIEREA LA VOCEA OMULUI (9 aug seara, ownerul: „vorbește peste mine") ─
    // NO_INTERRUPTION (#946) l-a făcut imun la ecou, dar și la OM. Serverul
    // decide în locul lui Google: voce susținută peste replica lui → redarea
    // din browser se golește (intrerupt) și restul replicii se aruncă.
    // `aecActiv` vine de la browser — fără anulare de ecou detectorul ar auzi
    // chiar vocea lui Kelion și l-ar tăia singur (regresia din 8 aug), deci
    // rămâne oprit până la raport.
    let aecActiv = false
    let taiatDeVoce = false
    // Ceasul DIFUZORULUI: cadrele sosesc în rafale, mai repede decât se aud —
    // estimăm până CÂND se aude vocea din durata PCM reală (24 kHz, 16 bit).
    let redareEstimataPanaLa = 0
    const detectorVoce = creeazaDetectorVocePeste()
    // ── VERDICTELE TUREI — trăiesc AICI, nu în closure-ul async, ca și
    // close/error să le poată consulta (audit 9 aug: salvarea de la închidere
    // ignora verdictele și băga în istoric ture suprimate — otravă pentru
    // instrucțiunea sesiunii următoare).
    let verdictTura: boolean | null = null // null = tura n-a început să răspundă
    let verdictLimba: boolean | null = null // null = nedecis; false = străină
    // Tura de SISTEM se declară EXPLICIT (anunțul de ordin terminat), nu se
    // mai deduce din „transcriere goală" — deducția era o poartă fail-open:
    // transcrierea Google sosește adesea DUPĂ primul cadru audio, deci tura
    // ambientală trecea drept „sistem" și se REDA (audit 9 aug, critică).
    let turaDeSistem = false
    // Rostirea CURENTĂ (segmentată pe pauze >2,5s): adresarea se judecă pe
    // ULTIMA rostire, nu pe tot ce s-a strâns peste ture mute — altfel
    // „Kelion, …" proaspăt rămânea îngropat după primele 4 cuvinte VECHI.
    let rostireCurenta = ''
    let ultimaTranscriereUserLa = 0
    // Verdict AMÂNAT: cadrele sosite înaintea transcrierii se țin aici — nici
    // redate, nici suprimate. La prima transcriere se judecă; la 900 ms fără
    // nicio transcriere → fail-open (lecția 308/308: mai bine o tură ambientală
    // scăpată decât vocea moartă).
    const cadreInAsteptare: string[] = []
    let ceasAsteptareVerdict: NodeJS.Timeout | null = null
    // Golirea difuzorului și ceasul lui nu se despart NICIODATĂ (audit 9 aug:
    // gardul de limbă golea redarea dar lăsa ceasul pe „vorbește" → detectorul
    // de voce tăia fals, pe liniște).
    const golesteRedarea = (): void => {
      redareEstimataPanaLa = 0
      trimite({ type: 'intrerupt' })
    }

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
      rostireCurenta = ''
      if (u) void saveMessage(user.email, 'user', u).catch(() => {})
      if (k) void saveMessage(user.email, 'assistant', k).catch(() => {})
      // ÎNVĂȚAREA PE VOCE (10 aug, ownerul: „nu ține minte nimic"): pe scris,
      // fiecare tură trece prin learnFromTurn (extrage fapte durabile → memorie
      // 'kelion'); calea vocală nu chema NICIODATĂ asta — un fapt spus la voce
      // („fiica mea se numește Ana") nu devenea memorie. Acum, la fel ca scrisul.
      // Fire-and-forget: nu ține tura pe loc, o citire/scriere picată nu strică.
      if (u || k) void learnFromTurn(user.email, u, k, 'kelion').catch(() => {})
    }
    // UN SINGUR drum de închidere a turei (audit 9 aug): tura suprimată se
    // GOLEȘTE cu jurnal, nu se salvează — regula din onTuraGata, acum și pe
    // close/error; înainte, o replică spaniolă suprimată intra totuși în
    // istoric la închiderea WS-ului și otrăvea sesiunea următoare.
    const incheieTura = (): void => {
      if (verdictTura === false || verdictLimba === false) {
        app.log.info(
          verdictLimba === false
            ? `[VOCE] tură suprimată aruncată la închidere (limbă străină): „${bufKelion.trim().slice(0, 120)}"`
            : `[VOCE] tură suprimată aruncată la închidere (nu i se vorbea lui): auzit „${bufUser.trim().slice(0, 120)}"`,
        )
        bufUser = ''
        bufKelion = ''
        rostireCurenta = ''
        return
      }
      salveazaTura()
    }

    // ── CONTABILIZAREA VOCII (8 aug: „creditul se consumă cu viteza luminii") ─
    // Până azi sesiunea live nu scria NIMIC în cost_events — pastila scădea
    // orbește pe lângă voce. Numărăm octeții chiar aici, la punctele de
    // trecere, și vărsăm estimarea (vezi estimareCostAudioUsd) sub kind
    // 'gemini' la fiecare 60s + la închidere — un restart de publicare pierde
    // cel mult ultimul minut, nu sesiunea întreagă.
    let octetiIn = 0
    let octetiOut = 0
    // Cadrele de cameră trimise în sesiune (8 aug: „trebuie să poată folosi
    // camera") — numărate aici, estimate în varsaCostul.
    let cadreTrimise = 0
    const varsaCostul = (): void => {
      const usd = estimareCostAudioUsd(octetiIn, octetiOut) + estimareCostCadreUsd(cadreTrimise)
      octetiIn = 0
      octetiOut = 0
      cadreTrimise = 0
      if (usd > 0) {
        void recordCost(user.email, 'gemini', usd)
        // DEBITAREA CLIENTULUI (10 aug, gaura „−10.280"): costul vocii live se
        // scădea doar în jurnal, nu și din portofelul clientului — vocea era
        // gratis pentru el, pe factura ownerului. Aceeași regulă ca la scris:
        // clientul plătește din credit; ownerul nu se taxează singur.
        if (user.role !== 'admin') void debitWallet(user.email, usd, 'voce-live')
      }
    }
    const ceasCost = setInterval(() => {
      varsaCostul()
      // OPRIREA PE SOLD GOLIT (10 aug): aceeași poartă ca la deschidere, pe
      // ritmul de 60s al vărsării costului — altfel „−10.280".
      inchideDacaFaraCredit(false)
    }, 60_000)

    // ── ANUNȚUL „CÂND E GATA" (8 aug, ownerul: „să anunțe când e gata") ──────
    // Ordinele de constructor pornite PRIN UȘĂ din sesiunea asta se țin minte
    // (id-ul din „Am preluat cerința (ordin #N)"), iar la fiecare 30s se
    // citește starea lor. Terminat (gata sau eșuat) → un anunț injectat în
    // sesiune, pe care Kelion îl SPUNE cu vocea lui. Fără ordine urmărite,
    // bătaia nu costă nimic (iese din prima).
    const ordineUrmarite = new Set<number>()
    const ceasOrdine = setInterval(() => {
      if (!ordineUrmarite.size || inchis) return
      void (async () => {
        const jobs = await listBuildJobs(24).catch(() => null)
        if (!jobs) return // coada necitibilă — încercăm la bătaia următoare
        for (const j of jobs) {
          if (!ordineUrmarite.has(j.id)) continue
          if (j.status === 'done' || j.status === 'failed') {
            ordineUrmarite.delete(j.id)
            turaDeSistem = true // tura care urmează e ANUNȚ, declarat pe față — nu dedus din buffer gol
            live?.anunta(
              `[ANUNȚ DE SISTEM — nu e vocea omului] Ordinul de construcție #${j.id} ` +
                `(„${j.orderText.slice(0, 80)}") s-a terminat: ${j.status === 'done' ? 'GATA' : 'A EȘUAT'}` +
                `${j.prUrl ? `, PR: ${j.prUrl}` : ''}${j.ci ? `, verificare CI: ${j.ci}` : ''}. ` +
                `Anunță-l pe Adrian într-o propoziție scurtă, cu numărul ordinului.`,
            )
          }
        }
      })()
    }, 30_000)

    // ANCORA REALITĂȚII (8 aug: „nu e ancorat în realitate, după coordonatele
    // gps"): browserul trimite {type:'coords', lat, lon, now, tz} chiar la
    // deschiderea socketului; deschiderea sesiunii Google o așteaptă maxim
    // 600 ms și o coace în instrucțiune. GPS-ul rămâne viu (reîmprospătat la
    // 2 min) pentru ușa creierului.
    let coords: { lat: number; lon: number } | null = null
    let ancora: { nowIso?: string; tz?: string; lat?: number; lon?: number; acc?: number } = {}
    let ancoraSosita: (() => void) | null = null
    // CE E PE MONITOR acum (10 aug): ultimul conținut raportat de browser cu
    // bătaia de coords — retransmis prin ușa creierului la get_monitor.
    let monitorLive: Record<string, unknown> | null = null
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
            // CE E PE MONITOR, ținut pentru get_monitor pe VOCE (10 aug): vine
            // cu aceeași bătaie ca ancora; null = nimic afișat acum.
            const mon = (m as { monitor?: unknown }).monitor
            monitorLive = mon && typeof mon === 'object' ? (mon as Record<string, unknown>) : null
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
            // ORA CURGE ÎN SESIUNE (8 aug: „la «bună seara» verifică ora dată
            // de GPS real"). Instrucțiunea are ora doar de la NAȘTEREA
            // sesiunii, iar reluările o cară ore întregi — de-aia salutul
            // cădea pe ora veche. Fiecare cadru de coordonate (la deschidere +
            // la 2 min) împinge ora reală ca ancoră TĂCUTĂ (turnComplete:
            // false — modelul nu răspunde, doar știe cât e ceasul).
            if (ancora.nowIso && live) {
              live.ancoreaza(
                `[ANCORĂ DE SISTEM — context, nu răspunde la rândul ăsta] ` +
                  `Ora locală reală a device-ului chiar acum: ${oraLocalaText(ancora.nowIso, ancora.tz)}` +
                  `${ancora.tz ? ` (fusul ${ancora.tz})` : ''}.`,
              )
            }
          } else if (m.type === 'cadre') {
            const cadre = Array.isArray(m.cadre) ? m.cadre.filter((c): c is string => typeof c === 'string') : []
            primesteCadre?.(cadre)
            primesteCadre = null
          } else if (m.type === 'cadru' && typeof (m as { data?: unknown }).data === 'string') {
            // OCHII SESIUNII (8 aug: „trebuie să poată folosi camera"): cadrul
            // intră DIRECT în sesiunea Live, ca video în flux — modelul vede
            // în timp ce vorbește, fără să treacă prin ușă.
            live?.scrieCadru((m as { data: string }).data)
            cadreTrimise++
          } else if (m.type === 'aec') {
            // Browserul raportează dacă bucla de anulare a ecoului e vie —
            // doar atunci tăierea la vocea omului are voie să judece.
            aecActiv = (m as { activ?: unknown }).activ === true
            app.log.info(`vocal-live: AEC raportat de browser: ${aecActiv ? 'activ — tăierea la voce armată' : 'INACTIV — tăierea la voce oprită (ecou netratat)'}`)
          }
        } catch {
          /* cadru text neînțeles — îl ignorăm, audio rămâne pe binar */
        }
        return
      }
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer)
      // Detectorul rulează pe FIECARE cadru (podeaua de zgomot învață și când
      // Kelion tace); verdictul de tăiere e posibil doar cât se AUDE Kelion
      // (ceasul difuzorului) și doar cu AEC-ul viu.
      if (detectorVoce.proceseazaCadru(buf, aecActiv && Date.now() < redareEstimataPanaLa)) {
        taiatDeVoce = true
        pulsVoce.taieriPeVoceaOmului++
        golesteRedarea() // browserul golește redarea ACUM, ceasul difuzorului tace
        app.log.info('[VOCE] omul a vorbit peste Kelion — i-am tăiat vorba (barge-in pe server)')
      }
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
      scadeSesiunea()
      clearInterval(ceasCost)
      clearInterval(ceasOrdine)
      if (ceasAsteptareVerdict) {
        clearTimeout(ceasAsteptareVerdict)
        ceasAsteptareVerdict = null
      }
      varsaCostul() // restul de sub un minut nu se pierde
      incheieTura() // o tură neterminată nu se pierde — dar una SUPRIMATĂ nu se salvează
      live?.inchide()
      app.log.info('vocal-live: WS închis')
    })
    socket.on('error', () => {
      inchis = true
      scadeSesiunea()
      clearInterval(ceasCost)
      clearInterval(ceasOrdine)
      if (ceasAsteptareVerdict) {
        clearTimeout(ceasAsteptareVerdict)
        ceasAsteptareVerdict = null
      }
      varsaCostul()
      incheieTura()
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
      // PINUL DE LIMBĂ (9 aug, „Dime, ¿qué" — instrucțiunile nu țin): limba
      // gurii se PINUIEȘTE determinist din preferința REALĂ a userului
      // (speech_lang); fără preferință, româna (limba aplicației). O citire
      // picată nu blochează vocea — cade pe ro-RO și spune în jurnal.
      const BCP47: Record<string, string> = {
        ro: 'ro-RO', en: 'en-US', es: 'es-ES', fr: 'fr-FR', de: 'de-DE', it: 'it-IT', pt: 'pt-PT',
      }
      // PE TOATE LIMBILE (9 aug, ownerul: „la user chinez sau japonez ce
      // face?"): pinul se pune DOAR pe ce știm sigur — limbile aplicației din
      // hartă sau un BCP-47 complet salvat (ex. ja-JP). O limbă NECUNOSCUTĂ =
      // FĂRĂ pin și FĂRĂ gard: sesiunea merge pe auto-detecția Google
      // (comportamentul dinainte) — mai bine auto decât un pin GREȘIT pe
      // română pentru un vorbitor de chineză.
      let limbaPin: string | undefined = 'ro-RO'
      try {
        const pref = await getSpeechLang(user.email)
        if (!pref) limbaPin = 'ro-RO' // fără preferință → limba aplicației
        else if (BCP47[pref]) limbaPin = BCP47[pref]
        else if (/^[a-z]{2}-[A-Z]{2}$/.test(pref)) limbaPin = pref // ex. ja-JP întreg
        else limbaPin = undefined // necunoscută → auto-detecție, fără gard
      } catch {
        app.log.warn('vocal-live: speech_lang necitibil — pinul de limbă rămâne ro-RO')
      }
      const nume = user.name || user.email.split('@')[0]
      // MEMORIA DE LUNGĂ DURATĂ (10 aug, ownerul: „nu ține minte nimic"): pe
      // scris, recallMemories injectează ce știe Kelion despre user în prompt;
      // calea vocală se cocea DOAR din ultimele 12 replici brute — un fapt
      // învățat în scris nu era reamintit la voce. Acum aceeași memorie. O citire
      // picată NU blochează vocea (mai bine fără memorie decât fără voce).
      let memorie = ''
      try {
        memorie = await recallMemories(user.email, 'kelion')
      } catch {
        app.log.warn('vocal-live: memoria de lungă durată necitibilă — sesiunea pornește doar cu istoricul recent')
      }
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
      const instructiune = construiesteInstructiune(PERSONA_KELION, nume, istoric, ancora, limbaPin) + memorie

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
      // AMPRENTA VEDE ACUM ȘI REGULILE (9 aug, revizia: CRITICĂ — „ancora
      // întărită N-A AJUNS în sesiunile reluate"): vechea amprentă era numele
      // uneltelor + LUNGIMEA personei, deci o regulă nouă în
      // construiesteInstructiune (ancora limbii, trezirea) NU rotea generația —
      // handle-ul relua sesiunea Google veche, cu instrucțiunea din ziua
      // NAȘTERII ei. De-aia capturile de la 16:24 tot spaniolă arătau: regula
      // nouă nici nu ajunsese la model. Acum amprenta e hash peste instrucțiunea
      // STATICĂ completă (fără ancoră/istoric — alea se schimbă mereu): orice
      // schimbare de REGULI aruncă mânerul vechi și sesiunea pornește proaspăt.
      const genUnelte = createHash('sha256')
        .update(unelteleSesiuniiLive(user.role).map((u) => u.name).join(','))
        .update(construiesteInstructiune(PERSONA_KELION, 'gen', []))
        .digest('hex')
        .slice(0, 16)
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
      // ── GARDUL TREZIRII PE NUME — DETERMINIST, PE SERVER (9 aug) ────────────
      // Ownerul, a treia oară azi: „kelion nu identifică când discuțiile
      // ambientale sunt între alte persoane". Instrucțiunea (PR #926) e o
      // rugăminte; ăsta e gardul: audio-ul modelului pleacă spre difuzor DOAR
      // dacă tura era ADRESATĂ (numele la început SAU dialog în curs — Kelion a
      // vorbit în ultimele FEREASTRA_DIALOG_MS). O tură pornită de SISTEM
      // (anunț de ordin, fără vorbă de om în față) trece mereu. Verdictul se ia
      // O DATĂ pe tură, la prima bucată de audio, pe transcrierea de până
      // atunci; tura suprimată se scrie în jurnal cu ce s-a auzit — o tăcere
      // GREȘITĂ trebuie să se poată vedea, nu să dispară (lecția numeStrigat).
      let ultimaVorbaKelion = 0 // 0 = n-a vorbit încă deloc
      // ── GARDUL DE LIMBĂ — DETERMINIST, PE SERVER (9 aug, revizia) ────────
      // Al doilea gard pe ieșire, frate cu adresarea: dacă răspunsul ÎNCEPE
      // într-o limbă străină (markeri ficși, services/limbaRaspuns.ts) și omul
      // n-a cerut-o, tura se SUPRIMĂ (audio tăiat + intrerupt spre browser) și
      // NU intră în istoric (altfel otrăvea instrucțiunea sesiunii următoare).
      // (verdictTura/verdictLimba trăiesc în scope-ul conexiunii, mai sus —
      // close/error le consultă la salvare.)
      // Gardul e legat de limba PINUITĂ a userului (9 aug, ownerul: „asta e
      // pentru admin sau se aplică la fiecare limbă?"): detectorul știe să
      // prindă doar ne-româna, deci taie DOAR când limba userului e româna —
      // un user cu engleza (sau orice altă limbă) setată își primește limba lui.
      const gardDeLimba = limbaPin === 'ro-RO'
      let primaTura = true
      const turaAdresataAcum = (): boolean => {
        // Judecăm pe ROSTIREA curentă (ultima activitate de vorbire), nu pe
        // bufferul întreg — un „Kelion, …" proaspăt nu mai e îngropat după
        // primele 4 cuvinte ale unui text vechi (audit 9 aug).
        const spusa = rostireCurenta.trim() || bufUser.trim()
        if (turaDeSistem) return true // anunț declarat EXPLICIT, nu dedus
        if (!spusa) return true // nimic auzit vreodată — nu suprimăm orbește
        // BLOCAJUL LA RECE, MĂSURAT (9 aug seara, pulsul: 308 cadre de voce de
        // la Google, 308 suprimate pe adresare, 0 spre browser): fereastra de
        // dialog se deschide doar după ce Kelion „a vorbit", dar nimic nu
        // trecea de gard ca să fi vorbit vreodată — mut pe veci fără „Kelion"
        // la fiecare frază. Cine deschide sesiunea și vorbește PRIMUL, lui
        // Kelion îi vorbește — prima tură e adresată prin definiție.
        if (primaTura) return true
        const deLaVorba = ultimaVorbaKelion > 0 ? Date.now() - ultimaVorbaKelion : Number.POSITIVE_INFINITY
        return turaAdresata(spusa, deLaVorba)
      }
      // Livrarea unui cadru de voce spre difuzor — TOATĂ contabilitatea la un
      // loc, folosită și de drumul normal și de vărsarea cadrelor amânate.
      const livreazaCadru = (data: string): void => {
        ultimaVorbaKelion = Date.now()
        // Ceasul difuzorului: octeți → mostre 16-bit → ms la 24 kHz. Fără el,
        // barge-in-ul ar crede că Kelion tace când el încă vorbește din buffer.
        redareEstimataPanaLa = Math.max(redareEstimataPanaLa, Date.now()) + octetiDinBase64(data) / 2 / 24
        pulsVoce.cadreAudioSpreBrowser++
        trimite({ type: 'audio', data })
      }
      // Cadrele ținute până la verdict se varsă prin ACEEAȘI judecată ca cele
      // directe — redate sau numărate ca suprimate, niciodată pierdute tăcut.
      const varsaCadreleInAsteptare = (): void => {
        if (ceasAsteptareVerdict) {
          clearTimeout(ceasAsteptareVerdict)
          ceasAsteptareVerdict = null
        }
        for (const data of cadreInAsteptare.splice(0)) {
          if (!verdictTura) pulsVoce.suprimateAdresare++
          else if (verdictLimba === false) pulsVoce.suprimateLimba++
          else if (taiatDeVoce) pulsVoce.suprimateDupaTaiere++
          else livreazaCadru(data)
        }
      }
      live = deschideVocalLive(instructiune, unelteleSesiuniiLive(user.role), {
        onGata: () => trimite({ type: 'gata' }),
        onAudioIesire: (data) => {
          pulsVoce.cadreAudioDeLaGoogle++
          pulsVoce.laUltimulCadru = Date.now()
          octetiOut += octetiDinBase64(data) // Google a facturat-o oricum — se numără
          if (verdictTura === null) {
            const areTemei = rostireCurenta.trim() || bufUser.trim() || turaDeSistem || primaTura
            if (!areTemei) {
              // Transcrierea n-a sosit încă (Google o trimite adesea DUPĂ
              // primul cadru audio) — verdict AMÂNAT, nu poartă deschisă:
              // înainte, „buffer gol = tură de sistem" reda tura ambientală
              // (audit 9 aug, critică). Ținem cadrul; judecăm la prima
              // transcriere sau, la 900 ms fără niciuna, fail-open.
              cadreInAsteptare.push(data)
              if (!ceasAsteptareVerdict) {
                ceasAsteptareVerdict = setTimeout(() => {
                  ceasAsteptareVerdict = null
                  if (verdictTura === null) {
                    verdictTura = true
                    taiatDeVoce = false
                    varsaCadreleInAsteptare()
                  }
                }, 900)
              }
              return
            }
            verdictTura = turaAdresataAcum()
            turaDeSistem = false // anunțul e consumat de tura lui
            taiatDeVoce = false // replică nouă — tăierea veche nu o mai privește
          }
          if (!verdictTura) { pulsVoce.suprimateAdresare++; return } // nu i se vorbea lui
          if (verdictLimba === false) { pulsVoce.suprimateLimba++; return } // limbă necerută
          if (taiatDeVoce) { pulsVoce.suprimateDupaTaiere++; return } // omul i-a tăiat vorba — restul replicii moare
          livreazaCadru(data)
        },
        onTranscriereUser: (text, final) => {
          const acum = Date.now()
          // Segmentare pe pauze: >2,5 s fără transcriere = rostire NOUĂ —
          // adresarea se judecă mereu pe ce se spune ACUM, nu pe resturi.
          if (acum - ultimaTranscriereUserLa > 2_500) rostireCurenta = ''
          ultimaTranscriereUserLa = acum
          rostireCurenta += text
          bufUser += text
          trimite({ type: 'user', text, final })
          if (final) {
            // Comanda de dispozitiv DOAR pe tură ADRESATĂ lui Kelion, în limba
            // cerută (Adrian, 10 aug — bug „prăjit la chat"): o frază ambientală
            // („închide camera", altcineva din încăpere) comuta camera userului,
            // deși audio-ul acelei ture e oricum suprimat de gardul de adresare.
            // Aceeași gardă și aici. turaAdresataAcum() e pură (fără efecte).
            if (turaAdresataAcum() && verdictLimba !== false) {
              const deviceCmd = interpretDeviceCommand(rostireCurenta)
              if (deviceCmd) {
                trimite({ type: 'control', frame: { device: deviceCmd } })
              }
            }
          }
          // Verdict amânat + transcrierea a sosit → judecăm ACUM și vărsăm.
          if (verdictTura === null && cadreInAsteptare.length) {
            verdictTura = turaAdresataAcum()
            turaDeSistem = false
            taiatDeVoce = false
            varsaCadreleInAsteptare()
          }
        },
        onTranscriereKelion: (text, final) => {
          bufKelion += text
          // Verdictul de LIMBĂ se ia O DATĂ pe tură, pe începutul replicii
          // (≥6 caractere sau primul final): început străin + necerut = tura
          // moare AICI — audio tăiat, redarea din browser oprită (intrerupt).
          if (gardDeLimba && verdictLimba === null && (bufKelion.trim().length >= 6 || final)) {
            const straina = inceputStrain(bufKelion)
            verdictLimba = !(straina && !aCerutAltaLimba(bufUser))
            if (verdictLimba === false) {
              app.log.info(`[VOCE] tură suprimată (răspuns în ${straina}, necerut): „${bufKelion.trim().slice(0, 80)}"`)
              golesteRedarea() // și ceasul difuzorului, nu doar redarea (audit 9 aug)
            }
          }
          if (verdictTura === false || verdictLimba === false) return
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
            // 'nav' adăugat (10 aug, ownerul: „la scris închide/deschide pagina
            // merge, la verbal nu"): open_app_view emite {nav:...}; fără el în
            // listă, deschiderea/închiderea de pagini era ARUNCATĂ tăcut pe voce.
            // 'niveluri' (nivelurile de tranzacționare pe grafic), 'gest'/'gesture'
            // (animația avatarului) — aceeași scurgere prin lista albă, adăugate
            // 10 aug ca cadrele creierului să ajungă la browser și pe voce.
            const CADRE_ECRAN = ['monitor', 'doc', 'app', 'card', 'image', 'golesteMonitor', 'build', 'device', 'nav', 'niveluri', 'gest', 'gesture', 'apel']
            const r = await turaCreierului(req.headers.cookie ?? '', cerere, coords, cadre, (frame) => {
              if (CADRE_ECRAN.some((k) => k in frame)) trimite({ type: 'control', frame })
            }, monitorLive)
            if (r.ok) {
              // Ordinele de constructor pornite prin ușă intră sub urmărire —
              // la terminare, Kelion anunță cu vocea lui (ceasOrdine, mai sus).
              const ordin = r.text.match(/ordin\s*#(\d+)/i)
              if (ordin) {
                ordineUrmarite.add(Number(ordin[1]))
                app.log.info(`vocal-live: urmăresc ordinul de construcție #${ordin[1]} — anunț la terminare`)
              }
              live?.raspundeUnealta(apel.id, apel.name, { rezultat: r.text || 'creierul n-a întors niciun text' })
            } else {
              app.log.warn(`vocal-live: ușa creierului a picat: ${r.motiv}`)
              live?.raspundeUnealta(apel.id, apel.name, { eroare: r.motiv })
            }
            return
          }
          try {
            // UNELTELE USER-SCOPED (10 aug): 7 unelte (list_updates, read_inbox,
            // server_logs, get_real_cost, list_memories, forget_memory,
            // log_unsupported_request) sunt OFERITE modelului Live prin
            // TOATE_UNELTELE_ADMIN, dar trăiesc în execUserScopedTool — nu în
            // execSharedAdminTool. Fără ramura asta răspundeau „nesuportată în
            // voce" deși pe scris merg. Exact ca bucla de noapte (autonomie.ts).
            if (USER_SCOPED_TOOLS.has(apel.name)) {
              const r = await execUserScopedTool(apel.name, apel.args as any, user.email, user.role === 'admin')
              live?.raspundeUnealta(apel.id, apel.name, { rezultat: r ?? 'Unealtă nesuportată în voce.' })
              return
            }
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
        onIntrerupt: () => {
          pulsVoce.intreruperiModel++
          verdictTura = null // barge-in: tura moare, următoarea se judecă proaspăt
          verdictLimba = null
          taiatDeVoce = false
          cadreInAsteptare.length = 0 // tura moartă nu mai are ce vărsa
          if (ceasAsteptareVerdict) {
            clearTimeout(ceasAsteptareVerdict)
            ceasAsteptareVerdict = null
          }
          golesteRedarea() // browserul golește redarea — și ceasul difuzorului tace
        },
        onTuraGata: () => {
          // Tura s-a terminat cu verdictul încă AMÂNAT (nicio transcriere n-a
          // sosit vreodată) → fail-open: cadrele ținute se livrează, nu se
          // înghit tăcut — răspunsul complet e al omului.
          if (verdictTura === null && cadreInAsteptare.length) {
            verdictTura = true
            taiatDeVoce = false
            varsaCadreleInAsteptare()
          }
          if (verdictTura === false || verdictLimba === false) {
            // Tura NU i se adresa SAU a răspuns într-o limbă necerută: nu se
            // salvează în memorie (o replică spaniolă salvată ar OTRĂVI
            // instrucțiunea sesiunii următoare — revizia, 9 aug), dar se
            // NUMEȘTE în jurnal — o suprimare greșită trebuie să fie vizibilă.
            app.log.info(
              verdictLimba === false
                ? `[VOCE] tură suprimată (limbă străină necerută): „${bufKelion.trim().slice(0, 120)}"`
                : `[VOCE] tură suprimată (nu i se vorbea lui): auzit „${bufUser.trim().slice(0, 120)}"`,
            )
            bufUser = ''
            bufKelion = ''
            rostireCurenta = ''
          } else {
            salveazaTura()
          }
          verdictTura = null
          verdictLimba = null
          primaTura = false // de-acum fereastra de dialog + numele decid
          trimite({ type: 'tura_gata' })
        },
        onEroare: (motiv) => {
          pulsVoce.ultimaEroare = motiv.slice(0, 160)
          trimite({ type: 'eroare', motiv })
          app.log.warn(`vocal-live: ${motiv}`)
        },
        onInfo: (msg) => {
          pulsVoce.varianta = msg.slice(0, 120)
          app.log.info(`vocal-live: ${msg}`)
        },
        onHandleReluare: (handle) => {
          const acum = Date.now()
          if (acum - ultimaSalvareHandle < 5_000) return
          ultimaSalvareHandle = acum
          // Mânerul se salvează CU generația lui de unelte — la următoarea
          // schimbare de capabilități, un mâner din altă generație se aruncă.
          void saveKv(KV_RELUARE, JSON.stringify({ h: handle, t: acum, gen: genUnelte })).catch(() => {})
        },
        onHandleProst: () => {
          // Handle-ul a picat la setup — se ȘTERGE din KV, altfel fiecare
          // sesiune nouă din următoarele 10 minute l-ar reîncărca și ar muri
          // în același connect (audit 9 aug, critică).
          app.log.warn('vocal-live: handle de reluare picat la setup — îl șterg din KV')
          void deleteKv(KV_RELUARE).catch(() => {})
        },
      }, reluareInitial, user.role === 'admin' ? unelteleDovedite() : undefined, limbaPin)
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
