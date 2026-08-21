import type { FastifyInstance } from 'fastify'
import { createHash } from 'node:crypto'
import type { RawData } from 'ws'
import { config } from '../config.js'
import { getSessionUser } from '../session.js'
import { creeazaOpusVoce, type OpusVoce } from '../services/opusVoce.js'
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
import { inceputStrain, continuareStraina, aCerutAltaLimba } from '../services/limbaRaspuns.js'
import { interpretDeviceCommand } from '../services/commands.js'
import { creeazaDetectorVocePeste } from '../services/vocePesteKelion.js'
import type { UnealtaVocala } from '../services/vocalLive.js'
import { execSharedAdminTool, execUserScopedTool, USER_SCOPED_TOOLS } from '../services/adminTools.js'
import { recallMemories, learnFromTurn } from '../services/agents.js'
import { saveMessage, getRecentHistory, saveKv, loadKv, deleteKv, recordCost, listBuildJobs, getSpeechLang, setSpeechLangPref, citesteSold, debitWallet, recordSimptomLive } from '../db.js'
import { trackSpeechLang } from '../services/lang.js'
import { pareCerereVizuala } from '../services/simptomeLive.js'

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
//                     JSON { type:'intrerupe' } = utilizatorul a tăiat tura
//                     curentă; restul cadrelor ei nu mai ajung la difuzor.
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
  tranzactii?: Record<string, unknown> | null,
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
        // ANCORA CENTRULUI DE TRANZACȚIONARE (N val 2a): starea REALĂ de pe
        // graficul de trading, ca la chatul scris — chat.ts o ia doar pentru
        // admin (`isAdminUser`), pune cifrele în prompt și, dacă răspunsul dă
        // niveluri, emite frame-ul {niveluri} care se desenează pe grafic.
        tranzactii: tranzactii ?? undefined,
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
    // OPUS PE HOPUL BROWSER↔SERVER (owner, 12 aug: „fă Opus"). OFF până când:
    // (a) flagul `config.voiceOpus` e pornit, (b) codecul de server se încarcă
    // (verificat la `gata`), (c) clientul confirmă `opus_ready` (are WebCodecs).
    // Până atunci — și mereu, dacă flagul e stins — calea rămâne PCM curat.
    let opus: OpusVoce | null = null
    let opusActiv = false // clientul a confirmat că trece pe Opus (uploads tag-uite, downloads Opus)
    // Microfonul clientului pornește imediat după deschiderea WS-ului, dar
    // sesiunea Live se deschide DUPĂ citirea istoricului (mai jos). Cadrele din
    // fereastra aia nu se aruncă — se țin aici și se varsă la deschidere,
    // altfel primele cuvinte ale omului ar dispărea exact ca în bugul vechi
    // „nu mă aude la prima frază".
    const preCoada: Buffer[] = []
    // Aceeași plasă pentru TEXTUL scris (JARVIS pasul 1): rândurile tastate în
    // fereastra „sesiunea încă se deschide" nu se aruncă — se varsă la deschidere.
    const preCoadaText: string[] = []
    // ── TĂIEREA LA VOCEA OMULUI (9 aug seara, ownerul: „vorbește peste mine") ─
    // NO_INTERRUPTION (#946) l-a făcut imun la ecou, dar și la OM. Serverul
    // decide în locul lui Google: voce susținută peste replica lui → redarea
    // din browser se golește (intrerupt) și restul replicii se aruncă.
    // `aecActiv` vine de la browser — fără anulare de ecou detectorul ar auzi
    // chiar vocea lui Kelion și l-ar tăia singur (regresia din 8 aug), deci
    // rămâne oprit până la raport.
    let aecActiv = false
    let taiatDeVoce = false
    // Tăierea explicită din UI diferă de barge-in-ul detectat din microfon:
    // până la capătul turei, niciun cadru rămas din aceeași replică nu mai
    // ajunge în browser.
    let taiereManuala = false
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
    // AUDITUL 15 aug: false-ul pus de CEASUL de 1500ms e PROVIZORIU — numele
    // măsurat târziu (transcrierea Google întârzie des peste fereastră) mai
    // poate învia tura. Un false definitiv venea exact pe replica strigată pe
    // nume: ownerul îl chema și nu auzea nimic.
    let verdictDinCeas = false
    // Anunțul de ordin terminat sosit CÂT o tură e în zbor nu mai deturnează
    // verdictul acelei ture — se amână și se armează la prima tură curată.
    let anuntAmanat = false
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
      // OPUS: golim și restul neîncadrat de download — un cadru parțial din
      // replica tăiată n-are ce căuta lipit de începutul celei următoare.
      opus?.reseteazaDownload()
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
      // AUDITUL 15 aug (critică, de 3 verificatori): verdictul NULL nu e „tura
      // e bună" — e modelul care a TĂCUT corect pe vorbire neadresată. Bălăriile
      // urechii („Eu não sei" pe foșnete, discuțiile altora) se salvau ca vorbe
      // ale userului, otrăveau instrucțiunea sesiunii următoare (filtrul
      // anti-otravă lasă rândurile 'user' mereu) ȘI memoria de lungă durată.
      // Sub STRICT: fără nume măsurat, tura nu intră în istoric.
      if (verdictTura === null && !turaAdresata(bufUser.trim())) {
        if (bufUser.trim() || bufKelion.trim()) {
          app.log.info(`[VOCE] tură nesalvată la închidere (tăcere corectă, fără nume): auzit „${bufUser.trim().slice(0, 120)}"`)
        }
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
            // AUDITUL 15 aug: flag-ul armat NECONDIȚIONAT deturna tura ÎN ZBOR
            // (replica ambientală se reda ca „anunț", anunțul real se suprima).
            // Tura în zbor → amânare; se armează la prima tură curată.
            const turaInZbor =
              verdictTura !== null || cadreInAsteptare.length > 0 || bufKelion.trim().length > 0 || rostireCurenta.trim().length > 0
            if (turaInZbor) anuntAmanat = true
            else turaDeSistem = true // tura care urmează e ANUNȚ, declarat pe față — nu dedus din buffer gol
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
    // ANCORA CENTRULUI DE TRANZACȚIONARE acum (N val 2a): ultima stare de pe
    // graficul de trading, raportată de browser cu aceeași bătaie de coords —
    // dată creierului prin ușă ca la chatul scris (frontendul o stinge singur
    // când tabul nu mai e pe ecran, deci null = trading închis).
    let tranzactiiLive: Record<string, unknown> | null = null
    // VEDEREA LA CERERE (8 aug: „hai și cu vedere"): când ușa se deschide,
    // serverul cere browserului cadrele camerei ({type:'cere_cadre'}) și
    // așteaptă răspunsul aici — zero trafic de imagini cât nu e nevoie.
    let primesteCadre: ((cadre: string[]) => void) | null = null
    // Este instalată după ce helper-ele turei au fost create; handlerul WS o
    // poate primi înainte sau după sesiunea Google fără să atingă obiecte moarte.
    let intrerupeTura: (() => void) | null = null

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
            // ANCORA TRADING, ținută pentru ușa creierului pe VOCE (N val 2a):
            // aceeași bătaie; null = tabul de trading nu mai e pe ecran.
            const trz = (m as { tranzactii?: unknown }).tranzactii
            tranzactiiLive = trz && typeof trz === 'object' ? (trz as Record<string, unknown>) : null
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
          } else if (m.type === 'intrerupe') {
            intrerupeTura?.()
          } else if (m.type === 'text' && typeof (m as { text?: unknown }).text === 'string') {
            // JARVIS pasul 1 + §10 (tastatura opțională): input SCRIS de la client cât
            // sesiunea Live e vie → rând de user în sesiune → modelul răspunde cu VOCEA
            // lui. Așa tura scrisă NU mai trece prin /api/chat → nu se mai sintetizează
            // Chirp → coliziunea celor două guri („2 sec și se rupe") nu mai are de unde
            // să apară pe turele scrise. Output-ul rămâne VOCE (regula de aur §10).
            //
            // BUG CRITIC prins de agentul de logică ÎNAINTE de merge (tura scrisă ar fi
            // fost MUTĂ — două lacăte interne îi mâncau răspunsul); dezarmăm amândouă:
            const textScris = ((m as { text: string }).text || '').trim().slice(0, 4000)
            if (textScris) {
              // LACĂTUL A: clientul taie gura înaintea oricărei ture noi (interruptAll →
              // {type:'intrerupe'} → taiereManuala). Tura SCRISĂ care sosește după E
              // următoarea intervenție a omului — exact ca vorbirea (vezi
              // onTranscriereUser) — deci tăierea veche se ridică, altfel răspunsul
              // turei noi ar fi „suprimat după tăiere" cadru cu cadru.
              if (taiereManuala) {
                taiereManuala = false
                taiatDeVoce = false
                verdictTura = null
                verdictLimba = null
                verdictDinCeas = false
                bufUser = ''
                bufKelion = ''
                rostireCurenta = ''
              }
              // LACĂTUL B: poarta de adresare („vorbește doar când i te adresezi") judecă
              // din bufferele de TRANSCRIERE — textul scris nu trece prin ele. Protocolul
              // EXISTENT al anunțurilor (mai sus): tura se declară PE FAȚĂ, nu se lasă
              // dedusă din buffer gol. Scrisul e prin natură adresat lui.
              const turaInZborScris =
                verdictTura !== null || cadreInAsteptare.length > 0 || bufKelion.trim().length > 0 || rostireCurenta.trim().length > 0
              if (turaInZborScris) anuntAmanat = true
              else turaDeSistem = true
              // Ferestrele „sesiunea nu-i gata încă" (live null la deschidere / reconectare
              // internă): audio-ul are coadă (preCoada + coada motorului) — textul primește
              // aceeași plasă, altfel rândul scris ar muri TĂCUT deși clientul l-a ecou-at.
              if (live) live.anunta(textScris)
              else {
                preCoadaText.push(textScris)
                if (preCoadaText.length > 20) preCoadaText.shift()
              }
            }
          } else if (m.type === 'ping') {
            try {
              socket.send(JSON.stringify({ type: 'pong', t: (m as { t?: unknown }).t ?? Date.now() }))
            } catch {
              /* socket închis */
            }
          } else if (m.type === 'opus_ready') {
            // Clientul și-a pornit codecul WebCodecs. DE-AICI (ordinea WS ne
            // garantează): uploadurile lui vin tag-uite [octet codec][payload] și
            // downloadurile pot pleca Opus. Doar dacă avem și noi codecul.
            if (opus) {
              opusActiv = true
              app.log.info('vocal-live: Opus ACTIV pe hopul browser↔server (client + server gata)')
            }
          }
        } catch {
          /* cadru text neînțeles — îl ignorăm, audio rămâne pe binar */
        }
        return
      }
      let buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer)
      // OPUS: cât e activ, cadrul de microfon vine [octet codec: 0=PCM, 1=Opus]
      // [payload]. Decodăm ÎNAINTE de detector și de Gemini — tot lanțul de jos
      // lucrează pe PCM exact ca azi. Pachet corupt → sărim cadrul, nu crăpăm.
      if (opusActiv && opus && buf.length >= 1) {
        const codec = buf[0]
        const payload = buf.subarray(1)
        if (codec === 1) {
          const pcm = opus.decodeUpload(payload)
          if (!pcm) return
          buf = pcm
        } else {
          buf = payload // clientul încă nu e gata pe codec — payload e PCM curat
        }
      }
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
      opus?.inchide() // eliberează codecul Opus (WASM) al sesiunii
      opus = null
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
      let prefLimbaCurenta: string | null = null // pentru comiterea din vorbit (mai jos)
      try {
        const pref = await getSpeechLang(user.email)
        prefLimbaCurenta = pref
        // AUDITUL 15 aug: fără preferință, vocea pinuia ro-RO în timp ce regula
        // scrisă a ownerului (24 iul, chat.ts: „default for EVERYONE starts in
        // English"; ADMIN = română mereu) dă engleza — gardul de limbă era armat
        // CONTRA limbii implicite a aplicației și amuțea userii noi ne-români.
        // Aceeași regulă acum pe ambele căi.
        if (user.role === 'admin') limbaPin = 'ro-RO' // adminul = română, mereu (regula scrisă)
        else if (!pref) limbaPin = 'en-US' // user nou → limba implicită a aplicației
        else if (BCP47[pref]) limbaPin = BCP47[pref]
        else if (/^[a-z]{2}-[A-Z]{2}$/.test(pref)) limbaPin = pref // ex. ja-JP întreg
        else limbaPin = undefined // necunoscută → auto-detecție, fără gard
      } catch {
        limbaPin = user.role === 'admin' ? 'ro-RO' : 'en-US'
        app.log.warn(`vocal-live: speech_lang necitibil — pinul de limbă cade pe implicit (${limbaPin})`)
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
      // ── GARDUL TREZIRII PE NUME — DETERMINIST, PE SERVER ──────────────────
      // 9 aug (ownerul, a treia oară: „nu identifică când discuțiile ambientale
      // sunt între alte persoane"): gardul s-a născut cu contractul „numele la
      // început SAU dialog în curs". 15 aug (ownerul, VERBATIM): „kelion
      // trebuie sa raspunda doar cind aude numele, doar atunci" — STRICT:
      // fereastra de dialog și excepția primei ture au fost scoase; audio-ul
      // modelului pleacă spre difuzor DOAR pe tură cu numele MĂSURAT în
      // transcriere. O tură pornită de SISTEM (anunț de ordin, fără vorbă de
      // om în față) trece mereu. Verdictul se ia O DATĂ pe tură, la prima
      // bucată de audio, pe transcrierea de până atunci; tura suprimată se
      // scrie în jurnal cu ce s-a auzit — o tăcere GREȘITĂ trebuie să se poată
      // vedea, nu să dispară (lecția numeStrigat).
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
      const turaAdresataAcum = (): boolean => {
        // Judecăm pe ROSTIREA curentă (ultima activitate de vorbire), nu pe
        // bufferul întreg — un „Kelion, …" proaspăt nu mai e îngropat după
        // primele 4 cuvinte ale unui text vechi (audit 9 aug).
        const spusa = rostireCurenta.trim() || bufUser.trim()
        if (turaDeSistem) return true // anunț declarat EXPLICIT, nu dedus
        // ── STRICT (owner, 15 aug, verbatim: „kelion trebuie sa raspunda doar
        // cind aude numele, doar atunci") ───────────────────────────────────
        // „Doar atunci" a scos: fereastra de dialog (120s), excepția primei
        // ture ȘI trecerea „nimic auzit → nu suprimăm orbește" — un enunț fără
        // nume MĂSURAT în transcriere nu primește răspuns. Nu e blocajul la
        // rece din 9 aug (ăla suprima și frazele CU nume): numele deschide
        // tura oricând, iar cadrele așteaptă transcrierea (mai jos) înainte de
        // verdict, deci o transcriere întârziată cu „Kelion" tot se redă.
        if (!spusa) return false
        return turaAdresata(spusa)
      }
      // Livrarea unui cadru de voce spre difuzor — TOATĂ contabilitatea la un
      // loc, folosită și de drumul normal și de vărsarea cadrelor amânate.
      const livreazaCadru = (data: string): void => {
        // Ceasul difuzorului: octeți → mostre 16-bit → ms la 24 kHz. Fără el,
        // barge-in-ul ar crede că Kelion tace când el încă vorbește din buffer.
        // Se calculează pe PCM (independent de codecul de pe sârmă), deci rămâne
        // corect și pe Opus — Opus scade OCTEȚII, nu DURATA sunetului.
        redareEstimataPanaLa = Math.max(redareEstimataPanaLa, Date.now()) + octetiDinBase64(data) / 2 / 24
        pulsVoce.cadreAudioSpreBrowser++
        // OPUS: cât e activ, comprimăm PCM-ul 24 kHz în pachete de 20 ms și le
        // trimitem tag-uite `codec:'opus'`. Restul neîncadrat se ține în codec
        // pentru cadrul următor. Fără Opus — exact ca azi, PCM base64.
        if (opusActiv && opus) {
          const pcm = Buffer.from(data, 'base64')
          for (const pkt of opus.encodeDownload(pcm)) {
            trimite({ type: 'audio', codec: 'opus', data: pkt.toString('base64') })
          }
        } else {
          trimite({ type: 'audio', data })
        }
      }
      // TEXTUL lui Kelion ținut până la verdict (owner, 15 aug: „iar aude
      // bălării, și scrie alte bălării în chat"). MĂSURAT: audio-ul avea
      // cadre-în-așteptare, dar TRANSCRIPTUL răspunsului curgea spre bandă cât
      // timp verdictul era încă null — replica la o vorbire neadresată se
      // SCRIA în chat chiar dacă vocea ei era apoi suprimată. Aceeași plasă ca
      // la audio: fragmentele așteaptă verdictul; true → se scriu, false → se
      // aruncă (numărate, nu pierdute tăcut).
      const textInAsteptare: Array<{ text: string; final: boolean }> = []
      // GARDUL DE LIMBĂ JUDECĂ ÎNAINTE DE LIVRARE (auditul 15 aug: începutul
      // replicii străine se AUZEA și se SCRIA înainte de verdictul de la ≥6
      // caractere). Cât verdictul de limbă e nedecis, cadrele și textul turei
      // adresate așteaptă. Transcrierea răspunsului vine de regulă ÎNAINTEA
      // audio-ului în același mesaj (services/vocalLive.ts), deci costul tipic
      // e zero; plasa fail-open de mai jos ține latența sub 700 ms în cazul rar
      // al transcrierii lipsă — mai bine o scăpare rară decât un Kelion lent.
      let ceasLimba: NodeJS.Timeout | null = null
      const asteaptaVerdictLimba = (): boolean => verdictTura === true && gardDeLimba && verdictLimba === null
      const opresteCeasLimba = (): void => {
        if (ceasLimba) {
          clearTimeout(ceasLimba)
          ceasLimba = null
        }
      }
      const varsaTextulInAsteptare = (): void => {
        if (asteaptaVerdictLimba()) return // limba încă nedecisă — textul mai așteaptă
        for (const t of textInAsteptare.splice(0)) {
          if (verdictTura && verdictLimba !== false) trimite({ type: 'kelion', text: t.text, final: t.final })
          else pulsVoce.suprimateAdresare++
        }
      }
      // Cadrele ținute până la verdict se varsă prin ACEEAȘI judecată ca cele
      // directe — redate sau numărate ca suprimate, niciodată pierdute tăcut.
      const varsaCadreleInAsteptare = (): void => {
        if (ceasAsteptareVerdict) {
          clearTimeout(ceasAsteptareVerdict)
          ceasAsteptareVerdict = null
        }
        if (asteaptaVerdictLimba()) return // limba încă nedecisă — cadrele mai așteaptă
        opresteCeasLimba()
        for (const data of cadreInAsteptare.splice(0)) {
          if (!verdictTura) pulsVoce.suprimateAdresare++
          else if (verdictLimba === false) pulsVoce.suprimateLimba++
          else if (taiatDeVoce) pulsVoce.suprimateDupaTaiere++
          else livreazaCadru(data)
        }
      }
      // Ceasul adresării: false-ul lui e PROVIZORIU (verdictDinCeas) — cadrele
      // rămân ținute, iar numele măsurat târziu le mai poate învia. Definitiv
      // abia la tura_gata (auditul 15 aug: ownerul striga numele și nu auzea
      // nimic când transcrierea depășea fereastra).
      const armeazaCeasAdresare = (): void => {
        if (ceasAsteptareVerdict) return
        ceasAsteptareVerdict = setTimeout(() => {
          ceasAsteptareVerdict = null
          if (verdictTura === null) {
            verdictTura = false
            verdictDinCeas = true
            taiatDeVoce = false
          }
        }, 1500)
      }
      // Judecata de limbă, într-un singur loc (rută + închiderea turei):
      // străin + necerut + omul NU vorbea el însuși limba aia → suprimare.
      let suprimariLimba = 0
      const judecaLimba = (): { verdict: boolean; straina: string | null } => {
        const straina = continuareStraina(bufKelion)
        const limbaUser = inceputStrain(rostireCurenta.trim() || bufUser)
        return { verdict: !(straina && !aCerutAltaLimba(bufUser) && limbaUser !== straina), straina }
      }
      const armeazaCeasLimba = (): void => {
        if (ceasLimba) return
        ceasLimba = setTimeout(() => {
          ceasLimba = null
          if (asteaptaVerdictLimba()) {
            // Transcrierea răspunsului n-a sosit — fail-OPEN pe limbă (invers
            // decât la adresare, deliberat: numele e măsurabil din intrare,
            // limba doar din răspuns; a amuți orice replică fără transcript ar
            // fi Kelion mut, lecția hotfixului din 9 aug).
            verdictLimba = true
            app.log.info('[VOCE] gard de limbă fail-open: transcrierea răspunsului n-a sosit în 700 ms')
            varsaCadreleInAsteptare()
            varsaTextulInAsteptare()
          }
        }, 700)
      }
      intrerupeTura = () => {
        if (taiereManuala) return
        taiereManuala = true
        taiatDeVoce = true
        cadreInAsteptare.length = 0
        textInAsteptare.length = 0
        if (ceasAsteptareVerdict) {
          clearTimeout(ceasAsteptareVerdict)
          ceasAsteptareVerdict = null
        }
        opresteCeasLimba()
        golesteRedarea()
      }
      live = deschideVocalLive(instructiune, unelteleSesiuniiLive(user.role), {
        onGata: async () => {
          // OPUS: cât sesiunea se pregătește, încercăm codecul de server O DATĂ.
          // Îl anunțăm clientului DOAR dacă flagul e pornit ȘI codecul chiar s-a
          // încărcat — altfel clientul rămâne pe PCM (fără cursă, fără regresie).
          if (config.voiceOpus && !opus) {
            opus = await creeazaOpusVoce().catch(() => null)
            if (!opus) app.log.warn('vocal-live: VOICE_OPUS pornit, dar codecul de server nu s-a încărcat — rămân pe PCM')
          }
          trimite({ type: 'gata', opus: !!(config.voiceOpus && opus) })
        },
        onAudioIesire: (data) => {
          pulsVoce.cadreAudioDeLaGoogle++
          pulsVoce.laUltimulCadru = Date.now()
          octetiOut += octetiDinBase64(data) // Google a facturat-o oricum — se numără
          if (taiereManuala) {
            pulsVoce.suprimateDupaTaiere++
            return
          }
          if (verdictTura === null) {
            const areTemei = rostireCurenta.trim() || bufUser.trim() || turaDeSistem
            if (!areTemei) {
              // Transcrierea n-a sosit încă (Google o trimite adesea DUPĂ
              // primul cadru audio) — verdict AMÂNAT: ținem cadrul și judecăm
              // la prima transcriere. STRICT (owner, 15 aug: „doar cind aude
              // numele, doar atunci"): fără nicio transcriere în 1500 ms, tura
              // se suprimă PROVIZORIU (verdictDinCeas) — numele măsurat târziu
              // o mai poate învia; definitiv abia la tura_gata.
              cadreInAsteptare.push(data)
              armeazaCeasAdresare()
              return
            }
            const adresata = turaAdresataAcum()
            if (!adresata && !turaDeSistem) {
              // AUDITUL 15 aug (critică): transcrierea de până acum poate fi
              // PARȚIALĂ — „Hei" sosit înaintea lui „Kelion" încuia false pe
              // fragment și amuțea toată replica strigată pe nume. Negativul
              // NU se mai încuie aici: cadrul așteaptă transcriptul final,
              // ceasul sau tura_gata.
              cadreInAsteptare.push(data)
              armeazaCeasAdresare()
              return
            }
            verdictTura = true
            turaDeSistem = false // anunțul e consumat de tura lui
            taiatDeVoce = false // replică nouă — tăierea veche nu o mai privește
            varsaTextulInAsteptare() // textul ținut se judecă cu ACELAȘI verdict
          }
          if (!verdictTura) {
            if (verdictDinCeas) {
              // ținute pentru învierea pe nume târziu — mărginit, nu nelimitat
              cadreInAsteptare.push(data)
              if (cadreInAsteptare.length > 600) {
                cadreInAsteptare.shift()
                pulsVoce.suprimateAdresare++
              }
            } else {
              pulsVoce.suprimateAdresare++ // nu i se vorbea lui
            }
            return
          }
          if (verdictLimba === false) { pulsVoce.suprimateLimba++; return } // limbă necerută
          if (asteaptaVerdictLimba()) {
            // limba încă nejudecată — cadrul așteaptă transcrierea răspunsului
            cadreInAsteptare.push(data)
            armeazaCeasLimba()
            return
          }
          if (taiatDeVoce) { pulsVoce.suprimateDupaTaiere++; return } // omul i-a tăiat vorba — restul replicii moare
          livreazaCadru(data)
        },
        onTranscriereUser: (text, final) => {
          const acum = Date.now()
          // O rostire nouă după o tăiere explicită deschide o tură nouă; nu
          // reanimăm replica pe care omul a oprit-o, ci pornim cu buffere curate.
          if (taiereManuala && text.trim()) {
            taiereManuala = false
            taiatDeVoce = false
            verdictTura = null
            verdictLimba = null
            verdictDinCeas = false
            bufUser = ''
            bufKelion = ''
            rostireCurenta = ''
          }
          // Segmentare pe pauze: >2,5 s fără transcriere = rostire NOUĂ —
          // adresarea se judecă mereu pe ce se spune ACUM, nu pe resturi.
          if (acum - ultimaTranscriereUserLa > 2_500) {
            rostireCurenta = ''
            // AUDITUL 15 aug: ambientalul dintre rostiri nu se mai LIPEȘTE de
            // fraza adresată care urmează — fără nicio tură în zbor, ce s-a
            // strâns fără nume se aruncă la granița de pauză, cu jurnal.
            if (verdictTura === null && !cadreInAsteptare.length && !textInAsteptare.length && !bufKelion.trim() && bufUser.trim() && !turaAdresata(bufUser.trim())) {
              app.log.info(`[VOCE] vorbire neadresată aruncată la pauză: „${bufUser.trim().slice(0, 120)}"`)
              bufUser = ''
            }
            // anunțul amânat își găsește aici o tură curată
            if (anuntAmanat && verdictTura === null && !cadreInAsteptare.length && !bufKelion.trim()) {
              turaDeSistem = true
              anuntAmanat = false
            }
          }
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
            // COMITEREA LIMBII DIN VORBIT (auditul 15 aug: doar scrisul comitea
            // preferința — un user „mut pe engleză" la voce nu se vindeca
            // niciodată). Aceeași regulă ca scrisul (lang.ts): aceeași limbă
            // NOUĂ pe 2 rostiri consecutive → preferința se scrie; pinul
            // urechii o ia la URMĂTOAREA sesiune.
            const rostire = rostireCurenta.trim()
            if (rostire) {
              const comisa = trackSpeechLang(user.email, rostire, prefLimbaCurenta)
              if (comisa) {
                prefLimbaCurenta = comisa
                void setSpeechLangPref(user.email, comisa).catch(() => {})
                app.log.info(`[VOCE] limba vorbită comisă ca preferință: ${comisa}`)
              }
            }
          }
          // Verdict amânat SAU false PROVIZORIU din ceas + transcrierea a sosit
          // → judecăm ACUM. Pozitivul se încuie oricând (și învie tura tăiată
          // de ceas); NEGATIVUL doar pe transcript FINAL — un fragment parțial
          // („Hei" fără „Kelion" încă) nu mai omoară replica (auditul 15 aug).
          if ((verdictTura === null || (verdictTura === false && verdictDinCeas)) && (cadreInAsteptare.length || textInAsteptare.length)) {
            if (turaAdresataAcum()) {
              verdictTura = true
              verdictDinCeas = false
              turaDeSistem = false
              taiatDeVoce = false
              varsaCadreleInAsteptare()
              varsaTextulInAsteptare()
            } else if (final && verdictTura === null) {
              verdictTura = false
              taiatDeVoce = false
              varsaCadreleInAsteptare()
              varsaTextulInAsteptare()
            }
          }
        },
        onTranscriereKelion: (text, final) => {
          bufKelion += text
          // Verdictul de LIMBĂ: la ≥6 caractere sau primul final, apoi
          // RE-JUDECAT pe continuare cât replica e la început (≤240 car.) —
          // „Bine. Não sei…" nu mai trece pe cuvântul românesc din față
          // (auditul 15 aug). Judecata: judecaLimba() — străin + necerut +
          // omul NU vorbea el însuși limba aia (comutarea legitimă din
          // instrucțiune, calea a doua, era suprimată → „vocea lipsă").
          if (gardDeLimba && verdictLimba !== false && (bufKelion.trim().length >= 6 || final)) {
            const rejudecare = verdictLimba === true && bufKelion.trim().length <= 240
            if (verdictLimba === null || rejudecare) {
              const { verdict, straina } = judecaLimba()
              if (verdictLimba === null || !verdict) verdictLimba = verdict
              if (verdictLimba === false) {
                app.log.info(`[VOCE] tură suprimată (răspuns în ${straina}, necerut): „${bufKelion.trim().slice(0, 80)}"`)
                golesteRedarea() // și ceasul difuzorului, nu doar redarea (audit 9 aug)
                // OTRAVA DIN SESIUNEA GOOGLE (auditul 15 aug): suprimarea era
                // doar la noi — în contextul ținut de Google replica străină
                // rămânea „ultima vorbă" și derapajul se autoîntreținea, chiar
                // peste reconectări (handle-ul persistat o resuscita). Corecția
                // se SPUNE sesiunii; la a doua suprimare, handle-ul se aruncă —
                // conexiunea următoare pornește pe instrucțiunea curată.
                suprimariLimba++
                live?.ancoreaza(`[SISTEM] Replica ta anterioară a fost respinsă: era în ${straina ?? 'altă limbă'}, necerută. Continuă EXCLUSIV în română.`)
                if (suprimariLimba >= 2) {
                  app.log.warn('[VOCE] a doua suprimare de limbă în sesiune — arunc handle-ul de reluare (context otrăvit)')
                  void deleteKv(KV_RELUARE).catch(() => {})
                }
              } else if (verdictTura === true) {
                varsaCadreleInAsteptare() // limba tocmai s-a decis bună → ce aștepta pe ea se varsă
                varsaTextulInAsteptare()
              }
            }
          }
          if (verdictTura === false || verdictLimba === false) {
            // false-ul PROVIZORIU din ceas ține și textul pentru înviere
            if (verdictTura === false && verdictDinCeas && verdictLimba !== false) textInAsteptare.push({ text, final })
            return
          }
          // Verdictul de adresare încă NU e luat SAU limba încă nedecisă →
          // textul așteaptă cu ele (P12 + auditul 15 aug: nu scriem și nu
          // rostim nimic pe negândite).
          if (verdictTura === null || asteaptaVerdictLimba()) {
            textInAsteptare.push({ text, final })
            return
          }
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
            // KELION VEDE CÂND NU VEDE (Adrian, 12 aug): a cerut ceva vizual și
            // n-a venit niciun cadru → nu mai cade tăcut, se notează ca simptom ca
            // autovindecarea să ajungă la el. `pareCerereVizuala` ține un „cât e
            // ceasul" fără cadru să nu fie luat drept vedere picată (regula #1).
            if (cadre.length === 0 && pareCerereVizuala(cerere)) {
              void recordSimptomLive('fara-vedere', `voce: cerere vizuală fără cadru — „${cerere.slice(0, 100)}"`).catch(() => {})
            }
            // 'nav' adăugat (10 aug, ownerul: „la scris închide/deschide pagina
            // merge, la verbal nu"): open_app_view emite {nav:...}; fără el în
            // listă, deschiderea/închiderea de pagini era ARUNCATĂ tăcut pe voce.
            // 'niveluri' (nivelurile de tranzacționare pe grafic), 'gest'/'gesture'
            // (animația avatarului) — aceeași scurgere prin lista albă, adăugate
            // 10 aug ca cadrele creierului să ajungă la browser și pe voce.
            const CADRE_ECRAN = ['monitor', 'doc', 'app', 'card', 'image', 'golesteMonitor', 'build', 'device', 'nav', 'niveluri', 'gest', 'gesture', 'apel']
            const r = await turaCreierului(req.headers.cookie ?? '', cerere, coords, cadre, (frame) => {
              if (CADRE_ECRAN.some((k) => k in frame)) trimite({ type: 'control', frame })
            }, monitorLive, tranzactiiLive)
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
              // CHATUL CARE NU RĂSPUNDE, FĂCUT VIZIBIL (12 aug): ușa creierului a
              // picat pe voce = exact „aplicația nu răspunde". Se notează ca simptom
              // ca autovindecarea să ajungă la cauză.
              void recordSimptomLive('chat-mut', `voce: ușa creierului a picat — ${r.motiv}`.slice(0, 180)).catch(() => {})
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
          taiereManuala = false
          verdictTura = null // barge-in: tura moare, următoarea se judecă proaspăt
          verdictLimba = null
          verdictDinCeas = false
          taiatDeVoce = false
          cadreInAsteptare.length = 0 // tura moartă nu mai are ce vărsa
          textInAsteptare.length = 0 // nici textul ei ținut
          if (ceasAsteptareVerdict) {
            clearTimeout(ceasAsteptareVerdict)
            ceasAsteptareVerdict = null
          }
          opresteCeasLimba()
          if (anuntAmanat) {
            turaDeSistem = true // tura moartă a eliberat locul — anunțul amânat se armează
            anuntAmanat = false
          }
          golesteRedarea() // browserul golește redarea — și ceasul difuzorului tace
        },
        onTuraGata: () => {
          // Tura s-a terminat cu verdictul încă AMÂNAT (nicio transcriere n-a
          // sosit vreodată). STRICT (owner, 15 aug: „doar cind aude numele,
          // doar atunci"): fail-open-ul de aici se închide la fel ca plasa de
          // timp — un nume nemăsurat nu e un nume auzit; cadrele și textul
          // ținute se ARUNCĂ numărate (suprimateAdresare), nu livrate pe
          // ghicite.
          if (verdictTura === null && (cadreInAsteptare.length || textInAsteptare.length)) {
            verdictTura = false
            taiatDeVoce = false
          }
          // Limba rămasă nedecisă la închidere (transcript scurt sau lipsă) se
          // judecă ACUM pe ce există — cadrele ținute pe ea nu se pierd tăcut;
          // fără niciun transcript, fail-open (nimic de judecat ≠ străin).
          if (verdictTura === true && gardDeLimba && verdictLimba === null) {
            verdictLimba = bufKelion.trim() ? judecaLimba().verdict : true
          }
          // False-ul provizoriu al ceasului devine DEFINITIV aici; resturile
          // ținute (pentru înviere sau pe limbă) se varsă numărate.
          verdictDinCeas = false
          if (cadreInAsteptare.length || textInAsteptare.length) {
            varsaCadreleInAsteptare()
            varsaTextulInAsteptare()
          }
          opresteCeasLimba()
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
          } else if (verdictTura === null && !turaAdresata(bufUser.trim())) {
            // AUDITUL 15 aug (critică, confirmată de 3 verificatori): modelul a
            // TĂCUT corect pe vorbire neadresată — verdictul null nu înseamnă
            // „tura e bună". Fără numele măsurat, bălăriile urechii nu intră
            // nici în istoric, nici în memoria de lungă durată.
            if (bufUser.trim()) {
              app.log.info(`[VOCE] tură nesalvată (tăcere corectă, fără nume): auzit „${bufUser.trim().slice(0, 120)}"`)
            }
            bufUser = ''
            bufKelion = ''
            rostireCurenta = ''
          } else {
            salveazaTura()
          }
          verdictTura = null
          verdictLimba = null
          taiereManuala = false
          taiatDeVoce = false
          textInAsteptare.length = 0 // tura încheiată nu mai are text de vărsat
          if (anuntAmanat) {
            turaDeSistem = true // tura s-a închis — anunțul amânat se armează acum
            anuntAmanat = false
          }
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
      // Rândurile SCRISE din fereastra de deschidere: fiecare e o tură adresată pe
      // față (protocolul anunțurilor) — se varsă acum, în ordinea sosirii.
      for (const t of preCoadaText.splice(0)) {
        turaDeSistem = true
        live.anunta(t)
      }
      app.log.info(
        `vocal-live: WS conectat (user=${user.role}, model=${VOCAL_LIVE_MODEL}, voce=${VOCAL_LIVE_VOICE}, memorie=${istoric.length} rânduri)`,
      )
    })()
  })
}
