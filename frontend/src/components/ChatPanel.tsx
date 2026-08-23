import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ChangeEvent,
  type ClipboardEvent as ReactClipboardEvent,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { streamChat, type ChatMessage, type Coords, type ChatControl } from '../lib/chat'
import { ceas } from '../lib/ceas'
import { frazaInchisa, gata as contorGata } from '../lib/contorFraza'
import { strings, resolveLang, uiStrings, type Lang } from '../lib/i18n'
import CameraView from './CameraView'
import { WorkClock } from './WorkClock'
import { cameraSupported, type Facing } from '../lib/camera'
import { defaultSpeechLang } from '../lib/languages'
import { loadLocalLang, loadServerPrefs, mirrorLang } from '../lib/prefs'
import {
  openWorkspace,
  openWorkspaceCard,
  openWorkspaceDoc,
  openWorkspaceApp,
  openWorkspaceBuild,
  openWorkspaceExecutie,
  adaugaPasExecutie,
  getStareExecutie,
  closeWorkspace,
  closeTasksByKind,
  closeAllTasks,
  switchToKind,
  getWorkspace,
  subscribeWorkspace,
  isMonitorWorking,
  getMonitorContent,
  getStareTranzactii,
} from '../lib/workspace'
import { startRecording, type RecordingHandle } from '../lib/recorder'
import {
  playVoice,
  stopVoice,
  isVoicePlaying,
  calibrateVoiceprint,
  hasVoiceprint,
  getPendingVoiceFeatures,
  setPendingVoiceFeatures,
  clearPendingVoiceFeatures,
  getVoiceVolume,
  setVoiceVolume,
  getVoiceLevel,
  type MicHandle,
} from '../lib/audioIO'
import {
  registerLiveFocus,
  unregisterLiveFocus,
  requestTtsFocus,
  releaseTtsFocus,
  interruptAll,
  setForeignVoiceLock,
} from '../lib/audioFocus'
import { getPendingFaceDescriptor } from '../lib/faceprint'
import { watchdogEnter, watchdogBeat, watchdogExit } from '../lib/watchdog'
import { setRealLatency, getRealLatency, subscribeRealLatency } from '../lib/latency'
import { keepScreenOn } from '../lib/wakelock'
// VOCE UNIFICATĂ (Adrian, 5 aug): urechea STT a fost scoasă TOTAL — o singură cale
// vocală (startRealtimeVoice → micStream local-VAD → audio la creierul unic).
// Dictarea batch (/api/asr) și streamingul standalone (STT) au dispărut.
import { startRealtimeVoice, type RealtimeVoiceHandle } from '../lib/realtimeVoice'
import { deschideVocalLive, vocalLiveDisponibila, type VocalLiveHandle } from '../lib/vocalLive'
import MicBargraf, { type NivelIntrare } from './MicBargraf'
import { getTeava, calitateCamera } from '../lib/retea'
import { deschideCanalVoce, idTabVoce, judecaMesajVoce, inimaAMurit, emiteTakeover, INIMA_BATE_MS, type MesajVoce } from '../lib/voceUnica'
import { pornesteDansPeMuzica } from '../lib/dansMuzica'
import { pushFacial } from '../lib/facialQueue'
import { reportActivity } from '../lib/activity'
import { isCarMode, setCarMode, subscribeCarMode } from '../lib/carMode'
import { esteConectat, useConectat } from '../lib/conexiune'
import { streamLocalRaspuns, pregatesteModelOffline, stareCreierLocal, webgpuDisponibil, sincronizeazaStareOffline, autoDescarcareaPermisa } from '../lib/creierLocal'
import { contextPentruCreier, vitezaDinPozitii } from '../lib/contextOffline'
import { opresteVoceLocal } from '../lib/voceBrowser'
import { vorbesteOffline, oprestePiper, piperVorbeste } from '../lib/guraOffline'
import { sincronizeazaKitOffline } from '../lib/kitOffline'
import { pregatesteUrecheaOffline, urecheaOfflineGata, transcrieOffline, wavBase64LaFloat32 } from '../lib/urecheaOffline'
import type { MicStreamHandle } from '../lib/micStream'
import {
  adaugaTuraSync,
  adaugaAmanata,
  citesteSync,
  golesteSync,
  citesteAmanate,
  stergeAmanata,
  necesitaNet,
  anuntAmanat,
} from '../lib/coadaOffline'
import { anuntaPeTelefon } from '../lib/notificari'
import JarvisOrb from './JarvisOrb'

// Gesturile-tool ale serverului (play_avatar_gesture, release-ul „v2.3” al
// builder) translated into the REAL clips from the RPM library — the skeleton
// moves only through clips (rule #125), so the label becomes the name
// of the equivalent clip and leaves on the same 'kelion-gesture' channel.
const GESTURE_TO_CLIP: Record<string, string> = {
  // Semantic vocabulary (Adrian, Jul 13) — the brain asks for the gesture by MEANING, here
  // it gets translated into the RPM clip. Each one is tied to a feeling/context.
  salut: 'expresie-1', // salut / rămas-bun
  'arata-inainte': 'expresie-2', // arată înainte
  uimire: 'expresie-3', // uimire
  dezamagire: 'expresie-4', // dezamăgire ușoară
  nedumerire: 'expresie-5', // nedumerire
  victorie: 'expresie-6', // victorie
  multumire: 'expresie-7', // mulțumire
  surpriza: 'expresie-8', // surpriză
  'stai-putin': 'expresie-9', // stai puțin
  ganditor: 'expresie-10', // gânditor
  aprobare: 'expresie-11', // aprobare
  entuziasm: 'expresie-12', // entuziasm
  'acord-discret': 'expresie-13', // acord discret
  plecaciune: 'expresie-14', // plecăciune teatrală
  dans: 'dans', // dans (doar la cerere)
  // Legacy — the deterministic voice commands in the backend still emit these.
  salute: 'expresie-1',
  raiseRightHand: 'expresie-13',
  pointMonitor: 'expresie-2',
}

// NO duration cap on recordings (Adrian, Jul 11 evening: "they must not
// have time settings or limits") — the scenario ends when it runs out of
// steps or when he says stop, not when an arbitrary timer expires.

// Camera + monitor-tab commands ("închide harta", "camera spate", "switch to
// the video") are interpreted on the SERVER now (backend services/commands.ts,
// owner's order: as much of the app as possible on the server). The server
// answers them with a {device} control frame that handleControl executes; the
// ✕ on the monitor stays as the universal manual fallback.
// Admin typed control for the promo recorder. START arms the Rec button (the
// browser REQUIRES one real click to pick the screen); STOP ends the take.
// Kelion confirms both in chat.
// NB: no \b before "î" — JS word boundaries are ASCII-only, so \bî never
// matches and the spoken "înregistrează" would sail through to the brain.
const REC_STOP =
  /\b(opre[șs]te|opreste|stop|termin[ăa]|gata)\b.{0,12}([îi]nregistr|record|rec\b)/i
const REC_START =
  /([îi]nregistreaz[ăa]|porne[șs]te\s+[îi]nregistrarea|start\s+record\w*|record\s+(the\s+)?screen|filmeaz[ăa])/i
// During a promo TAKE only these typed words cut it (narrow on purpose).
const TAKE_STOP = /\b(stop|stai|opre[șs]te|opreste|t[ăa]iem|taie)\b/i
// "Reluăm" — redo the SAME approved take without re-asking for the script.
const RETAKE =
  /(relu[ăa]m\b|retake|reia (dubla|clipul|[îi]nregistrarea)|înc[ăa] o dubl[ăa]|inca o dubla|din nou (dubla|clipul))/i
// LOCATION intent in the typed message — only then is the real GPS read
// (Adrian, Jul 26: "only when GPS apps are used or location detection
// is needed"). Covers all 7 UI languages (audit Aug 2: it was RO+EN only, so
// a French/German/Spanish user asking for weather or a route NEVER got a
// position read): weather, maps, position, routes.
const LOC_INTENT =
  /\b(vreme(a|me)?|meteo|prognoz\w*|weather|forecast|tiempo|clima|pron[óo]stico|m[ée]t[ée]o|pr[ée]visions|wetter(bericht)?|vorhersage|previsioni|tempo|previs[ãa]o|unde (sunt|m[ăa] aflu)|where am i|d[óo]nde estoy|o[ùu] suis[- ]je|wo bin ich|dove (sono|mi trovo)|onde estou|l[âa]ng[ăa] mine|near me|cerca de m[íi]|pr[èe]s de moi|in meiner n[äa]he|vicino a me|perto de mim|aproape de mine|[îi]n zon[ăa]|hart[ăa]|h[ăa]r[țt]i|maps?|mapas?|carte|plan\b|karte|mappa|traseu|rut[ăa]|ruta|rotas?|route|itin[ée]raire|percorso|drum(ul)? (spre|p[âa]n[ăa])|direc[țt]ii|directions|direcciones|wegbeschreibung|indicazioni|dire[çc][õo]es|navig\w*|loca[țt]ia (mea|curent[ăa])|locul meu|pozi[țt]ia mea|coordonate(le)? mele|mi ubicaci[óo]n|ma position|mein standort|la mia posizione|minha localiza[çc][ãa]o|gps)\b/i

