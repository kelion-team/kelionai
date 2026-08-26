import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'node:crypto'
import type { RawData } from 'ws'
import { config } from '../config.js'
import { getSessionUser, validateWebSocketSession, webSocketSessionUser } from '../session.js'
import { creeazaOpusVoce, type OpusVoce } from '../services/opusVoce.js'
import {
  deschideVocalLive,
  vocalLiveDisponibila,
  construiesteInstructiune,
  oraLocalaText,
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
import { saveMessage, getRecentHistory, listBuildJobs, getSpeechLang, setSpeechLangPref, debitWalletMinorAtomar, grantCreditMinor, recordProviderUsage, recordSimptomLive, inregistreazaSarcinaOperationala, noteazaEvenimentOperational, tranzitioneazaSarcinaOperationala } from '../db.js'
import { esteAdminKelion } from '../services/adminIdentity.js'
import { rezumaStareFinalaSarcinaOperationala } from '../services/jurnalOperational.js'
import { trackSpeechLang } from '../services/lang.js'
import { pareCerereVizuala } from '../services/simptomeLive.js'
import { pretentiiFaraFapta, textulNuPotVerifica, clasificaRezultatUnealta, type DovadaUnealta } from '../services/poartaFaptelor.js'
import { parseInputImageDataUrl } from '../services/inputImage.js'

// ── RUTA VOCII UNIFICATE — CALE SEPARATĂ ȘI EXCLUSIVĂ (4 aug 2026) ───────────
//
// Owner: „atenție că vei avea 2 voci în același timp". Corect — de-aia asta e o
// cale complet separată, care înlocuiește lanțurile seriale ASR→chat→TTS.
// Frontendul pornește o singură cale. OpenAI Realtime aude, raționează și
// vorbește în aceeași sesiune, cu întrerupere și transcrieri.
//
// Continuitatea conversației vine din istoricul propriu al aplicației:
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
//                     JSON { type:'cadre', cadre:[dataUrl] } = răspuns limitat
//                     la cererea explicită `cere_cadre`; nu există flux video
//                     continuu sau upload de cameră nesolicitat.
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
//      `input_schema`, sesiunea live cere `parameters`; traducerea este explicită.
//      nepotrivire pe care TypeScript l-ar fi prins, dacă nu-l amuțea `as any`.
// Consecința potrivea perfect simptomul: setup refuzat → sesiunea moare → un
// warn invizibil în consolă → cădere pe calea veche (care avea surzenia).
// Setul de mai jos e mic, conversațional, cu scheme plate — în spiritul
// fazelor: vocea vorbește; lucrul greu vine după ce se dovedește.
const UNELTE_LIVE_USER = new Set(['list_memories', 'dovada_faptelor'])

const VOICE_BCP47: Record<string, string> = {
  ro: 'ro-RO', en: 'en-US', es: 'es-ES', fr: 'fr-FR', de: 'de-DE', it: 'it-IT', pt: 'pt-PT',
}

export function selectVoiceLocale(detected: string | null | undefined): {
  language: string
  source: 'detected_preference' | 'fallback'
} {
  const value = String(detected ?? '').trim()
  const base = value.toLowerCase().split('-')[0]
  if (VOICE_BCP47[base]) return { language: VOICE_BCP47[base], source: 'detected_preference' }
  if (/^[a-z]{2,3}-[a-z]{2}$/i.test(value)) {
    const [language, region] = value.split('-')
    return { language: `${language.toLowerCase()}-${region.toUpperCase()}`, source: 'detected_preference' }
  }
  // O preferință ISO validă (ex. `ja` sau `zh`) este tot o limbă detectată;
  // nu o înlocuim cu engleza doar fiindcă nu are încă o regiune salvată.
  if (/^[a-z]{2,3}$/i.test(value)) return { language: value.toLowerCase(), source: 'detected_preference' }
  return { language: 'en-US', source: 'fallback' }
}

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
    'COMPLET, în limba lui. Creierul aplicației o execută cu uneltele lui și îți întoarce rezultatul. ' +
    // TRIEREA ÎN DOI (JARVIS pasul 3 — PROIECT-CHAT-VOCE §4): protocolul de
    // gândire în doi, pe scurt, chiar în fișa uneltei (declarată o dată la setup).
    'TRIEREA ÎN DOI: dacă cererea e ambiguă, ÎNTÂI pune omului 1-2 întrebări scurte și decente care ' +
    'chiar schimbă răspunsul, apoi cheamă unealta cu tot ce ai aflat. Dacă rezultatul întors numește o ' +
    'informație lipsă, întreabă omul și cheamă unealta din nou cu completarea. Te oprești când nicio ' +
    'întrebare rămasă nu mai mută răspunsul — ăla e răspunsul. Nu-ți nara procesul („stai să verific") — ' +
    'ori întrebi firesc, ori dai răspunsul curat. ' +
    // MONITORUL PE VOCE (pasul 5 — §8): regula predării, chiar în fișă.
    'Când rezultatul are câmpul „pe_ecran_nu_se_recita", un document a fost trimis pe monitor în tura ' +
    'asta: rostești DOAR ce spune „de_rostit" — predarea și esențialul într-o frază — și NICIODATĂ ' +
    'textul întreg din câmp.',
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
  cadreAudioDeLaOpenAI: 0,
  cadreAudioSpreBrowser: 0,
  suprimateAdresare: 0,
  suprimateLimba: 0,
  intreruperiModel: 0,
  // Barge-in-ul SERVERULUI (9 aug seara, „vorbește peste mine"): de câte ori
  // vocea omului l-a oprit pe Kelion + câte cadre Google s-au aruncat după.
  taieriPeVoceaOmului: 0,
  suprimateDupaTaiere: 0,
  // TRIEREA ÎN DOI (pas 3): câte runde de convergență au rulat — măsurabil
  // fără acces la jurnalul VPS (GET /api/vocal-live/stare).
  rundeTriere: 0,
  // MONITORUL PE VOCE (pas 5, §8): câte uși au trimis măcar un DOCUMENT pe
  // monitor ({doc} — singurul cadru purtător de text) și de câte ori textul
  // lung a fost chiar mutat din poziția „rezultat de spus" în câmpul „pe
  // ecran, nu se recită" (predarea scurtă, trimisă unui model viu). Cifre.
  usiCuDoc: 0,
  predariEcran: 0,
  varianta: '',
  ultimaEroare: '',
  laUltimulCadru: 0,
}

/** Admin-only operational trace. It deliberately contains counters and state
 * labels only: neither raw microphone audio nor transcript text is exposed. */
const diagnosticVoce = {
  language: 'en-US',
  languageSource: 'fallback' as 'detected_preference' | 'fallback',
  session: 'idle' as 'idle' | 'connecting' | 'ready' | 'closed' | 'error',
  startedAt: 0,
  lastEventAt: 0,
  micFrames: 0,
  micBytes: 0,
  transcriptUserEvents: 0,
  transcriptUserFinal: 0,
  transcriptKelionEvents: 0,
  transcriptKelionFinal: 0,
  vadSpeechStarted: 0,
  lastSuppression: '' as '' | 'wake_word_required' | 'language_guard' | 'manual_interrupt',
}

export function diagnosticVocalLive(): Record<string, unknown> {
  return {
    models: {
      realtime: config.openai.realtime,
      transcription: config.openai.realtimeTranscription,
      configured: Boolean(config.openai.key && config.openai.realtime && config.openai.realtimeTranscription),
    },
    language: { effective: diagnosticVoce.language, source: diagnosticVoce.languageSource },
    session: {
      state: diagnosticVoce.session,
      startedAt: diagnosticVoce.startedAt || null,
      lastEventAt: diagnosticVoce.lastEventAt || null,
      openSessions: pulsVoce.sesiuniDeschise,
    },
    micFrames: { count: diagnosticVoce.micFrames, bytes: diagnosticVoce.micBytes },
    transcript: {
      userEvents: diagnosticVoce.transcriptUserEvents,
      userFinal: diagnosticVoce.transcriptUserFinal,
      kelionEvents: diagnosticVoce.transcriptKelionEvents,
      kelionFinal: diagnosticVoce.transcriptKelionFinal,
    },
    vad: { mode: 'server_vad', speechStarted: diagnosticVoce.vadSpeechStarted },
    suppression: {
      lastReason: diagnosticVoce.lastSuppression || null,
      wakeWord: pulsVoce.suprimateAdresare,
      language: pulsVoce.suprimateLimba,
      manualInterrupt: pulsVoce.suprimateDupaTaiere,
    },
  }
}