function metersBetween(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371000
  const dLat = ((bLat - aLat) * Math.PI) / 180
  const dLon = ((bLon - aLon) * Math.PI) / 180
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

export default function ChatPanel({
  lang,
  isAdmin,
}: {
  readonly lang: Lang
  readonly isAdmin: boolean
}) {
  const t = strings(lang)
  // Fix hydration: start with the deterministic UI lang, then resolve the browser locale on the client.
  const [speechLang, setSpeechLang] = useState<string>(lang)
  useEffect(() => {
    setSpeechLang(defaultSpeechLang(lang))
  }, [lang])
  const [messages, setMessages] = useState<ChatMessage[]>([])
  // CLEAN PAGE ON OPEN (Adrian, Jul 26: "it must look like it starts clean
  // on the page, without mumbling the last sentence"). The "permanent
  // history" hydration from Jul 24 USED to live here, filling the chat with the old conversation on EVERY
  // open — and it defeated the newer mechanism below (restore ONLY on
  // release refresh). It was removed: memory stays ACTIVE on the server
  // (the brain gets the history every turn, the voice too), only the screen
  // starts clean. The full history stays in Admin → Istoric chat.
  const [chatImage, setChatImage] = useState<string | null>(null)
  // THE DRAFT SURVIVES THE AUTO-UPDATE (Adrian, Aug 1): the new-version
  // countdown applies a hard reset by itself — what you were typing must NOT
  // die with it. The draft lives in localStorage (kept by the reset, like the
  // voiceprint) and comes back into the composer on boot; an emptied composer
  // clears it.
  const [input, setInput] = useState(() => {
    try {
      return localStorage.getItem('kelion.draft') ?? ''
    } catch {
      return ''
    }
  })
  useEffect(() => {
    try {
      if (input) localStorage.setItem('kelion.draft', input)
      else localStorage.removeItem('kelion.draft')
    } catch {
      /* storage unavailable — the draft just doesn't survive */
    }
  }, [input])
  // PRE-PREGĂTIREA CREIERULUI OFFLINE — complet AUTOMATĂ și complet INVIZIBILĂ
  // (ordinul owner-ului, 21 aug, „finalizare"). Condiții rămase: WebGPU + orice
  // conexiune la net (poarta de „doar țeavă bună" a fost SCOASĂ la ordin) + modelul
  // să lipsească/difere față de cel curent (analiza = sincronizeazaStareOffline).
  // Niciun element de interfață: bara StatusOffline a fost ștearsă. Idempotent.
  useEffect(() => {
    if (typeof window === 'undefined') return
    let anulat = false
    const id = window.setTimeout(() => {
      void (async () => {
        if (anulat) return
        const st = stareCreierLocal().stare
        if (st === 'gata' || st === 'se_pregateste' || st === 'fara_webgpu') return
        if (!(await webgpuDisponibil())) return
        // TESTEAZĂ ÎNTÂI dacă modelul e DEJA în cache (owner 20 aug: „de câte ori
        // pornești face auto download, nu testează versiunea"). Dacă e descărcat →
        // 'descarcat', și NU-l re-descărcăm și NU-l re-încărcăm în GPU la fiecare
        // pornire (economie de baterie/GPU cât ești online) — se încarcă din cache abia
        // când chiar pierzi semnalul (efectul de mai jos).
        await sincronizeazaStareOffline()
        if (anulat || stareCreierLocal().stare === 'descarcat') return
        // ORDINUL owner-ului (21 aug, „finalizare"): „se analizează automat dacă
        // versiunea locală are diferențe în minus față de cea care se downloadează;
        // dacă da, se auto-downloadează. Procesul se face AUTOMAT, nu se mai afișează
        // deloc." Analiza = sincronizarea de mai sus (model lipsă/diferit/parțial);
        // descărcarea pornește pe ORICE net (poarta de „doar țeavă bună" scoasă la
        // ordin), fără niciun element de interfață — bara StatusOffline a fost scoasă.
        if (!esteConectat()) return
        // Fără UI = fără frână umană: pe un dispozitiv blocat (quota plină), fiecare
        // pornire ar re-lua ~5,2 GB și ar pica iar. Contorul persistat de eșecuri
        // (creierLocal) oprește bucla: după 3 căderi, o singură re-încercare pe zi.
        if (!autoDescarcareaPermisa()) return
        void pregatesteModelOffline()
      })()
    }, 8000)
    return () => {
      anulat = true
      window.clearTimeout(id)
    }
  }, [])
  // FAZA 3 — RECONECTARE AUTOMATĂ: la trecerea offline→online (owner: „la găsirea
  // de semnal să se reconecteze automat, să-și trimită tot pe server… iar cererile
  // neonorate să le rezolve și să anunțe civilizat"), (1) trimitem pe server tot ce
  // s-a întâmplat offline (SYNC), (2) rezolvăm cererile AMÂNATE și le anunțăm pe
  // monitor. Netezim trecerea: contextul chatului e deja împărtășit (messages).
  const online = useConectat()
  const eraOnlineRef = useRef(online)
  // ÎNCĂRCARE LA OFFLINE: cât ești ONLINE nu ținem modelul în GPU (economie de
  // baterie/GPU); când treci OFFLINE și modelul e în cache ('descarcat'), îl încărcăm
  // DIN CACHE (fără rețea) → 'gata', ca să răspundă când pierzi semnalul. Fără date.
  useEffect(() => {
    if (online) return
    let viu = true
    void sincronizeazaStareOffline().then(() => {
      if (viu && stareCreierLocal().stare === 'descarcat') void pregatesteModelOffline()
    })
    return () => {
      viu = false
    }
  }, [online])
  useEffect(() => {
    const veneaDinOffline = online && !eraOnlineRef.current
    eraOnlineRef.current = online
    if (!veneaDinOffline) return
    void (async () => {
      const ture = citesteSync()
      if (ture.length) {
        try {
          const r = await fetch('/api/offline/sync', {
            method: 'POST',
            credentials: 'include',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ture }),
          })
          if (r.ok) golesteSync()
        } catch {
          /* rămâne în coadă → reîncercăm la următoarea revenire */
        }
      }
      const bucati: string[] = []
      for (const c of citesteAmanate()) {
        try {
          let raspuns = ''
          const ac = new AbortController()
          // onControl = no-op → aruncă cadrele de audio/suprafață; luăm DOAR textul.
          for await (const buc of streamChat(
            [{ role: 'user', content: c.intrebare, ts: c.t }],
            undefined,
            coordsRef.current ?? undefined,
            () => {},
            undefined,
            ac.signal,
          )) {
            raspuns += buc
          }
          if (raspuns.trim()) bucati.push(anuntAmanat(c.intrebare, raspuns, lang))
          stergeAmanata(c.id)
        } catch {
          /* rămâne amânată → reîncercăm data viitoare */
        }
      }
      if (bucati.length) {
        openWorkspaceDoc(strings(lang).raspunsAmanat, bucati.join('\n\n───\n\n'))
        // FAZA 4 — anunț pe telefon (best-effort; Android complet, iOS limitat), ca
        // omul să știe că i-am rezolvat cererea amânată chiar dacă app-ul e în fundal.
        void anuntaPeTelefon(strings(lang).raspunsAmanat, bucati[0])
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, lang])
  const [busy, setBusy] = useState(false)
  // ECOUL A CE TRANSMIT EU — ținut mai mult pe ecran (Adrian, 3 aug: „afișarea
  // foarte scurtă a ce transmit eu — triplat timpul de afișat pe interfață").
  // Banda 👤 cu textul meu dispărea în clipa în care sosea primul cuvânt al lui
  // Kelion (o sclipire sub o secundă cu creierul rapid). Acum textul meu rămâne
  // vizibil cel puțin USER_ECHO_HOLD_MS (~3× cât stătea), ca să pot să-l citesc.
  const [userEchoHold, setUserEchoHold] = useState(false)
  const userEchoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Microphone (input) — capture → server (STT) → brain. It is NOT "voice in front".
  const [listening, setListening] = useState(false)
  // VOICE VOLUME (Jul 25): the value persisted from audioIO, mirrored in the slider.
  const [voiceVol, setVoiceVolState] = useState(() => getVoiceVolume())
  // LIVE DICTATION: the current sentence, word by word, with a cinematic effect on
  // the ticker while Adrian speaks; it empties when the sentence leaves for the brain.
  const [liveVoice, setLiveVoice] = useState('')
  // BRAIN-INPUT TICKER (Adrian, Jul 10): the EXACT text handed
  // to the brain on the current turn — it comes from the SERVER ({heard}), not a local echo.
  const [heard, setHeard] = useState('')
  // Banda-teletext a rulat DEJA răspunsul ăsta? (Adrian, 8 aug: „repetă scris,
  // baleind mesajul la infinit" — orice re-montare a benzii repornea animația
  // one-shot, deci același text mătura ecranul iar și iar.) Ținem minte ts-ul
  // răspunsului deja baleiat: o trecere pe răspuns, apoi banda tace.
  const [tickerDoneTs, setTickerDoneTs] = useState<number | null>(null)
  // THE VISIBLE CONVERSATION (Aug 1): the chat log stays pinned to the newest
  // bubble — auto-scroll on every new message and on every streaming update.
  const chatLogRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = chatLogRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])
  // THE BAND GOES TO SLEEP WHEN IDLE (Adrian, Aug 1: "the sweeping stays on
  // screen"). The K band (the reply ticker) used to stay on screen FOREVER
  // after the reply. It still shows the flow live, but 12s after the turn ends
  // it lies down — the page breathes. Any new activity wakes it.
  const [idleBandHidden, setIdleBandHidden] = useState(false)
  // THE CALM SIGNAL for the auto-update countdown (lib/activity.ts): voice
  // session open / request in flight / draft in the composer — while any of
  // these is true, the countdown stands still so the reset never cuts work.
  useEffect(() => {
    reportActivity({ voice: listening, busy, draft: input.trim().length > 0 })
  }, [listening, busy, input])
  useEffect(() => () => reportActivity({ voice: false, busy: false, draft: false }), [])
  // The sleep timer for the K band: runs only when a turn just ENDED (not busy,
  // last word is the assistant's). New work resets it and wakes the band.
  useEffect(() => {
    const last = messages.at(-1)
    if (busy || !last || last.role !== 'assistant') {
      setIdleBandHidden(false)
      return
    }
    const id = window.setTimeout(() => setIdleBandHidden(true), 12_000)
    return () => window.clearTimeout(id)
  }, [busy, messages])
  // AVATARUL SE DĂ ÎN COLȚ LA O ANALIZĂ (Adrian, 12 aug: „mută avatarul… când se
  // afișează o analiză, că acoperă ce scrie"; alegerea lui: avatar în colț, mic).
  // Chatul (z-index 30) stă peste avatarul central; la un răspuns LUNG (o
  // analiză) se calcă. Semnalăm Stage-ul, care trece avatarul în colț (pip) doar
  // atât timp cât analiza e pe ecran; la un răspuns scurt / gol, revine central.
  useEffect(() => {
    const lastAssistant = messages.filter((m) => m.role === 'assistant').at(-1)
    const activ = (lastAssistant?.content?.trim().length ?? 0) > 320
    window.dispatchEvent(new CustomEvent('kelion:analiza-vizibila', { detail: { activ } }))
  }, [messages])
  // TICKER (fixed rule, Jul 10): the scroll duration scales with the text
  // length, so it stays readable — neither too fast, nor forever.
  const tickerDur = (s: string): string => `${Math.min(22, Math.max(3.5, s.length / 14))}s`
  // QUICK SUMMARY (Adrian, Jul 10: "if the pause outlasts the thinking, don't
  // leave a gap on the brain's line — a few-word summary, hold it until
  // the next one"). Extracted INSTANTLY from {heard} (the request already confirmed by
  // the server as handed to the brain) — zero latency, doesn't wait for the model.
  const synthesize = (s: string, maxWords = 8): string => {
    const words = s.trim().split(/\s+/).filter(Boolean)
    return words.length <= maxWords ? s.trim() : `${words.slice(0, maxWords).join(' ')}…`
  }
  const micRef = useRef<MicHandle | null>(null)
  // VOCE = OpenAI Realtime `cedar` — chat FULL-DUPLEX nativ cu escaladare, pe
  // cele 2 chei (Adrian, 24 iul: „chat fullduplex realtime cu escaladare").
  // Chirp would have required a 3rd Google key (no AIza key was ever given in
  // chat — verified). ONLY if Realtime fails (no key / WebRTC failure) we fall
  // back ONCE to STT→brain→TTS for the session (a fallback, not the rule).
  const realtimeOffRef = useRef(false)
  // FIX "chat full duplex doesn't exist" (Adrian, Jul 24): before, ANY error
  // Realtime (even a transient one — a 502, an ICE hop, a benign input-ended)
  // set `realtimeOffRef=true` PERMANENTLY for the whole session → full-duplex
  // died for good and fell silent onto half-duplex STT. Now we count failures:
  // we give full-duplex 3 chances before latching onto STT, and a successful
  // connection (`live`) resets the counter. This way a transient failure no longer kills the duplex.
  const realtimeFailCountRef = useRef(0)
  const REALTIME_MAX_FAILS = 3
  // AUTOMATIC RECOVERY (Jul 25 — the real cause of "the voice is robotic"): once latched
  // onto the TTS fallback (robotic), `realtimeOffRef` stayed true FOREVER in
  // that tab — even after the session was fixed on the server, the user heard
  // the robot until a HARD reload, which they had no way to know about. Now
  // the latch is time-based: after `REALTIME_RECOVER_MS` we retry the REAL voice, and
  // the failure counter resets — a fixed deploy recovers on its own.
  const realtimeOffAtRef = useRef(0)
  const REALTIME_RECOVER_MS = 90_000
  // THE ONE HONEST STATUS (Aug 2 — live data: 57 "voce realtime a picat" in
  // 24h and the human heard NOTHING, just silence): when BOTH mouths are down
  // (the Google probe failed AND the OpenAI reserve won't connect), the panel
  // says so ONCE in chat instead of looping silent retries. The latch → STT
  // dictation keeps the ears working; a later `live` re-arms the notice.
  const voiceDownAckedRef = useRef(false)
  // NO SEMI-DUPLEX ANYMORE (Aug 1 — one brain): the old escalation muted the
  // microphone while the heavy brain thought. The voice session no longer
  // thinks at all — the spoken turn goes through send() like a typed one, and
  // full-duplex never breaks: barge-in is handled by the normal send() logic.
  // Joins the VOX pieces cut at a thinking pause (not an end-of-sentence one)
  // into a single thought, before sending it to the brain. Rebuilt on every
  // (re)start of the microphone — see ensureMic below.
  // TURA VOCALĂ CURENTĂ (Adrian, 5 aug — voce unificată): fără transcript, o frază
  // vocală pleacă la creier ca AUDIO, cu o bulă-substituent „🎙️". Ținem ts-urile
  // bulei userului și ale răspunsului ca handleControl să le poată: (a) umple bula
  // userului cu ce a auzit creierul ({heard}), (b) le ȘTEARGĂ dacă nu i se vorbea
  // ({ignored}). Nul pe turele scrise.
  const voiceTurnRef = useRef<{ userTs: number; asstTs: number } | null>(null)
  // The voiceprint — restricts the permanent microphone to Adrian's
  // voice. Without a UI entry point, hasVoiceprint() stays false forever: the button
  // below is the only place where the profile can be enrolled/reset.
  const [voiceCalState, setVoiceCalState] = useState<'idle' | 'listening' | 'ok' | 'fail'>('idle')
  // Fix hydration: localStorage is client-only; read it after hydration.
  const [hasVoicePrint, setHasVoicePrint] = useState(false)
  useEffect(() => {
    setHasVoicePrint(hasVoiceprint())
  }, [])
  // Messages typed during an active turn — visible, not lost in a queue.
  const [queued, setQueued] = useState<string[]>([])
  // Adrian, Jul 11: "the camera didn't start [after restart] — that's wrong" → the camera
  // starts BY DEFAULT on every load; the button remains for turning it off.
  const [cameraOn, setCameraOn] = useState(true)
  const [facing, setFacing] = useState<Facing>('user')
  const [menuOpen, setMenuOpen] = useState(false)
  // Attached images (ChatGPT-style composer). Sent to the brain's vision on send.
  // Attachments are images (url = data URL, used for vision), documents
  // (text = the Markdown extracted by MarkItDown, prepended to the message),
  // or — for the ADMIN — ANY raw file (url = data URL, type set): photos,
  // texts, archives, video, everything rides the bridge to the developer.
  const [attachments, setAttachments] = useState<
    { id: string; url: string; name: string; text?: string; type?: string }[]
  >([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  // The typing field: a single click anywhere in the bar focuses it (the input's real
  // area is narrow, and a click "next to" the text didn't grab focus — it took
  // several clicks). The ref is targeted by the handler on the composer row.
  const composerInputRef = useRef<HTMLTextAreaElement>(null)
  // ── ZGOMOTUL OPREȘTE TASTAREA (owner, 23 aug 2026: „orice zgomot îți alterează
  //    posibilitatea de a scrie") — cât timp userul scrie activ în composer,
  //    microfonul se MUTĂ ca să nu mai intercepteze sunete de tastatură care
  //    ar porni VOX/barge-in și ar tăia scrierea. La oprirea tastării (1.5s
  //    fără tastă) sau pierderea focusului, microfonul revine automat.
  //    NU folosește micManualOffRef (aia e pentru oprire manuală permanentă) —
  //    e un ref separat, temporar, care nu interacționează cu logica de recover.
  const tastareActivaRef = useRef(false)
  const tastareDebounceRef = useRef<number | null>(null)
  // AUTO-CREȘTERE a câmpului de scris (owner, 20 aug: „tabul de scris nu permite
  // să scrii mesajul întreg"). Era un <input> pe o linie — Enter trimitea, deci
  // NU se putea compune un mesaj lung/pe mai multe rânduri ca să supervizezi
  // ordinele lui Kelion. Acum e <textarea> care crește cu textul (până la un plafon,
  // apoi scroll). Se reîntinde și la golirea programatică (după trimitere).
  useEffect(() => {
    const el = composerInputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`
  }, [input])
  // LA PORNIRE CÂMPUL E GOL — GARANTAT (owner, 22 aug, măsurat pe captură:
  // „Cel iarl, ceva ce?" pre-scris la pornire; „trebuie gol"). În aplicație
  // NIMIC nu umple câmpul (singurele setInput ne-onChange sunt goliri —
  // măsurat), deci textul vine scris DIRECT în DOM, pe lângă React:
  // restaurarea de formulare a browserului la reluarea tabului nu emite
  // niciun eveniment (React nu află), la fel un autofill. Nu pot verifica
  // browserul omului de aici — de-asta gardul e MECANIC, indiferent de sursă:
  // golim la montare și mai măturăm de două ori după fereastra de restaurare.
  // Cheia siguranței: starea React goală + DOM plin = textul N-A venit de la
  // om (tastarea trece prin onChange → stare), deci se aruncă fără riscul de
  // a șterge ce scrie omul chiar acum.
  const inputViuRef = useRef('')
  useEffect(() => {
    inputViuRef.current = input
  }, [input])
  useEffect(() => {
    const matura = (): void => {
      const el = composerInputRef.current
      if (el && el.value && !inputViuRef.current) el.value = ''
    }
    matura()
    const t1 = window.setTimeout(matura, 400)
    const t2 = window.setTimeout(matura, 2000)
    return () => {
      window.clearTimeout(t1)
      window.clearTimeout(t2)
    }
  }, [])
  // Admin promo-scenario recorder: type steps, hit Record, Kelion runs them while
  // the screen + voice are recorded, then it saves an MP4 to Downloads.
  const [scenarioOpen, setScenarioOpen] = useState(false)
  const [scenarioText, setScenarioText] = useState('')
  const [scenarioRunning, setScenarioRunning] = useState(false)
  const scenarioRunningRef = useRef(false)
  scenarioRunningRef.current = scenarioRunning
  const scenarioRecRef = useRef<RecordingHandle | null>(null)

  const menuRef = useRef<HTMLDivElement>(null)
  const captureRef = useRef<(() => string | null) | null>(null)
  const latestFrameRef = useRef<string | null>(null)
  // The last 4 frames (Adrian, Jul 11: "the camera doesn't capture 4 frames per second
  // + Kelion's audit: "it sends a single frame instead of four — vision
  // isn't continuous"). Circular buffer; on every turn ALL 4 leave.
  const frameBufRef = useRef<string[]>([])
  const coordsRef = useRef<Coords | null>(null)
  // Precizia MĂSURATĂ a fixului GPS (±metri, de la senzor) — merge împreună cu
  // coordonatele în sesiunea vocală, ca modelul să știe cât de bun e locul.
  const precizieRef = useRef<number | null>(null)
  // VITEZA de deplasare (m/s din `coords.speed`) — merge și OFFLINE, o folosește
  // creierul local ca să fie uman (faza 2, owner: „la 2 va putea spune viteza?").
  // null = senzorul n-a dat-o (nu inventăm). Ultima poziție+timp pentru fallback.
  const vitezaRef = useRef<number | null>(null)
  const ultimaPozRef = useRef<{ lat: number; lon: number; t: number } | null>(null)
  // The LIVE voice session (if any) — used by the location tools to
  // refresh its position exactly when needed (updateCoords, on demand).
  const rvLiveRef = useRef<RealtimeVoiceHandle | null>(null)
  // A SUNAT CEVA pe tura curentă? (owner 20 aug: „chatul audio inexistent"). Se
  // ridică true când gura reală rostește ceva — vocea live (mouth.speak) SAU Chirp-ul
  // de pe server (c.audio → playVoice). Dacă la finalul unei ture SCRISE rămâne false,
  // răspunsul n-a fost auzit de nimeni → intră gura de siguranță (vocea browserului).
  const aSunatTuraRef = useRef(false)
  // Tura curentă a produs VREUN semn vizibil (cadru de control: monitor, hartă,
  // document, gest, tab…)? Resetat la începutul turei, ridicat în handleControl.
  // La final: text gol + zero semne + zero sunet = tăcere TOTALĂ → rând onest
  // (registrul frontend, lot C — înainte tura dispărea fără nicio urmă).
  const turaAvutSemneRef = useRef(false)
  // VOCEA LIVE FULL-DUPLEX (7 aug) — din 8 aug seara e calea IMPLICITĂ (ownerul:
  // „asta nu e chat live, e semiduplex... pui [modelul live] în locul acestuia").
  // `localStorage.kelion_voce_live = '0'` repune calea clasică, fără deploy.
  // Rămâne SAU una, SAU alta — două voci în același timp = numărat dublu (#894).
  const vlRef = useRef<VocalLiveHandle | null>(null)
  // Fiecare pornire/oprire live primește o generație. Callback-urile async ale
  // unei sesiuni înlocuite nu mai pot curăța, reporni sau modifica sesiunea nouă.
  const vlGeneratieRef = useRef(0)
  const VL_MAX_RELUARI = 3
  const VL_REARMARE_STABILA_MS = 30_000
  // NIVELUL DE INTRARE AL URECHII LIVE (owner, 16 aug: „vreau sa vad un mic
  // bargraf… sa se identifice daca nu se truncheaza nimic"). Măsurat în vocalLive
  // pe fiecare cadru trimis modelului; ținut într-un ref (nu state) ca bargraful
  // să-l citească prin rAF fără să re-randeze tot chatul.
  const micNivelRef = useRef<NivelIntrare>({ nivel: 0, pic: 0, poarta: false, clip: false })
  // PREAMP MICROFON (owner, 16 aug: „reglaj preamp de la minim la maxim… ce faci
  // daca e surd?"). Factorul de amplificare, persistat în localStorage, aplicat
  // pe calea live prin handle.setPreamp; sliderul de sub bargraf îl schimbă viu.
  const [preampNivel, setPreampNivel] = useState<number>(() => {
    const v = Number(localStorage.getItem('kelion_preamp'))
    return Number.isFinite(v) && v > 0 ? Math.min(12, Math.max(0.5, v)) : 1
  })
  // Contorul de minute al sesiunii live + steagul „live a căzut de tot în tabul
  // ăsta" (după 3 reluări picate se coboară pe calea veche și nu se mai insistă
  // până la un refresh — altfel am pendula între cele două căi la nesfârșit).
  const vlTickRef = useRef<number | null>(null)
  const vlCazutRef = useRef(false)
  /** Sonda de ÎNTOARCERE pe live după o cădere (restart de publicare = 1006):
   *  bate capabilitatea la 5s și, când serverul revine, repune vocea live. */
  const vlSondaRef = useRef<number | null>(null)
  const busyRef = useRef(busy)
  busyRef.current = busy
  // The abort controller of the current turn — "stop" aborts it on the spot.
  const abortRef = useRef<AbortController | null>(null)
  // GUEST SPEAKER (Adrian, Aug 1): set by the voice gate right before a spoken
  // turn — "guest:<id>:<name> (<relation>)" / "guest-pending:...". It rides
  // with exactly ONE send() (the turn it belongs to), then clears.
  const pendingSpeakerRef = useRef<string | null>(null)
  // AUDIO NATIV → CREIER (Adrian, 3 aug): vocea BRUTĂ a frazei vocale curente,
  // pusă de onAddressed și citită de send(), ca să ajungă la creierul care aude.
  const pendingAudioRef = useRef<string | null>(null)
  // Synchronous guard against overlapping turns. `busy` state lags a render, so
  // two voice utterances firing in the same tick could both start a stream and
  // fragment the reply ("chat starts from several parts"). This ref locks now.
  const inFlightRef = useRef(false)
  // Messages typed WHILE a turn is still streaming. They are queued here
  // instead of being dropped by the in-flight guard (that silent drop is how
  // written messages "never arrived"), and sent as one turn when it finishes.
  const pendingSendsRef = useRef<string[]>([])
  // Approved promo script + shot list waiting for the recording to start, and
  // the scheduled scene timers (cleared when the recording stops).
  const promoRef = useRef<{
    subject: string
    duration: number
    script: string
    lang?: string | null
    scenes?: { at: number; title: string; url?: string; close?: boolean }[]
  } | null>(null)
  const promoTimersRef = useRef<number[]>([])
  // A promo TAKE in progress: the owner can cut it mid-take by typing a
  // TAKE_STOP word. lastPromoRef keeps the approved take so "reluăm" re-arms
  // the SAME script + scenes without redoing the approval.
  const takeActiveRef = useRef(false)
  const lastPromoRef = useRef<typeof promoRef.current>(null)
  // True after a turn failed because the connection dropped — used to resume once
  // the browser regains connectivity. retryTextRef holds the message to re-send.
  const offlineRef = useRef(false)
  const retryTextRef = useRef<string | null>(null)
  // Timestamp-urile bulelor turei picate offline (eroarea + bula user) — ca la
  // revenirea online să ștergem EXACT bulele alea, nu orbește „ultimele două"
  // (registrul frontend, lot C: între cădere și revenire pot intra alte bule —
  // transcript vocal, {ignored}, altă întrebare — și slice(0,-2) le rupea pe alea).
  // Bula user pe TS, nu pe conținut: la turele cu documente conținutul bulei
  // (docBlock+msg) diferă de textul reluat (agentul lotului C, marginea 1).
  const retryEroareTsRef = useRef<number | null>(null)
  const retryUserTsRef = useRef<number | null>(null)
  // THE HONEST CONNECTION VERDICT (Adrian, 2 aug: „raportează fals că pierde
  // conexiunea la net"). 'server_down' resumes on a health poll (the browser's
  // 'online' event never fires — the net was never down); 'transient' gets ONE
  // silent retry (nothing broke from the human's point of view).
  const healthPollRef = useRef<number | null>(null)
  const transientRetryRef = useRef(false)
  const cameraOnRef = useRef(cameraOn)
  cameraOnRef.current = cameraOn
  const speechLangRef = useRef(speechLang)
  speechLangRef.current = speechLang

  // Kelion drives the monitor himself (no manual button): a control frame from
  // the stream opens/clears the workspace surface behind the avatar.
  function handleControl(c: ChatControl): void {
    // Delivery receipt: the server's first frame arrived — the message got there.
    // (No separate UI: the user text already shows ONCE in the single band below.)
    if (c.receipt) return
    // Un cadru REAL (suprafață/gest/sunet/ignored) = tura a produs ceva → rândul
    // onest de „tură complet goală" nu mai are motiv. Cadrele PUR-PROTOCOL
    // ({heard}/{lang}/{ping}) NU contează — oglinda taxonomiei serverului
    // (chat.ts backend: „PURE-protocol frames do NOT count"). Fără excluderea
    // asta, {heard} (trimis pe FIECARE tură ne-ambientală) ridica flag-ul mereu
    // și rândul onest era literă moartă fix pe cazul lui (verificatorul C).
    if (c.heard === undefined && c.lang === undefined && c.ping === undefined) turaAvutSemneRef.current = true
    // MODUL MAȘINĂ — GARDA DE SUPRIMARE SCOASĂ (Adrian, 13 aug: „când spune orice,
    // trebuie să fie executat acel orice"). Aici stătea plasa care, la volan, arunca
    // ORICE frame de suprafață vizuală (monitor/hartă/document/card/imagine/tab) deși
    // creierul spunea că a deschis-o — exact ruptura „vorbă fără faptă" pe care
    // ownerul a cerut-o scoasă. Acum toate frame-urile se execută la fel ca în modul
    // normal; car mode rămâne doar UI voce-first (răspuns scurt). Vorbă = faptă.
    // GESTURE ON COMMAND (Adrian, Jul 11: "commanded movements for everything I want him
    // to do"): the brain put [GEST name] in the reply → the server turned it
    // into the {gest} frame → the movement direction (AvatarModel) plays the clip once.
    if (c.gest) {
      window.dispatchEvent(new CustomEvent('kelion-gesture', { detail: c.gest }))
      return
    }
    // The server-side tool's {gesture} frame — translated into the equivalent clip.
    if (c.gesture) {
      if (GESTURE_TO_CLIP[c.gesture]) {
        window.dispatchEvent(new CustomEvent('kelion-gesture', { detail: GESTURE_TO_CLIP[c.gesture] }))
      } else {
        // UNKNOWN NAME ≠ SILENCE (audit Aug 2): the brain called a gesture the
        // map doesn't know and the avatar just stood still, no trace anywhere.
        // console.error reaches the server through F12 reporting — the gap
        // becomes visible instead of looking like a dead gesture engine.
        console.error('gest necunoscut de la server (lipsește din GESTURE_TO_CLIP):', c.gesture)
      }
      return
    }
    // Kelion opens the app's tabs from the WRITTEN chat (open_app_view →
    // {nav} frame); Stage listens to kelion:navigate and enforces the admin gate.
    if (c.nav?.view) {
      window.dispatchEvent(new CustomEvent('kelion:navigate', { detail: c.nav }))
      return
    }
    // P32: scenariul pregătit de Studio se ține minte (localStorage) — butonul
    // 🎬 din meniul Aplicații îl preia AUTOMAT la apăsare, plus „Copiază".
    if (c.scenariu?.text) {
      try {
        localStorage.setItem('kelion_scenariu', JSON.stringify({ ...c.scenariu, la: Date.now() }))
      } catch {
        /* stocarea plină nu rupe chatul */
      }
      window.dispatchEvent(new CustomEvent('kelion:scenariu', { detail: c.scenariu }))
      return
    }
    // MESSENGER: creierul a pornit un apel („apelează-l pe X") → ridicăm la APELANT
    // ecranul „sun pe…". Stage ascultă și arată interfața de apel (merge și la volan).
    if (c.apel) {
      window.dispatchEvent(new CustomEvent('kelion:apel-stare', { detail: c.apel }))
      return
    }
    // VOCE UNIFICATĂ: creierul a decis că NU i se vorbea → răspunsul gol și
    // substituentul „🎙️…" pleacă, nimic nu se redă (Adrian: „să nu vorbească
    // neîntrebat") — dar bula CONFIRMATĂ de {heard} rămâne (vezi mai jos).
    if (c.ignored) {
      // NU SE MAI ARUNCĂ CE S-A AUZIT (Adrian, 8 aug: „nu ignora ce aude când
      // nu apare Kelion"). Înainte, tura stinsă ștergea AMBELE bule — ce ai
      // spus dispărea fără urmă, iar „m-a auzit și a tăcut" arăta identic cu
      // „nu m-a auzit deloc". Acum: răspunsul gol pleacă, dar bula ta RĂMÂNE
      // dacă serverul a confirmat ce a auzit ({heard} vine înaintea {ignored});
      // fără marcaj special — simpla prezență a bulei fără răspuns SPUNE că a
      // fost auzită și tura s-a stins. Se șterge doar substituentul fără text.
      const vt = voiceTurnRef.current
      voiceTurnRef.current = null
      stopVoice()
      if (vt)
        setMessages((prev) =>
          prev
            .filter((m) => m.ts !== vt.asstTs)
            .flatMap((m) => {
              if (m.ts !== vt.userTs) return [m]
              // REGISTRUL, LOT C — codul contrazicea comentariul de mai sus (și
              // ordinul owner-ului din 8 aug): bula userului se ștergea MEREU,
              // inclusiv când {heard} o umpluse deja cu transcriptul confirmat —
              // „m-a auzit și a tăcut" arăta identic cu „nu m-a auzit deloc".
              // Acum: bula CONFIRMATĂ (text real, nu substituentul 🎙️) RĂMÂNE;
              // se șterge doar substituentul fără text.
              const confirmata = m.content.trim() && !m.content.startsWith('🎙')
              return confirmata ? [m] : []
            }),
        )
      return
    }
    // The brain-input ticker: the server says EXACTLY what text it hands
    // to the brain — shown on the dedicated ticker until the next turn.
    if (c.heard !== undefined) {
      setHeard(c.heard)
      // VOCE: creierul a confirmat ce a auzit → umplem bula-substituent a userului
      // cu transcriptul PRECIS (din voce, nu dintr-un STT stâlcit).
      const vt = voiceTurnRef.current
      if (vt && c.heard) {
        const auzit = c.heard
        setMessages((prev) => prev.map((m) => (m.ts === vt.userTs ? { ...m, content: auzit } : m)))
      }
      return
    }
    // THE BRAIN'S VOICE: MP3 pre-synthesized on the server (Chirp 3) — we ONLY play it.
    // While it speaks, the microphone doesn't send (anti-echo), but stays on watch:
    // vocea lui Adrian taie redarea pe loc (barge-in, vezi ensureMic).
    if (c.audio) {
      // O TURĂ = O SINGURĂ GURĂ. CORECȚIE (owner 20 aug „nu ajunge audio unde trebuie" pe
      // VOCE + agent): Gemini Live (vlRef) NU rostește răspunsul serverului nici pe voce
      // (n-are speak(text)). Deci Chirp (c.audio) e singura gură — ȘI scris ȘI voce. Vechea
      // gardă îl tăcea pe voce → TĂCERE. Realtime OpenAI (isRealtime) chiar rostește textul → refuzăm Chirp.
      const _isRealtime = (micRef.current as unknown as { isRealtime?: boolean } | null)?.isRealtime === true
      // eslint-disable-next-line no-console
      console.log(`[audio] c.audio primit: ${c.audio.length} chars | isRealtime=${_isRealtime} | vlRef=${!!vlRef.current} | micRef=${!!micRef.current}`)
      if (_isRealtime) return
      // SCRISUL S-A ÎNTORS PE /api/chat (owner, 22 aug — MĂSURAT LIVE: cererea
      // scrisă nu se executa, nu se afișa, nu se auzea cât Live era viu dar
      // mut). Vechea gardă „cât LIVE e viu, Chirp tace" avea sens doar cât
      // turele scrise mergeau PRIN Live; acum răspunsul scris vine pe c.audio,
      // deci Chirp E gura lui — inclusiv cu sesiunea Live vie. VOCEA UNICĂ nu
      // se pierde: requestTtsFocus({turaScrisa:true}) ÎNTRERUPE redarea Live
      // înainte să sune Chirp (mecanismul existent), iar anti-ecoul de mai jos
      // (setRedareExterna) mută urechea sesiunii Live cât redă Chirp — de azi
      // iar mecanism VIU, nu no-op defensiv. Turele VOCALE rămân în sesiunea
      // Live, cu vocea modelului — neatinse.
      const _focusOk = requestTtsFocus({ turaScrisa: true })
      // eslint-disable-next-line no-console
      console.log(`[audio] requestTtsFocus(turaScrisa): ${_focusOk}`)
      if (!_focusOk) return
      contorGata('primul sunet (gura a pornit)')
      aSunatTuraRef.current = true // Chirp-ul de pe server a sunat → gura de siguranță NU mai intră
      playVoice(
        c.audio,
        // Cât redă Chirp-ul, mutăm urechile (anti-ecou): microfonul clasic
        // (setMuted) ȘI urechea sesiunii Live (setRedareExterna) — din 22 aug
        // ramura se atinge și cu Live VIU (răspunsul scris sună pe Chirp),
        // deci apelul pe vlRef e iar mecanismul viu, nu no-op defensiv.
        () => { micRef.current?.setMuted(true); vlRef.current?.setRedareExterna(true) },
        () => {
          micRef.current?.setMuted(false)
          vlRef.current?.setRedareExterna(false)
          releaseTtsFocus()
        },
      )
      return
    }
    // A SERVER-interpreted device command (the camera/monitor regexes moved off
    // the browser): just execute it. Any spoken ack arrives as normal text.
    if (c.device) {
      const cam = c.device.camera
      if (cam === 'off') setCameraOn(false)
      else if (cam === 'back') {
        setFacing('environment')
        setCameraOn(true)
      } else if (cam === 'front') {
        setFacing('user')
        setCameraOn(true)
      } else if (cam === 'switch') switchCamera()
      else if (cam === 'on') setCameraOn(true)
      const scr = c.device.screen
      if (scr?.op === 'closeAll') closeAllTasks()
      else if (scr?.op === 'close') closeWorkspace()
      else if (scr?.op === 'closeKind' && scr.kind) closeTasksByKind(scr.kind)
      else if (scr?.op === 'switchKind' && scr.kind) switchToKind(scr.kind)
      return
    }
    // The server committed a speech-language switch (detected + persisted
    // there): apply it to the recognizer and mirror it locally.
    if (c.lang) {
      applyLang(c.lang)
      return
    }
    if (c.paywall) {
      window.dispatchEvent(new Event('kelion:paywall'))
      return
    }
    // Promo pipeline: the APPROVED script arrived — remember it and arm the Rec
    // button with a suggestive file name; the script is performed (spoken) the
    // moment the recording actually starts (see the rec-started listener).
    if (c.promo?.script) armPromo(c.promo)
    if (c.image?.url) setChatImage(c.image.url)
    if (c.doc && c.doc.text.trim()) {
      openWorkspaceDoc(c.doc.title || t.monitorTitle, c.doc.text)
      return
    }
    // PLAYGROUND: the page written by Kelion runs live on the monitor (sandboxed frame).
    if (c.app && c.app.html.trim()) {
      openWorkspaceApp(c.app.title || t.monitorTitle, c.app.html)
      return
    }
    // EXECUȚIA PAS CU PAS (owner, 14 aug: „să arate fiecare pas pe monitor…
    // cu bara de evoluție de la 0 la 100%"): fiecare frame {executie} intră în
    // starea vie și ține suprafața 'executie' deschisă pe monitor. Frame-ul
    // final (gata) doar închide bara la 100% — nu redeschide tabul dacă omul
    // l-a închis între timp.
    if (c.executie) {
      // Tabul se deschide DOAR la ÎNCEPUTUL unei ture de execuție — nu la
      // fiecare pas (bug 14 aug, captura ownerului: fiecare frame re-activa
      // „Execuție în direct", iar cu microfonul mereu pornit turele curg
      // întruna → tabul fura click-urile de pe celelalte taburi — „nu se
      // poate trece din tab în tab, sau închide individual"). Conținutul
      // suprafeței se hrănește ORICUM din starea vie (getStareExecutie),
      // nu din re-deschidere — deci nimic nu se pierde.
      const inainte = getStareExecutie()
      adaugaPasExecutie(c.executie.pas ?? '', c.executie.procent ?? 0, c.executie.gata === true)
      if (!c.executie.gata && (inainte === null || inainte.gata)) openWorkspaceExecutie(t.execTitle)
      return
    }
    // PANOUL CONSTRUCTORULUI (Etapa 4b): Kelion a preluat un ordin de build →
    // opens the live display on the monitor (Preluat→pas→Gata/Eșuat stages).
    if (c.build?.open) {
      openWorkspaceBuild(c.build.title || 'Constructor')
      return
    }
    if (c.card && c.card.items.length > 0) {
      openWorkspaceCard(c.card.title, c.card)
      return
    }
    if (c.golesteMonitor) {
      // „Golește monitorul" = golește TOT ce e afișat, nu doar tabul activ
      // (bug 11 aug, ownerul: „golirea ecran la cerere user nu funcționează" —
      // cu 2 taburi, closeWorkspace închidea doar unul). closeAllTasks curăță
      // toate suprafețele; imaginea generată din chat se șterge și ea.
      closeAllTasks()
      setChatImage(null)
      return
    }
    if (c.clickMonitor) {
      const { x, y } = c.clickMonitor;
      const el = document.elementFromPoint(x, y);
      if (el) {
        (el as HTMLElement).click();
        el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
        el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
      }
      return
    }
    if (c.zoomMonitor) {
      const { level, direction } = c.zoomMonitor;
      const scale = direction === 'out' ? 1 / (level || 1.2) : (level || 1.2);
      const cadru = document.querySelector<HTMLIFrameElement>('iframe.workspace-frame') || document.body;
      if (cadru) {
        const currentStyle = cadru.style.transform || 'scale(1)';
        const match = currentStyle.match(/scale\(([^)]+)\)/);
        let currentScale = 1;
        if (match) {
          currentScale = parseFloat(match[1]);
        }
        const newScale = currentScale * scale;
        cadru.style.transform = `scale(${newScale})`;
        cadru.style.transformOrigin = 'top left';
      }
      return
    }
    // Nivelurile din răspunsul chatului REAL pleacă în iframe-ul Centrului de
    // Tranzacționare — pagina le desenează pe grafic (10 aug, „conștient").
    if (c.niveluri) {
      const cadru = document.querySelector<HTMLIFrameElement>('iframe.workspace-frame')
      cadru?.contentWindow?.postMessage({ kelion: 'niveluri', date: c.niveluri }, window.location.origin)
    }
    // POINTERII DE INDICAȚIE (10 aug): la fel ca nivelurile, dar cu vorbele lui
    // Kelion + săgeată, fix pe preț — „când explică, arată clar pe monitor ce zice".
    if (c.semne) {
      const cadru = document.querySelector<HTMLIFrameElement>('iframe.workspace-frame')
      cadru?.contentWindow?.postMessage({ kelion: 'semne', date: c.semne }, window.location.origin)
    }
    if (!c.monitor) return
    if (c.monitor.url) openWorkspace(c.monitor.title || t.monitorTitle, c.monitor.url)
    else closeWorkspace()
  }

  // Short on-screen acknowledgement for a local command (camera, etc.).
  function ack(text: string): void {
    setMessages((cur) => [...cur, { role: 'assistant', content: text, ts: Date.now() }])
    suggestFacial(text)
  }

  // The face micro-expression, GENTLEMAN style (Adrian, Jul 12: "the mug of a rascal,
  // not a gentleman"). A gentleman is COMPOSED: the face stays neutral BY DEFAULT; an expression
  // appears RARELY and ONLY at a real, clear feeling — never reactive to
  // every punctuation mark (amazement at every "!", an eyebrow at every
  // "?" — that looked agitated). No default expression: the face's silence is dignified.
  function suggestFacial(text: string): void {
    const s = text.trim()
    if (!s) return
    // Warm, sincere gratitude → a restrained smile.
    if (/\b(mul[țt]umesc|[îi][țt]i mul[țt]umesc|thank you|apreciez|bravo|felicit)\b/i.test(s))
      return pushFacial('warmth')
    // Genuine regret/empathy → a soft expression.
    if (/\b([îi]mi pare r[ăa]u|regret|condolean|din p[ăa]cate|sympath|my condolences)\b/i.test(s))
      return pushFacial('empathy')
    // Otherwise: NO expression — a composed, neutral, dignified face. (Body gestures
    // and broader expressions come ONLY on the brain's command via [GEST], rarely.)
  }

  // The conversation SURVIVES a RELEASE refresh — and ONLY that. The release
  // auto-reload (and the update bar) set a one-shot sessionStorage flag right
  // before reloading; when we mount WITH the flag we restore the saved history
  // so mid-conversation releases stay seamless. Any other arrival — login, new
  // tab, manual refresh — starts with a CLEAN page: Kelion still remembers
  // everything server-side, but old messages never litter a fresh session.
  useEffect(() => {
    if (sessionStorage.getItem('kelion_restore_chat') !== '1') return
    sessionStorage.removeItem('kelion_restore_chat')
    void fetch('/api/chat/history', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : { history: [] }))
      .then((j: { history?: { role?: string; content?: string }[] }) => {
        const h = (j.history ?? [])
          .filter(
            (m): m is { role: 'user' | 'assistant'; content: string } =>
              (m.role === 'user' || m.role === 'assistant') &&
              typeof m.content === 'string' &&
              m.content.trim() !== '',
          )
          // PROTOCOL GARBAGE (Aug 1: „id: 15\ndata: …" bubbles on screen) — raw
          // transport fragments saved into history by the old voice path. They
          // are not conversation; they never reach the screen again.
          .filter((m) => !/^(id:\s*\d+|data:)\s/m.test(m.content))
          .map((m) => ({ role: m.role, content: m.content }))
          // Collapse repeated error echoes (the same technical-problem line
          // stacked 3× while the chat was down) — one is enough.
          .filter((m, i, a) => i === 0 || m.content !== a[i - 1].content)
        if (h.length > 0) setMessages((cur) => (cur.length === 0 ? h : cur))
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Arm the recorder for an approved promo take (also used by "reluăm" to redo
  // the same take): remember the script + scenes and light up the Rec button
  // with a suggestive clip name.
  function armPromo(p: NonNullable<typeof promoRef.current>): void {
    promoRef.current = p
    const slug = p.subject
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
    const date = new Date().toISOString().slice(0, 10).replaceAll('-', '')
    window.dispatchEvent(
      new CustomEvent('kelion:rec', {
        detail: { action: 'arm', name: `kelionai-${slug || 'promo'}-${p.duration}s-${date}` },
      }),
    )
  }

  // The recording actually started (the owner clicked and picked the screen):
  // PERFORM the clip. The script panel closes (the clip never shows the text)
  // and the shot-list scenes appear on the monitor at their times.
  useEffect(() => {
    const onStarted = (): void => {
      const p = promoRef.current
      if (!p) return
      promoRef.current = null
      lastPromoRef.current = p // kept so "reluăm" can redo this exact take
      takeActiveRef.current = true
      closeAllTasks() // the script panel is done — clean frame for the clip
      // THE CLIP'S VOICE (QA Jul 24: the approved script was NEVER spoken during
      // recording — the clip came out mute). We synthesize the script with the single voice
      // (via /api/tts) and play it over the rolling scenes.
      // IN CHUNKS (Jul 25): /api/tts cuts at its character cap — a 5-10 minute
      // clip lost its voice halfway through. THE CAP IS THE SERVER'S (audit
      // Aug 2): /api/tts/status publishes `maxChars`; before, a second 3500
      // lived here and the two could drift apart silently. Fallback 3500 only
      // if the probe fails. A failed chunk is retried ONCE, and if it still
      // fails the owner hears it DURING the take (audit Aug 2: the rec kept
      // rolling and the silent hole was only discovered at playback).
      void (async () => {
        let cap = 3500
        try {
          const s = await fetch('/api/tts/status', { credentials: 'include', cache: 'no-store' })
          if (s.ok) {
            const j = (await s.json()) as { maxChars?: number }
            if (typeof j.maxChars === 'number' && j.maxChars >= 500) cap = j.maxChars
          }
        } catch {
          /* probe down — the conservative fallback stands */
        }
        const chunks: string[] = []
        let cur = ''
        for (const sentence of p.script.split(/(?<=[.!?…])\s+/)) {
          if (cur && cur.length + sentence.length + 1 > cap) {
            chunks.push(cur)
            cur = sentence
          } else {
            cur = cur ? `${cur} ${sentence}` : sentence
          }
        }
        if (cur) chunks.push(cur)
        // A single monster sentence longer than the cap would have been sent
        // whole and truncated server-side mid-word — hard-split it instead.
        const bounded = chunks.flatMap((c) => {
          const parts: string[] = []
          for (let i = 0; i < c.length; i += cap) parts.push(c.slice(i, i + cap))
          return parts
        })
        let lost = 0
        for (const chunk of bounded) {
          let spoken = false
          for (let attempt = 0; attempt < 2 && !spoken; attempt++) {
            try {
              const r = await fetch('/api/tts', {
                method: 'POST',
                credentials: 'include',
                headers: { 'content-type': 'application/json' },
                // The language is the SCRIPT's; without one, the CURRENT speech
                // language — never a hardcoded locale (the old 'ro-RO' fallback
                // narrated an English script with the Romanian voice).
                body: JSON.stringify({ text: chunk, lang: p.lang ?? speechLangRef.current }),
              })
              if (!r.ok) continue
              const buf = await r.arrayBuffer()
              let bin = ''
              const bytes = new Uint8Array(buf)
              for (let i = 0; i < bytes.length; i += 0x8000)
                bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
              playVoice(btoa(bin))
              spoken = true
            } catch {
              /* retried once above; counted honestly below */
            }
          }
          if (!spoken) lost++
        }
        // The take is live and unrepeatable — if pieces of the narration died,
        // the owner finds out NOW and can cut the take, not at playback.
        if (lost > 0) ack(t.promoVoiceLost)
      })()
      for (const s of p.scenes ?? []) {
        promoTimersRef.current.push(
          window.setTimeout(() => {
            if (s.close || !s.url) closeAllTasks()
            else openWorkspace(s.title, s.url)
          }, 900 + s.at * 1000),
        )
      }
    }
    // Recording stopped (typed cut, Chrome's stop bar, or natural end): kill the
    // pending scenes, clear the stage, and offer the retake.
    const onStopped = (): void => {
      const wasTake = takeActiveRef.current
      takeActiveRef.current = false
      for (const id of promoTimersRef.current) window.clearTimeout(id)
      promoTimersRef.current = []
      if (wasTake) {
        closeAllTasks()
        window.setTimeout(() => ack(t.promoTakeSaved), 600)
      }
    }
    window.addEventListener('kelion:rec-started', onStarted)
    window.addEventListener('kelion:rec-stopped', onStopped)
    return () => {
      window.removeEventListener('kelion:rec-started', onStarted)
      window.removeEventListener('kelion:rec-stopped', onStopped)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── File attachment (ChatGPT-style) ──
  function openFilePicker(): void {
    setMenuOpen(false)
    fileInputRef.current?.click()
  }
  function addImageFiles(files: File[]): void {
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue
      const reader = new FileReader()
      reader.onload = () =>
        setAttachments((cur) => [
          ...cur,
          {
            id: `${Date.now()}-${file.name || 'pasted'}-${cur.length}`,
            url: String(reader.result),
            name: file.name || 'pasted-image.png',
          },
        ])
      reader.readAsDataURL(file)
    }
  }
  // Documents (PDF / Word / Excel / PowerPoint / …) are converted to Markdown by
  // the backend (MarkItDown) and attached as text so Kelion can read them.
  // HONESTY REWRITE (frontend audit, Aug 2). Two lies lived here:
  //  1. a failed conversion added NOTHING and said NOTHING — the user believed
  //     the PDF was attached and Kelion answered as if it never existed;
  //  2. for the admin, an unconvertible file got a chip and a promise ("rides
  //     the bridge as-is") — but send() only ever transmits data:image URLs
  //     and converted text, so the raw file went NOWHERE and was silently
  //     cleared. A chip for a file that never leaves the browser is a lie.
  // Now: converted → attached; not converted → an honest chat line says so.
  // The size gate mirrors the server's REAL limit. P13 (owner, 15 aug:
  // „mărește-i spațiul de încărcare în chat"): /api/ingest are acum limita LUI
  // de 100MB (routes/ingest.ts, ca /api/chat) — capul real e Cloudflare
  // (100MB/cerere). 96MB de base64 ≈ fișier de ~72MB; peste, mesajul cinstit
  // docTooLarge rămâne exact ca înainte.
  const MAX_INGEST_B64 = 96_000_000
  async function addDocFiles(files: File[]): Promise<void> {
    for (const file of files) {
      if (file.type.startsWith('image/')) continue
      const name = file.name || 'document'
      try {
        const data = await new Promise<string>((res, rej) => {
          const r = new FileReader()
          r.onload = () => res(String(r.result))
          r.onerror = () => rej(new Error('read'))
          r.readAsDataURL(file)
        })
        if (data.length > MAX_INGEST_B64) {
          ack(t.docTooLarge.replace('{name}', name))
          continue
        }
        let markdown = ''
        try {
          const resp = await fetch('/api/ingest', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ filename: file.name, data }),
          })
          if (resp.ok) markdown = ((await resp.json()) as { markdown?: string }).markdown ?? ''
        } catch {
          /* conversion unreachable — reported honestly below */
        }
        if (markdown.trim()) {
          setAttachments((cur) => [
            ...cur,
            { id: `${Date.now()}-${file.name}-doc`, url: '', name, text: markdown },
          ])
        } else {
          ack(t.docAttachFailed.replace('{name}', name))
        }
      } catch {
        // The file couldn't even be read from disk — same honest line.
        ack(t.docAttachFailed.replace('{name}', name))
      }
    }
  }
  function onFilesPicked(e: ChangeEvent<HTMLInputElement>): void {
    const files = [...(e.target.files ?? [])]
    e.target.value = '' // let the same file be picked again later
    addImageFiles(files.filter((f) => f.type.startsWith('image/')))
    void addDocFiles(files.filter((f) => !f.type.startsWith('image/')))
  }
  // Paste an image/file straight into the chat (Ctrl+V) or drag-and-drop a file.
  // DIRECT PRINTSCREEN (Adrian, Jul 25: "it doesn't take printscreens directly").
  // A pasted screenshot (Win+Shift+S, "Copy image") often does NOT land in
  // clipboardData.files, but in clipboardData.items (kind:'file', type:image/*).
  // We read BOTH sources → the pasted capture is caught every time. Dedup on
  // (name+size) so we don't add the same image twice.
  function onPasteFiles(e: ReactClipboardEvent): void {
    // OFFLINE (owner, 22 aug): atașarea de fișiere e funcție de internet
    // (vision/MarkItDown pe server) — butonul 📎 e ascuns, iar lipirea NU
    // trebuie să intre pe ușa din dos: un fișier atașat offline ar pleca
    // spre nicăieri. Textul lipit trece normal (nu chemăm preventDefault).
    if (!esteConectat()) return
    const seen = new Set<string>()
    const collected: File[] = []
    for (const f of e.clipboardData.files) {
      const key = `${f.name}:${f.size}`
      if (!seen.has(key)) { seen.add(key); collected.push(f) }
    }
    for (const it of e.clipboardData.items) {
      if (it.kind === 'file') {
        const f = it.getAsFile()
        if (f) {
          const key = `${f.name}:${f.size}`
          if (!seen.has(key)) { seen.add(key); collected.push(f) }
        }
      }
    }
    const imgs = collected.filter((f) => f.type.startsWith('image/'))
    const docs = collected.filter((f) => !f.type.startsWith('image/'))
    if (imgs.length > 0 || docs.length > 0) {
      e.preventDefault()
      if (imgs.length > 0) addImageFiles(imgs)
      if (docs.length > 0) void addDocFiles(docs)
    }
  }
  function onDropFiles(e: ReactDragEvent): void {
    // Aceeași regulă ca la onPasteFiles (22 aug) — dar cu preventDefault
    // ÎNAINTE de return (verificatorul de logică): onDragOver previne mereu,
    // deci fără prevenire și aici, un fișier ARUNCAT offline cădea pe
    // comportamentul implicit al browserului — navigarea LA fișier, care
    // înlocuia aplicația cu totul (stare pierdută).
    if (!esteConectat()) {
      e.preventDefault()
      return
    }
    const all = [...e.dataTransfer.files]
    if (all.length > 0) {
      e.preventDefault()
      addImageFiles(all.filter((f) => f.type.startsWith('image/')))
      void addDocFiles(all.filter((f) => !f.type.startsWith('image/')))
    }
  }
  function removeAttachment(id: string): void {
    setAttachments((cur) => cur.filter((a) => a.id !== id))
  }

  // ── Admin promo-scenario recorder ──
  // Records the screen + voice and AUTO-RUNS the typed scenario (one step per
  // line) through Kelion, then saves the clip. The click is the gesture
  // getDisplayMedia needs.
  async function runScenario(): Promise<void> {
    const steps = scenarioText
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
    if (steps.length === 0 || scenarioRunningRef.current) return
    const handle = await startRecording(
      () => {
        scenarioRunningRef.current = false
        setScenarioRunning(false)
        scenarioRecRef.current = null
      },
      () => {
        scenarioRunningRef.current = false
        setScenarioRunning(false)
      },
    )
    if (!handle) return
    scenarioRecRef.current = handle
    scenarioRunningRef.current = true
    setScenarioRunning(true)
    setScenarioOpen(false)
    for (const step of steps) {
      if (!scenarioRunningRef.current) break
      await sendRef.current(step) // waits for Kelion's full reply to stream in

    }
    // Let the final sentence finish speaking, then stop + save.

    handle.stop()
  }
  function stopScenario(): void {
    scenarioRunningRef.current = false
    scenarioRecRef.current?.stop()
    scenarioRecRef.current = null
    setScenarioRunning(false)
  }

  async function send(text: string, spoken = false): Promise<void> {
    const msg = text.trim()
    // OFFLINE + IMAGINE = SPUS, NU ARUNCAT TĂCUT (FAIL-ul verificatorului de
    // logică, 22 aug): creierul local e text-only — imaginea n-are drum, iar
    // înainte tura doar-imagine pleca cu „Ce vezi în această imagine?" spre un
    // creier fără ochi (confabulare garantată), cu poza aruncată pe tăcute.
    // Acum: nota onestă în chat, imaginile ies din tură (textul/documentele
    // merg mai departe), iar tura DOAR-imagine se oprește aici de tot.
    let atts = attachments
    if (!esteConectat() && stareCreierLocal().stare === 'gata' && atts.some((a) => a.url.startsWith('data:image'))) {
      ack(t.offlineNoVision ?? strings('en').offlineNoVision ?? 'Offline: images cannot be analysed right now.')
      atts = atts.filter((a) => !a.url.startsWith('data:image'))
      setAttachments(atts)
      if (!msg && atts.length === 0 && !pendingAudioRef.current) return
    }
    // O tură PUR VOCALĂ vine cu text GOL și fără atașamente — audio-ul brut al frazei
    // e DOAR în pendingAudioRef (setat de onAddressed chiar înainte de send('', true)).
    // Fără să-l verificăm aici, guardul „nimic de trimis" arunca TĂCUT fraza vocală
    // ÎNAINTE de orice fetch → exact „nu aude" (6 aug: consolă goală, zero request la
    // /api/chat). Cu pendingAudioRef, tura vocală trece spre isVoiceTurn (mai jos) și
    // pleacă la creier ca AUDIO. (Scrisul nu era afectat: msg ne-gol trecea guardul.)
    if (!msg && atts.length === 0 && !pendingAudioRef.current) return
    // Admin recorder commands — handled locally, never sent to the brain.
    if (msg && isAdmin) {
      // Mid-take cut: something changed — stop everything; the rec-stopped
      // handler cleans up and offers the retake.
      if (takeActiveRef.current && TAKE_STOP.test(msg)) {
        window.dispatchEvent(new CustomEvent('kelion:rec', { detail: 'stop' }))
        setInput('')
        return
      }
      // "Reluăm" — same approved script + scenes, new take, no re-approval.
      if (RETAKE.test(msg) && lastPromoRef.current) {
        const saved = lastPromoRef.current
        const savedLang = (saved.lang || '').slice(0, 2).toLowerCase()
        const setLang = speechLangRef.current.slice(0, 2).toLowerCase()
        // Guard: a saved script in a DIFFERENT language than the one now set is
        // stale — never re-narrate it (that's how it "went Spanish"). Drop it and
        // ask for a fresh take so Kelion regenerates it in the current language.
        if (savedLang && setLang && savedLang !== setLang) {
          lastPromoRef.current = null
          ack(t.promoWrongLang.replace('{subject}', saved.subject))
          setInput('')
          return
        }
        armPromo(saved)
        ack(t.promoRetake)
        setInput('')
        return
      }
      if (REC_STOP.test(msg)) {
        window.dispatchEvent(new CustomEvent('kelion:rec', { detail: 'stop' }))
        ack(t.promoRecStopped)
        setInput('')
        return
      }
      if (REC_START.test(msg)) {
        window.dispatchEvent(new CustomEvent('kelion:rec', { detail: 'arm' }))
        ack(t.promoRecReady)
        setInput('')
        return
      }
    }
    // IMMEDIATE STOP (Adrian, Jul 10: "I tell it stop and it ignores me, it doesn't take
    // the command right away"). A typed or spoken "stop" is NOT queued — it cuts the voice
    // and the current turn ON THE SPOT, empties the queue and closes the request on the server. The software
    // does NOT break: the backend finishes its turn on its own in the background; I just stop
    // waiting and stop speaking. Checked BEFORE the "busy" guard.
    const STOP_CMD =
      /^\s*(stop|stai|opre[șs]te(?:-te)?|oprire|gata|las[ăa](?:\s*asta)?|anuleaz[ăa]|renun[țt][ăa])[\s.!]*$/i
    if (msg && STOP_CMD.test(msg)) {
      interruptAll('stop-command')
      rvLiveRef.current?.stopSpeaking() // the live mouth shuts up too (Aug 1 — one brain)
      opresteVoceLocal(); oprestePiper() // și gurile offline (browser + Piper) tac pe „stop"
      abortRef.current?.abort()
      pendingSendsRef.current = [] // stop means stop — empty the queue
      setQueued([])
      inFlightRef.current = false
      setBusy(false)
      setLiveVoice('')
      setInput('')
      // Closes the request/loop on the server (the backend's stop handler).
      void fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          messages: [{ role: 'user', content: msg }],
          now: new Date().toISOString(),
          tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      }).catch(() => {})
      ack(t.stopAck)
      return
    }
    // Camera + monitor commands are interpreted by the SERVER (it sees the open
    // tabs on every turn and answers instantly with a {device} frame, no model
    // call) — nothing to intercept here anymore.
    if (busyRef.current || inFlightRef.current) {
      // REAL FULL-DUPLEX (Adrian, Jul 13: "while it works it doesn't hear the microphone / the text
      // doesn't reach it"): new input (typed OR spoken) while Kelion works =
      // BARGE-IN — we cancel the current turn and start the new one IMMEDIATELY. We no longer queue
      // it: the queue BLOCKED full-duplex (the second message didn't reach the brain
      // until the first finished). The backend + worker already accept concurrent
      // turns.
      // O FRAZĂ VOCALĂ rostită cât Kelion lucrează = barge-in, NU o pierdem: audio-ul
      // e în pendingAudioRef chiar dacă msg e gol (altfel o tură vocală în timpul alteia
      // era aruncată tăcut — aceeași cauză ca la linia ~865).
      // ATAȘAMENTUL SINGUR la fel (registrul, lot C): apăsarea „trimite" cu o
      // imagine fără text, cât Kelion lucra, se ARUNCA tăcut — zero urmă, zero
      // feedback. Regula casei e una singură: orice input în timpul lucrului =
      // barge-in. Return doar când chiar nu e NIMIC de trimis.
      if (!msg && !pendingAudioRef.current && atts.length === 0) return
      interruptAll('barge-in-text') // cut TTS + notify LIVE mouth; one focus arbiter
      rvLiveRef.current?.stopSpeaking() // and the live mouth's queue (spoken turn replaced)
      opresteVoceLocal(); oprestePiper() // taie gurile offline ale turei întrerupte (barge-in)
      abortRef.current?.abort() // the old turn becomes "superseded"; its finally no longer resets
      // NO return — we fall through below and start the new turn right now.
    } else {
      // O TURĂ NOUĂ TAIE ORICE GURĂ RĂMASĂ VIE, chiar dacă NU eram „busy": vocea
      // LIVE (Gemini Live) răspunde AUTONOM pe WebSocket și NU setează busyRef, deci
      // ramura de mai sus o sărea. Fără asta, dacă scrii un mesaj cât LIVE încă
      // vorbește, Chirp-ul turei noi se suprapunea peste vocea LIVE (owner, 20 aug:
      // „voci paralele… o singură ieșire audio"). O gură nouă închide celelalte guri.
      interruptAll('tura-noua-peste-live')
    }
    // ── SCRISUL MERGE LA CREIERUL ÎNTREG — MEREU (owner, 22 aug, MĂSURAT LIVE
    // pe V7.5: „kelion vreau un audit complet pe toata aplicatia, afisat pe
    // ecran" → NIMIC pe ecran, NIMIC în urechi; apoi „scris ignora ce cer" +
    // „audio nu merge"). Cauza: pasul 1 v1 ruta tura SCRISĂ prin sesiunea Live
    // ({type:'text'} → live.anunta) — răspunsul venea DOAR ca voce, deschiderea
    // ușii spre unelte rămânea la ALEGEREA modelului Live, iar un Live mut
    // făcea aplicația să pară moartă: neafișat, neauzit, neexecutat.
    // DE-ACUM: tot ce TASTEZI trece prin /api/chat — creierul întreg, uneltele,
    // monitorul, textul vizibil pe banda „K". Coliziunea celor două guri („2
    // sec și se rupe") rămâne moartă prin CELĂLALT mecanism al pasului 1, care
    // nu se atinge: interruptAll de mai sus taie orice gură la tura nouă, iar
    // la redarea Chirp sesiunea Live e întreruptă (regula vocii unice, vezi
    // c.audio). Turele VOCALE rămân integral în sesiunea Live, ca până acum.
    // Canalul {type:'text'} al serverului rămâne pe loc (nefolosit de client).
    inFlightRef.current = true
    setInput('')
    // New turn: the server-confirmed text of the FINISHED turn is cleared —
    // the band never shows a stale "what the brain got" from the previous one.
    setHeard('')
    setAttachments([])
    // Multi-tasking: whatever is on the monitor (a map, a route, a video) STAYS
    // open while you keep chatting — it's only replaced when Kelion shows
    // something new, or closed when you (or Kelion) close it. So the map keeps
    // running in parallel with the conversation until you say to close it.
    // The user's ESTABLISHED language. Detection + the two-in-a-row commit rule
    // run on the SERVER now; a committed switch comes back as a {lang} frame.
    const replyLang = speechLangRef.current
    // An attached image takes priority over the live camera frame for this turn.
    const attached = atts.find((a) => a.url.startsWith('data:image'))?.url
    const image =
      attached ??
      (cameraOnRef.current
        ? (latestFrameRef.current ?? captureRef.current?.() ?? undefined)
        : undefined)
    // Prepend any attached documents (already converted to Markdown) so Kelion
    // reads them as part of this turn.
    const docs = atts.filter((a) => a.text)
    const docBlock = docs.map((d) => `[Document: ${d.name}]\n${d.text}`).join('\n\n')
    // STOP THE DEFAULT IMAGE NARRATION (Adrian, 3 aug: „la pornire să NU spună
    // default ce vede în imagine — captura e DOAR ca să lege imaginea de timbrul
    // vocii, ca securitate, salvată tăcut"). `imagePrompt` („Ce vezi în această
    // imagine?") is still correct when the user EXPLICITLY attached a picture —
    // then they DO want it described. But a bare camera frame with no text must
    // NOT be turned into a „describe what you see" request: we send a plain
    // greeting instead, which carries NO vision-intent words, so the backend
    // vision gate does not attach the frame → no narration. The frame still
    // leaves silently (camFrames / faceDescriptor / facePhoto) for the
    // faceprint↔voiceprint security binding the server saves without a word.
    // VOCE UNIFICATĂ (Adrian, 5 aug): o tură vocală vine cu AUDIO și FĂRĂ text —
    // NU o transformăm în „salut" (greetPrompt); creierul aude fraza brută. Textul
    // trimis creierului rămâne GOL; UI-ul arată o bulă-substituent (mai jos).
    // O tură vocală = fraza vine ca AUDIO și FĂRĂ text tastat. Dacă omul a SCRIS
    // ceva (msg ne-gol), e o tură SCRISĂ chiar dacă un audio a rămas pending —
    // altfel textul lui era golit („outgoing=''") și se pierdea (Adrian, 6 aug:
    // „textul scris nu merge la creier"). Textul tastat are prioritate.
    const isVoiceTurn = !!pendingAudioRef.current && !msg
    const base = isVoiceTurn
      ? ''
      : msg || (docBlock ? t.docPrompt : attached ? t.imagePrompt : t.greetPrompt)
    const outgoing = docBlock && !isVoiceTurn ? `${docBlock}\n\n${base}` : base
    // CONTINUOUS VISION (Adrian, Jul 11): with the camera on, the LAST 8 FRAMES leave
    // (≈2s of motion at 4 fps), not a single one — the brain sees MOTION, not a
    // frozen blink. The same for ALL users (rule no. 9): the frames go through
    // `images`, while an explicitly attached picture goes through `image`.
    const camFrames = cameraOnRef.current && !attached ? frameBufRef.current.slice(-8) : []

    // Voice features collected from the last spoken sentence (live dictation or batch).
    const voiceFeatures = getPendingVoiceFeatures() ?? undefined
    clearPendingVoiceFeatures()
    // The guest label set by the voice gate (null for the holder / typed turns).
    const speaker = pendingSpeakerRef.current ?? undefined
    pendingSpeakerRef.current = null
    // Vocea brută a acestei ture (DOAR pe o tură vocală). Pe o tură SCRISĂ nu
    // cărăm un audio rătăcit — l-ar auzi creierul peste textul tastat.
    const nativeAudio = isVoiceTurn ? (pendingAudioRef.current ?? undefined) : undefined
    pendingAudioRef.current = null
    // The facial descriptor READY in the background (if the camera is on and it caught a
    // face). Instant — it waits for no inference, it doesn't slow down the send.
    const face = getPendingFaceDescriptor()

    const userTs = Date.now()
    // Creierul primește textul GOL pe voce (aude audio-ul); `next` e payload-ul.
    const next: ChatMessage[] = [...messages, { role: 'user', content: outgoing, ts: userTs }]
    // STABLE ts for THIS turn's in-progress reply — the functional updater
    // below recognizes and replaces it, without deleting the messages
    // (e.g. voice transcripts) that arrived meanwhile.
    const turnTs = Date.now()
    // UI: pe voce arătăm o bulă-substituent „🎙️…" până creierul confirmă ce a auzit
    // ({heard} o umple) sau decide că nu i se vorbea ({ignored} o șterge).
    const uiUser: ChatMessage = { role: 'user', content: isVoiceTurn ? '🎙️…' : outgoing, ts: userTs }
    voiceTurnRef.current = isVoiceTurn ? { userTs, asstTs: turnTs } : null
    setMessages([...messages, uiUser, { role: 'assistant', content: '', ts: turnTs }])
    setChatImage(null) // a new turn clears any previously shown image
    // The abort controller of THIS turn — "stop" aborts it on the spot.
    const ac = new AbortController()
    abortRef.current = ac
    setBusy(true)
    // Ține ecoul textului MEU pe ecran ~3× mai mult (Adrian, 3 aug). Se reia la
    // fiecare tură (și la barge-in): anulăm cronometrul vechi și pornim unul nou.
    const USER_ECHO_HOLD_MS = 2600
    if (userEchoTimerRef.current) clearTimeout(userEchoTimerRef.current)
    setUserEchoHold(true)
    userEchoTimerRef.current = setTimeout(() => setUserEchoHold(false), USER_ECHO_HOLD_MS)
    let acc = ''
    // THE MOUTH, FED BY THE BRAIN (Aug 1 — one brain): while the reply streams,
    // complete sentences go to the live voice session's speak() queue and are
    // spoken VERBATIM, in order, with the model's one voice. No live session →
    // nothing is spoken here (the Chirp path stays as it was). The session is
    // captured ONCE per turn — a mid-turn rotation must not steal the speech.
    const mouth = rvLiveRef.current
    // NOUĂ TURĂ: încă n-a rostit nimeni nimic; tăiem orice gură de siguranță rămasă.
    aSunatTuraRef.current = false
    turaAvutSemneRef.current = false
    opresteVoceLocal()
    oprestePiper()
    let speechBuf = ''
    // Sentence splitter: a sentence leaves the buffer only when it ENDS with a
    // terminator followed by whitespace (or the very end of the buffer) — so
    // "3.14" or "e.g." don't cut early, and the first words reach the mouth
    // within the first second of the stream.
    const SENT_RE = /^[\s\S]*?[.!?…]+["'»)\]]*(?=\s|$)/
    const cleanForSpeech = (s: string): string =>
      s
        .replace(/<[a-zA-Z0-9_-]+[\s\S]*?<\/[a-zA-Z0-9_-]+>/g, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\[[a-zA-Z0-9_-]+\][\s\S]*?\[\/[a-zA-Z0-9_-]+\]/g, ' ')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // images — nothing to say
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // links keep their label
        .replace(/https?:\/\/\S+/g, '')
        .replace(/[*_`#>~]/g, '') // markdown ornaments are not words
        .replace(/\s+/g, ' ')
        .trim()
    const feedSpeech = (chunk: string): void => {
      if (!mouth) return
      // NU vorbi peste muzică (Adrian, 4 aug): cât e muzică în cameră, gura tace.
      if (muzicaActivaRef.current) return
      aSunatTuraRef.current = true // gura live rostește tura → fără gură de siguranță
      speechBuf += chunk
      // Fast check: don't run regex if there is no punctuation/newline and buffer is small
      if (speechBuf.length < 200 && !/[.!?…\n]/.test(speechBuf)) return
      for (;;) {
        const mm = SENT_RE.exec(speechBuf)
        if (mm) {
          speechBuf = speechBuf.slice(mm[0].length)
          const sent = cleanForSpeech(mm[0])
          if (sent) mouth.speak(sent)
        } else if (speechBuf.length > 300) {
          // Break on newline or space when buffer gets too large without terminal punctuation
          const cutIdx = speechBuf.lastIndexOf('\n', 250) !== -1 ? speechBuf.lastIndexOf('\n', 250) + 1 : speechBuf.lastIndexOf(' ', 250)
          if (cutIdx > 0) {
            const piece = speechBuf.slice(0, cutIdx)
            speechBuf = speechBuf.slice(cutIdx)
            const sent = cleanForSpeech(piece)
            if (sent) mouth.speak(sent)
          } else {
            break
          }
        } else {
          break
        }
      }
    }
    // REAL RESPONSE TIME (measured here, in the browser — what the user feels): from
    // send → first visible word → complete reply. Shown on the counter.
    const t0 = performance.now()
    let firstAt = 0
    try {
      const wsNow = getWorkspace()
      const screen = wsNow.open
        ? wsNow.tasks.map((tk) => ({ kind: tk.kind, title: tk.title, active: tk.id === wsNow.activeId }))
        : undefined
      // GPS ONLY WHEN NEEDED: we read the REAL position right now, just once,
      // ONLY if the message really asks for the location (weather/maps/"where am I"/route).
      // Otherwise we detect nothing — at most the last known position leaves.
      const locTurn = LOC_INTENT.test(msg)
      const turnCoords = locTurn ? await getFreshCoords() : coordsRef.current
      // MARTOR + THROTTLING (11 aug, ownerul: „se blochează la tot ce trece prin
      // chat"): watchdog-ul măsoară cauza (fir principal vs. server); re-randăm
      // la cel mult ~12/s (nu la fiecare token) și cedăm periodic firul ca browserul să respire.
      watchdogEnter('creier')
      let ultimulFlush = 0
      let ultimulYield = performance.now()
      const flushMesaje = (): void => {
        setMessages((cur) => {
          // Compară pe (rol, ts), NU pe identitatea obiectului (agentul lotului C):
          // {heard} umple bula userului IN-PLACE (obiect NOU, același ts) — pe
          // identitate, comparația pica fix pe poziția aia, „base" cădea pe next
          // și flush-ul REVERTEA transcriptul confirmat la substituentul gol
          // (C5 murea la milisecunde după ce se năștea). Când base = cur, prefixul
          // păstrat e AL LUI cur (cu editările in-place), nu al lui next.
          const aceeasi = (a: { role: string; ts?: number }, b: { role: string; ts?: number }): boolean => a.role === b.role && a.ts === b.ts
          const base = cur.length >= next.length && cur.slice(0, next.length).every((m, i) => aceeasi(m, next[i])) ? cur : next
          const rest = base.slice(next.length).filter((m) => !(m.role === 'assistant' && m.ts === turnTs))
          return [...base.slice(0, next.length), ...rest, { role: 'assistant', content: acc, ts: turnTs }]
        })
      }
      // COMUTAREA OFFLINE (mod companion, faza 1): fără net REAL → răspunsul vine
      // din CREIERUL LOCAL (WebLLM, pe dispozitiv), NU de la server. Aceeași formă
      // de flux (async iterable de bucăți), deci tot ce urmează (acumulare, gură,
      // randare, abort) rămâne IDENTIC. Calea online e neatinsă. `next` (istoricul,
      // inclusiv mesajul curent) e preluat de model — PRELUAREA CONTEXTULUI cerută.
      // FAIL-SAFE (owner 20 aug: „nu răspunde nici online nici offline"): folosim
      // creierul LOCAL doar dacă chiar NU e semnal ȘI modelul e GATA. Dacă modelul
      // nu-i descărcat (mereu până se descarcă) sau detectorul se-nșeală, NU tăiem
      // chatul — cădem pe server (streamChat). Așa online-ul merge MEREU ca înainte,
      // iar offline folosește creierul local doar când chiar are ce.
      const eTuraOffline = !esteConectat() && stareCreierLocal().stare === 'gata'
      const sursaFlux = eTuraOffline
        ? streamLocalRaspuns(
            next,
            lang,
            ac.signal,
            // FAZA 2 — GPS + viteză + vedere, MĂSURATE, injectate în creierul local
            // ca să fie UMAN offline (spune viteza, unde ești, că te vede).
            contextPentruCreier({
              lat: coordsRef.current?.lat,
              lon: coordsRef.current?.lon,
              vitezaMs: vitezaRef.current,
              fataDetectata: Boolean(face),
            }),
          )
        : streamChat(
        next,
        image ?? undefined,
        turnCoords ?? undefined,
        handleControl,
        screen,
        ac.signal,
        Boolean(attached), // explicitly pasted/uploaded picture — unconditional analysis
        // Continuous vision for ALL users (rule no. 9): the last frames.
        camFrames.length > 0 ? camFrames : undefined,
        voiceFeatures,
        face?.descriptor,
        face?.photo,
        // O SINGURĂ GURĂ PE TURĂ. CORECȚIE MĂSURATĂ (owner 20 aug „nu ajunge audio unde
        // trebuie" pe VOCE + agent): Gemini Live (vlRef) NU rostește răspunsul serverului
        // nici pe voce — n-are `speak(text)`, rostește doar audio-ul PROPRIULUI model. Deci
        // Chirp-ul TREBUIE să rămână pornit ȘI pe turele vocale, altfel răspunsul vocal e MUT
        // (exact bugul). Serverul oprește sinteza DOAR pentru o sesiune Realtime OpenAI, care
        // chiar rostește textul (acolo Chirp ar dubla). O singură voce = Chirp + întreruperea
        // Live la redare (vezi c.audio). NU mai lega Chirp-ul de „LIVE e instalat".
        (micRef.current as unknown as { isRealtime?: boolean } | null)?.isRealtime === true,
        // SPOKEN TURN (the ears brought it): the server shapes the reply for speech.
        spoken || undefined,
        // GUEST SPEAKER (the voice gate's verdict): the server strips ALL admin
        // powers from this turn, whoever is logged in.
        speaker,
        // AUDIO NATIV → CREIER: vocea brută a frazei (WAV), pentru creierul care
        // aude nativ (Gemini). Gol pe turele scrise.
        nativeAudio,
        // VOCE AMBIENTALĂ: creierul unic decide singur, din audio, dacă i se vorbea
        // (altfel tace — {ignored}). Doar pe turele vocale.
        isVoiceTurn || undefined,
        // MODUL MAȘINĂ (11 aug; rescris 13 aug): semnalăm creierului că userul e la
        // volan ca să răspundă SCURT, voce-first. NU mai suprimă suprafețe — ce spune
        // că face, execută (owner: „vorbă = faptă"; garda din handleControl a fost scoasă).
        isCarMode() || undefined,
      )
      for await (const chunk of sursaFlux) {
        if (!firstAt && chunk && chunk.trim()) firstAt = performance.now() // first REAL word
        acc += chunk
        feedSpeech(chunk) // the mouth speaks the reply as it streams
        watchdogBeat('creier') // măsoară pauza față de server (diagnostic blocaj)
        // THROTTLING (11 aug, îmbunătățit 15 aug): re-randăm la intervale optime
        // și cedăm controlul buclei de evenimente a browserului (macrotask) pentru
        // a preveni blocarea firului principal pe streamuri rapide/dense de date.
        const acum = performance.now()
        if (acum - ultimulFlush >= 80) {
          ultimulFlush = acum
          flushMesaje()
        }
        if (acum - ultimulYield >= 60) {
          ultimulYield = acum
          await new Promise<void>((resolve) => setTimeout(resolve, 0))
        }
      }
      // FLUSH FINAL — garantează conținutul complet al răspunsului. DOAR dacă a
      // curs text: pe o tură {ignored}/goală n-are ce garanta, iar rescrierea
      // ar RESUSCITA bulele șterse de {ignored} (bula păstrată de C5 trăia doar
      // până aici — constatarea agentului lotului C).
      if (acc.trim()) flushMesaje()
      // The LAST piece of the reply (it may end without a terminator) — the
      // mouth says it too, then nothing is left unsaid.
      if (mouth && speechBuf.trim()) {
        const rest = cleanForSpeech(speechBuf)
        speechBuf = ''
        if (rest) mouth.speak(rest)
      }
      // Publishes the REAL time on the counter (only if visible text arrived).
      if (firstAt) {
        setRealLatency({ firstMs: firstAt - t0, totalMs: performance.now() - t0, at: Date.now() })
      }
      // A monitor-only / tool-only reply streams no visible text. Don't leave an
      // empty assistant turn in the history (it would 400 the next request).
      // Dar TĂCEREA TOTALĂ e altceva (registrul, lot C): text gol + niciun cadru
      // de control + niciun sunet = tura a murit fără nicio urmă — omul rămânea
      // cu întrebarea în aer, fără să știe dacă a fost măcar primită. Rând onest.
      if (!acc.trim()) {
        // FUNCȚIONAL și ȚINTIT pe ambele ramuri (agentul lotului C): vechiul
        // `setMessages(next)` era un instantaneu care ștergea tot ce apăruse
        // între timp — inclusiv bula confirmată păstrată de {ignored} (C5) și
        // transcriptul pus de {heard}. Singurul lucru de curățat e bula
        // assistant GOALĂ a turei (ts=turnTs) — restul stării rămâne cum e.
        const faraAsistentGol = (cur: typeof next): typeof next =>
          cur.filter((mm) => !(mm.role === 'assistant' && mm.ts === turnTs && !mm.content.trim()))
        if (!eTuraOffline && !turaAvutSemneRef.current && !aSunatTuraRef.current) {
          setMessages((cur) => [...faraAsistentGol(cur), { role: 'assistant', content: `⚠️ ${strings(lang).turnEmpty}`, ts: Date.now() }])
        } else setMessages((cur) => faraAsistentGol(cur))
      }
      else suggestFacial(acc) // the face follows the tone of the finished reply
      // FAZA 3 — COZILE OFFLINE: dacă tura a fost fără net, o punem în coada de
      // SYNC (chat + locație) ca serverul să se actualizeze la revenire; dacă
      // cererea CEREA net (căutare/vreme/email…), o punem și în coada de AMÂNATE,
      // s-o rezolvăm și s-o anunțăm civilizat când revine semnalul (owner).
      if (eTuraOffline) {
        const acum = Date.now()
        const lat = coordsRef.current?.lat
        const lon = coordsRef.current?.lon
        // SYNC include textul COMPLET trimis (docBlock + mesaj), nu doar `msg`.
        if (outgoing.trim()) adaugaTuraSync({ rol: 'user', text: outgoing, t: acum, lat, lon })
        if (acc.trim()) adaugaTuraSync({ rol: 'assistant', text: acc, t: acum })
        // Întrebarea amânată e cea pe care o poate citi ownerul — `msg` curat.
        if (msg && necesitaNet(msg)) adaugaAmanata({ intrebare: msg, t: acum, lat, lon })
      }
      // GURĂ DE SIGURANȚĂ, DOAR OFFLINE (owner 20 aug: „daca ii scriu si sunt online
      // raspund ambele versiuni"). BUG-ul meu din #1291: pe turele SCRISE ONLINE vocea
      // browserului rostea răspunsul PESTE Chirp-ul de pe server → DOUĂ voci (una suna
      // „offline", una „online"). Chirp funcționează online, deci plasa nu mai are ce
      // căuta acolo. O restrângem la turele OFFLINE (`eTuraOffline`), unde chiar NU există
      // voce de server (nici c.audio, nici gură live) → o singură voce, fără dublare.
      if (eTuraOffline && !isVoiceTurn && acc.trim() && !muzicaActivaRef.current) {
        const deRostit = cleanForSpeech(acc)
        if (deRostit) {
          window.setTimeout(() => {
            if (!aSunatTuraRef.current && !ac.signal.aborted && !isVoicePlaying() && !muzicaActivaRef.current) {
              // GURA ADEVĂRATĂ ÎNTÂI (kitul offline, 22 aug): Piper „Mihai" —
              // voce masculină constantă + buzele avatarului mișcă; doar dacă
              // modelul nu e (încă) descărcat cade pe vocea browserului.
              void vorbesteOffline(deRostit, lang)
            }
          }, 2200)
        }
      }
    } catch (err) {
      // A REPLACED TURN MAY NO LONGER WRITE (Adrian, Jul 31: "it hears the second
      // question, briefly shows it, but doesn't pass it on" + "the message that technically
      // appeared again").
      //
      // The `finally` below has long checked `stillCurrent` — it knows the turn
      // may have been replaced by a new one (barge-in) and then leaves its
      // state alone. This `catch` checked NOTHING: the old turn's error rewrote
      // the message list with ITS snapshot, i.e. over the new turn. Your second
      // question appeared and vanished, with a ⚠️ on top. The asymmetry between catch
      // and finally WAS the bug.
      // (Written without the call literal: a guard in aDouaIntrebare.test.ts
      // counts the snapshot writes in the file, and a comment quoting
      // them would be counted as a real one.)
      const codErr = err instanceof Error ? err.message : 'error'
      const inlocuita = abortRef.current !== ac
      if (ac.signal.aborted || codErr === 'aborted' || inlocuita) {
        // Stopped by Adrian or replaced by the new question — no error
        // message, no writing over what's on the screen right now.
      } else {
        // Regula veche „vocea să nu spună mai mult decât e scris" (10 iul) nu
        // mai cere tăierea: ramura de eroare PĂSTREAZĂ acum tot textul primit
        // pe ecran (acc + ⚠️ mai jos), iar serverul emite audio-ul unei
        // propoziții DUPĂ textul ei — deci audio-ul deja livrat e acoperit de
        // text. Tăierea lui la o rupere de stream producea exact asimetria
        // inversă, măsurată de owner: „chatul se trunchează audio" (vânătoarea
        // 22 aug, MEDIU confirmat). Tăiem doar când chiar nu s-a scris NIMIC.
        if (!acc.trim()) interruptAll('chat-error')
        mouth?.stopSpeaking() // classic/chirp mouth queue too
        const code = codErr
        const spoken = strings(resolveLang(replyLang))
        // TRANSIENT + nothing streamed yet → ONE silent retry: the network and
        // the server are MEASURED fine (diagnozaConexiune), only this request
        // broke on the road. From the human's view nothing broke — so nothing
        // is said. The guard ref stops a retry loop (one per 30s).
        if (code === 'transient' && !acc.trim() && !transientRetryRef.current) {
          transientRetryRef.current = true
          window.setTimeout(() => {
            transientRetryRef.current = false
          }, 30_000)
          console.info('[CONEXIUNE] cerere ruptă cu net+server OK — reîncerc tăcut o dată')
          // Voice turns stash audio in pendingAudioRef before send clears it.
          // Restore it so the silent retry is still a real voice turn (HTTP 200 path),
          // not an empty typed message that the guard drops.
          if (nativeAudio) pendingAudioRef.current = nativeAudio
          if (speaker) pendingSpeakerRef.current = speaker
          // NOTE: local `spoken` below is i18n strings — use isVoiceTurn for the flag.
          window.setTimeout(() => void sendRef.current(msg, isVoiceTurn), 400)
        } else {
        const m =
          code === 'brain_not_configured'
            ? t.brainNotActive
            : code === 'offline'
              ? spoken.offline
              : code === 'server_down'
                ? spoken.serverDown
                : code === 'transient'
                  ? spoken.requestLost
                  : code === 'unauthorized'
                    // VERDICTE ONESTE (registrul, lot C): sesiunea expirată NU e
                    // „am pierdut netul", paywall-ul NU e „eroare la creier",
                    // prea-multe-cereri NU e „cererea s-a rupt pe drum" — trei
                    // minciuni de cod HTTP, fiecare cu vorba EI acum.
                    ? spoken.sessionExpired
                    : code === 'paywall'
                      ? spoken.paywallRow
                      : code === 'rate_limited'
                        ? spoken.rateLimited
                        : t.brainError
        if (code === 'paywall') {
          window.dispatchEvent(new Event('kelion:paywall'))
        }
        // KEEP the text already received (don't drop it) — just add a discreet note,
        // so the text stays complete versus what was heard.
        // FUNCTIONAL updater, not a snapshot — the same lesson as in the streaming
        // loop (line ~912): a message arriving meanwhile (voice transcript,
        // a new question) must not disappear because this turn failed.
        const tsEroare = Date.now()
        setMessages((cur) => {
          const baza = cur.length >= next.length && cur.slice(0, next.length).every((mm, i) => mm === next[i]) ? cur : next
          const rest = baza.slice(next.length).filter((mm) => !(mm.role === 'assistant' && mm.ts === turnTs))
          return [...next, ...rest, { role: 'assistant', content: acc.trim() ? `${acc}\n⚠️ ${m}` : `⚠️ ${m}`, ts: tsEroare }]
        })
        if (code === 'offline') {
          offlineRef.current = true
          retryTextRef.current = msg // resume THIS message when the signal returns
          retryEroareTsRef.current = tsEroare // ștergerea ȚINTITĂ la revenire (nu slice orb)
          retryUserTsRef.current = userTs // bula user se șterge pe TS (conținutul poate diferi — ex. turele cu documente)
        }
        if (code === 'server_down') {
          // Aceeași pereche de ts-uri și aici (agentul lotului C, marginea 2):
          // altfel secvența offline→server_down lăsa ts-ul VECHI de eroare și
          // revenirea ștergea bula de eroare veche + bula user a textului nou.
          retryEroareTsRef.current = tsEroare
          retryUserTsRef.current = userTs
          // The 'online' browser event will never fire — the net was never
          // down. We poll OUR server's health (5s, max 2 min — a deploy takes
          // ~30-60s) and resume the SAME message the moment it answers.
          retryTextRef.current = msg
          if (healthPollRef.current) window.clearInterval(healthPollRef.current)
          let incercari = 0
          healthPollRef.current = ceas('sondă sănătate voce', () => {
            incercari++
            if (incercari > 24) {
              window.clearInterval(healthPollRef.current!)
              healthPollRef.current = null
              return
            }
            void fetch('/api/health', { cache: 'no-store', signal: AbortSignal.timeout(3000) })
              .then((r) => {
                if (!r.ok) return
                window.clearInterval(healthPollRef.current!)
                healthPollRef.current = null
                const retry = retryTextRef.current
                retryTextRef.current = null
                console.info('[CONEXIUNE] serverul a revenit — reiau mesajul singur')
                // Serverul a înviat după restart → vocea live primește iar
                // dreptul de a porni (căderea ei fusese restartul, nu ea).
                vlCazutRef.current = false
                if (retry) void sendRef.current(retry)
              })
              .catch(() => {})
          }, 5000)
        }
        }
      }
    } finally {
      watchdogExit('creier') // verdictul turei (fir principal vs. server) în consolă
      // BARGE-IN (full-duplex): if this turn was REPLACED by a new one,
      // `abortRef` already points at the new turn — do NOT reset its "working"
      // flags (that would clobber them). Only the STILL-current turn cleans itself up.
      const stillCurrent = abortRef.current === ac
      if (stillCurrent) {
        abortRef.current = null
        inFlightRef.current = false
        setBusy(false)
      }
      // Compat: if something is left in an old queue (it no longer fills up
      // normally — full-duplex sends directly), we send it, but only if we weren't
      // just replaced by a new turn.
      if (stillCurrent && pendingSendsRef.current.length > 0) {
        const combined = pendingSendsRef.current.join('\n')
        pendingSendsRef.current = []
        setQueued([])
        window.setTimeout(() => void sendRef.current(combined), 50)
      }
    }
  }
  const sendRef = useRef(send)
  sendRef.current = send

  // ── APLICAȚIILE GOOGLE DIN MENIU → O COMANDĂ CLARĂ ÎN CHAT (owner, 14 aug:
  // „tot ce interconectăm să fie în aplicații") ──────────────────────────────
  // O intrare din meniul „Aplicații" (Stage) trimite EXACT o comandă de om în
  // chat — același drum ca tastatura, aceleași porți (plată, poarta acțiunii,
  // bara de execuție). Nimic nu se cheamă pe ascuns: comanda se vede în chat.
  useEffect(() => {
    const onComanda = (e: Event): void => {
      const text = String((e as CustomEvent<string>).detail ?? '').trim()
      if (text) void sendRef.current(text)
    }
    window.addEventListener('kelion:comanda', onComanda)
    return () => window.removeEventListener('kelion:comanda', onComanda)
  }, [])

  // The microphone is PERMANENT ON: it starts by itself on entry and reopens
  // by itself when the track dies (phone call, Bluetooth headset removed, another app takes
  // the microphone) or when the tab becomes visible again. The button remains only as a manual
  // pause — the only case where the microphone stays off intentionally.
  const micManualOffRef = useRef(false)
  const micStartingRef = useRef(false)
  const micRetryRef = useRef<number | null>(null)
  const micBackoffRef = useRef(1000)
  // VOCEA E FUNCȚIE DE INTERNET — SE ÎNCHIDE, NU DOAR SE ASCUNDE (blocantul
  // verificatorului de logică pe ordinul din 22 aug): butonul de microfon e
  // ascuns offline, deci o ureche rămasă VIE n-ar mai avea niciun buton de
  // oprire, iar bucla de reluare ar clipi getUserMedia la nesfârșit contra
  // unui server de neatins. La căderea netului sesiunea vocală (live sau
  // veche) se stinge COMPLET — fără micManualOff (aia înseamnă „omul a ales
  // oprit"), ca urechea permanentă să revină SINGURĂ la net.
  // URECHEA LOCALĂ (kitul offline, 22 aug): captură proprie, fără server —
  // fraza PCM 16 kHz de la micStream → Whisper local → textul intră pe
  // ACELAȘI drum ca tastarea (send) → creierul local → gura Piper.
  const urecheaLocalaRef = useRef<MicStreamHandle | null>(null)
  // Vizibilitatea butonului de microfon pe offline: doar când urechea locală
  // chiar EXISTĂ (modelul e în cache) — un buton pentru o funcție moartă ar fi
  // exact „doar poza" interzisă azi de owner.
  const [urecheaLocalaGata, setUrecheaLocalaGata] = useState(false)
  // ── ZGOMOTUL OPREȘTE TASTAREA (owner, 23 aug 2026) — useEffect care mută
  //    microfonul cât timp userul tastează. Definit AICI (după urecheaLocalaRef)
  //    ca să evite TDZ pe ref-urile declarate mai târziu în componentă.
  useEffect(() => {
    const el = composerInputRef.current
    if (!el) return
    const aplicaPauzaTastare = (pauza: boolean): void => {
      if (tastareActivaRef.current === pauza) return
      tastareActivaRef.current = pauza
      // Mută ambele căi: microfonul clasic (micStream) ȘI sesiunea Live (Gemini)
      micRef.current?.setMuted(pauza)
      vlRef.current?.setMuted(pauza)
      // Urechea locală (offline) — și ea produce fraze din zgomot de tastatură
      urecheaLocalaRef.current?.setMuted(pauza)
    }
    const onKeyDown = (): void => {
      // Prima tastă → mută microfonul
      if (!tastareActivaRef.current) aplicaPauzaTastare(true)
      // Reset debounce — 1.5s fără tastă = terminat de scris
      if (tastareDebounceRef.current) window.clearTimeout(tastareDebounceRef.current)
      tastareDebounceRef.current = window.setTimeout(() => {
        aplicaPauzaTastare(false)
        tastareDebounceRef.current = null
      }, 1500)
    }
    const onBlur = (): void => {
      // Pierde focusul → dezmută imediat (nu mai scrie)
      if (tastareDebounceRef.current) {
        window.clearTimeout(tastareDebounceRef.current)
        tastareDebounceRef.current = null
      }
      aplicaPauzaTastare(false)
    }
    el.addEventListener('keydown', onKeyDown)
    el.addEventListener('blur', onBlur)
    return () => {
      el.removeEventListener('keydown', onKeyDown)
      el.removeEventListener('blur', onBlur)
      if (tastareDebounceRef.current) window.clearTimeout(tastareDebounceRef.current)
    }
  }, [])
  const pornesteUrecheaLocala = async (): Promise<void> => {
    if (esteConectat() || micManualOffRef.current || urecheaLocalaRef.current) return
    const gata = await pregatesteUrecheaOffline()
    if (!gata) return
    setUrecheaLocalaGata(true)
    if (esteConectat() || micManualOffRef.current || urecheaLocalaRef.current) return
    const { startMicStream } = await import('../lib/micStream')
    const ureche = await startMicStream({
      onLive: () => {},
      onPhrase: (_text, _f, audio) => {
        if (!audio || !urecheaOfflineGata()) return
        // Half-duplex local: cât vorbește ORICE gură locală (Piper sau coada
        // Chirp rămasă să sune după căderea netului — stopVoice nu o mai taie),
        // frazele se aruncă (propria voce ar intra înapoi — v1, fără barge-in).
        if (piperVorbeste() || isVoicePlaying()) return
        void transcrieOffline(wavBase64LaFloat32(audio), speechLangRef.current).then((text) => {
          if (text && !esteConectat()) void send(text)
        })
      },
      onError: () => {},
      getLang: () => speechLangRef.current,
      storePendingFeatures: false,
    })
    if (!ureche) return
    if (esteConectat() || micManualOffRef.current) {
      ureche.stop()
      return
    }
    urecheaLocalaRef.current = ureche
    setListening(true)
  }
  const pornesteUrecheaLocalaRef = useRef(pornesteUrecheaLocala)
  pornesteUrecheaLocalaRef.current = pornesteUrecheaLocala
  useEffect(() => {
    if (online) {
      // Revenirea: urechea LOCALĂ tace (serverul aude de-acum), kitul își
      // face sincronizarea invizibilă (descarcă ce lipsește), urechea
      // permanentă online se re-armează.
      urecheaLocalaRef.current?.stop()
      urecheaLocalaRef.current = null
      oprestePiper()
      void sincronizeazaKitOffline()
      if (!micManualOffRef.current) void ensureMicRef.current()
      return
    }
    setMenuOpen(false) // meniul „+" e demontat offline — să nu sară deschis la revenire
    vlGeneratieRef.current++ // omoară reluările/sondele programate ale sesiunii live
    unregisterLiveFocus()
    vlRef.current?.inchide()
    vlRef.current = null
    micRef.current?.stop()
    micRef.current = null
    micStartingRef.current = false
    setListening(false)
    // stopVoice() a fost SCOS de aici (vânătoarea 22 aug, BLOCANT confirmat):
    // detectorul basculează pe UN singur semnal (evenimentul 'offline' la
    // comutarea Wi-Fi↔celular, sau UN ping /health ratat la 4s) — iar audio-ul
    // Chirp deja primit e ÎN MEMORIE (data:-URI), redarea lui nu are nevoie de
    // rețea. Tăierea lui la un fâlfâit de o secundă era truncare pură:
    // răspunsul tăiat nu se mai auzea niciodată. Redarea locală se termină
    // singură; orice tură nouă o taie oricum prin interruptAll.
    // Urechea locală pornește singură (modelul se ÎNCARCĂ din cache, fără
    // rețea — dacă nu fusese descărcat cât era net, pregătirea pică onest și
    // offline rămâne pe scris). Oprirea manuală a omului se respectă.
    void pornesteUrecheaLocalaRef.current()
    return () => {
      urecheaLocalaRef.current?.stop()
      urecheaLocalaRef.current = null
    }
  }, [online])
  // La montare (online): kitul își verifică singur componentele — invizibil.
  useEffect(() => {
    if (online) void sincronizeazaKitOffline()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // THE EAR COMES BACK BY ITSELF (4 Aug — the day of 4 server restarts): once the
  // voice session degraded to batch dictation, the 90s unlatch in ensureMic was
  // DEAD CODE — ensureMic returns at its first line while the batch mic handle
  // exists, so full-duplex never returned without a manual page refresh (the
  // chat message even promised it would). This timer breaks that guard: after
  // the cooldowns expire it stops the batch mic, re-arms streaming candidacy
  // and calls ensureMic — if the server is back, full-duplex resumes; if not,
  // the failure cascade re-arms the timer and we retry every ~100s forever.
  // ── O VOCE ÎN TOATE TABURILE (Adrian, 4 aug: „am 2 voci") — zăvorul dintre
  // taburi. Regulile pure stau în lib/voceUnica.ts; aici doar refs + efectul.
  const tabVoceIdRef = useRef(idTabVoce())
  const voceAiureaRef = useRef(false) // vocea trăiește în ALT tab → aici tăcem
  const ultimaInimaRef = useRef(0)
  const canalVoceRef = useRef<BroadcastChannel | null>(null)
  // ── DANS PE MUZICA DIN CAMERĂ (Adrian, 4 aug: „motor de sincronizare bitrate
  // pe dans") — refs: dacă e muzică acum (gura tace) și dacă avatarul e liber
  // pentru următoarea mișcare (o pornim pe un BIT, ca să fie sincron).
  const muzicaActivaRef = useRef(false)
  const dansLiberRef = useRef(true)
  const dansIdxRef = useRef(0)
  // (upgradeTimerRef rămâne DOAR ca no-op de cleanup — „urcarea" din STT înapoi la
  // full-duplex a dispărut odată cu STT-ul: calea vocală e una singură acum.)
  const upgradeTimerRef = useRef<number | null>(null)
  // "VOICE PER SENTENCE" — TRIED AND ROLLED BACK (Jul 25): it closed the paid session
  // after every exchange + reopened it by itself on local speech detection
  // (`speechWake.ts`). Two real regressions on the same day (it cut the sentence after 2
  // words; then "hears but doesn't speak") → Adrian: "go back to the full-duplex
  // chat". The session stays open continuously, as before the experiment.

  // HONEST MIC FAILURES (audit Aug 2). Two silences lived here:
  //  1. a failed /api/asr transcription tore NOTHING down but said nothing —
  //     the red dot stayed on while the spoken sentence vanished;
  //  2. 'not-allowed'/'unsupported' returned WITHOUT A WORD — a blocked mic
  //     looked exactly like a working one that ignores you.
  const lastAsrLostAckRef = useRef(0)
  const micTerminalAckedRef = useRef(false)
  // Reprogramează pornirea microfonului cu backoff (evită bucla strânsă) — o
  // SINGURĂ definiție, folosită pe toate căile de reîncercare (fără clonă jscpd).
  const reprogrameazaMic = (): void => {
    if (micRetryRef.current) window.clearTimeout(micRetryRef.current)
    micRetryRef.current = window.setTimeout(() => void ensureMicRef.current(), micBackoffRef.current)
    micBackoffRef.current = Math.min(micBackoffRef.current * 2, 15_000)
  }
  const onMicErr = (reason: string): void => {
    // A lost TRANSCRIPTION is not a dead microphone: the mic keeps listening,
    // the human hears the truth and repeats the sentence — not into a void.
    if (reason === 'asr-failed') {
      const now = Date.now()
      if (now - lastAsrLostAckRef.current > 30_000) {
        lastAsrLostAckRef.current = now
        ack(t.asrLost)
      }
      return
    }
    micRef.current = null
    setListening(false)
    setLiveVoice('')
    if (reason === 'not-allowed' || reason === 'unsupported') {
      // Terminal: retrying can't grant a permission or add browser support —
      // but the human is TOLD, once, instead of silence.
      if (!micTerminalAckedRef.current) {
        micTerminalAckedRef.current = true
        ack(reason === 'unsupported' ? t.micUnsupported : t.micBlocked)
      }
      return
    }
    if (reason === 'no-device' && !micTerminalAckedRef.current) {
      // Said once; the retry loop below stays armed — plugging a headset in
      // later brings the ear back by itself.
      micTerminalAckedRef.current = true
      ack(t.micNoDevice)
    }
    reprogrameazaMic()
  }

  async function ensureMic(preWarmedStream?: MediaStream): Promise<void> {
    // Vocea trăiește în alt tab (zăvor, 4 aug) → tabul ăsta nu pornește nimic;
    // veghea din efectul „o voce în toate taburile" o reia dacă acel tab moare.
    if (voceAiureaRef.current) return
    // OFFLINE URECHEA NU PORNEȘTE (22 aug): toate drumurile de auto-armare
    // (avatar-ready, vizibilitate, backoff) trec pe aici — un singur gard
    // acoperă tot; efectul pe `online` o re-armează la revenirea netului.
    if (!esteConectat()) return
    if (micRef.current || micStartingRef.current || micManualOffRef.current) return
    // MICROFON REFUZAT TERMINAL (fix buclă infinită): browserul a refuzat
    // accesul la microfon — `onMicErr('not-allowed')` a setat steagul. Nu are
    // rost să reîncercăm la fiecare visibilitychange/avatar-ready — browserul
    // ține minte refuzul. Userul trebuie să schimbe permisiunea în setările
    // browserului, apoi să reîncarce pagina. Fără garda asta, ensureMic()
    // se chema la nesfârșit (de la evenimente) și reluari se reseta la 0
    // de fiecare dată → buclă infinită de "microfonul nu a fost permis".
    if (micTerminalAckedRef.current) return
    // GARDA LIPSĂ (8 aug, consola ownerului: „[voce] urechi Chirp 3…" APĂRUT
    // PESTE „calea veche NU pornește" + audio mort la fiecare ~5 numere).
    // Garda de mai sus verifică doar mânerul căii VECHI (micRef) — dacă vocea
    // LIVE rulează (vlRef), o a doua chemare a lui ensureMic sărea peste blocul
    // live („e deja pornit") și cădea în blocul vechi, pornind A DOUA voce
    // PESTE cea vie: două urechi, două guri, vechea își închidea „fraza"
    // periodic și o tăia pe cea nouă. O sesiune live sănătoasă = nimic de făcut.
    if (vlRef.current) return
    if (micRetryRef.current) {
      window.clearTimeout(micRetryRef.current)
      micRetryRef.current = null
    }
    micStartingRef.current = true

    // Adrian, Jul 11: "on restart the microphone button freezes / gets
    // disabled". Cause: if the start threw an exception, the "starting
    // now" flag stayed stuck on true forever → every press fell onto
    // the STOP branch (nothing to stop) and the button looked dead. try/finally
    // guarantees the flag is released on EVERY exit path.
    try {
      // ── VOCE LIVE OpenAI Realtime (full-duplex): microfon + WebRTC direct la
      // OpenAI (the voice brain), which plays the reply itself + has native barge-in/anti-
      // echo. The transcript flows onto the ticker and gets saved on the server. If it's
      // not available (no key / failure), we fall back ONCE to STT→brain→TTS.
      // Kelion takes back its real voice BY ITSELF: if it was latched onto the fallback but
      // the recovery window has passed, it unlatches and retries full-duplex.
      if (realtimeOffRef.current && Date.now() - realtimeOffAtRef.current > REALTIME_RECOVER_MS) {
        realtimeOffRef.current = false
        realtimeFailCountRef.current = 0
      }
      // ── VOCEA LIVE FULL-DUPLEX — DRUMUL IMPLICIT (8 aug: „execută cu Gemini") ──
      // Un singur model AUDE + GÂNDEȘTE + VORBEȘTE + CHEAMĂ UNELTE, într-o
      // sesiune (măsurat pe cheia ownerului: 90 ms handshake, 491 ms primul
      // răspuns). Ownerul a ales azi drumul ăsta ca implicit — dispar prin
      // construcție VAD-ul local, frazele împachetate, pauza de 1,4 s și tot
      // lanțul ureche→creier→gură care a produs întârzierile măsurate azi.
      // Ieșirea de siguranță a rămas: `localStorage.kelion_voce_live = '0'`
      // repune calea veche, fără deploy.
      // RECONECTARE: sesiunile Live au limită de durată la Google — o cădere
      // mid-sesiune NU înseamnă „vocea a murit", ci „redeschide". Se reia
      // singură de câteva ori; abia dacă și reluarea pică se coboară pe calea
      // veche, cu motivul scris.
      // LIVE E DIN NOU IMPLICITĂ (8 aug seara, ownerul, pe calea clasică:
      // „asta nu e chat live, e semiduplex — modelul anterior rapid avea chat
      // live; ți-am dat solicitarea să-l pui în locul acestuia, dar
      // funcționalitățile să le păstrezi"). Are dreptate pe fapt: lanțul
      // ureche→creier→gură de mai jos e semiduplex prin construcție (ascultă,
      // împachetează, așteaptă răspunsul), pe când sesiunea Live aude continuu.
      // Funcționalitățile SUNT păstrate pe live: inventarul complet de unelte
      // (#893), reluarea după cădere (#892), regula limbii (#890), AEC (#889).
      // Ieșirea de siguranță s-a întors la forma din 8 aug dimineața:
      // localStorage.kelion_voce_live = '0' repune calea clasică, fără deploy —
      // iar la căderi repetate coborârea pe clasic + sonda de întoarcere rămân.
      if (localStorage.getItem('kelion_voce_live') !== '0' && !vlRef.current && !vlCazutRef.current) {
        const cap = await vocalLiveDisponibila()
        if (cap?.disponibil) {
          let reluari = 0
          // BANDA ACUMULEAZĂ DELTELE, PE CANALE (auditul 15 aug, confirmat pe
          // cod de 2 verificatori): serverul trimite FRAGMENTE incrementale
          // (ruta le adună cu +=), dar banda făcea setLiveVoice(text) —
          // înlocuire, nu acumulare: din „Nu știu ce să zic" se vedea doar
          // „ ce să", iar un delta de INTRARE (inclusiv halucinațiile urechii
          // pe ture apoi suprimate) suprascria vorbirea lui Kelion fără nicio
          // etichetă — exact „bălăriile" fotografiate. Două tampoane + semn:
          // 🎙 = ce aude, ⚡ = ce spune Kelion; ultima activitate câștigă banda.
          let vlAud = ''
          let vlSpune = ''
          const arataBanda = (canal: 'aud' | 'spune'): void => {
            const activ = canal === 'aud' ? vlAud : vlSpune
            const altul = canal === 'aud' ? vlSpune : vlAud
            const semn = canal === 'aud' ? '🎙 ' : '⚡ '
            const semnAltul = canal === 'aud' ? '⚡ ' : '🎙 '
            setLiveVoice(activ ? semn + activ : altul ? semnAltul + altul : '')
          }
          const porneste = async (): Promise<boolean> => {
            const generatie = ++vlGeneratieRef.current
            const vl = await deschideVocalLive({
              onGata: () => {
                if (generatie !== vlGeneratieRef.current) return
                // Un handshake urmat imediat de close nu e o sesiune sănătoasă:
                // rearmăm încercările doar după o perioadă continuă de funcționare.
                window.setTimeout(() => {
                  if (generatie === vlGeneratieRef.current && vlRef.current) reluari = 0
                }, VL_REARMARE_STABILA_MS)
                vlAud = ''
                vlSpune = ''
                setLiveVoice('') // orice eroare veche de pe bandă se șterge
                setListening(true)
              },
              onUser: (text, final) => {
                if (generatie !== vlGeneratieRef.current) return
                vlAud = final ? '' : vlAud + text
                arataBanda('aud')
              },
              onKelion: (text, final) => {
                if (generatie !== vlGeneratieRef.current) return
                vlSpune = final ? '' : vlSpune + text
                arataBanda('spune')
              },
              onTuraInchisa: () => {
                if (generatie !== vlGeneratieRef.current) return
                // tura s-a închis (gata sau tăiată) — banda nu păstrează resturi
                vlAud = ''
                vlSpune = ''
                setLiveVoice('')
              },
              // NIVELUL DE INTRARE (bargraful urechii) — doar scriem în ref;
              // MicBargraf îl citește prin rAF. Măsurat, nu presupus.
              onNivelIntrare: (nv) => {
                if (generatie !== vlGeneratieRef.current) return
                micNivelRef.current = nv
              },
              // PREAMP inițial din preferința salvată (owner: „ce faci daca e surd").
              preampInitial: preampNivel,
              // Cadrele de ECRAN din ușa creierului (cere_creierului) intră în
              // ACELAȘI handleControl ca la chatul scris — monitorul, cardurile
              // și documentele arată identic, indiferent cine le-a cerut.
              onControl: (frame) => {
                if (generatie === vlGeneratieRef.current) handleControl(frame as ChatControl)
              },
              // GPS-ul REAL al device-ului către sesiunea live (8 aug: „nu are
              // acces la gps" + „îi trebuiesc date de la gps real") — fixul
              // satelitar al paznicului + precizia măsurată (±m, de la senzor).
              coordonate: () =>
                coordsRef.current
                  ? { ...coordsRef.current, acc: precizieRef.current ?? undefined }
                  : null,
              // Ochii ușii creierului (8 aug: „hai și cu vedere"): un cadru
              // captat PE LOC + ultimele din tampon. Fără captură proaspătă
              // (camera oprită/negata) NU se trimit cadre stătute — mai bine o
              // tură fără vedere decât o vedere veche dată drept acum.
              cadre: () => {
                const proaspat = captureRef.current?.()
                if (!proaspat) return []
                // CALITATE ADAPTIVĂ LA ȚEAVĂ (12 aug): pe 4G/Wi-Fi trimitem până
                // la 4 cadre (fresh + 3 din tampon); pe 3G/2G doar 1–2, ca
                // vederea să nu sufoce urcarea slabă. Dimensiunea/calitatea JPEG
                // a fiecărui cadru se adaptează în CameraView (aceeași sursă).
                const n = calitateCamera(getTeava()).cadre
                // atenție: slice(-0) === slice(0) (întoarce TOT) — deci pe n=1
                // trimitem DOAR cadrul proaspăt, fără tampon.
                const dinTampon = n > 1 ? frameBufRef.current.slice(-(n - 1)) : []
                return [...dinTampon, proaspat]
              },
              // VEDEREA CONTINUĂ (8 aug: „trebuie să poată folosi camera"):
              // sesiunea live primește un cadru proaspăt la ~2,5s cât camera
              // e pornită — captura întoarce null când camera e oprită, deci
              // nu pleacă nimic stătut.
              cadruLive: () => captureRef.current?.() ?? null,
              // CE E PE MONITOR și pe VOCE (10 aug): același conținut ca la
              // chatul scris — get_monitor îl citește prin ușa creierului.
              monitor: () => getMonitorContent(),
              // ANCORA CENTRULUI DE TRANZACȚIONARE pe VOCE (N val 2a): aceeași
              // sursă ca la chatul scris (getStareTranzactii — se stinge singură
              // când tabul nu mai e pe ecran), ca vocea să răspundă pe CIFRELE
              // reale și să deseneze nivelurile pe grafic (frame {niveluri}).
              tranzactii: () => getStareTranzactii(),
              onEroare: (motiv) => {
                if (generatie !== vlGeneratieRef.current) return
                // PE ECRAN, nu doar în consolă (8 aug: „pornește la voce, dar
                // nimic" — eroarea reală era un warn pe care nu-l vedea nimeni).
                setLiveVoice(`⚠ voce live: ${motiv}`.slice(0, 140))
                console.warn(`[vocalLive] ${motiv}`)
                unregisterLiveFocus()
                vlRef.current?.inchide()
                vlRef.current = null
                setListening(false)
                // Oprirea manuală nu se „repară" — doar căderile.
                if (micManualOffRef.current) return
                // Cauzele NE-tranzitorii nu se „repară" prin reconectare (F4):
                // creditul epuizat și sesiunea moartă pică identic la fiecare
                // reluare — 3 reconectări degeaba doar amânau mesajul onest.
                // ATENȚIE (R4): stringurile sunt CUPLATE cu lib/vocalLive.ts
                // (onclose 1008) — schimbi acolo, schimbi și aici.
                if (motiv.includes('credit epuizat') || motiv.includes('nu ești autentificat')) return
                if (reluari < VL_MAX_RELUARI) {
                  reluari++
                  // RAPID, nu rar (8 aug, ownerul: „chiar dacă se întrerupe 1
                  // sec, e suficient să se redeschidă și să continue logic").
                  // REALITATEA CODULUI (comentariul vechi promitea „până la
                  // 90" — fals, F11): prima reluare la 400 ms, apoi la 1 s,
                  // TREI în total (VL_MAX_RELUARI); după ele se coboară pe
                  // calea veche, iar SONDA de 5 s readuce live-ul când
                  // serverul revine — acela e drumul de lungă durată, nu
                  // bucla de reluări. Banda apare abia la ultima ratare, ca
                  // un sughiț de-o secundă să rămână invizibil pe ecran.
                  const pauza = reluari === 1 ? 400 : 1000
                  if (reluari < VL_MAX_RELUARI) setLiveVoice('')
                  console.info(`[vocalLive] reluare ${reluari}/${VL_MAX_RELUARI} în ${pauza} ms`)
                  window.setTimeout(() => {
                    if (
                      generatie === vlGeneratieRef.current &&
                      !micManualOffRef.current &&
                      !vlRef.current
                    ) {
                      void porneste()
                    }
                  }, pauza)
                } else {
                  // Coborârea pe calea veche NU trece iar prin blocul live (am
                  // pica în aceeași groapă în buclă): se marchează sesiunea asta
                  // de tab ca „live căzut" și ensureMic pornește lanțul vechi.
                  console.error('[vocalLive] 3 reluări picate — cobor pe calea vocală veche')
                  setLiveVoice('⚠ vocea live a picat de 3 ori — trec pe calea veche')
                  vlCazutRef.current = true
                  void ensureMic()
                  // ÎNTOARCEREA PE LIVE (8 aug: „trimite err 1006 pe live… și
                  // moare, nu mă mai aude"). Până acum, după cădere rămâneai pe
                  // calea veche până la reîncărcarea paginii — vocea live revenea
                  // doar dacă pica un mesaj SCRIS (sonda aia trăia în trimitere).
                  // Acum sondăm chiar capabilitatea live la 5s: când serverul
                  // revine, oprim calea veche și repornim lanțul — live-ul își ia
                  // locul înapoi singur.
                  if (vlSondaRef.current) window.clearInterval(vlSondaRef.current)
                  const sonda = window.setInterval(() => {
                    if (generatie !== vlGeneratieRef.current) {
                      // Sesiune NOUĂ pornită între timp (F9): sonda veche se
                      // sinucide pe PROPRIUL handle — altfel, cu ref-ul
                      // suprascris de sesiunea nouă, intervalul orfan polla
                      // /capability la 5s pe termen nelimitat.
                      window.clearInterval(sonda)
                      if (vlSondaRef.current === sonda) vlSondaRef.current = null
                      return
                    }
                    if (micManualOffRef.current) {
                      // Omul a închis microfonul cu mâna — nu pornim nimic peste el.
                      window.clearInterval(sonda)
                      if (vlSondaRef.current === sonda) vlSondaRef.current = null
                      return
                    }
                    void vocalLiveDisponibila()
                      .then((c) => {
                        if (generatie !== vlGeneratieRef.current) return
                        if (!c?.disponibil || vlRef.current) return
                        window.clearInterval(sonda)
                        if (vlSondaRef.current === sonda) vlSondaRef.current = null
                        console.info('[vocalLive] serverul a revenit — mă întorc pe vocea live')
                        vlCazutRef.current = false
                        reluari = 0
                        micRef.current?.stop()
                        micRef.current = null
                        void ensureMic()
                      })
                      .catch(() => {})
                  }, 5000)
                  vlSondaRef.current = sonda
                }
              },
            })
            if (vl) {
              if (generatie !== vlGeneratieRef.current || micManualOffRef.current) {
                vl.inchide()
                return false
              }
              vlRef.current = vl
              registerLiveFocus({
                onInterrupt: () => {
                  // LIVE has a separate WebAudio queue from audioIO's TTS.
                  // Cutting only stopVoice() leaves that queue audible → dual voice.
                  stopVoice()
                  vl.intrerupeRedarea()
                },
              })
              // ANTI-ECOU la (re)deschidere sub Chirp viu (vânătoarea 22 aug):
              // registerLiveFocus NU mai taie tura scrisă în redare — deci
              // urechea sesiunii NOI trebuie să tacă cât mai sună Chirp-ul,
              // altfel modelul își aude coada („varză"). Eliberarea există
              // deja: onEnd-ul playVoice face setRedareExterna(false) pe
              // vlRef.current — adică exact sesiunea asta.
              if (isVoicePlaying()) vl.setRedareExterna(true)
              setListening(true)
              // Tabul ăsta a luat VOCEA — o anunță pe canal, ca celelalte
              // taburi să se zăvorască (auditul de noapte: calea live pornea
              // fără takeover, deci un al doilea tab pornea liniștit a doua voce).
              emiteTakeover(canalVoceRef.current, tabVoceIdRef.current)
              setForeignVoiceLock(false) // tabul ăsta ARE acum vocea — nu e zăvorât
              return true
            }
            return false
          }
          if (await porneste()) {
            console.info(`[vocalLive] pornit pe ${cap.model} (voce ${cap.voce}) — calea veche NU pornește`)
            // Contorul de minute: vocea live se taxează ca orice voce (adminul e
            // scutit pe server). Bate cât timp sesiunea trăiește.
            if (vlTickRef.current) window.clearInterval(vlTickRef.current)
            let ultimulTick = Date.now()
            vlTickRef.current = ceas('puls minute voce live', () => {
              if (!vlRef.current) {
                if (vlTickRef.current) window.clearInterval(vlTickRef.current)
                vlTickRef.current = null
                return
              }
              const secs = Math.round((Date.now() - ultimulTick) / 1000)
              ultimulTick = Date.now()
              void fetch('/api/realtime/tick', {
                method: 'POST',
                credentials: 'include',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ seconds: secs }),
              }).catch(() => {})
            }, 60_000)
            return
          }
        }
        console.info('[vocalLive] indisponibil pe server — rămân pe calea vocală obișnuită')
      }
      if (!realtimeOffRef.current) {
        try {
          const rv = await startRealtimeVoice({
            language: speechLangRef.current,
            // GPS FROM THE DEVICE (Jul 25): when the session starts we send the current
            // position → the server puts it into the voice context (weather/"where am I").
            coords: coordsRef.current ?? undefined,
            // THE EARS (Aug 1 — one brain): the live transcript only feeds the
            // dictation band; the FINAL text no longer enters the chat here —
            // if it passes the name gate, onAddressed sends it through send(),
            // which adds the user bubble exactly like a typed message (single
            // display, single save, single brain).
            onUserTranscript: (text, done) => {
              if (done) setLiveVoice('')
              else setLiveVoice(text)
            },
            // THE MOUTH: what the session speaks is the brain's reply, fed by
            // send() sentence by sentence (rv.speak) — nothing to add to the
            // chat from here; the bubbles already stream via send().
            onAssistantTranscript: (_text, done) => {
              if (done) setLiveVoice('')
            },
            // SPOKEN = WRITTEN: the utterance addressed to Kelion takes the
            // EXACT path of a typed message — the same brain, the same tools,
            // the same escalation, the same bubbles. The voiceprint rides along
            // (speaker check, like on the STT dictation path); the second
            // argument marks the turn as spoken so the server shapes the reply
            // for speech (clean sentences, no markdown tables).
            onAddressed: (_text, vf, speaker, audio) => {
              // VOCE UNIFICATĂ (Adrian, 5 aug): fără transcript de unit — fraza
              // pleacă DIRECT la creier ca AUDIO. Poarta de timbru (realtimeVoice) a
              // filtrat deja străinii; creierul unic aude fraza și decide singur
              // dacă i se vorbește (altfel tace). Fără audio nu are ce trimite.
              if (!audio) return
              frazaInchisa() // contor: zero
              setPendingVoiceFeatures(vf)
              pendingSpeakerRef.current = speaker ?? null
              pendingAudioRef.current = audio
              void sendRef.current('', true)
            },
            // NO onToolCall (Aug 1 — one brain): the voice session has NO tools
            // at all. Every action the user asks for by voice goes through
            // onAddressed → send() → the ONE brain, which drives the monitor,
            // camera, maps and app panels through the same control frames as a
            // typed turn. The second entity that thought in parallel with the
            // brain (the live "two voices at once" bug) is gone by construction.
            onState: (s, note) => {
              // SOLID Realtime connection (WebRTC `connected`) → resets the failure
              // counter: full-duplex works, any earlier mishap is forgiven.
              if (s === 'live') {
                realtimeFailCountRef.current = 0
                voiceDownAckedRef.current = false // the voice is back — a future outage is announced again
                // THE RED DOT ON PROOF, NOT ON HOPE (audit Aug 2): `listening`
                // used to light up right after the SDP answer, before ICE ever
                // connected — the UI asserted "I hear you" without a successful
                // measurement. 'live' is the measurement (pc connected / Chirp
                // ear started), so the dot and the backoff reset move HERE.
                micBackoffRef.current = 1000
                setListening(true)
                return
              }
              if (s === 'error') {
                // SESSION ROTATION ≠ FAILURE (live F12 proof, Jul 24: "Your
                // session hit the maximum duration of 60 minutes" → the counter
                // reached 3 after 3 hours of continuous use and extinguished
                // full-duplex for good). OpenAI's 60-min limit is a NORMAL
                // life cycle: we restart WITHOUT penalizing.
                const isRotation = /maximum duration|session.*(expired|limit)|60 minutes/i.test(note ?? '')
                let gaveUp = false
                if (!isRotation) {
                  // We count the REAL failure. Latch onto STT ONLY after 3 failures; below
                  // the threshold the next start RETRIES full-duplex.
                  realtimeFailCountRef.current += 1
                  const giveUp = realtimeFailCountRef.current >= REALTIME_MAX_FAILS
                  console.error(
                    `voce realtime a picat (${realtimeFailCountRef.current}/${REALTIME_MAX_FAILS}):`,
                    note ?? 'fără detalii',
                  )
                  if (giveUp) { realtimeOffRef.current = true; realtimeOffAtRef.current = Date.now(); gaveUp = true }
                }
                if (micRef.current) {
                  // Cleans up the Realtime session if it still exists (mic + WebRTC),
                  // otherwise it stayed captured in parallel with the STT microphone.
                  micRef.current?.stop?.()
                  micRef.current = null
                  setListening(false)
                  setLiveVoice('')
                  micStartingRef.current = false
                  // ONE honest status when we give up (Aug 2): both mouths are
                  // down — the human hears it ONCE, in chat, instead of silence.
                  if (gaveUp && !voiceDownAckedRef.current) {
                    voiceDownAckedRef.current = true
                    ack(t.voiceDownTemp)
                  }
                  // BACKOFF, not a tight loop (Aug 2 — 57 restarts in 24h came
                  // from this instant re-entry): the restart waits on the same
                  // backoff as the STT path's onMicErr.
                  reprogrameazaMic()
                }
              }
            },
          })
          if (micManualOffRef.current || micRef.current) {
            rv.stop()
            // The Chirp mouth emits 'live' DURING start — if this stale session
            // is rejected here, the dot it lit must not survive it.
            if (!micRef.current) setListening(false)
            return
          }
          // THE SINGLE-VOICE RULE (Adrian, Jul 26: "there must never be
          // 2 voices at the same time"): we mark the handle as a Realtime session — while it's
          // installed, the written chat's Chirp voice is NOT played (see c.audio) and
          // is no longer synthesized on the server either (serverVoiceOff on send).
          // CHIRP MOUTH (Adrian, Aug 2 — "gura pe Google Chirp 3 HD, OpenAI doar
          // rezervă"): a guraChirp session is NOT marked — its voice ARRIVES as
          // the server's {audio} frames, so they must PLAY (not be suppressed at
          // c.audio) and serverVoiceOff must stay false so the server keeps
          // synthesizing. The OpenAI reserve keeps the old rule.
          ;(rv as unknown as { isRealtime?: boolean }).isRealtime = rv.guraChirp !== true
          micRef.current = rv as unknown as MicHandle
          rvLiveRef.current = rv
          // The pre-warmed stream is only for the STT path; Realtime opens
          // its own microphone — without the closing here, the pre-warm capture stayed
          // STUCK in parallel (mic open twice) for as long as the voice session lasted.
          preWarmedStream?.getTracks().forEach((t) => t.stop())
          // If the fallback TTS is still playing at install time, we start MUTED
          // (anti-echo), as on the STT paths — the unmute comes from stopVoice/onEnd.
          if (isVoicePlaying()) rv.setMuted(true)
          // PROACTIVE ROTATION at 55 min (OpenAI's limit is 60): we restart the session
          // BEFORE the server cuts it — the user feels no break
          // and no "failure" gets counted. The timer dies with the session.
          // CHIRP MOUTH (Aug 2): no OpenAI session, no 60-min limit — rotating
          // would just blip the microphone for nothing, so no timer is armed.
          const rotateTimer = rv.guraChirp === true ? null : window.setTimeout(() => {
            if (micRef.current === (rv as unknown as MicHandle) && !micManualOffRef.current) {
              rv.stop()
              micRef.current = null
              setListening(false)
              micStartingRef.current = false
              void ensureMicRef.current()
            }
          }, 55 * 60_000)
          // VOICE BILLING PER MINUTE (Adrian, Jul 25): while the voice is active,
          // we pulse every 20s → the server debits the seconds from the credits. On "stop"
          // from the server (out of credit) we stop the voice; on any stop, the timer dies.
          // (GPS is NO longer pushed on this pulse — Adrian, Jul 26: "only
          // when GPS apps are used or location detection is needed".
          // The position is read on demand, in the location tools — see
          // onToolCall + getFreshCoords.)
          let lastTick = Date.now()
          // THE VOICE METER RUNS IN EVERY MODE (Adrian, Aug 2): the per-minute
          // pulse is the PRODUCT price of voice — the user's credits pay for
          // the service, not for a specific provider. Chirp mode costs US ≈ 0
          // (Google free tier), which is exactly the margin the owner wants;
          // an earlier change stopped the pulse in Chirp mode and silently
          // made voice FREE for every user — reverted. The wallet side is in
          // routes/realtime.ts (admin exempt — the owner doesn't pay himself).
          const voiceTick = ceas('puls minute voce', () => {
            const secs = Math.round((Date.now() - lastTick) / 1000)
            lastTick = Date.now()
            void fetch('/api/realtime/tick', {
              method: 'POST',
              credentials: 'include',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ seconds: secs }),
            })
              .then((r) => (r.ok ? r.json() : null))
              .then((j: { stop?: boolean } | null) => {
                window.dispatchEvent(new CustomEvent('kelion:credits-changed'))
                if (j?.stop) {
                  rv.stop()
                  micRef.current = null
                  setListening(false)
                }
              })
              .catch(() => {})
          }, 20_000)
          const rotStop = rv.stop.bind(rv)
          const origStop = () => {
            if (voiceTick !== null) clearInterval(voiceTick)
            rotStop()
          }
          rv.stop = () => {
            if (rotateTimer !== null) clearTimeout(rotateTimer)
            // Sesiunea s-a oprit → marcajul cade IMEDIAT, pe orice drum de stop
            // (manual, rotation, out of credit) — even if micRef gets cleaned up
            // later, the chat's Chirp voice doesn't stay stuck on mute.
            ;(rv as unknown as { isRealtime?: boolean }).isRealtime = false
            if (rvLiveRef.current === rv) rvLiveRef.current = null
            origStop()
          }
          // `listening` is NOT asserted here (audit Aug 2): the dot lights up
          // on the proven 'live' state — see onState above.
          return
        } catch (e) {
          const err = e as Error & { code?: string; retryable?: boolean }
          // MICROFON REFUZAT/ABSENT (DOMException de la getUserMedia): mesaj clar, o
          // singură dată, prin onMicErr (care reprogramează și retry-ul) — nu-l
          // tratăm ca un eșec de „voce" (n-are rost să numărăm 3 rateuri pentru o
          // permisiune lipsă). Singura cale vocală rămâne cea unică; nu există STT.
          if (e instanceof DOMException && /NotAllowed|NotFound|NotReadable|Security|Permission/i.test(e.name)) {
            onMicErr(/NotFound|NotReadable/i.test(e.name) ? 'no-device' : 'not-allowed')
            return
          }
          if (err?.code === 'need_login' || err?.code === 'need_credit') {
            // NOT transient (audit Aug 2): retrying can't sign a session in or
            // refill a wallet — before, a user out of credit burned the 3
            // chances and then heard "temporarily unavailable… I will retry",
            // a promise that could never come true. Latch STT now and tell the
            // REAL reason. The 90s recovery stays armed on purpose: once he
            // tops up (or signs in), the voice comes back by itself — exactly
            // what the message promises.
            realtimeOffRef.current = true
            realtimeOffAtRef.current = Date.now()
            if (!voiceDownAckedRef.current) {
              voiceDownAckedRef.current = true
              ack(err.code === 'need_credit' ? t.voiceNeedCredit : t.voiceNeedLogin)
            }
          } else {
            // The Realtime start threw (no key / WebRTC blocked). We count the
            // same way: 3 chances before latching onto STT — a transient start failure
            // no longer extinguishes full-duplex for the whole session.
            realtimeFailCountRef.current += 1
            if (realtimeFailCountRef.current >= REALTIME_MAX_FAILS) {
              realtimeOffRef.current = true
              realtimeOffAtRef.current = Date.now()
              // ONE honest status (Aug 2): both mouths failed — say it once,
              // then dictation carries the conversation.
              if (!voiceDownAckedRef.current) {
                voiceDownAckedRef.current = true
                ack(t.voiceDownTemp)
              }
            }
          }
        }
      }

      // ── VOCE UNIFICATĂ — O SINGURĂ CALE (Adrian, 5 aug: „urechea o scoți total
      // ca modelul are tot; tot decis de creierul unic"). STT-ul a DISPĂRUT complet:
      // nici streaming (WS /api/asr-stream), nici batch (/api/asr). Singura cale
      // vocală e startRealtimeVoice de mai sus — microfon → micStream (VAD local) →
      // AUDIO brut la creierul unic, care aude și decide singur dacă i se vorbește.
      // Dacă am ajuns aici, calea vocală nu s-a instalat (microfon refuzat / eroare
      // de start): NU cădem pe niciun STT — reîncercăm calea unică mai târziu, cu
      // backoff (veghea permanentă și revenirea în tab o repornesc oricum).
      if (!micManualOffRef.current && !micRef.current) {
        reprogrameazaMic()
      }
    } finally {
      micStartingRef.current = false
    }
  }
  const ensureMicRef = useRef(ensureMic)
  ensureMicRef.current = ensureMic

  function toggleMic(): void {
    // OFFLINE: butonul comandă urechea LOCALĂ (kitul, 22 aug) — pornit/oprit,
    // fără nicio mașinărie de server.
    if (!esteConectat()) {
      if (urecheaLocalaRef.current) {
        micManualOffRef.current = true
        urecheaLocalaRef.current.stop()
        urecheaLocalaRef.current = null
        setListening(false)
      } else {
        micManualOffRef.current = false
        void pornesteUrecheaLocalaRef.current()
      }
      return
    }
    // Adrian, Jul 11: "the microphone button doesn't work right". Cause: the start
    // is async (~0.5–2s); a press in that window didn't find micRef yet
    // and fell onto the START branch — i.e. stopping was impossible to express
    // while the boot was in flight, and a double-click left the microphone forever
    // on. Now: pressed during the start = STOP (manualOff), and
    // ensureMic checks manualOff after every await before installing.
    // + vlRef (9 aug, ownerul: „dacă ar merge să-l oprești, că nici asta nu
    // merge"): pe vocea LIVE micRef e null — condiția veche nu intra NICIODATĂ
    // pe ramura de închidere, sesiunea (și facturarea) supraviețuiau butonului.
    if (micRef.current || micStartingRef.current || vlRef.current) {
      micManualOffRef.current = true
      vlGeneratieRef.current++
      // Also release the start flag: if the boot really is in flight, it sees
      // manualOff at the end and stops by itself; if the flag was stuck from an
      // old error, the button heals here instead of staying dead.
      micStartingRef.current = false
      unregisterLiveFocus()
      vlRef.current?.inchide()
      vlRef.current = null
      micRef.current?.stop()
      micRef.current = null
      // intentional stop: a stuck fragment must NOT be sent after teardown
      setListening(false)
      return
    }
    micManualOffRef.current = false
    // Apăsarea manuală bate zăvorul dintre taburi: omul a ales TABUL ĂSTA.
    voceAiureaRef.current = false
    // …și bate și lacătul „live căzut de 3×" (registrul frontend, lot C): omul
    // care apasă BUTONUL cere explicit vocea — sesiunea live primește o șansă
    // proaspătă (dacă iar pică de 3×, plasa coboară la fel pe calea veche;
    // fără reset, doar un refresh de pagină mai readucea vreodată vocea live).
    vlCazutRef.current = false

    // PRE-WARM: we open the microphone before startMicStream, so that pressing
    // the "mic on" button activates almost instantly. If the user presses
    // STOP during the warmup, we stop the pre-warmed stream and give up.
    if (navigator.mediaDevices?.getUserMedia) {
      micStartingRef.current = true
      void (async () => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          })
          if (micManualOffRef.current || micRef.current) {
            stream.getTracks().forEach((t) => t.stop())
            micStartingRef.current = false
            return
          }
          // WE HAND OVER THE BATON (Jul 25 — Adrian: "after I stop the microphone I can't
          // start it again"): ensureMic guards on micStartingRef and exited IMMEDIATELY
          // while our pre-warm flag was still true → the button's start
          // died in vain, and the flag stayed stuck on true and every
          // next press fell alternately onto stop/nothing. We release the flag
          // right before the handover — the section is synchronous, ensureMic takes it
          // back by itself on entry, so the race window is zero.
          micStartingRef.current = false
          await ensureMicRef.current(stream)
          if (!micRef.current) {
            stream.getTracks().forEach((t) => t.stop())
          }
        } catch {
          // Pre-warm failed → we let the normal path report the error/correctly.
          micStartingRef.current = false
          void ensureMicRef.current()
        }
      })()
      return
    }
    void ensureMicRef.current()
  }

  // Permanent hearing: starts TOGETHER WITH THE AVATAR LOADING (Adrian, Jul 28:
  // "move the opening to when the GLB loads"). WHY: starting at the raw
  // mount ran DURING the heavy parsing of the 3D model (`/kelion-rpm.glb`) —
  // main thread busy → getUserMedia/AudioContext stumbled, the first
  // call failed and went into backoff retries (1s→2s→4s…), hence "starts
  // slowly". Now we wait for the `kelion:avatar-ready` signal (emitted by AvatarModel
  // when the base GLB has loaded, the thread is free) and ONLY THEN arm
  // the microphone — the first try catches, no backoff. For the owner (permission
  // already granted) it starts with no click. 4s net: if the avatar doesn't load
  // (page without an avatar / GLB failure), the microphone starts anyway, it's not lost.
  useEffect(() => {
    let armed = false
    const arm = (): void => {
      if (armed) return
      armed = true
      void ensureMicRef.current()
    }
    // If the avatar already loaded before we attach the listener (a race on
    // a fast start), we start on the spot; otherwise we wait for the event.
    if ((window as unknown as { __kelionAvatarReady?: boolean }).__kelionAvatarReady) arm()
    else window.addEventListener('kelion:avatar-ready', arm, { once: true })
    const armFallback = window.setTimeout(arm, 4000)
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void ensureMicRef.current()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('kelion:avatar-ready', arm)
      window.clearTimeout(armFallback)
      document.removeEventListener('visibilitychange', onVisible)
      if (micRetryRef.current) window.clearTimeout(micRetryRef.current)
      if (upgradeTimerRef.current) window.clearTimeout(upgradeTimerRef.current)
      vlGeneratieRef.current++
      unregisterLiveFocus()
      vlRef.current?.inchide()
      vlRef.current = null
      micRef.current?.stop()
      micRef.current = null
      stopVoice()
    }
  }, [])

  // MESSENGER — VOCEA CU KELION SE SUSPENDĂ CÂT VORBEȘTI CU OMUL (Faza 2). Când
  // un apel se CONECTEАZĂ, oprim microfonul/sesiunea Kelion (altfel două microfoane
  // s-ar bate, iar Kelion ar „auzi" conversația și ar răspunde). Captura apelului
  // (lib/apelMic) preia microfonul. La ÎNCHIDEREA apelului, revenim la vocea Kelion.
  useEffect(() => {
    const laApel = (e: Event): void => {
      const d = (e as CustomEvent).detail as { stare?: string }
      if (d?.stare === 'conectat') {
        micManualOffRef.current = true // blochează re-armarea automată a urechii Kelion
        vlGeneratieRef.current++
        unregisterLiveFocus()
        vlRef.current?.inchide()
        vlRef.current = null
        micRef.current?.stop()
        micRef.current = null
        setListening(false)
        stopVoice()
      } else if (d?.stare === 'inchis' || d?.stare === 'refuzat') {
        // Apelul s-a terminat → readucem vocea cu Kelion (dacă nu era oprită manual).
        micManualOffRef.current = false
        // Vocea live primește o șansă PROASPĂTĂ (F9b al marii verificări):
        // dacă live-ul căzuse înaintea apelului, sonda de revenire a murit la
        // conectare (micManualOff) și fără resetul ăsta ensureMic rămânea pe
        // calea veche cu serverul sănătos — până la un toggle manual
        // (aceeași regulă ca la toggleMic).
        vlCazutRef.current = false
        void ensureMicRef.current()
      }
    }
    window.addEventListener('kelion:apel-stare', laApel)
    return () => window.removeEventListener('kelion:apel-stare', laApel)
  }, [])

  // ULTRA-FAST FULL-DUPLEX STREAMING FOR EVERYONE, THE SAME (Adrian, Jul 14: "audio
  // full duplex streaming ultra fast for everyone, now; everyone equally fast").
  // REMOVED the admin-only LiveKit detour: it entered the LiveKit room ALONE and stopped
  // the HTTP microphone, but when the voice agent on the VPS did NOT process audio, the state
  // stayed `live` (fallback ONLY on `error`/`closed`) → the admin "left but couldn't
  // hear", a different (deaf) experience than the clients'. NOW admin AND clients use
  // EXACTLY the same path: instant streaming (`micStream` → /api/asr-stream Google STT,
  // VOX + barge-in, fast first word), started default-on by the "Permanent hearing"
  // above — proven to work (the real voiceprints are created on it). Zero separate
  // admin channel, zero dependency on the LiveKit agent.

  // ── DANS PE MUZICA DIN CAMERĂ (Adrian, 4 aug): cât microfonul ascultă,
  // deschidem un tap de analiză pe microfon (motorBit) și, când e MUZICĂ, gura
  // tace (nu vorbi peste ea) iar avatarul dansează — fiecare mișcare PORNEȘTE
  // pe un bit, ca să fie sincron. Permisiunea de microfon e deja dată (mic-ul
  // ascultă), deci al doilea getUserMedia nu mai întreabă.
  const DANSURI = ['dans', 'dans-2', 'dans-3', 'dans-4', 'dans-5', 'dans-6', 'dans-7', 'dans-8', 'dans-9', 'dans-10']
  useEffect(() => {
    if (!listening || !navigator.mediaDevices?.getUserMedia) return
    let opreste = (): void => {}
    let anulat = false
    let stream: MediaStream | null = null
    const peDansGata = (): void => {
      dansLiberRef.current = true
    }
    window.addEventListener('kelion-gesture-done', peDansGata)
    void navigator.mediaDevices
      .getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
      .then((s) => {
        if (anulat) {
          s.getTracks().forEach((t) => t.stop())
          return
        }
        stream = s
        opreste = pornesteDansPeMuzica(s, {
          peBit: () => {
            // O mișcare nouă pornește DOAR pe un bit și doar dacă avatarul e
            // liber (mișcarea precedentă s-a terminat) — așa dansul e sincron
            // pe ritm, nu un vârtej de clipuri suprapuse.
            if (!muzicaActivaRef.current || !dansLiberRef.current) return
            dansLiberRef.current = false
            dansIdxRef.current = (dansIdxRef.current + 1) % DANSURI.length
            window.dispatchEvent(new CustomEvent('kelion-gesture', { detail: DANSURI[dansIdxRef.current] }))
          },
          muzicaOn: () => {
            muzicaActivaRef.current = true
            // Taci peste muzică: oprește vocea live și redarea în curs.
            rvLiveRef.current?.stopSpeaking()
            interruptAll('music-start')
            // Prima mișcare pornește imediat; următoarele vin pe bit.
            if (dansLiberRef.current) {
              dansLiberRef.current = false
              window.dispatchEvent(new CustomEvent('kelion-gesture', { detail: DANSURI[dansIdxRef.current] }))
            }
          },
          muzicaOff: () => {
            muzicaActivaRef.current = false
            dansLiberRef.current = true
          },
        })
      })
      .catch(() => {
        /* fără al doilea microfon → fără dans pe muzică; nimic stricat */
      })
    return () => {
      anulat = true
      window.removeEventListener('kelion-gesture-done', peDansGata)
      opreste()
      stream?.getTracks().forEach((t) => t.stop())
      muzicaActivaRef.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listening])

  // ── O VOCE ÎN TOATE TABURILE (Adrian, 4 aug: două taburi deschise = două
  // voci, una live + una robotică din dictarea de rezervă — măsurat din captura
  // lui). Zăvorul vechi (BroadcastChannel din realtimeVoice) acoperea DOAR
  // sesiunea live; aici acoperim TOT lanțul vocii: la {takeover} străin tabul
  // ăsta oprește orice microfon și se zăvorăște; cât ține vocea, bate {inima};
  // dacă inima tabului activ tace (>25s) sau vine {ramasBun} la închidere, un
  // tab zăvorât reia vocea singur. Regulile pure: lib/voceUnica.ts.
  useEffect(() => {
    const bc = deschideCanalVoce()
    canalVoceRef.current = bc
    if (!bc) return
    const opresteLocal = (): void => {
      if (micRetryRef.current) {
        window.clearTimeout(micRetryRef.current)
        micRetryRef.current = null
      }
      if (upgradeTimerRef.current) {
        window.clearTimeout(upgradeTimerRef.current)
        upgradeTimerRef.current = null
      }
      vlGeneratieRef.current++
      unregisterLiveFocus()
      vlRef.current?.inchide()
      vlRef.current = null
      if (vlSondaRef.current) {
        window.clearInterval(vlSondaRef.current)
        vlSondaRef.current = null
      }
      micRef.current?.stop()
      micRef.current = null
      setListening(false)
      setLiveVoice('')
    }
    const onMesaj = (ev: MessageEvent): void => {
      const ce = judecaMesajVoce(ev.data as MesajVoce | null, tabVoceIdRef.current, voceAiureaRef.current)
      if (ce === 'zavoraste') {
        voceAiureaRef.current = true
        ultimaInimaRef.current = Date.now()
        opresteLocal()
        // ZĂVORUL ACOPERĂ ȘI CHIRP-UL SCRIS (owner, 20 aug: voci paralele pe 2
        // taburi). `opresteLocal` oprea doar sesiunea LIVE/mic; dar un tab de fundal
        // în care SCRII tot reda Chirp (GURA 1), peste vocea tabului activ. Armăm
        // zăvorul ca `requestTtsFocus` să respingă Chirp-ul aici — o singură gură în
        // tot browserul. (Era construit dar nearmat — se aprindea doar în teste.)
        setForeignVoiceLock(true)
      } else if (ce === 'inima') {
        ultimaInimaRef.current = Date.now()
      } else if (ce === 'reia') {
        voceAiureaRef.current = false
        setForeignVoiceLock(false) // tabul ăsta reia vocea — nu mai e zăvorât
        void ensureMicRef.current()
      }
    }
    bc.addEventListener('message', onMesaj)
    const puls = ceas('puls interfață', () => {
      // ÎNTREG lanțul vocii ține inima — și calea veche (micRef), și sesiunea
      // LIVE (vlRef). Auditul de noapte (9 aug): inima bătea doar pe micRef,
      // iar calea live (implicită din 8 aug) era în afara zăvorului — două
      // taburi = două voci, bugul din 4 aug reapărut prin construcție.
      if (micRef.current || vlRef.current) bc.postMessage({ inima: tabVoceIdRef.current })
      else if (voceAiureaRef.current && inimaAMurit(ultimaInimaRef.current, Date.now())) {
        // Tabul care ținea vocea a murit fără rămas-bun → vocea revine AICI.
        voceAiureaRef.current = false
        void ensureMicRef.current()
      }
    }, INIMA_BATE_MS)
    const laPlecare = (): void => {
      if (micRef.current || vlRef.current) bc.postMessage({ ramasBun: tabVoceIdRef.current })
    }
    window.addEventListener('pagehide', laPlecare)
    return () => {
      window.removeEventListener('pagehide', laPlecare)
      window.clearInterval(puls)
      bc.removeEventListener('message', onMesaj)
      laPlecare()
      bc.close()
      canalVoceRef.current = null
    }
  }, [])

  // While it listens, the screen doesn't fall asleep — a phone with the screen off cuts its
  // microphone, and "permanent on" would die at the first screen-off.
  useEffect(() => {
    keepScreenOn(listening)
    return () => keepScreenOn(false)
  }, [listening])

  // Apply a language the SERVER decided (it already persisted the pref) —
  // update the recognizer + the local mirror. No-op if already active.
  function applyLang(code: string): void {
    if (code === speechLangRef.current) return
    speechLangRef.current = code
    setSpeechLang(code)
    mirrorLang(code)
  }

  // Connectivity recovery: after a turn failed offline, resume the moment the
  // browser regains a connection. Each request is independent, so the next
  // message just works.
  useEffect(() => {
    const onOnline = (): void => {
      if (!offlineRef.current) return
      offlineRef.current = false
      const retry = retryTextRef.current
      retryTextRef.current = null
      const tsEroare = retryEroareTsRef.current
      retryEroareTsRef.current = null
      const tsUser = retryUserTsRef.current
      retryUserTsRef.current = null
      if (retry) {
        // Resume from where we were cut off: drop EXACT the failed turn's error
        // bubble + its user bubble (both by their recorded ts), then re-send.
        // NOT slice(0,-2): bubbles that arrived between the failure and the
        // recovery (voice transcript, another question) must survive; and the
        // user bubble goes by TS, not content (document turns differ).
        setMessages((cur) =>
          cur.filter(
            (mm) =>
              !(mm.role === 'assistant' && tsEroare !== null && mm.ts === tsEroare) &&
              !(mm.role === 'user' && tsUser !== null && mm.ts === tsUser),
          ),
        )
        window.setTimeout(() => void sendRef.current(retry), 400)
      }
    }
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [])

  // Load the user's persisted speech language (localStorage instantly, then the
  // server which follows the user across devices). Auto-detection still refines
  // it from what's actually spoken/typed.
  useEffect(() => {
    const apply = (code: string | null): void => {
      if (!code || code === speechLangRef.current) return
      speechLangRef.current = code
      setSpeechLang(code)
    }
    const local = loadLocalLang()
    apply(local)
    void loadServerPrefs().then((serverPrefs) => {
      if (!serverPrefs) return
      apply(serverPrefs.speechLang)
      // Server is the cross-device source of truth: if the local mirror is stale
      // (e.g. left over from an earlier mis-detection), correct it.
      if (serverPrefs.speechLang && serverPrefs.speechLang !== local) mirrorLang(serverPrefs.speechLang)
    })
  }, [])

  // Permanent vision — camera ON by default. The camera is switched by voice/
  // text command (no button), so no need to probe for a second camera here.
  useEffect(() => {
    if (cameraSupported()) setCameraOn(true)
  }, [])

  // GPS PERMANENT IN THE BRAIN (Adrian, Aug 3: „să aibă permanent în creier să
  // citească coordonatele GPS și să știe cât e ceasul" — this NEW order reverses
  // his Jul 26 decision of on-demand-only reads). A cheap permanent watcher
  // (network precision, 2-min cache) keeps `coordsRef` always fresh, and EVERY
  // turn already ships it to the brain; the clock (now/tz) ships every turn too.
  // The ON-THE-SPOT read below stays, for precision on explicit location turns.
  useEffect(() => {
    if (!navigator.geolocation) return
    // Distanța în metri între două fixuri (haversine) — pentru pragul de mișcare.
    const distantaMetri = (a: Coords, b: Coords): number => {
      const R = 6_371_000
      const d2r = Math.PI / 180
      const dLat = (b.lat - a.lat) * d2r
      const dLon = (b.lon - a.lon) * d2r
      const s =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(a.lat * d2r) * Math.cos(b.lat * d2r) * Math.sin(dLon / 2) ** 2
      return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s))
    }
    // PRIMUL FIX RAPID, TĂCUT (9 aug, ownerul: „nu preia gps imediat"):
    // precizia ÎNALTĂ (satelit) poate dura zeci de secunde la primul fix, deci
    // GPS-ul părea că „nu se ia imediat". Cerem ÎNTÂI un fix GROSIER, aproape
    // instant (rețea, fără satelit, cache generos) — coordsRef e populat pe loc,
    // în tăcere, gata de folosit la nevoie; paznicul satelitar de mai jos îl
    // rafinează apoi. Nu suprascrie un fix satelitar deja prins (doar dacă e gol).
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (!coordsRef.current) {
          coordsRef.current = { lat: pos.coords.latitude, lon: pos.coords.longitude }
          precizieRef.current = Number.isFinite(pos.coords.accuracy) ? Math.round(pos.coords.accuracy) : null
        }
      },
      () => {},
      { enableHighAccuracy: false, maximumAge: 600_000, timeout: 10_000 },
    )
    // GPS REAL (8 aug, ownerul: „îi trebuiesc date de la gps real"): paznicul
    // permanent cere precizie ÎNALTĂ (satelit). Lecția din 26 iul rămâne
    // respectată prin construcție: pana de atunci era citirea LA RECE cu
    // timeout de 5s — un paznic continuu ține fixul cald, primul fix poate
    // dura, dar odată prins se împrospătează singur. Precizia MĂSURATĂ
    // (±metri, ce raportează chiar senzorul) se ține lângă coordonate, ca
    // sesiunea vocală și creierul să știe cât de bun e fixul — nu să presupună.
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const nou = { lat: pos.coords.latitude, lon: pos.coords.longitude }
        // VITEZA (faza 2): din senzor (`coords.speed`, merge și offline) dacă o dă;
        // altfel calculată din poziția anterioară (vitezaDinPozitii). Măsurată,
        // niciodată inventată — null rămâne null.
        const vSenzor = typeof pos.coords.speed === 'number' && pos.coords.speed >= 0 ? pos.coords.speed : null
        if (vSenzor != null) vitezaRef.current = vSenzor
        else if (ultimaPozRef.current)
          vitezaRef.current = vitezaDinPozitii(ultimaPozRef.current, { lat: nou.lat, lon: nou.lon, t: pos.timestamp }) ?? vitezaRef.current
        ultimaPozRef.current = { lat: nou.lat, lon: nou.lon, t: pos.timestamp }
        // AUTO-UPDATE DOAR LA MIȘCARE MARE (9 aug, ownerul: „și un km e ok, că
        // la cerere se citește real"). Paznicul de fundal e doar un CACHE CALD
        // — nu trebuie precis, fiindcă orice tură care chiar are nevoie de loc
        // cheamă getFreshCoords (citire REALĂ pe loc, indiferent de prag). Deci
        // rescriem cache-ul doar la o mișcare de peste PRAG_MISCARE_M (drift de
        // senzor = zero zgomot, zero trafic inutil spre creier).
        const PRAG_MISCARE_M = 1000 // 1 km — schimbă aici dacă vrei mai des
        const vechi = coordsRef.current
        if (!vechi || distantaMetri(vechi, nou) > PRAG_MISCARE_M) {
          coordsRef.current = nou
          precizieRef.current = Number.isFinite(pos.coords.accuracy) ? Math.round(pos.coords.accuracy) : null
        }
      },
      // Refusal/failure → the last known position stays (may be null); the
      // server DECLARES the void instead of inventing a place (LOCATION_NONE).
      () => {},
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 30_000 },
    )
    return () => navigator.geolocation.clearWatch(id)
  }, [])
  const getFreshCoords = (): Promise<Coords | null> =>
    new Promise((resolve) => {
      if (!navigator.geolocation) return resolve(coordsRef.current)
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const c = { lat: pos.coords.latitude, lon: pos.coords.longitude }
          coordsRef.current = c
          precizieRef.current = Number.isFinite(pos.coords.accuracy) ? Math.round(pos.coords.accuracy) : null
          // Viteza (faza 2), dacă senzorul o dă la citirea pe loc.
          if (typeof pos.coords.speed === 'number' && pos.coords.speed >= 0) vitezaRef.current = pos.coords.speed
          resolve(c)
        },
        // Refusal/failure → we stay on the last known position (may be null).
        () => resolve(coordsRef.current),
        // GPS REAL (8 aug: „îi trebuiesc date de la gps real"). Pana din 26 iul
        // era precizie înaltă LA RECE cu timeout de 5s, fără paznic permanent —
        // de-atunci paznicul de mai sus ține fixul satelitar CALD, deci citirea
        // pe loc nu mai pornește de la zero: precizie înaltă, 12s, cache 30s;
        // la eșec rămâne ultimul fix bun al paznicului, nu un gol.
        { enableHighAccuracy: true, maximumAge: 30_000, timeout: 12_000 },
      )
    })

  // Capture at 4 frames/s PERMANENTLY (Adrian, Jul 11 — the old 1 fps pace on
  // the spot left vision choppy; indoor GPS doesn't detect movement, so it
  // stayed on 1 forever). In motion it climbs up to 8 fps. The frames collect in
  // the circular buffer (the last 4); they leave for the brain only on a turn — continuous
  // sending remains forbidden by cost.
  useEffect(() => {
    if (!cameraOn) return
    let timer: number | null = null
    let watchId: number | null = null
    let fps = 4
    let last: { lat: number; lon: number; t: number } | null = null

    let ultimaCaptura = 0
    const tick = (): void => {
      // PAUZĂ CÂT VORBEȘTE KELION (owner, 13 aug — desincronizarea feței sub
      // sarcină): captarea = `toDataURL` SINCRON, care citește înapoi de pe
      // GPU-ul avatarului; cât gura se mișcă, blochează firul principal și
      // lip-sync-ul sare (măsurat live: „captare cadre cameră a ținut firul
      // 3440 ms, vârf 4275 ms"). Cât vorbește Kelion nu capturăm — vederea nu e
      // cerută atunci (o tură pornită ia oricum un cadru proaspăt); se reia
      // instant la tăcere.
      if (getVoiceLevel() > 0.06) return
      // ÎN VOCEA LIVE, CAPTAREA SE RĂREȘTE (măsurat 8 aug, consola ownerului:
      // „[ceas lent] captare cadre cameră a ținut firul 51–92 ms" în timpul
      // sesiunii live). Împachetarea JPEG (toDataURL = citire sincronă GPU→CPU
      // + encode la 768px) rula la 4–8 fps degeaba: sesiunea live nu trimite
      // cadre (contractul WS e doar audio) — cadrele pleacă doar cu turele de
      // chat. Cât e live activ și nicio tură în zbor, un cadru pe secundă
      // ajunge (proaspăt pentru faceprint și pentru o tură scrisă pornită);
      // firul rămâne liber pentru redarea vocii.
      // Cât e VOCEA LIVE activă, cel mult 1 cadru/sec — ȘI în timpul unei ture
      // (busy). Vechea gardă sărea throttle-ul pe `busy`, dar într-o conversație
      // vocală reală (barge-in-uri) e mereu busy → captarea rula la 4 fps și
      // înfometa redarea vocii (audio crăpat, 10 aug). Sesiunea live e audio-only,
      // nu trimite cadre — un cadru/sec ajunge pentru faceprint/o tură scrisă.
      if (vlRef.current && performance.now() - ultimaCaptura < 950) return
      ultimaCaptura = performance.now()
      const f = captureRef.current?.()
      if (f) {
        latestFrameRef.current = f
        const b = frameBufRef.current
        b.push(f)
        // We keep the LAST 8 frames (≈2s at 4 fps) — the K2 brain sees the motion over
        // a longer window (Adrian, Jul 13). The send takes `slice(-8)`.
        if (b.length > 8) b.shift()
      }
    }
    const arm = (): void => {
      if (timer) globalThis.clearInterval(timer)
      timer = ceas('captare cadre cameră', tick, Math.round(1000 / fps))
    }
    arm()

    if (navigator.geolocation) {
      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          const { latitude, longitude, speed } = pos.coords
          let mps = typeof speed === 'number' && speed >= 0 ? speed : 0
          if (!mps && last) {
            const dt = (pos.timestamp - last.t) / 1000
            if (dt > 0) mps = metersBetween(last.lat, last.lon, latitude, longitude) / dt
          }
          last = { lat: latitude, lon: longitude, t: pos.timestamp }
          const next = mps < 0.5 ? 4 : Math.min(8, 4 + Math.floor(mps / 2))
          if (next !== fps) {
            fps = next
            arm()
          }
        },
        () => undefined,
        { enableHighAccuracy: true, maximumAge: 1000, timeout: 10_000 },
      )
    }

    return () => {
      if (timer) globalThis.clearInterval(timer)
      if (watchId !== null && navigator.geolocation) navigator.geolocation.clearWatch(watchId)
      // Camera off → the buffer empties (old frames must not show up
      // in a later turn, after a restart). latestFrameRef too (Jul 25):
      // it stayed full and `look` from the voice described an old scene with the camera off.
      frameBufRef.current = []
      latestFrameRef.current = null
    }
  }, [cameraOn])

  // Close the functions menu on an outside click.
  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: PointerEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [menuOpen])

  function toggleCamera(): void {
    setCameraOn((v) => !v)
  }
  function switchCamera(): void {
    setFacing((f) => (f === 'user' ? 'environment' : 'user'))
  }
  // STABLE IDENTITY (the Jul 27 fluidity audit, defect 4): as a plain
  // function, it got a NEW identity on every render → the CameraView effect
  // (dependent on onError) unmounted/remounted CONTINUOUSLY: the camera stopped-started
  // dozens of times per second during streaming, and the serial release
  // chain (camera.ts, 450ms/stop) grew faster than real time —
  // vision died. useCallback([]) = a single identity for the component's lifetime.
  const onCameraError = useCallback((): void => {
    setCameraOn(false)
  }, [])

  // Voiceprint calibration: 3s of capturing Adrian's voice, then the profile
  // saves locally (audioIO.ts) and the permanent microphone starts filtering it.
  async function calibrateVoice(): Promise<void> {
    if (voiceCalState === 'listening') return
    setVoiceCalState('listening')
    const ok = await calibrateVoiceprint(3000)
    setHasVoicePrint(hasVoiceprint())
    setVoiceCalState(ok ? 'ok' : 'fail')
    window.setTimeout(() => setVoiceCalState('idle'), 2000)
  }
  // AUTOMATIC (Adrian, Jul 12: "the one with the button happens automatically"): voice
  // recognition no longer asks for a click. When the admin enters and has no voiceprint yet, we
  // calibrate it OURSELVES (from the first seconds of speech); if it doesn't catch (silence),
  // it retries until it succeeds. The manual button was removed.
  useEffect(() => {
    if (!isAdmin || hasVoicePrint || voiceCalState !== 'idle') return
    const id = window.setTimeout(() => void calibrateVoice(), 1500)
    return () => window.clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, hasVoicePrint, voiceCalState])

  // When the MONITOR shows content, the centre chat bubbles would cover it —
  // so Kelion's words move to a slim black bar just above the composer instead.
  const wsOpen = useSyncExternalStore(subscribeWorkspace, getWorkspace).open
  // Monitor mode = a surface is open OR the brain is executing live. In EITHER
  // case the chat collapses to the slim black bar above the composer so nothing
  // covers the monitor (Adrian's rule). `working` follows the live-work console.
  const monitorBusy = useSyncExternalStore(subscribeWorkspace, isMonitorWorking)
  // The REAL latency measured in the browser — shown as proof, not thrown away.
  const realLatency = useSyncExternalStore(subscribeRealLatency, getRealLatency)
  // MODUL MAȘINĂ (Adrian, 11 aug): la volan se arată stratul Jarvis (voce-first),
  // nu chatul obișnuit. Se abonează la store-ul de mașină ca să re-randeze la
  // pornire/oprire; toată logica de voce/chat de dedesubt rămâne neatinsă.
  const carOn = useSyncExternalStore(subscribeCarMode, isCarMode)
  const monitorMode = wsOpen || monitorBusy
  // Show the CURRENT exchange in writing: the user's request (so he sees it
  // arrived correctly the instant he types) AND Kelion's reply, which updates
  // live as it streams — not just one sentence.
  const lastUser = messages.filter((m) => m.role === 'user').at(-1)
  const lastAssistant = messages.filter((m) => m.role === 'assistant').at(-1)
  // RENDER-LEVEL CLEANUP (Adrian, Aug 1): old saved messages can still carry
  // fake tool-call markup from before the backend stripper existed. It is
  // never shown, no matter how old the bubble.
  const cleanMsg = (s: string): string => {
    if (!s) return ''
    
    let cleaned = s

    // 1. Remove XML/HTML-like system/thought tags (both closed and unclosed at the end of stream)
    const tags = [
      'thought', 'thinking', 'thought_signature', 'thoughtSignature', 
      'gand', 'gandire', 'creier', 'system', 'tool_call', 'tool_response', 
      'tool', 'context', 'prompt', 'instructiune', 'call', 'response', 
      'error', 'info', 'warning'
    ]
    for (const tag of tags) {
      const closedRegex = new RegExp(`<${tag}[\\s\\S]*?<\\/${tag}>`, 'gi')
      cleaned = cleaned.replace(closedRegex, ' ')
      const unclosedRegex = new RegExp(`<${tag}>[\\s\\S]*?$`, 'gi')
      cleaned = cleaned.replace(unclosedRegex, '')
    }

    // Remove special tokens
    cleaned = cleaned
      .replace(/<\|?tool_call\|?>[\s\S]*?(<\|?\/?tool_call\|?>|$)/g, ' ')
      .replace(/<\/?tool_call>[\s\S]*?(<\/tool_call>|$)/g, ' ')
      .replace(/<\|im_(?:start|end)\|>[^\n]*\n?/g, ' ')

    // 2. Remove bracketed system/thought tags
    const bracketTags = [
      'thought', 'thinking', 'gand', 'gandire', 'creier', 'system', 
      'tool', 'context', 'prompt', 'error', 'info', 'warning',
      'CREIER', 'THOUGHT', 'GANDIRE', 'SYSTEM', 'TOOL'
    ]
    for (const bTag of bracketTags) {
      const closedB = new RegExp(`\\[${bTag}\\][\\s\\S]*?\\[\\/${bTag}\\]`, 'gi')
      cleaned = cleaned.replace(closedB, ' ')
      const unclosedB = new RegExp(`\\[${bTag}\\][\\s\\S]*?$`, 'gi')
      cleaned = cleaned.replace(unclosedB, '')
      const lineB = new RegExp(`^\\[${bTag}\\][\\s\\S]*?$`, 'gm')
      cleaned = cleaned.replace(lineB, '')
    }

    cleaned = cleaned.trim()

    // 3. Handle JSON structure
    if (cleaned.startsWith('{') && cleaned.endsWith('}')) {
      try {
        const parsed = JSON.parse(cleaned)
        const targetLang = (lang || 'ro').toLowerCase()
        if (targetLang.startsWith('ro') && parsed.ro) {
          cleaned = parsed.ro
        } else if (targetLang.startsWith('en') && parsed.en) {
          cleaned = parsed.en
        } else if (parsed[targetLang]) {
          cleaned = parsed[targetLang]
        } else {
          const otherLang = targetLang.startsWith('ro') ? 'en' : 'ro'
          if (parsed[otherLang]) {
            cleaned = parsed[otherLang]
          } else if (parsed.text) {
            cleaned = parsed.text
          } else if (parsed.message) {
            cleaned = parsed.message
          }
        }
      } catch {
        // Not valid JSON or failed to parse, continue
      }
    }

    // 4. Handle language markers
    const targetLang = (lang || 'ro').toLowerCase()
    
    // Check bracketed language markers like [RO] / [EN] / [RO-RO] / [EN-US]
    const hasRoBracket = /\[ro(?:-ro)?\]/i.test(cleaned)
    const hasEnBracket = /\[en(?:-us)?\]/i.test(cleaned)
    if (hasRoBracket || hasEnBracket) {
      if (targetLang.startsWith('ro')) {
        const match = cleaned.match(/\[ro(?:-ro)?\]\s*([\s\S]*?)(?:\s*\[[a-z]{2,}(?:-[a-z]{2,})?\]|$)/i)
        if (match && match[1].trim()) cleaned = match[1].trim()
      } else {
        const match = cleaned.match(/\[en(?:-us)?\]\s*([\s\S]*?)(?:\s*\[[a-z]{2,}(?:-[a-z]{2,})?\]|$)/i)
        if (match && match[1].trim()) cleaned = match[1].trim()
      }
    }

    // Check prefixed language markers like "RO: ..." / "EN: ..." / "ROMANA: ..." / "ENGLISH: ..." / "RO-RO: ..."
    const hasRoPrefix = /\b(?:ro|romana|română|ro-ro):\s*/i.test(cleaned)
    const hasEnPrefix = /\b(?:en|english|en-us):\s*/i.test(cleaned)
    if (hasRoPrefix || hasEnPrefix) {
      if (targetLang.startsWith('ro')) {
        const match = cleaned.match(/\b(?:ro|romana|română|ro-ro):\s*([\s\S]*?)(?:\b(?:en|english|en-us|fr|de|it|es|ru):\s*|$)/i)
        if (match && match[1].trim()) cleaned = match[1].trim()
      } else {
        const match = cleaned.match(/\b(?:en|english|en-us):\s*([\s\S]*?)(?:\b(?:ro|romana|română|ro-ro|fr|de|it|es|ru):\s*|$)/i)
        if (match && match[1].trim()) cleaned = match[1].trim()
      }
    }

    // Clean any remaining leading language prefixes or bracketed tags
    cleaned = cleaned
      .replace(/^\[(?:ro|en|ro-ro|en-us)\]\s*/i, '')
      .replace(/^(?:ro|romana|română|ro-ro|en|english|en-us):\s*/i, '')

    // 5. Clean markdown noise (bold, italic, headers, backticks, bullet points)
    cleaned = cleaned
      .replace(/\*\*\*([\s\S]*?)\*\*\*/g, '$1')
      .replace(/\*\*([\s\S]*?)\*\*/g, '$1')
      .replace(/\*([\s\S]*?)\*/g, '$1')
      .replace(/___([\s\S]*?)___/g, '$1')
      .replace(/__([\s\S]*?)__/g, '$1')
      .replace(/_([\s\S]*?)_/g, '$1')
      .replace(/`{1,3}([\s\S]*?)`{1,3}/g, '$1')
      .replace(/^#{1,6}\s+/gm, '') // remove header markers
      .replace(/^[-*+]\s+/gm, '') // remove simple bullet list symbols at the start of lines

    // 6. Clean whitespace noise and fix merged sentences
    cleaned = cleaned
      .replace(/\r\n/g, '\n')
      .replace(/([.!?])([A-ZĂÎÂȘȚ])/g, '$1 $2')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n') // allow max 2 consecutive newlines
      .trim()

    return cleaned
  }
  // BUTONUL DE MICROFON — o SINGURĂ definiție, folosită și în compozitor și în
  // stratul de mașină (fără cod duplicat, poarta jscpd). Diferă doar clasa CSS;
  // starea (listening), acțiunea (toggleMic) și eticheta sunt aceleași peste tot.
  // OFFLINE = FĂRĂ MICROFON (owner, 22 aug: „cind este in mod ofline, funtiile
  // dedicate de internet nu trebuiesc sa se reafiseze, ele sunt afisate doar
  // cind aplicatia e live"): vocea e Gemini Live (server), iar urechea offline
  // nu există (pasul 7) — un buton de microfon afișat offline ar fi o funcție
  // moartă, adică exact păcăleala interzisă. Reapare singur la revenirea rețelei
  // (useConectat re-randează).
  // Offline, butonul rămâne DOAR dacă urechea locală există (kitul, 22 aug) —
  // altfel ar fi „doar poză" (funcție moartă), exact ce a interzis ownerul.
  const micButton = (cls: string) =>
    !online && !urecheaLocalaGata ? null : (
    <button
      type="button"
      className={`${cls} ${listening ? 'live' : ''}`}
      onClick={toggleMic}
      aria-label={listening ? t.micStop : t.micTalk}
      title={listening ? t.micStop : t.micTalk}
    >
      {listening ? '●' : '🎤'}
    </button>
  )
  const hint = t.chatHint
  // The right-hand button concerns ONLY the WRITTEN chat. You have something to send (text or
  // attached file) → it's active. Empty field → the chat is AUDIO (the microphone is always
  // on, the voice comes in by itself), so the button stays a neutral arrow, NOT a
  // dead stop-square. The ■ square appears ONLY when you really have something to send over
  // a turn in progress — click = BARGE-IN (the current turn is cut and the new
  // one starts now; the queue era is gone — full-duplex, Adrian Jul 13). The
  // `queueing` name survives only as the CSS state of the square.
  const hasDraft = input.trim().length > 0 || attachments.length > 0
  const queueing = busy && hasDraft

  return (
    <div className="chat">
      <CameraView
        active={cameraOn}
        facing={facing}
        onError={onCameraError}
        captureRef={captureRef}
      />
      {/* MODUL MAȘINĂ (Adrian, 11 aug) — strat full-screen voce-first pentru volan.
      Glob Jarvis care pulsează pe vocea REALĂ a lui Kelion, un rând MARE cu
      ultima întrebare + răspunsul (spus, nu afișat), un microfon mare și ieșire.
      Fără avatar 3D, fără monitor, fără carduri — legislația auto. Chatul/vocea
      de dedesubt rămân montate și funcționale; aici doar se ARATĂ altfel. */}
      {/* PRIN PORTAL, DIRECT ÎN <body> (Adrian, 11 aug: „încadrează corect pe orice
      ecran, e foarte important" + „x nu închide" + „audio nu se aude"). Cauza celor
      trei: stratul stătea în `.chat`, care are `transform` (prinde `position:fixed`
      → încadrat greșit, doar banda de jos) ȘI `pointer-events:none` (butoanele mic/✕
      nu primeau clic → mic mort = fără voce, ✕ mort = nu închide). În <body> scapă
      de amândouă: acoperă tot ecranul și butoanele răspund. */}
      {carOn &&
        createPortal(
          <div className="car-mode" role="dialog" aria-label={t.carMode}>
            <JarvisOrb />
            <button
              type="button"
              className="car-exit"
              onClick={() => setCarMode(false)}
              aria-label={t.carExit}
              title={t.carExit}
            >
              ✕
            </button>
            <div className="car-talk">
              {listening && (heard || lastUser?.content) ? (
                <p className="car-heard">{(heard || lastUser?.content || '').slice(0, 200)}</p>
              ) : null}
              <p className="car-reply">{cleanMsg(lastAssistant?.content ?? '') || t.carHint}</p>
            </div>
            {/* ON/OFF pentru vocea FULL-DUPLEX (Adrian, 11 aug: „butonul să fie
                on/off, nu când vreau să vorbesc — e full duplex"). O pornești o
                dată; Kelion ascultă și răspunde continuu, vorbești liber (nu
                apeși de fiecare dată). toggleMic pornește/oprește exact sesiunea
                live full-duplex — aceeași ca în restul aplicației. */}
            {/* OFFLINE: microfonul din mașină dispare și el (același ordin, 22 aug)
                — vocea e funcție de internet; fără net butonul ar minți. */}
            {online && (
              <div className="car-mic-wrap">
                <button
                  type="button"
                  className={`car-mic ${listening ? 'live' : ''}`}
                  onClick={toggleMic}
                  aria-pressed={listening}
                  aria-label={listening ? t.carVoiceOff : t.carVoiceOn}
                  title={listening ? t.carVoiceOff : t.carVoiceOn}
                >
                  🎙️
                </button>
                <span className="car-mic-label">{listening ? t.carListening : t.carVoiceOn}</span>
              </div>
            )}
          </div>,
          document.body,
        )}
      {/* KELION DOAR PE MONITOR (owner, 20 aug: „Kelion nu trebuie să mai AFIȘEZE,
      doar pe monitor"). RĂSPUNSUL lui Kelion NU mai apare ca bulă în chat — merge
      DOAR pe monitor: curge live pe banda „K" de sub compozitor (teletext, mai jos)
      cât scrie, și se așază ca document pe monitor la finalul turei (auto-preview
      din server → {doc} → openWorkspaceDoc). Aici, în centru, rămâne DOAR ecoul a
      ce a scris/spus USERUL (confirmarea că a ajuns) — nu vorba lui Kelion.
      În monitor mode logul se ascunde oricum, ca nimic să nu acopere monitorul. */}
      {!monitorMode && (
        <div className="chat-log" ref={chatLogRef}>
          {messages.length === 0 && <p className="chat-hint">{hint}</p>}
          {[lastUser].map((m, i) =>
            m && cleanMsg(m.content) ? (
              <div key={`${m.ts ?? 0}-${i}`} className={`chat-msg ${m.role === 'user' ? 'me' : 'kelion'}`}>
                <span className="chat-msg-text">{cleanMsg(m.content)}</span>
              </div>
            ) : null,
          )}
          {chatImage && (
            <img className="chat-image" src={chatImage} alt="Kelion generated" />
          )}
        </div>
      )}
      {scenarioRunning && <p className="scenario-live">● {t.scenarioRecording}</p>}
      {/* REAL SPEED (Jul 27 audit: latency was measured every turn and THROWN
      AWAY — the readers were never called by anyone). The proof of the „first
      word under 1s” rule, discreet, shown only while fresh (under 2 min from
      the measurement). */}
      {realLatency && Date.now() - realLatency.at < 120_000 && (
        <span className="latency-chip" title={uiStrings().latencyChip}>
          ⚡ {(realLatency.firstMs / 1000).toFixed(1)}s · {(realLatency.totalMs / 1000).toFixed(1)}s
        </span>
      )}
      {/* CLEPSIDRA + CRONOMETRU (Adrian, 3 aug): vizibilă DOAR cât Kelion chiar
          lucrează la tura curentă (busy). Cinstită: nu poate curge fără ca serverul
          să proceseze cu adevărat. Vezi WorkClock.tsx. */}
      <WorkClock busy={busy} title={t.workClockTitle} />

      {isAdmin && scenarioOpen && (
        <div className="scenario-panel">
          <div className="scenario-head">
            <span>{t.scenarioTitle}</span>
            <button type="button" className="ghost" onClick={() => setScenarioOpen(false)}>
              ✕
            </button>
          </div>
          <textarea
            className="scenario-text"
            value={scenarioText}
            onChange={(e) => setScenarioText(e.target.value)}
            placeholder={t.scenarioHint}
            rows={4}
          />
          <div className="scenario-actions">
            <button
              type="button"
              className="composer-send scenario-rec"
              onClick={() => void runScenario()}
              disabled={!scenarioText.trim()}
            >
              ● {t.scenarioRecord}
            </button>
          </div>
        </div>
      )}
      {scenarioRunning && (
        <button type="button" className="scenario-stop" onClick={stopScenario}>
          ■ {t.scenarioStop}
        </button>
      )}
      <div className={`composer ${busy ? 'working' : ''}`}>
        {/* LIVE DICTATION with a cinematic effect (like AI movies): as Adrian
        speaks, the sentence appears word by word, with a blinking cursor; on a
        pause over 3s it leaves for the brain and the band empties. */}
        {/* FIXED RULE (Adrian, Jul 10: „I don't want to see anything on the
        interface that covers the page — text flows like teletext, on a single
        line”): ANY live band is a fixed line, single-line text, scrolling
        (teletext) when it doesn't fit — it NEVER grows vertically, never
        covers the page. */}
        {liveVoice && (
          <div className="voice-live" aria-live="polite">
            <span className="voice-live-dot" />
            {/* FIXED TAIL, not a remounted teletext (fluidity #9): during dictation
            the text grows in place, showing its tail — it no longer jumps off-screen
            at every new word. */}
            <span className="speech-tail">
              <span className="speech-tail-text">{liveVoice}</span>
            </span>
            <span className="voice-live-caret" />
          </div>
        )}
        {/* BARGRAF DE INTRARE AL URECHII LIVE (owner, 16 aug): cât ascultă
            sesiunea live, arată nivelul REAL al microfonului spre model + dacă
            poarta half-duplex îl taie (gri „mut") sau clipează (roșu). Ca ownerul
            să VADĂ, măsurat, dacă vocea ajunge și dacă se trunchiază ceva. */}
        {listening && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <MicBargraf nivelRef={micNivelRef} activ={listening} />
            {/* PREAMP min→max (owner, 16 aug: „reglaj preamp… ce faci daca e surd?"):
                ridică/coboară manual nivelul microfonului; efectul se vede în bargraf. */}
            <label
              title="Preamp microfon (min→max): ridică nivelul dacă e prea surd (peste amplificarea automată)"
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#c9ccd1' }}
            >
              <span style={{ opacity: 0.8 }}>preamp</span>
              <input
                type="range"
                min={0.5}
                max={12}
                step={0.5}
                value={preampNivel}
                onChange={(e) => {
                  const g = Number(e.target.value)
                  setPreampNivel(g)
                  vlRef.current?.setPreamp(g)
                  try { localStorage.setItem('kelion_preamp', String(g)) } catch { /* ignore */ }
                }}
                style={{ width: 96 }}
              />
              <span style={{ minWidth: 30, opacity: 0.85, fontVariantNumeric: 'tabular-nums' }}>×{preampNivel.toFixed(1)}</span>
            </label>
          </div>
        )}
        {/* ONE BAND, BOTH DIRECTIONS (Adrian, Jul 11 evening: "things must be
            swept here, from the brain and towards the brain — no other written
            chat shows"). The band changes its sign with the turn's phase:
            👤 = YOUR TEXT, SHOWN ONCE (Adrian, Aug 1: "the text must not show
            towards the model and then the same text again towards the brain —
            only what enters the brain, a single time") — first what was sent,
            swapped IN PLACE for the server-confirmed {heard} when it arrives,
            never a second display; 🧠 = the brain is thinking (only when there
            is no user text to show); K = the reply flows FROM the brain (text
            tail while streaming, ticker when done). One row, always. */}
        {(heard || lastUser?.content) && (userEchoHold || (busy && !lastAssistant?.content)) ? (
          // 👤 ECOUL A CE TRANSMIT EU — rămâne pe ecran ~3× mai mult: cât ține
          // userEchoHold, textul meu stă chiar dacă Kelion a și început să răspundă
          // (Adrian, 3 aug). Fără hold, ar dispărea la primul cuvânt al lui Kelion.
          <div className="heard-band user-band" aria-live="polite">
            <span className="heard-band-label" title={uiStrings().heardYouTitle}>👤</span>
            <span className="speech-tail">
              <span className="speech-tail-text">{(heard || lastUser?.content || '').slice(0, 400)}</span>
            </span>
          </div>
        ) : busy && !lastAssistant?.content ? (
          <div className="heard-band" aria-live="polite">
            <span className="heard-band-label" title={uiStrings().heardBrainTitle}>🧠</span>
            <span className="speech-tail">
              <span className="speech-tail-text">…</span>
            </span>
          </div>
        ) : ((lastAssistant?.content && !idleBandHidden) || busy) && lastAssistant?.ts !== tickerDoneTs ? (
          <div className="heard-band kelion-band" aria-live="polite">
            <span className="heard-band-label kelion-k" title={t.heardKelionTitle}>K</span>
            {busy ? (
              <span className="speech-tail">
                <span className="speech-tail-text">
                  {cleanMsg(lastAssistant?.content ?? '') || (heard ? synthesize(heard) : '…')}
                </span>
              </span>
            ) : (
              <span className="ticker">
                <span
                  className="ticker-text"
                  key={lastAssistant?.ts ?? 'empty'}
                  style={{ '--ticker-dur': tickerDur(cleanMsg(lastAssistant?.content ?? '')) } as CSSProperties}
                  onAnimationEnd={() => setTickerDoneTs(lastAssistant?.ts ?? null)}
                >
                  {cleanMsg(lastAssistant?.content ?? '')}
                </span>
              </span>
            )}
          </div>
        ) : null}
        {/* REMOVED (Adrian's order, Jul 10: „remove that microphone-is-muted
        thing, it's wrong” + „microphone with autovox, instantly”): the mic no
        longer stays mute until calibration — the voiceprint is learned
        AUTOMATICALLY from the first sentences (audioIO.ts, auto-enrollment),
        so the hint was false. */}
        {attachments.length > 0 && (
          <div className="composer-atts">
            {attachments.map((a) => (
              <div className="att-chip" key={a.id}>
                {/* A converted document has url:'' — an <img src=""> rendered a
                    BROKEN image icon for every attached PDF (audit Aug 2). */}
                {a.url ? <img src={a.url} alt={a.name} /> : <span className="att-doc-name">📄 {a.name}</span>}
                <button
                  type="button"
                  className="att-remove"
                  onClick={() => removeAttachment(a.id)}
                  aria-label={t.attRemove}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        {queued.length > 0 && (
          <div className="queued-band" aria-live="polite">
            <span className="queued-dot" />
            <span className="ticker">
              <span className="ticker-text" key={queued.join('|')} style={{ '--ticker-dur': tickerDur(queued.join(' · ')) } as CSSProperties}>
                {queued.map((q, i) => (
                  <span key={i} className="queued-chip">{q.slice(0, 80)}{i < queued.length - 1 ? ' · ' : ''}</span>
                ))}
              </span>
            </span>
          </div>
        )}
        <div
          className="composer-row"
          onMouseDown={(e) => {
            // A click anywhere in the bar (outside the buttons and the input itself)
            // focuses the typing field ON THE FIRST TRY — no more multiple clicks.
            const el = e.target as HTMLElement
            if (el.closest('button') || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return
            composerInputRef.current?.focus()
          }}
        >
          {/* OFFLINE: meniul „+" dispare ÎNTREG (owner, 22 aug — funcțiile de
              internet nu se afișează offline): TOATE intrările lui cer serverul
              (📎 fișierele merg la vision/MarkItDown, 📷 camera trimite cadre la
              creier, 🎬 scenariul e generare pe server). Offline rămâne exact ce
              chiar merge: tastezi → creierul local răspunde. Reapare la net. */}
          {online && (
          <div className="fn-wrap" ref={menuRef}>
            <button
              type="button"
              className={`composer-icon ${menuOpen ? 'live' : ''}`}
              onClick={() => setMenuOpen((o) => !o)}
              title={t.functionsTitle}
              aria-label={t.functionsTitle}
              aria-expanded={menuOpen}
            >
              +
            </button>
            {menuOpen && (
              <div className="fn-menu">
                <button type="button" className="fn-item" onClick={openFilePicker}>
                  <span className="ico">📎</span>
                  {t.attachTitle}
                </button>
                {cameraSupported() && (
                  <button type="button" className="fn-item" onClick={toggleCamera}>
                    <span className="ico">{cameraOn ? '🔌' : '📷'}</span>
                    {cameraOn ? t.disconnectCamTitle : t.connectCamTitle}
                    {cameraOn && <span className="dot" />}
                  </button>
                )}
                {/* Hands-free full-duplex: there is NO button anymore — the microphone
                opens BY ITSELF when the chat mounts (see the „Permanent hearing”
                useEffect), with VOX + barge-in. The LiveKit button was removed (Adrian's
                order, Jul 13): it was a dead duplicate (the LiveKit server isn't even
                running); real full-duplex works on the automatic voice path. */}
                {/* The „Trezire Kelion” button was REMOVED (Adrian, Jul 13): waking is
                AUTOMATIC — the microphone is already always on (the „Permanent hearing”
                useEffect), so Kelion wakes at the FIRST SOUND heard; and for typing he
                wakes at the FIRST LETTER typed (the field is always active). There is
                nothing left to press. */}
                {/* No monitor or camera-switch buttons: Kelion opens the monitor on
                    his own (show_on_screen), and the camera is switched by text
                    command ("switch camera", "comută camera", "camera spate"). */}
                {isAdmin && (
                  <button
                    type="button"
                    className="fn-item"
                    onClick={() => {
                      setMenuOpen(false)
                      setScenarioOpen(true)
                    }}
                  >
                    <span className="ico">🎬</span>
                    {t.scenarioTitle}
                  </button>
                )}
                {/* The „Recunoaște-mi vocea” AND „Resetează vocea” buttons were REMOVED
                (Adrian, Jul 13): voice calibration is fully automatic (see the
                calibration useEffect above); there is nothing left to press manually. */}
              </div>
            )}
          </div>
          )}
          <textarea
            ref={composerInputRef}
            className="composer-input"
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPaste={onPasteFiles}
            onDrop={onDropFiles}
            onDragOver={(e) => e.preventDefault()}
            onKeyDown={(e) => {
              // Enter = trimite; Shift+Enter = rând nou (acum posibil, e <textarea>),
              // ca să poți scrie mesajul ÎNTREG pe mai multe rânduri (owner, 20 aug).
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                // Typed text has PRIORITY over the pending voice (Adrian, Jul 11: typed
                // messages lost — don't let a voice fragment jump ahead of the text).
                // The coalescer is cancelled, not flushed.
                void send(input)
              }
            }}
            placeholder={t.chatPlaceholder}
            autoComplete="off"
          />
          {micButton('composer-mic')}
          {/* VOLUMUL VOCII — ASCUNS din compozitor (Adrian, 6 aug: „ascunde-l că
          nu-și are rostul aici"). Păstrăm starea și logica (volumul persistat se
          aplică în continuare la redare prin getVoiceVolume/setVoiceVolume), doar
          controlul din bară nu se mai arată. `hidden` îl scoate din layout fără să
          rupă legăturile de stare (voiceVol/setVoiceVolState rămân folosite). */}
          <input
            type="range"
            className="composer-volume"
            hidden
            min={0}
            max={100}
            value={Math.round(voiceVol * 100)}
            onChange={(e) => {
              const v = Number(e.target.value) / 100
              setVoiceVolState(v)
              setVoiceVolume(v)
            }}
            aria-label={t.voiceVolume}
            title={`${t.voiceVolume}: ${Math.round(voiceVol * 100)}%`}
          />
          <button
            type="button"
            className={`composer-send ${queueing ? 'queueing' : ''}`}
            onClick={() => {
              // Typed text has PRIORITY: we cancel the pending voice,
              // we don't send it ahead of the text (lost typed messages bug).
              void send(input)
            }}
            // Active while you have something TYPED to send. Empty field (audio chat) → it stays
            // a neutral arrow, disabled — not a dead stop-square.
            // TRUTHFUL TOOLTIP (audit Aug 2): since the Jul 13 barge-in rewrite
            // a text sent mid-turn INTERRUPTS (send() cancels the running turn
            // and starts the new one) — the old "queued, doesn't interrupt"
            // tooltip described a design that no longer exists.
            disabled={!hasDraft}
            aria-label={queueing ? t.sendInterrupts : t.send}
            title={queueing ? t.sendInterrupts : t.send}
          >
            {queueing ? '■' : '↑'}
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          // ANY FILE TYPE (Adrian, Jul 25: "it can't analyze what I send,
          // any file type"): no restrictive list on the picker — images
          // go to vision, the rest through MarkItDown (PDF/Word/Excel/PPT/HTML/…) →
          // text for the brain; what can't be converted goes raw to the admin.
          multiple
          hidden
          onChange={onFilesPicked}
        />
      </div>
    </div>
  )
}