const sesiuniLivePeUtilizator = new Map<string, number>()

/** O tură COMPLETĂ pe creierul clasic, prin chiar ruta /api/chat (cookie-ul
 *  sesiunii omului → aceleași drepturi, aceleași unelte, aceeași
 *  contabilizare). Întoarce textul final; cadrele de control trec prin
 *  `laControl` pe măsură ce se despachetează. Orice eșec vine NUMIT. */
export async function turaCreierului(
  cookie: string,
  cerere: string,
  idempotencyKey: string,
  coords: { lat: number; lon: number } | null,
  imagini: string[],
  laControl: (frame: Record<string, unknown>) => void,
  monitor?: Record<string, unknown> | null,
  tranzactii?: Record<string, unknown> | null,
  // TRIEREA ÎN DOI (pas 3): runda de convergență CARĂ istoricul rundei
  // anterioare (altfel runda 2 e o tură amnezică ce RE-EXECUTĂ faptele —
  // verificatorul a demonstrat emailul trimis de 2 ori) și se declară
  // `continuareUsa` ca chat.ts să nu mai forțeze uneltele de faptă.
  triere?: { istoric: { role: 'user' | 'assistant'; content: string }[] },
): Promise<{ ok: true; text: string } | { ok: false; motiv: string }> {
  let r: Response
  try {
    r = await fetch(`http://127.0.0.1:${config.port}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, origin: config.publicOrigin },
      body: JSON.stringify({
        messages: triere ? triere.istoric : [{ role: 'user', content: cerere }],
        idempotencyKey,
        continuareUsa: triere ? true : undefined,
        // Glasul e al modelului live — sinteza serială rămâne stinsă (regula
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
  // STREAMING, NU BUFAT (clepsidra pe voce — vânătoarea 22 aug, BLOCANT):
  // `await r.text()` aștepta TOATĂ tura și abia apoi despacheta cadrele, deci
  // pașii de lucru {executie} ar fi ajuns la browser DUPĂ ce căutarea se
  // terminase — un flash inutil. Acum fluxul se taie incremental pe CTRL:
  // fiecare cadru complet pleacă la laControl PE LOC (pașii curg pe monitor
  // cât ușa chiar macină), textul se adună exact ca înainte. Segmentul impar
  // care nu e JSON valid se păstrează ca text — mai bine un rând ciudat decât
  // un cadru pierdut tăcut. Semnătura și întoarcerea rămân neschimbate.
  let text = ''
  let rest = ''
  const consuma = (bucata: string, final: boolean): void => {
    rest += bucata
    for (;;) {
      const deschis = rest.indexOf(CTRL)
      if (deschis === -1) {
        // Niciun marcaj în ce avem (CTRL e UN caracter — nu se poate rupe
        // între chunk-uri): totul e text.
        text += rest
        rest = ''
        return
      }
      const inchisLa = rest.indexOf(CTRL, deschis + CTRL.length)
      if (inchisLa === -1) {
        // Cadru încă incomplet: textul de dinainte pleacă, cadrul așteaptă.
        text += rest.slice(0, deschis)
        rest = rest.slice(deschis)
        if (final) {
          // Flux încheiat cu un cadru neterminat — rămâne text (nu-l pierdem).
          text += rest
          rest = ''
        }
        return
      }
      text += rest.slice(0, deschis)
      const corp = rest.slice(deschis + CTRL.length, inchisLa)
      rest = rest.slice(inchisLa + CTRL.length)
      try {
        laControl(JSON.parse(corp) as Record<string, unknown>)
      } catch {
        text += corp
      }
    }
  }
  try {
    const cititor = r.body?.getReader()
    if (cititor) {
      const decodor = new TextDecoder()
      for (;;) {
        const { done, value } = await cititor.read()
        if (done) break
        consuma(decodor.decode(value, { stream: true }), false)
      }
      consuma(decodor.decode(), true)
    } else {
      consuma(await r.text(), true)
    }
  } catch (e) {
    if (!text.trim()) return { ok: false, motiv: `fluxul creierului s-a rupt: ${e instanceof Error ? e.message.slice(0, 80) : String(e)}` }
    // Ce s-a primit deja e răspuns real — nu-l aruncăm pentru o coadă ruptă.
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

/** Inventory is derived from the verified Google-admin identity, never a role
 *  string supplied by a database row or the client. */
export function unelteleSesiuniiLive(isAdmin: boolean): UnealtaVocala[] {
  const toate = TOATE_UNELTELE_ADMIN as Array<{ name: string; description: string; input_schema?: Record<string, unknown> }>
  if (isAdmin) return [UNEALTA_CREIER, ...toate.map(tradu)]
  return [UNEALTA_CREIER, ...toate.filter((t) => UNELTE_LIVE_USER.has(t.name)).map(tradu)]
}

const PERSONA_KELION =
  'Ești Kelion, asistentul utilizatorului autentificat. Vorbești firesc, cald și SCURT, în limba sesiunii. ' +
  'Ce nu poți proba spui „nu pot verifica" — nu inventezi. Nu te prezinta la fiecare replică. ' +
  'REGULA UNELTELOR: pentru ORICE cerere care implică informație din lume sau o acțiune — căutare, ' +
  'știri, METEO, muzică, YouTube, hărți, unde mă aflu, e-mail, calendar, imagini, deschis ceva pe ' +
  'monitor — chemi unealta cere_creierului cu cererea omului formulată complet, apoi spui pe scurt ' +
  'rezultatul. NU refuza niciodată pe motiv că n-ai unealta sau accesul: ușa e cere_creierului. ' +
  'ÎNTREBĂRILE DESPRE UNELTE, CONSTRUCTOR sau CINE-ȚI-FACE-CODUL („constructorul este disponibil?", „cine ' +
  'construiește?", „ce unelte ai?") NU se răspund din memorie sau din lista ta de funcții — ' +
  'chemi cere_creierului, care întoarce starea MĂSURATĂ, și spui exact ce zice. ' +
  'Ce apare pe monitor NU se citește cu voce tare — o propoziție scurtă și atât. ' +
  'VEDEREA (la CERERE, NU continuu): nu primești un flux permanent de la cameră — cadrele se ' +
  'taxează, așa că vin DOAR când le ceri. La „ce vezi", „uită-te", „citește ce e aici" CERI ' +
  'cadrele prin ușa cere_creierului și te uiți la imaginea de ATUNCI, proaspătă. Nu spune „văd ' +
  'acum" fără să fi cerut cadrele; nu comenta imaginea nechemat, niciodată. Dacă la cerere nu vin ' +
  'cadre, camera e oprită — o spui, nu inventezi o vedere. ' +
  'INVENTARUL REAL depinde de consimțămintele și integrările contului. Folosește doar funcțiile ' +
  'declarate în sesiune și raportează indisponibilitatea factual, fără să promiți acces generic.'

export function ancoraConstructor(codexActiv: boolean): string {
  return codexActiv
    ? '\nPENTRU ADMIN — CONSTRUCTOR: cererile validate pot fi puse în coada workerului Codex separat. ' +
      'Nu afirma PR, merge, deploy sau versiune live până când starea durabilă a jobului le dovedește.'
    : '\nPENTRU ADMIN — CONSTRUCTOR: workerul Codex nu este configurat; spune setup_required și nu inventa execuție locală.'
}

export function capacitateVocalLive(): { disponibil: boolean; model: string; voce: string } {
  return {
    disponibil: vocalLiveDisponibila(),
    model: config.openai.realtime,
    voce: config.openaiVoice,
  }
}

/** Contract comun cu frontendul: un singur instantaneu data URL, validat și plafonat. */
export function cadreVedereLive(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const cadru = value.find((item): item is string =>
    typeof item === 'string'
    && parseInputImageDataUrl(item) !== null)
  return cadru ? [cadru] : []
}

export async function vocalLiveRoutes(app: FastifyInstance): Promise<void> {
  // Frontendul verifică disponibilitatea înainte de a deschide socketul.
  // Pulsul vocii — DOAR cifre (vezi pulsVoce, mai sus). Public: niciun conținut,
  // doar contoare; cu el, „nu merge audio" se citește de oriunde cu un curl.
  app.get('/api/vocal-live/stare', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    if (!esteAdminKelion(user.email)) return reply.code(403).send({ error: 'forbidden' })
    reply.header('Cache-Control', 'no-store')
    return { ...pulsVoce, diagnostic: diagnosticVocalLive() }
  })

  app.get('/api/vocal-live/capability', async (req, reply) => {
    if (!getSessionUser(req)) return reply.code(401).send({ error: 'unauthorized' })
    reply.header('Cache-Control', 'no-store')
    return capacitateVocalLive()
  })

  app.get('/api/vocal-live', {
    websocket: true,
    preValidation: (req, reply) => validateWebSocketSession(req, reply, 'vocal-live'),
  }, (socket, req) => {
    const user = webSocketSessionUser(req, socket)
    if (!user) return
    const isAdminSession = esteAdminKelion(user.email)
    const userKey = user.email.trim().toLowerCase()
    if ((sesiuniLivePeUtilizator.get(userKey) ?? 0) >= 1) {
      try { socket.close(1008, 'session_limit') } catch { /* already closed */ }
      return
    }
    sesiuniLivePeUtilizator.set(userKey, 1)
    diagnosticVoce.session = 'connecting'
    diagnosticVoce.startedAt = Date.now()
    diagnosticVoce.lastEventAt = Date.now()
    if (!vocalLiveDisponibila()) {
      try {
        socket.close(1011, 'vocal_live_indisponibil')
      } catch {
        /* deja închis */
      }
      return
    }
    const billingSessionId = randomUUID()
    // Product usage is billable for every non-admin account. A missing payment
    // link must never turn an existing customer balance into free provider use.
    const monetizedCustomer = !isAdminSession
    let billingTick = 0
    let providerReady = false
    let initialChargeRef: string | null = null
    const chargeMinute = async (): Promise<boolean> => {
      if (!monetizedCustomer) return true
      const tick = ++billingTick
      const ref = `voice:${billingSessionId}:${tick}`
      const result = await debitWalletMinorAtomar(
        user.email,
        config.billing.voiceMinuteMinor,
        ref,
        'vocal live minute',
      )
      if (result.ok) {
        if (tick === 1 && !result.duplicate) initialChargeRef = ref
        if (!result.duplicate) return true
        try { socket.close(1008, 'billing_tick_reused') } catch { /* closed */ }
        return false
      }
      try { socket.close(1008, result.code === 'insufficient' ? 'fara_credit' : 'billing_unavailable') } catch { /* closed */ }
      return false
    }
    const refundInitialSetupCharge = async (): Promise<void> => {
      if (providerReady || !initialChargeRef || !monetizedCustomer) return
      const ref = initialChargeRef
      initialChargeRef = null
      const refunded = await grantCreditMinor(user.email, config.billing.voiceMinuteMinor, `${ref}:setup_refund`)
      if (!refunded) app.log.error('vocal-live: setup refund could not be persisted')
    }

    // Pulsul numără sesiunile REAL (audit 9 aug: contoarele existau din #947,
    // dar nimeni nu le incrementa — panoul anti-minciună raporta permanent 0).
    pulsVoce.sesiuniTotal++
    pulsVoce.sesiuniDeschise++
    let sesiuneScazuta = false // close și error pot trage amândouă — scădem o dată
    const scadeSesiunea = (): void => {
      if (sesiuneScazuta) return
      sesiuneScazuta = true
      pulsVoce.sesiuniDeschise = Math.max(0, pulsVoce.sesiuniDeschise - 1)
      sesiuniLivePeUtilizator.delete(userKey)
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
    let preCoadaBytes = 0
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
    // Cine a amânat: DOAR anunțul de SISTEM (ordinul terminat) exonerează tura
    // viitoare de judecata cățelului — tura SCRISĂ folosește același protocol
    // anuntAmanat dar TREBUIE judecată (agentul de logică: armarea necondi-
    // ționată la consum ar fi exonerat și scrisul).
    let anuntSistemAmanat = false
    // Tura de SISTEM se declară EXPLICIT (anunțul de ordin terminat), nu se
    // mai deduce din „transcriere goală" — deducția era o poartă fail-open:
    // transcrierea providerului poate sosi după primul cadru audio, deci tura
    // ambientală trecea drept „sistem" și se REDA (audit 9 aug, critică).
    let turaDeSistem = false
    // Rostirea CURENTĂ (segmentată pe pauze >2,5s): adresarea se judecă pe
    // ULTIMA rostire, nu pe tot ce s-a strâns peste ture mute — altfel
    // „Kelion, …" proaspăt rămânea îngropat după primele 4 cuvinte VECHI.
    let rostireCurenta = ''
    let ultimaRostireFinalizata = ''
    let ultimaTranscriereUserLa = 0
    // Idle cleanup is configuration-driven. It releases forgotten provider
    // sessions and tells the client the exact close reason before disconnecting.
    const idleTimeoutMs = config.vocalLiveIdleTimeoutSeconds * 1000
    let ceasTacere: NodeJS.Timeout | null = null
    const reseteazaCeasTacere = (): void => {
      if (ceasTacere) clearTimeout(ceasTacere)
      ceasTacere = setTimeout(() => {
        if (inchis) return
        app.log.info(`vocal-live: idle timeout after ${config.vocalLiveIdleTimeoutSeconds}s`)
        try {
          socket.send(JSON.stringify({ type: 'session_closed', reason: 'idle_timeout', idleTimeoutSeconds: config.vocalLiveIdleTimeoutSeconds }))
        } catch { /* socket deja mort */ }
        socket.close(1000, 'idle_timeout')
      }, idleTimeoutMs)
    }
    reseteazaCeasTacere() // pornește la deschiderea sesiunii
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
    // Rândurile SCRISE ale turei (F2 al marii verificări): tastatul intră și
    // în bufUser (pentru tura curentă), dar căile de SUPRIMARE (tură
    // neadresată/limbă străină/închidere) aruncau bufferul AMESTECAT cu tot
    // cu întrebarea scrisă — UI-ul o arăta, istoria n-o mai avea, iar
    // învățarea primea user gol. Bufferul separat se salvează NECONDIȚIONAT
    // pe drumurile de aruncare (un rând tastat e, prin definiție, adresat).
    let bufScris = ''
    const salveazaScrisulAruncat = (): void => {
      if (bufScris.trim()) void saveMessage(user.email, 'user', bufScris.trim()).catch(() => {})
      bufScris = ''
    }
    // ── CĂȚELUL PE VOCE (JARVIS pasul 2 — PROIECT-CHAT-VOCE §5) ─────────────
    // Gap-ul MĂSURAT din spec: poartaFaptelor rula doar pe scris. Pe voce:
    // dovezile UNELTELOR chemate direct de sesiunea Live în tura vorbită
    // curentă + steagul „temeiul turei e ÎN AFARA ei" (creierul GREU prin
    // cere_creierului — poarta LUI rulează deja în /api/chat, iar re-rostirea
    // răspunsului lui ar fi demascată FALS aici; sau un anunț de SISTEM, al
    // cărui temei e starea măsurată a ordinelor). Judecăm DOAR turele
    // PUR-UȘOARE — fals-pozitivul e interzis prin design („o poartă care
    // strigă la adevăr nu mai e crezută de nimeni").
    let doveziVoceTura: DovadaUnealta[] = []
    let turaCuTemeiDinAfara = false
    // Ușile spre creierul GREU încă în ZBOR (agentul de logică, #3): ordinea
    // turnComplete vs toolCall la Google NU e garantată/măsurată — cât o ușă e
    // deschisă, orice tură rostită are temeiul în afară și steagul NU se
    // consumă (robust la ambele ordini; se măsoară live la publicare).
    let usiGreleInZbor = 0
    // TRIEREA ÎN DOI (JARVIS pasul 3 — PROIECT-CHAT-VOCE §4): cât o ușă grea
    // MACINĂ, ce spune omul (adresat lui Kelion) e informație PROASPĂTĂ pentru
    // gândirea în curs — se strânge aici și, la întoarcerea ușii, creierul greu
    // primește runde de CONVERGENȚĂ cu tot ce s-a aflat între timp. Criteriul
    // de stop e al specului: nimic nou aflat = răspunsul e gata (nu un procent
    // inventat). Dacă modelul Live nu poate conversa cât unealta e blocată
    // (nemăsurat — „nu pot verifica" din repo), lista rămâne goală și bucla
    // nu rulează — nimic nu se strică.
    let injectiiUsa: string[] = []
    // PROPRIETARUL trierii (verificatorul pasului 3, concurența): două uși pot
    // măcina în paralel (onUnealta e fire-and-forget) — fără proprietar, a doua
    // ușă ștergea tăcut informația strânsă pentru prima și își consuma reciproc
    // injecțiile (completarea omului se lipea de cererea GREȘITĂ). Doar ușa
    // care DEȚINE trierea curăță/consumă lista; celelalte nu fac trierea.
    let usaTrierii = 0
    let usaUrmatoareId = 0
    // SALVAREA = DOVADA pe voce (JARVIS pasul 4 — PROIECT-CHAT-VOCE §7):
    // până aici, uneltele executate DIRECT de sesiunea Live mureau odată cu
    // tura (doveziVoceTura se golea fără nicio urmă durabilă) — „asul din
    // mânecă" nu exista pentru faptele vocale. Acum tura vocală cu unelte
    // devine sarcină în jurnalul operațional (LENEȘ: doar când chiar rulează
    // o unealtă — conversația pură nu umple jurnalul), fiecare rezultat
    // clasificat devine eveniment, iar la închiderea turei starea finală se
    // derivă din dovezi — aceeași regulă ca pe scris. Scrierile sunt
    // fire-and-forget înlănțuite (ordinea evenimentelor păstrată, zero
    // latență pe drumul frazei — primul cuvânt sub 1s rămâne lege). Ușa
    // (cere_creierului) NU trece pe aici: fapta ei are sarcina EI în chat.ts,
    // marcată usaCreierului în metadate.
    let sarcinaVoceId: string | null = null
    // Registrul PER-SARCINĂ al dovezilor (agentul de logică, gaura 1):
    // doveziVoceTura are carry-over DELIBERAT între ture (cățelul, pasul 2 —
    // dovada supraviețuiește turei fără rostire), deci derivarea stării
    // finale din EL contamina sarcina T2 cu dovezile lui T1 (probat:
    // [failed(vechi), verified(nou)] → failed FALS pe T2). Sarcina își ține
    // dovezile SEPARAT, detașate EAGER la închidere — cățelul rămâne neatins.
    let doveziSarcinaVoce: DovadaUnealta[] = []
    let ultimaRostireTura = ''
    let lantJurnalVoce: Promise<unknown> = Promise.resolve()
    const scrieJurnalVoce = (scriere: () => Promise<unknown>): void => {
      lantJurnalVoce = lantJurnalVoce
        .then(scriere)
        .catch((e) => app.log.warn(`[jurnal operațional][voce] scriere pierdută: ${String(e).slice(0, 160)}`))
    }
    const tranzitieVoce = (taskId: string, stare: Parameters<typeof tranzitioneazaSarcinaOperationala>[0]['stare'], code: string, metadata?: Record<string, unknown>): void => {
      scrieJurnalVoce(async () => {
        const r = await tranzitioneazaSarcinaOperationala({ taskId, stare, code, metadata })
        // {ok:false} nu ARUNCĂ (agentul de logică, minor): fără rândul ăsta,
        // o tranziție respinsă dispărea complet fără urmă.
        if (!r.ok) app.log.warn(`[jurnal operațional][voce] tranziție respinsă (${stare}): ${r.error}`)
      })
    }
    const sarcinaVoceaPentruFapta = (): string => {
      if (!sarcinaVoceId) {
        const id = randomUUID()
        sarcinaVoceId = id
        // Fallback-ul obiectivului: dacă turnComplete a golit deja bufferele
        // (ordinea toolCall/turnComplete nu e garantată), rostirea care a
        // CERUT unealta e cea abia salvată (ultimaRostireTura) — nu un
        // „(tură vocală)" mut. Turele suprimate nu o setează (nu erau
        // adresate lui Kelion).
        const obiectiv = bufUser.trim() || rostireCurenta.trim() || ultimaRostireTura || '(tură vocală)'
        scrieJurnalVoce(() => inregistreazaSarcinaOperationala({
          id,
          userEmail: user.email,
          turnId: randomUUID(),
          objective: obiectiv,
          metadata: { source: 'voce', direct: true },
        }))
        tranzitieVoce(id, 'interpreting', 'voice_tool_call')
        tranzitieVoce(id, 'executing', 'voice_tool_call')
      }
      return sarcinaVoceId
    }
    const noteazaDovadaVoce = (dovada: DovadaUnealta): void => {
      doveziVoceTura.push(dovada)
      const taskId = sarcinaVoceaPentruFapta()
      doveziSarcinaVoce.push(dovada)
      scrieJurnalVoce(() => noteazaEvenimentOperational({
        taskId,
        kind: 'tool_result',
        capability: dovada.nume,
        outcomeState: dovada.stare,
        code: dovada.stare,
      }))
      // Unealta ÎN ZBOR la close/error (re-verificatorul, drumul rezidual al
      // găurii 2): rezultatul sosit DUPĂ incheieTura ar deschide o sarcină
      // nouă pe care niciun sfârșit de tură n-o mai închide vreodată — se
      // închide pe loc, derivată din propria dovadă (lanțul serializat
      // păstrează ordinea create→…→tool_result→final).
      if (inchis) inchideSarcinaVoce()
    }
    // Închiderea sarcinii pe ORICE drum care încheie tura (agentul de logică,
    // gaura 2): turele SUPRIMATE și close/error nu treceau prin salveazaTura,
    // deci sarcina rămânea pe `executing` PENTRU TOTDEAUNA (nu există nicio
    // măturare de expirare, iar executing→expired e ilegal în mașina de
    // stări) — „asul" ar fi servit la nesfârșit un „în lucru" vechi de zile.
    // Dovezile sarcinii se detașează EAGER (lungimea inclusiv), ca lanțul
    // leneș să nu numere push-uri de după captură.
    const inchideSarcinaVoce = (): void => {
      if (!sarcinaVoceId) return
      const taskId = sarcinaVoceId
      sarcinaVoceId = null
      const dovezi = doveziSarcinaVoce
      doveziSarcinaVoce = []
      const cate = dovezi.length
      const final = rezumaStareFinalaSarcinaOperationala({ cereActiune: false, dovezi, planFaraExecutie: false })
      tranzitieVoce(taskId, final.stare, final.cod, { source: 'voce', toolResults: cate })
    }
    const salveazaTura = (): void => {
      const u = bufUser.trim()
      let k = bufKelion.trim()
      bufUser = ''
      bufKelion = ''
      rostireCurenta = ''
      // Închiderea sarcinii vocale (pasul 4): din registrul PER-SARCINĂ, nu
      // din doveziVoceTura (carry-over-ul cățelului ar contamina verdictul —
      // gaura 1 a agentului de logică). cereActiune e fals aici: tura ușoară
      // e conversațională prin definiție — faptele ei sunt DOAR cele chiar
      // executate, iar lipsa lor nu e o acțiune ratată.
      inchideSarcinaVoce()
      if (u) ultimaRostireTura = u
      // Pe tura PUR-UȘOARĂ, pretențiile de FAPTĂ din ce a ROSTIT Kelion se
      // judecă pe uneltele chiar reușite ale turei. Vorba rostită nu se poate
      // lua înapoi — dar pretenția nu rămâne necontestată: nota intră în
      // ISTORIC (sesiunea următoare o vede și o poate corecta), pe MONITOR ca
      // document (niciodată citit cu voce — spec §8) și în jurnal. TEXTUL e
      // varianta „nu pot verifica" (nu „e FALSĂ") — pe voce pretenția poate fi
      // un RECALL adevărat al unei fapte din altă tură; un verdict de fals ar
      // fi EL minciuna (regula #1). CONSUMUL steagului: DOAR pe tura cu
      // rostire și DOAR fără uși în zbor (agentul de logică, #2/#4: o tură
      // administrativă închisă fără vorbă nu fură protecția turei care chiar
      // rostește temeiul).
      if (k) {
        if (!turaCuTemeiDinAfara && usiGreleInZbor === 0) {
          const nedovedite = pretentiiFaraFapta(k, doveziVoceTura)
          if (nedovedite.length) {
            const demascare = textulNuPotVerifica(nedovedite)
            k += demascare
            try {
              trimite({ type: 'control', frame: { doc: { title: 'Poarta faptelor (voce)', text: demascare.trim() } } })
            } catch {
              /* socket picat — nota rămâne în istoric + jurnal */
            }
            app.log.error(`[POARTA FAPTELOR][VOCE] pretenții nedovedite pe tura ușoară (nu pot verifica): ${nedovedite.join('; ')} | dovezi: ${doveziVoceTura.map((d) => `${d.nume}:${d.stare}`).join(',') || 'niciuna'}`)
          }
        }
        doveziVoceTura = []
        if (usiGreleInZbor === 0) turaCuTemeiDinAfara = false
      }
      if (u) void saveMessage(user.email, 'user', u).catch(() => {})
      // R1 (re-verificatorul lotului V): dacă vreun drum a golit bufUser fără
      // să treacă pe aici (granița de pauză), scrisul NU mai e în u — atunci
      // se salvează separat, nu se aruncă; altfel doar se resetează (e în u).
      if (bufScris.trim() && !u.includes(bufScris.trim())) salveazaScrisulAruncat()
      else bufScris = ''
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
      reseteazaCeasTacere() // tura s-a încheiat → resetăm ceasul de tăcere (15s de acum)
      if (verdictTura === false || verdictLimba === false) {
        app.log.info(
          verdictLimba === false
            ? `[VOCE] tură suprimată aruncată la închidere (limbă străină): „${bufKelion.trim().slice(0, 120)}"`
            : `[VOCE] tură suprimată aruncată la închidere (nu i se vorbea lui): auzit „${bufUser.trim().slice(0, 120)}"`,
        )
        salveazaScrisulAruncat()
        bufUser = ''
        bufKelion = ''
        rostireCurenta = ''
        // Suprimarea privește ROSTIREA, nu fapta: unealta chiar a rulat, iar
        // sarcina ei nu are voie să rămână „executing" pe veci (gaura 2).
        inchideSarcinaVoce()
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
        salveazaScrisulAruncat()
        bufUser = ''
        bufKelion = ''
        rostireCurenta = ''
        inchideSarcinaVoce()
        return
      }
      salveazaTura()
    }

    const ceasCost = setInterval(() => { void chargeMinute() }, 60_000)

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
            // Temeiul anunțului e starea MĂSURATĂ a ordinului (sistemul), nu o
            // unealtă a turei — cățelul vocal nu judecă rostirea lui (§5).
            // STEAGUL CĂLĂTOREȘTE CU ANUNȚUL, nu cu ceasul (agentul de logică,
            // #4 — fals-pozitiv DOVEDIT): pe amânare, tura în zbor ar fi
            // consumat steagul armat aici, iar tura anunțului rămânea judecată
            // și „clipul e gata" (adevărat, măsurat) era demascat fals. Armarea
            // pe ramura amânată se face LA CONSUMUL anuntAmanat (vezi cele 3
            // site-uri anuntAmanat → turaDeSistem).
            if (turaInZbor) {
              anuntAmanat = true
              anuntSistemAmanat = true
            } else {
              turaDeSistem = true // tura care urmează e ANUNȚ, declarat pe față — nu dedus din buffer gol
              turaCuTemeiDinAfara = true
            }
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
        const textFrame = String(data)
        if (Buffer.byteLength(textFrame, 'utf8') > 3 * 1024 * 1024) {
          socket.close(1009, 'frame_too_large')
          return
        }
        try {
          const m = JSON.parse(textFrame) as {
            type?: string
            lat?: number
            lon?: number
            acc?: number
            now?: string
            tz?: string
            cadre?: unknown
          }
          if (m.type === 'coords') {
            if (Number.isFinite(m.lat) && Number.isFinite(m.lon)
              && (m.lat as number) >= -90 && (m.lat as number) <= 90
              && (m.lon as number) >= -180 && (m.lon as number) <= 180) {
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
            const cadre = cadreVedereLive(m.cadre)
            primesteCadre?.(cadre)
            primesteCadre = null
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
            // sinteza serială → coliziunea celor două guri nu mai are de unde
            // să apară pe turele scrise. Output-ul rămâne VOCE (regula de aur §10).
            //
            // BUG CRITIC prins de agentul de logică ÎNAINTE de merge (tura scrisă ar fi
            // fost MUTĂ — două lacăte interne îi mâncau răspunsul); dezarmăm amândouă:
            const textScrisBrut = ((m as { text: string }).text || '').trim()
            if (textScrisBrut.length > 4000) {
              trimite({ type: 'eroare', motiv: 'text_too_long' })
              return
            }
            const textScris = textScrisBrut
            if (textScris) {
              // „ÎN ZBOR" se măsoară ÎNAINTE de curățare (re-verificatorul: curățarea
              // șterge chiar dovada turei în zbor → amânarea nu se mai declanșa, iar
              // coada turei vechi putea consuma dreptul turei scrise → tura scrisă mută).
              // R2 (re-verificatorul lotului V, pre-existent): rostirea
              // NEADRESATĂ din buffer (ambientul unei camere zgomotoase, cu
              // modelul tăcând corect) NU e o tură „în zbor" — pe ea, rândul
              // TASTAT devenea anuntAmanat, verdictul se judeca pe bufferul
              // ambient și răspunsul la scris era SUPRIMAT (mut). Ambient pur
              // → tura scrisă e de sistem imediat.
              const eraInZbor =
                verdictTura !== null || cadreInAsteptare.length > 0 || bufKelion.trim().length > 0 || turaAdresata(rostireCurenta.trim())
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
              if (eraInZbor) anuntAmanat = true
              else turaDeSistem = true
              // MEMORIA (re-verificatorul: rândul scris nu se salva nicăieri — istoria
              // ținea răspunsuri la întrebări invizibile, iar învățarea primea user gol):
              // rândul intră în bufferul de user, ca vorbirea; adresarea nu e afectată
              // (turaDeSistem/anuntAmanat scurtcircuitează poarta numelui).
              bufUser = bufUser ? bufUser + ' ' + textScris : textScris
              bufScris = bufScris ? bufScris + ' ' + textScris : textScris
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
          } else if (m.type === 'opus_cazut') {
            // Codecul WebCodecs al clientului a MURIT în zbor (registrul
            // frontend, lot C): fără anunțul ăsta, serverul continua să trimită
            // Opus iar difuzorul clientului rămânea permanent mut. Hop înapoi pe
            // PCM pe ambele sensuri — aceeași ordine WS garantează că uploadurile
            // de după anunț vin ne-tag-uite.
            opusActiv = false
            // INFO, nu warn (verificatorul C): la warn (nivel 40) intra în inelul
            // scanat de auto-vindecare și, nefiind în amprentele de infrastructură,
            // după 2 sesiuni cu codec mort ar fi deschis un ordin FALS de „reparat
            // cod" pentru un eveniment de mediu-browser DEJA tratat prin fallback
            // (vocea continuă pe PCM). Simptomul ajunge oricum la diagnoză prin
            // client_errors (console.error-ul clientului la aceeași cădere).
            app.log.info('vocal-live: clientul a anunțat căderea codecului Opus — hopul revine pe PCM')
          }
        } catch {
          /* cadru text neînțeles — îl ignorăm, audio rămâne pe binar */
        }
        return
      }
      let buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer)
      if (buf.length > 128 * 1024) {
        socket.close(1009, 'audio_frame_too_large')
        return
      }
      diagnosticVoce.micFrames++
      diagnosticVoce.micBytes += buf.length
      diagnosticVoce.lastEventAt = Date.now()
      // OPUS: cât e activ, cadrul de microfon vine [octet codec: 0=PCM, 1=Opus]
      // [payload]. Decodăm înainte de detector și de OpenAI Realtime — tot lanțul
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
      } else {
        preCoada.push(buf)
        preCoadaBytes += buf.length
        while (preCoadaBytes > 2 * 1024 * 1024 && preCoada.length) {
          preCoadaBytes -= preCoada.shift()?.length ?? 0
        }
      }
    })
    socket.on('close', () => {
      inchis = true
      diagnosticVoce.session = 'closed'
      diagnosticVoce.lastEventAt = Date.now()
      scadeSesiunea()
      clearInterval(ceasCost)
      clearInterval(ceasOrdine)
      if (ceasTacere) {
        clearTimeout(ceasTacere)
        ceasTacere = null
      }
      if (ceasAsteptareVerdict) {
        clearTimeout(ceasAsteptareVerdict)
        ceasAsteptareVerdict = null
      }
      incheieTura() // o tură neterminată nu se pierde — dar una SUPRIMATĂ nu se salvează
      live?.inchide()
      void refundInitialSetupCharge()
      opus?.inchide() // eliberează codecul Opus (WASM) al sesiunii
      opus = null
      app.log.info('vocal-live: WS închis')
    })
    socket.on('error', () => {
      inchis = true
      diagnosticVoce.session = 'error'
      diagnosticVoce.lastEventAt = Date.now()
      scadeSesiunea()
      clearInterval(ceasCost)
      clearInterval(ceasOrdine)
      if (ceasTacere) {
        clearTimeout(ceasTacere)
        ceasTacere = null
      }
      if (ceasAsteptareVerdict) {
        clearTimeout(ceasAsteptareVerdict)
        ceasAsteptareVerdict = null
      }
      incheieTura()
      live?.inchide()
      void refundInitialSetupCharge()
    })

    void (async () => {
      if (!await chargeMinute()) return
      // Memoria: ultimele schimburi din istoric intră în instrucțiunea de setup.
      // O citire picată NU blochează vocea — sesiunea pornește fără memorie și
      // spune asta în jurnal (mai bine o voce uitucă decât niciuna).
      let istoric: Array<{ role: string; content: string }> = []
      try {
        istoric = await getRecentHistory(user.email, 12)
      } catch {
        app.log.warn('vocal-live: istoricul nu s-a putut citi — sesiunea pornește fără memorie')
      }
      // Preferința este limba deja detectată pentru acest cont după autentificare.
      // Ea câștigă pentru orice rol, inclusiv admin; engleza este numai fallback.
      let limbaPin = 'en-US'
      let sursaLimba: 'detected_preference' | 'fallback' = 'fallback'
      let prefLimbaCurenta: string | null = null // pentru comiterea din vorbit (mai jos)
      try {
        const pref = await getSpeechLang(user.email)
        prefLimbaCurenta = pref
        const selected = selectVoiceLocale(pref)
        limbaPin = selected.language
        sursaLimba = selected.source
      } catch {
        limbaPin = 'en-US'
        app.log.warn(`vocal-live: speech_lang necitibil — pinul de limbă cade pe implicit (${limbaPin})`)
      }
      diagnosticVoce.language = limbaPin
      diagnosticVoce.languageSource = sursaLimba
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
      const instructiune = construiesteInstructiune(
        PERSONA_KELION + (isAdminSession ? ancoraConstructor(config.codexWorker.enabled) : ''),
        nume,
        istoric,
        ancora,
        limbaPin,
      ) + memorie
      const liveTools = unelteleSesiuniiLive(isAdminSession)
      const allowedLiveTools = new Set(liveTools.map((tool) => tool.name))
      const toolCallsInFlight = new Set<string>()
      const toolCallResults = new Map<string, { name: string; result: unknown }>()
      const raspundeTool = (id: string, name: string, result: unknown): void => {
        toolCallsInFlight.delete(id)
        toolCallResults.set(id, { name, result })
        while (toolCallResults.size > 200) {
          const oldest = toolCallResults.keys().next().value as string | undefined
          if (!oldest) break
          toolCallResults.delete(oldest)
        }
        live?.raspundeUnealta(id, name, result)
      }

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
        diagnosticVoce.lastSuppression = 'manual_interrupt'
        diagnosticVoce.lastEventAt = Date.now()
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
      live = deschideVocalLive(instructiune, liveTools, {
        onGata: async () => {
          providerReady = true
          diagnosticVoce.session = 'ready'
          diagnosticVoce.lastEventAt = Date.now()
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
          pulsVoce.cadreAudioDeLaOpenAI++
          pulsVoce.laUltimulCadru = Date.now()
          reseteazaCeasTacere() // Kelion vorbește → sesiunea e ACTIVĂ, nu idle
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
            const _spusaPrim = rostireCurenta.trim() || bufUser.trim()
            app.log.info(`[VOCE-DIAG] prim cadru: adresata=${adresata} | turaDeSistem=${turaDeSistem} | spusa="${_spusaPrim.slice(0, 80)}"`)
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
          diagnosticVoce.transcriptUserEvents++
          if (final) diagnosticVoce.transcriptUserFinal++
          diagnosticVoce.lastEventAt = Date.now()
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
              if (anuntSistemAmanat) {
                turaCuTemeiDinAfara = true // temeiul anunțului de SISTEM = starea ordinului (§5)
                anuntSistemAmanat = false
              }
            }
          }
          ultimaTranscriereUserLa = acum
          rostireCurenta += text
          bufUser += text
          reseteazaCeasTacere() // utilizatorul vorbește → resetăm timeout-ul de tăcere
          trimite({ type: 'user', text, final })
          // R3 (re-verificatorul lotului V): `final` nu era idempotent — un
          // `finished` dublat de Google (sau finished + turnComplete în cadre
          // separate) rula blocul de două ori pe ACEEAȘI rostire acumulată:
          // dublu-toggle pe comanda de dispozitiv, limbă comisă dintr-o
          // singură rostire reală, injecție duplicată în triere.
          if (final && rostireCurenta.trim() && rostireCurenta !== ultimaRostireFinalizata) {
            ultimaRostireFinalizata = rostireCurenta
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
              // TRIEREA ÎN DOI (§4): rostirea ADRESATĂ sosită cât ușa grea
              // macină intră în convergență (aceeași gardă ca la comenzi —
              // ambientalul/altă limbă nu „informează" gândirea).
              if (usiGreleInZbor > 0 && rostireCurenta.trim()) {
                injectiiUsa.push(rostireCurenta.trim())
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
            const _adresat = turaAdresataAcum()
            const _spusa = rostireCurenta.trim() || bufUser.trim()
            app.log.info(`[VOCE-DIAG] judecat adresare: verdict=${_adresat} | final=${final} | spusa="${_spusa.slice(0, 80)}" | cadreAsteptare=${cadreInAsteptare.length} | textAsteptare=${textInAsteptare.length}`)
            if (_adresat) {
              verdictTura = true
              verdictDinCeas = false
              turaDeSistem = false
              taiatDeVoce = false
              varsaCadreleInAsteptare()
              varsaTextulInAsteptare()
            } else if (final && verdictTura === null) {
              verdictTura = false
              taiatDeVoce = false
              app.log.info(`[VOCE-DIAG] TURĂ SUPRIMATĂ (nu i se vorbea lui): "${_spusa.slice(0, 120)}"`)
              varsaCadreleInAsteptare()
              varsaTextulInAsteptare()
            }
          }
        },
        onTranscriereKelion: (text, final) => {
          diagnosticVoce.transcriptKelionEvents++
          if (final) diagnosticVoce.transcriptKelionFinal++
          diagnosticVoce.lastEventAt = Date.now()
          reseteazaCeasTacere() // Kelion transcrie → sesiunea e ACTIVĂ, nu idle
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
                // Corecția se spune sesiunii curente; o conexiune nouă își
                // reconstruiește contextul din istoricul propriu al aplicației.
                live?.ancoreaza(`[SISTEM] Replica ta anterioară a fost respinsă: era în ${straina ?? 'altă limbă'}, necerută. Continuă EXCLUSIV în română.`)
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
          reseteazaCeasTacere() // Kelion face tool calls → sesiunea e ACTIVĂ, nu idle
          if (!allowedLiveTools.has(apel.name)) {
            raspundeTool(apel.id, apel.name, { error: 'tool_not_allowed' })
            return
          }
          const completed = toolCallResults.get(apel.id)
          if (completed) {
            if (completed.name !== apel.name) {
              live?.raspundeUnealta(apel.id, apel.name, { error: 'tool_call_id_conflict' })
            } else {
              live?.raspundeUnealta(apel.id, apel.name, completed.result)
            }
            return
          }
          if (toolCallsInFlight.has(apel.id)) {
            // The first execution will answer this call id; never run or emit a
            // second result while its side effect is still in flight.
            return
          }
          toolCallsInFlight.add(apel.id)
          // UȘA SPRE CREIERUL ÎNTREG: cererea trece prin /api/chat cu sesiunea
          // omului — toate uneltele chatului, aceeași contabilizare. Cadrele de
          // ECRAN se retrimit browserului; cadrele de VOCE nu trec (glasul e al
          // modelului live — regula vocii unice), nici cele de mers (receipt/
          // heartbeat/lang), care ar deruta handleControl.
          if (apel.name === 'cere_creierului') {
            const cerere = String((apel.args as { cerere?: unknown }).cerere ?? '').trim()
            if (!cerere) {
              raspundeTool(apel.id, apel.name, { eroare: 'cerere goală' })
              return
            }
            // Temeiul turei trece la creierul GREU — poarta faptelor a LUI
            // rulează în /api/chat; cățelul vocal nu judecă re-rostirea (§5).
            // Steagul se pune DUPĂ validarea cererii (F8 al marii verificări):
            // pe cererea goală, exempția armată degeaba lăsa prima rostire
            // următoare nejudecată de cățel, fără nicio tură de creier.
            turaCuTemeiDinAfara = true
            app.log.info(`vocal-live: ușa creierului — „${cerere.slice(0, 80)}"`)
            // UȘĂ ÎN ZBOR (agentul de logică, #3): cât cererea grea e deschisă,
            // steagul NU se consumă la salvarea vreunei ture intercalate —
            // ordinea turnComplete/toolCall la Google nu e garantată, iar sub
            // „trierea în doi" ușa poate măcina zeci de secunde cu schimburi
            // vorbite pe deasupra. Contorul ține exempția vie cap-coadă.
            usiGreleInZbor++
            // PROPRIETATEA trierii (concurența): doar PRIMA ușă deschisă face
            // convergența; una concurentă nici nu curăță, nici nu consumă lista.
            const usaId = ++usaUrmatoareId
            if (usaTrierii === 0) {
              usaTrierii = usaId
              injectiiUsa.length = 0 // ușa pornește curată — se strânge doar ce se află DE-ACUM
            }
            try {
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
            // 'executie' (22 aug — clepsidra pe voce): pașii de lucru curg pe
            // monitor și când cererea e SPUSĂ, nu doar scrisă (împreună cu
            // streaming-ul din turaCreierului, care îi lasă să plece PE LOC).
            const CADRE_ECRAN = ['monitor', 'doc', 'app', 'card', 'image', 'golesteMonitor', 'build', 'device', 'nav', 'niveluri', 'gest', 'gesture', 'apel', 'executie']
            // MONITORUL PE VOCE (JARVIS pasul 5 — PROIECT-CHAT-VOCE §8):
            // până aici, ecranul și gura erau complet independente — același
            // șir de caractere pleca SIMULTAN pe monitor (cadrul de mai jos)
            // și în poziția „rezultat de spus" a modelului Live, iar singura
            // frână a recitării era o instrucțiune. Steagul leagă CAUZAL cele
            // două și se ridică DOAR pe cadrul purtător de TEXT ({doc} — al
            // lui show_document sau al plasei autoPreview): verificatorul de
            // logică a dovedit că pe suprafețele-URL (meteo/hartă) textul
            // răspunsului NU e afișat nicăieri (surfaceShown sare plasa),
            // deci un steag ridicat pe orice cadru ar fi pus formula predării
            // să mintă — iar pe voce conținutul n-ar mai fi ajuns pe NICIUN
            // canal. Fără doc → drumul vechi: Live rostește răspunsul întreg.
            let docPeEcranInUsa = false
            const laEcran = (frame: Record<string, unknown>): void => {
              if (CADRE_ECRAN.some((k) => k in frame)) {
                if ('doc' in frame) {
                  if (!docPeEcranInUsa) pulsVoce.usiCuDoc++
                  docPeEcranInUsa = true
                }
                trimite({ type: 'control', frame })
              }
            }
            let r = await turaCreierului(req.headers.cookie ?? '', cerere, apel.id, coords, cadre, laEcran, monitorLive, tranzactiiLive)
            // TRIEREA ÎN DOI (§4) — CONVERGENȚA: dacă în timpul măcinării omul a
            // spus lucruri noi (întrebat de Live sau de la sine), creierul greu
            // primește încă o rundă CU ISTORICUL rundei anterioare (altfel runda
            // 2 e amnezică și RE-EXECUTĂ faptele — emailul de 2 ori, clasa
            // interzisă B#2) și cu instrucțiunea „doar DIFERENȚA". STOP-ul
            // specului: nimic nou = răspunsul e gata; plafonul ține „calitatea
            // > viteza, dar nu e raliu". Runda picată NU aruncă răspunsul bun
            // deja obținut (regula #1: fapta e făcută — nu raportăm „a picat").
            // hardcod-permis: plafon tehnic de runde de convergență (nu bani/stare afișată)
            const RUNDE_TRIERE = 2
            let runde = 0
            // `!inchis`: după moartea socketului nu mai pornim runde de
            // convergență (F7 al marii verificări) — 2 ture de creier a câte
            // 90s, cu fapte posibile, al căror rezultat ar muri mut.
            while (!inchis && r.ok && usaTrierii === usaId && injectiiUsa.length > 0 && runde < RUNDE_TRIERE) {
              const noi = injectiiUsa.splice(0).join(' • ')
              runde++
              app.log.info(`vocal-live: trierea în doi — runda ${runde}, informații noi de la om („${noi.slice(0, 80)}")`)
              pulsVoce.rundeTriere++
              const r2 = await turaCreierului(
                req.headers.cookie ?? '',
                cerere,
                `${apel.id}:triage:${runde}`,
                coords,
                cadre,
                laEcran,
                monitorLive,
                tranzactiiLive,
                {
                  istoric: [
                    { role: 'user', content: cerere },
                    { role: 'assistant', content: r.text },
                    {
                      role: 'user',
                      content:
                        `[TRIEREA ÎN DOI — ce a spus omul cât gândeai]: ${noi}\n` +
                        `Continuă de unde ai rămas, ținând cont de TOT. NU repeta faptele deja făcute în runda de dinainte ` +
                        `(email trimis, eveniment creat, orice unealtă cu efect) — fă doar DIFERENȚA nouă. ` +
                        `Dacă o întrebare rămasă încă MUTĂ răspunsul, pune-o scurt și decent; altfel răspunde final.`,
                    },
                  ],
                },
              )
              if (!r2.ok) {
                app.log.warn(`vocal-live: trierea în doi — runda ${runde} a picat (${r2.motiv}); rămân pe ultimul răspuns bun`)
                break
              }
              r = r2
            }
            if (r.ok) {
              // Ordinele de constructor pornite prin ușă intră sub urmărire —
              // la terminare, Kelion anunță cu vocea lui (ceasOrdine, mai sus).
              const ordin = r.text.match(/ordin\s*#(\d+)/i)
              if (ordin) {
                ordineUrmarite.add(Number(ordin[1]))
                app.log.info(`vocal-live: urmăresc ordinul de construcție #${ordin[1]} — anunț la terminare`)
              }
              // PREDAREA SCURTĂ (§8): peste PRAG, cu un DOCUMENT trimis pe
              // monitor în tura asta, textul NU se dă ca „rezultat de spus" —
              // se dă ÎNTREG (nicio trunchiere: primele N caractere pot
              // inversa sensul — „nu am putut trimite" tăiat înainte de „nu"
              // ar fi minciună, Legea #1) în câmpul al cărui nume spune
              // singur regula. Formula predării afirmă DOAR ce s-a măsurat
              // (un cadru doc a plecat) — nu „conținutul e afișat", care pe
              // ramurile URL/cod era fals (verificatorii pasului 5).
              const PRAG_PREDARE_ECRAN = 300 // hardcod-permis: plafon tehnic — peste ~o frază rostibilă; sub el rostirea integrală e deja scurtă
              // Demascarea porții faptelor (marcajul ⚠) nu are voie să moară
              // în câmpul nerostit: dacă răspunsul o conține, splitul se
              // sare — adevărul rostit bate evitarea recitării.
              const contineDemascare = r.text.includes('\n\n⚠ ')
              if (docPeEcranInUsa && !contineDemascare && r.text.length > PRAG_PREDARE_ECRAN) {
                if (live) {
                  pulsVoce.predariEcran++
                  raspundeTool(apel.id, apel.name, {
                    rezultat: {
                      de_rostit: 'Un document a fost trimis pe monitor în tura asta, iar textul COMPLET al răspunsului îl ai în „pe_ecran_nu_se_recita". Predă scurt: o propoziție de predare + esențialul într-o frază — nu recita textul întreg.',
                      pe_ecran_nu_se_recita: r.text,
                    },
                  })
                }
              } else {
                raspundeTool(apel.id, apel.name, { rezultat: r.text || 'creierul n-a întors niciun text' })
              }
            } else {
              app.log.warn(`vocal-live: ușa creierului a picat: ${r.motiv}`)
              // CHATUL CARE NU RĂSPUNDE, FĂCUT VIZIBIL (12 aug): ușa creierului a
              // picat pe voce = exact „aplicația nu răspunde". Se notează ca simptom
              // ca autovindecarea să ajungă la cauză.
              void recordSimptomLive('chat-mut', `voce: ușa creierului a picat — ${r.motiv}`.slice(0, 180)).catch(() => {})
              raspundeTool(apel.id, apel.name, { eroare: r.motiv })
            }
            } finally {
              usiGreleInZbor--
              if (usaTrierii === usaId) usaTrierii = 0 // proprietatea se eliberează pe ORICE drum
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
              const r = await execUserScopedTool(apel.name, apel.args as any, user.email, isAdminSession)
              // Dovada cățelului vocal (§5): rezultatul REAL, clasificat — o
              // pretenție de faptă rostită se acoperă doar cu o unealtă reușită.
              if (r != null) noteazaDovadaVoce(clasificaRezultatUnealta(apel.name, String(r)))
              raspundeTool(apel.id, apel.name, { rezultat: r ?? 'Unealtă nesuportată în voce.' })
              return
            }
            const rezultat = await execSharedAdminTool(apel.name, apel.args as any, { email: user.email })
            if (rezultat !== null) {
              noteazaDovadaVoce(clasificaRezultatUnealta(apel.name, String(rezultat)))
              raspundeTool(apel.id, apel.name, { rezultat })
            } else {
              raspundeTool(apel.id, apel.name, { rezultat: 'Unealtă nesuportată în voce.' })
            }
          } catch (err: any) {
            app.log.error(`Eroare unealtă ${apel.name}: ${err.message}`)
            // Tentativă picată = dovadă de EȘEC (nu acoperă nicio pretenție).
            noteazaDovadaVoce(clasificaRezultatUnealta(apel.name, `tool_error: ${String(err?.message ?? err)}`))
            raspundeTool(apel.id, apel.name, { eroare: err.message })
          }
        },
        onIntrerupt: () => {
          diagnosticVoce.vadSpeechStarted++
          diagnosticVoce.lastEventAt = Date.now()
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
            if (anuntSistemAmanat) {
              turaCuTemeiDinAfara = true // temeiul anunțului de SISTEM = starea ordinului (§5)
              anuntSistemAmanat = false
            }
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
            diagnosticVoce.lastSuppression = verdictLimba === false ? 'language_guard' : 'wake_word_required'
            diagnosticVoce.lastEventAt = Date.now()
            trimite({ type: 'status', code: 'response_suppressed', reason: diagnosticVoce.lastSuppression })
            // Tura NU i se adresa SAU a răspuns într-o limbă necerută: nu se
            // salvează în memorie (o replică spaniolă salvată ar OTRĂVI
            // instrucțiunea sesiunii următoare — revizia, 9 aug), dar se
            // NUMEȘTE în jurnal — o suprimare greșită trebuie să fie vizibilă.
            app.log.info(
              verdictLimba === false
                ? `[VOCE] tură suprimată (limbă străină necerută): „${bufKelion.trim().slice(0, 120)}"`
                : `[VOCE] tură suprimată (nu i se vorbea lui): auzit „${bufUser.trim().slice(0, 120)}"`,
            )
            salveazaScrisulAruncat()
            bufUser = ''
            bufKelion = ''
            rostireCurenta = ''
            inchideSarcinaVoce()
          } else if (verdictTura === null && !turaAdresata(bufUser.trim())) {
            // AUDITUL 15 aug (critică, confirmată de 3 verificatori): modelul a
            // TĂCUT corect pe vorbire neadresată — verdictul null nu înseamnă
            // „tura e bună". Fără numele măsurat, bălăriile urechii nu intră
            // nici în istoric, nici în memoria de lungă durată.
            diagnosticVoce.lastSuppression = 'wake_word_required'
            diagnosticVoce.lastEventAt = Date.now()
            trimite({ type: 'status', code: 'response_suppressed', reason: diagnosticVoce.lastSuppression })
            if (bufUser.trim()) {
              app.log.info(`[VOCE] tură nesalvată (tăcere corectă, fără nume): auzit „${bufUser.trim().slice(0, 120)}"`)
            }
            salveazaScrisulAruncat()
            bufUser = ''
            bufKelion = ''
            rostireCurenta = ''
            inchideSarcinaVoce()
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
            if (anuntSistemAmanat) {
              turaCuTemeiDinAfara = true // temeiul anunțului de SISTEM = starea ordinului (§5)
              anuntSistemAmanat = false
            }
          }
          trimite({ type: 'tura_gata' })
        },
        onUsage: (usage) => {
          if (!usage.responseId) {
            trimite({ type: 'eroare', motiv: 'provider_usage_missing_response_id' })
            try { socket.close(1011, 'provider_usage_missing') } catch { /* closed */ }
            return
          }
          void recordProviderUsage({
            responseId: usage.responseId,
            userEmail: user.email,
            surface: 'realtime',
            sessionId: billingSessionId,
            model: config.openai.realtime,
            serviceTier: null,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            inputAudioTokens: usage.inputAudioTokens,
            outputAudioTokens: usage.outputAudioTokens,
          }).catch((error) => {
            app.log.error({ err: String(error).slice(0, 160) }, 'vocal-live metering failed')
            trimite({ type: 'eroare', motiv: 'provider_usage_unavailable' })
            try { socket.close(1011, 'provider_usage_unavailable') } catch { /* closed */ }
          })
        },
        onEroare: (motiv) => {
          pulsVoce.ultimaEroare = motiv.slice(0, 160)
          trimite({ type: 'eroare', motiv })
          app.log.warn(`vocal-live: ${motiv}`)
          void refundInitialSetupCharge()
        },
        onInfo: (msg) => {
          pulsVoce.varianta = msg.slice(0, 120)
          app.log.info(`vocal-live: ${msg}`)
        },
      }, limbaPin)
      if (!live) {
        await refundInitialSetupCharge()
        try {
          socket.close(1011, 'vocal_live_indisponibil')
        } catch {
          /* deja închis */
        }
        return
      }
      for (const b of preCoada.splice(0)) {
        live.scrieAudio(b)
      }
      preCoadaBytes = 0
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
