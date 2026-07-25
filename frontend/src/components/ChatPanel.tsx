import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ChangeEvent,
  type ClipboardEvent as ReactClipboardEvent,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
} from 'react'
import { streamChat, type ChatMessage, type Coords, type ChatControl } from '../lib/chat'
import { strings, resolveLang, type Lang } from '../lib/i18n'
import CameraView from './CameraView'
import { cameraSupported, type Facing } from '../lib/camera'
import { defaultSpeechLang } from '../lib/languages'
import { loadLocalLang, loadServerPrefs, mirrorLang } from '../lib/prefs'
import {
  openWorkspace,
  openWorkspaceCard,
  openWorkspaceDoc,
  closeWorkspace,
  closeTasksByKind,
  closeAllTasks,
  switchToKind,
  getWorkspace,
  subscribeWorkspace,
  isMonitorWorking,
} from '../lib/workspace'
import { startRecording, type RecordingHandle } from '../lib/recorder'
import {
  startMic,
  playVoice,
  stopVoice,
  isVoicePlaying,
  calibrateVoiceprint,
  hasVoiceprint,
  getPendingVoiceFeatures,
  clearPendingVoiceFeatures,
  getVoiceVolume,
  setVoiceVolume,
  type MicHandle,
} from '../lib/audioIO'
import { getPendingFaceDescriptor } from '../lib/faceprint'
import { setRealLatency } from '../lib/latency'
import { keepScreenOn } from '../lib/wakelock'
import { startMicStream } from '../lib/micStream'
import { startRealtimeVoice } from '../lib/realtimeVoice'
import { createUtteranceCoalescer, type UtteranceCoalescer } from '../lib/utteranceCoalescer'
import { pushFacial } from '../lib/facialQueue'

// Gesturile-tool ale serverului (play_avatar_gesture, release-ul „v2.3” al
// constructorului) traduse în clipurile REALE din biblioteca RPM — scheletul
// se mișcă doar din clipuri (regula #125), deci eticheta devine numele
// clipului echivalent și pleacă pe același canal 'kelion-gesture'.
const GESTURE_TO_CLIP: Record<string, string> = {
  // Vocabular semantic (Adrian, 13 iul) — creierul cere gestul pe ÎNȚELES, aici
  // se traduce în clipul RPM. Fiecare e legat de un sentiment/context.
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
  // Legacy — comenzile vocale deterministe din backend încă emit astea.
  salute: 'expresie-1',
  raiseRightHand: 'expresie-13',
  pointMonitor: 'expresie-2',
}

// FĂRĂ plafon de durată la înregistrări (Adrian, 11 iul seara: „nu trebuie să
// aibă setări de timp sau limitări”) — scenariul se termină când i se termină
// pașii sau când spune el stop, nu când expiră un cronometru arbitrar.

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
  // ISTORIC PERMANENT ÎNTRE SESIUNI (Adrian, 24 iul): la deschidere, chatul se
  // umple cu conversația salvată pe server (/api/chat/history) — continuitate
  // reală, nu chat gol la fiecare vizită. Nu suprascrie mesaje deja apărute.
  useEffect(() => {
    void fetch('/api/chat/history', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { history?: { role: 'user' | 'assistant'; content: string }[] } | null) => {
        const h = j?.history ?? []
        if (h.length === 0) return
        setMessages((ms) =>
          ms.length > 0 ? ms : h.map((m) => ({ role: m.role, content: m.content, ts: Date.now() })),
        )
      })
      .catch(() => {})
  }, [])
  const [chatImage, setChatImage] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  // Microfonul (intrare) — captează → server (STT) → creier. NU e „voce în front”.
  const [listening, setListening] = useState(false)
  // VOLUMUL VOCII (25 iul): valoarea persistată din audioIO, oglindită în slider.
  const [voiceVol, setVoiceVolState] = useState(() => getVoiceVolume())
  // DICTARE LIVE: fraza curentă, cuvânt cu cuvânt, cu efect cinematografic pe
  // bandă cât vorbește Adrian; se golește când fraza pleacă la creier.
  const [liveVoice, setLiveVoice] = useState('')
  // BARGRAF LA INTRAREA ÎN CREIER (Adrian, 10 iul): textul EXACT predat
  // creierului la tura curentă — vine de pe SERVER ({heard}), nu e ecou local.
  const [heard, setHeard] = useState('')
  // TICKER (regulă fixă, 10 iul): durata derulării scalează cu lungimea
  // textului, ca să rămână lizibil — nici prea repede, nici o veșnicie.
  const tickerDur = (s: string): string => `${Math.min(22, Math.max(3.5, s.length / 14))}s`
  // SINTEZĂ RAPIDĂ (Adrian, 10 iul: „dacă pauza e mai mare de gândire, să nu
  // rămână gol în dreptul creierului — sinteză de câteva cuvinte, ține-o până
  // la următorul”). Extrasă INSTANT din {heard} (cererea deja confirmată de
  // server ca predată creierului) — zero latență, nu așteaptă modelul.
  const synthesize = (s: string, maxWords = 8): string => {
    const words = s.trim().split(/\s+/).filter(Boolean)
    return words.length <= maxWords ? s.trim() : `${words.slice(0, maxWords).join(' ')}…`
  }
  // Modul microfon: true = dictare live (streaming WS); cade pe batch dovedit
  // dacă WS-ul pică sau rămâne mut, ca vocea să nu se rupă niciodată.
  const streamModeRef = useRef(true)
  const micRef = useRef<MicHandle | null>(null)
  // VOCE = OpenAI Realtime `cedar` — chat FULL-DUPLEX nativ cu escaladare, pe
  // cele 2 chei (Adrian, 24 iul: „chat fullduplex realtime cu escaladare").
  // Chirp ar fi cerut o a 3-a cheie Google (nicio cheie AIza nu a fost dată în
  // chat — verificat). DOAR dacă Realtime pică (fără cheie/eșec WebRTC) cădem O
  // DATĂ pe STT→creier→TTS pentru sesiune (rezervă, nu regulă).
  const realtimeOffRef = useRef(false)
  // FIX „chat full duplex nu există" (Adrian, 24 iul): înainte, ORICE eroare
  // Realtime (chiar tranzitorie — un 502, un hop ICE, un input-ended benign)
  // punea `realtimeOffRef=true` PERMANENT pe toată sesiunea → full-duplex se
  // stingea definitiv și cădea mut pe half-duplex STT. Acum numărăm eșecurile:
  // dăm full-duplex-ului 3 șanse înainte să latch-uim pe STT, iar o conexiune
  // reușită (`live`) resetează contorul. Așa un eșec pasager nu mai omoară duplexul.
  const realtimeFailCountRef = useRef(0)
  const REALTIME_MAX_FAILS = 3
  // RECUPERARE AUTOMATĂ (25 iul — cauza reală „vocea e robotică"): odată latch-uit
  // pe rezerva TTS (robotică), `realtimeOffRef` rămânea true PENTRU TOTDEAUNA în
  // acel tab — chiar și după ce sesiunea era reparată pe server, userul auzea
  // robotul până la un reload TARE, pe care nu avea de unde să-l știe. Acum
  // latch-ul e pe timp: după `REALTIME_RECOVER_MS` reîncercăm vocea REALĂ, iar
  // contorul de eșecuri se resetează — un deploy reparat își revine singur.
  const realtimeOffAtRef = useRef(0)
  const REALTIME_RECOVER_MS = 90_000
  // SEMI-DUPLEX LA ESCALADARE (Adrian: „când escaladează se folosește aceeași
  // voce și trece în semiduplex când gândește, revine la normal după ce se
  // rezolvă"). Când vocea live cheamă creierul greu (`ask_brain`), gândirea +
  // răspunsul durează; punem microfonul pe mut (semi-duplex) cât gândește, ca să
  // nu se audă peste el, apoi revenim la full-duplex când termină de vorbit.
  // Vocea rămâne ACEEAȘI (tot Realtime) — se schimbă doar modul duplex.
  const thinkingRef = useRef(false)
  // Unește bucățile de VOX tăiate la o pauză de gândire (nu de final-de-frază)
  // într-un singur gând, înainte de a-l trimite creierului. Refăcut la fiecare
  // (re)pornire a microfonului — vezi ensureMic mai jos.
  const coalescerRef = useRef<UtteranceCoalescer | null>(null)
  // Amprenta vocală (voiceprint) — restrânge microfonul permanent la vocea lui
  // Adrian. Fără punct de UI, hasVoiceprint() rămâne mereu false: butonul de
  // mai jos e singurul loc din care se poate înrola/reseta profilul.
  const [voiceCalState, setVoiceCalState] = useState<'idle' | 'listening' | 'ok' | 'fail'>('idle')
  // Fix hydration: localStorage is client-only; read it after hydration.
  const [hasVoicePrint, setHasVoicePrint] = useState(false)
  useEffect(() => {
    setHasVoicePrint(hasVoiceprint())
  }, [])
  // Delivery receipt for the CURRENT turn: the server's first stream frame
  // ({turn}) sets it, so a small ✓ shows the message actually arrived.
  const [delivered, setDelivered] = useState(false)
  // Mesaje scrise în timpul unei ture active — vizibile, nu pierdute în coadă.
  const [queued, setQueued] = useState<string[]>([])
  // Adrian, 11 iul: „camera nu a pornit [după restart] — e greșit” → camera
  // pornește IMPLICIT la fiecare încărcare; butonul rămâne pentru oprire.
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
  // Câmpul de scris: un singur click oriunde în bară îl focalizează (zona reală a
  // inputului e îngustă, iar un click „lângă” text nu prindea focus — trebuiau
  // mai multe click-uri). Ref-ul e țintit de handlerul de pe rândul composer.
  const composerInputRef = useRef<HTMLInputElement>(null)
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
  // Ultimele 4 cadre (Adrian, 11 iul: „camera nu captează 4 cadre pe secundă”
  // + auditul lui Kelion: „trimite un singur cadru în loc de patru — vederea
  // nu e continuă”). Tampon circular; la fiecare tură pleacă TOATE 4.
  const frameBufRef = useRef<string[]>([])
  const coordsRef = useRef<Coords | null>(null)
  const busyRef = useRef(busy)
  busyRef.current = busy
  // Controlerul de abandon al turei în curs — „stop” îl abortează pe loc.
  const abortRef = useRef<AbortController | null>(null)
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
  const cameraOnRef = useRef(cameraOn)
  cameraOnRef.current = cameraOn
  const speechLangRef = useRef(speechLang)
  speechLangRef.current = speechLang

  // Kelion drives the monitor himself (no manual button): a control frame from
  // the stream opens/clears the workspace surface behind the avatar.
  function handleControl(c: ChatControl): void {
    // Delivery receipt: the server's first frame arrived — the message got there.
    if (c.receipt) {
      setDelivered(true)
      return
    }
    // GEST LA COMANDĂ (Adrian, 11 iul: „mișcări comandate la tot ce vreau să
    // facă”): creierul a pus [GEST nume] în răspuns → serverul l-a transformat
    // în cadrul {gest} → regia de mișcare (AvatarModel) execută clipul o dată.
    if (c.gest) {
      window.dispatchEvent(new CustomEvent('kelion-gesture', { detail: c.gest }))
      return
    }
    // Cadrul {gesture} al tool-ului server-side — tradus în clipul echivalent.
    if (c.gesture && GESTURE_TO_CLIP[c.gesture]) {
      window.dispatchEvent(new CustomEvent('kelion-gesture', { detail: GESTURE_TO_CLIP[c.gesture] }))
      return
    }
    // Kelion deschide tab-urile aplicației din chatul SCRIS (open_app_view →
    // frame {nav}); Stage ascultă kelion:navigate și face gate-ul de admin.
    if (c.nav?.view) {
      window.dispatchEvent(new CustomEvent('kelion:navigate', { detail: c.nav }))
      return
    }
    // Bargraf-ul intrării în creier: serverul spune EXACT ce text predă
    // creierului — se afișează pe banda dedicată până la tura următoare.
    if (c.heard !== undefined) {
      setHeard(c.heard)
      return
    }
    // VOCEA CREIERULUI: MP3 gata sintetizat pe server (Chirp 3) — DOAR îl redăm.
    // Cât vorbește, microfonul nu trimite (anti-ecou), dar rămâne de veghe:
    // vocea lui Adrian taie redarea pe loc (barge-in, vezi ensureMic).
    if (c.audio) {
      playVoice(
        c.audio,
        () => micRef.current?.setMuted(true),
        () => micRef.current?.setMuted(false),
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
    if (c.card && c.card.items.length > 0) {
      openWorkspaceCard(c.card.title, c.card)
      return
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

  // Micro-expresia feței, în stil GENTLEMAN (Adrian, 12 iul: „mimică de golan,
  // nu gentleman”). Un domn e COMPUS: fața rămâne neutră IMPLICIT; o expresie
  // apare RAR și DOAR la un sentiment real și clar — niciodată reactiv la
  // fiecare semn de punctuație (mirare la fiecare „!”, sprânceană la fiecare
  // „?” — asta arăta agitat). Fără expresie implicită: tăcerea feței e demnă.
  function suggestFacial(text: string): void {
    const s = text.trim()
    if (!s) return
    // Recunoștință caldă, sinceră → un zâmbet reținut.
    if (/\b(mul[țt]umesc|[îi][țt]i mul[țt]umesc|thank you|apreciez|bravo|felicit)\b/i.test(s))
      return pushFacial('warmth')
    // Regret/empatie autentică → expresie blândă.
    if (/\b([îi]mi pare r[ăa]u|regret|condolean|din p[ăa]cate|sympath|my condolences)\b/i.test(s))
      return pushFacial('empathy')
    // Altfel: NICIO expresie — fața compusă, neutră, demnă. (Gesturile de corp
    // și expresiile mai ample vin DOAR la comanda creierului prin [GEST], rar.)
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
          .map((m) => ({ role: m.role, content: m.content }))
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
      // VOCEA CLIPULUI (QA 24 iul: scenariul aprobat nu era rostit NICIODATĂ la
      // înregistrare — clipul ieșea mut). Sintetizăm scriptul cu vocea unică
      // (ash, prin /api/tts) și îl redăm peste scenele care se derulează.
      // PE BUCĂȚI (25 iul): /api/tts taie tăcut la 5000 de caractere — un clip
      // de 5-10 minute rămânea fără voce de la jumătate. Împărțim scriptul pe
      // fraze în bucăți ≤3500, le sintetizăm ÎN ORDINE și playVoice le pune în
      // coadă (aceeași replică, fără tăieturi).
      void (async () => {
        const chunks: string[] = []
        let cur = ''
        for (const sentence of p.script.split(/(?<=[.!?…])\s+/)) {
          if (cur && cur.length + sentence.length + 1 > 3500) {
            chunks.push(cur)
            cur = sentence
          } else {
            cur = cur ? `${cur} ${sentence}` : sentence
          }
        }
        if (cur) chunks.push(cur)
        for (const chunk of chunks) {
          try {
            const r = await fetch('/api/tts', {
              method: 'POST',
              credentials: 'include',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ text: chunk, lang: p.lang ?? 'ro-RO' }),
            })
            if (!r.ok) continue
            const buf = await r.arrayBuffer()
            let bin = ''
            const bytes = new Uint8Array(buf)
            for (let i = 0; i < bytes.length; i += 0x8000)
              bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
            playVoice(btoa(bin))
          } catch {
            /* o bucată picată nu oprește restul narațiunii */
          }
        }
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
        const ro = speechLangRef.current.toLowerCase().startsWith('ro')
        window.setTimeout(
          () =>
            ack(
              ro
                ? 'Dubla s-a oprit și clipul s-a salvat. Spune „reluăm” pentru încă o dublă cu același scenariu.'
                : 'Take stopped and the clip was saved. Say "retake" to do the same take again.',
            ),
          600,
        )
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
  // the backend (MarkItDown) and attached as text so Kelion can read them. For
  // the ADMIN, a file that can't be converted (archive, video, audio, anything)
  // is kept RAW — it rides the bridge to the developer as-is.
  // The REAL pipe maximum: Cloudflare hard-caps a request at 100MB — one file
  // may fill nearly the whole pipe (~70MB real content as base64).
  const MAX_RAW_FILE = 90_000_000
  async function addDocFiles(files: File[]): Promise<void> {
    for (const file of files) {
      if (file.type.startsWith('image/')) continue
      try {
        const data = await new Promise<string>((res, rej) => {
          const r = new FileReader()
          r.onload = () => res(String(r.result))
          r.onerror = () => rej(new Error('read'))
          r.readAsDataURL(file)
        })
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
          /* conversion unavailable — fall through to raw for admin */
        }
        if (markdown.trim()) {
          setAttachments((cur) => [
            ...cur,
            { id: `${Date.now()}-${file.name}-doc`, url: '', name: file.name || 'document', text: markdown },
          ])
        } else if (isAdmin && data.length <= MAX_RAW_FILE) {
          setAttachments((cur) => [
            ...cur,
            {
              id: `${Date.now()}-${file.name}-raw`,
              url: data,
              name: file.name || 'fisier',
              type: file.type || 'application/octet-stream',
            },
          ])
        }
      } catch {
        /* skip a file that couldn't be read */
      }
    }
  }
  function onFilesPicked(e: ChangeEvent<HTMLInputElement>): void {
    const files = [...(e.target.files ?? [])]
    e.target.value = '' // let the same file be picked again later
    addImageFiles(files.filter((f) => f.type.startsWith('image/')))
    void addDocFiles(files.filter((f) => !f.type.startsWith('image/')))
  }
  // Paste an image straight into the chat (Ctrl+V) or drag-and-drop a file.
  function onPasteFiles(e: ReactClipboardEvent): void {
    const imgs = [...e.clipboardData.files].filter((f) => f.type.startsWith('image/'))
    if (imgs.length > 0) {
      e.preventDefault()
      addImageFiles(imgs)
    }
  }
  function onDropFiles(e: ReactDragEvent): void {
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
      await new Promise((r) => globalThis.setTimeout(r, 1200))
    }
    // Let the final sentence finish speaking, then stop + save.
    await new Promise((r) => globalThis.setTimeout(r, 2500))
    handle.stop()
  }
  function stopScenario(): void {
    scenarioRunningRef.current = false
    scenarioRecRef.current?.stop()
    scenarioRecRef.current = null
    setScenarioRunning(false)
  }

  async function send(text: string): Promise<void> {
    const msg = text.trim()
    const atts = attachments
    if (!msg && atts.length === 0) return
    // Admin recorder commands — handled locally, never sent to the brain.
    if (msg && isAdmin) {
      const ro = speechLangRef.current.toLowerCase().startsWith('ro')
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
          ack(
            ro
              ? `Scenariul salvat era în altă limbă. Spune-mi din nou „fă un clip despre ${saved.subject}” și îl refac în limba curentă.`
              : `The saved script was in another language. Say "make a clip about ${saved.subject}" again and I'll redo it in your language.`,
          )
          setInput('')
          return
        }
        armPromo(saved)
        ack(
          ro
            ? 'Reluăm aceeași dublă — apasă butonul roșu care pulsează și alege ecranul.'
            : 'Same take again — press the pulsing red button and pick the screen.',
        )
        setInput('')
        return
      }
      if (REC_STOP.test(msg)) {
        window.dispatchEvent(new CustomEvent('kelion:rec', { detail: 'stop' }))
        ack(
          ro
            ? 'Am oprit înregistrarea — clipul se salvează în Descărcări.'
            : 'Recording stopped — the clip is saving to Downloads.',
        )
        setInput('')
        return
      }
      if (REC_START.test(msg)) {
        window.dispatchEvent(new CustomEvent('kelion:rec', { detail: 'arm' }))
        ack(
          ro
            ? 'Pregătit de înregistrare. Apasă butonul roșu care pulsează, sus, și alege ecranul.'
            : 'Ready to record. Press the pulsing red button at the top and pick the screen.',
        )
        setInput('')
        return
      }
    }
    // OPRIRE IMEDIATĂ (Adrian, 10 iul: „îi spun stop și mă ignoră, nu primește
    // imediat comanda”). „stop” scris sau vorbit NU se pune în coadă — taie vocea
    // și tura curentă PE LOC, golește coada și închide cererea pe server. Softul
    // NU se rupe: backendul își termină singur tura în fundal; eu doar nu mai
    // aștept și nu mai vorbesc. Se verifică ÎNAINTE de garda „ocupat”.
    const STOP_CMD =
      /^\s*(stop|stai|opre[șs]te(?:-te)?|oprire|gata|las[ăa](?:\s*asta)?|anuleaz[ăa]|renun[țt][ăa])[\s.!]*$/i
    if (msg && STOP_CMD.test(msg)) {
      stopVoice()
      abortRef.current?.abort()
      pendingSendsRef.current = [] // stop înseamnă stop — golește coada
      setQueued([])
      inFlightRef.current = false
      setBusy(false)
      setLiveVoice('')
      setInput('')
      // Închide cererea/bucla pe server (handlerul de stop din backend).
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
      ack(speechLangRef.current.toLowerCase().startsWith('ro') ? 'Am oprit.' : 'Stopped.')
      return
    }
    // Camera + monitor commands are interpreted by the SERVER (it sees the open
    // tabs on every turn and answers instantly with a {device} frame, no model
    // call) — nothing to intercept here anymore.
    if (busyRef.current || inFlightRef.current) {
      // FULL-DUPLEX REAL (Adrian, 13 iul: „când lucrează nu aude microfonul / nu-i
      // ajunge textul"): input nou (scris SAU vorbit) cât Kelion lucrează =
      // BARGE-IN — anulăm tura curentă și pornim IMEDIAT tura nouă. NU mai punem
      // în coadă: coada BLOCA full-duplex-ul (al doilea mesaj nu ajungea la creier
      // până nu se termina primul). Backendul + workerul acceptă deja ture
      // concurente. Fără text (doar atașament) → lăsăm tura curentă, n-o tăiem.
      if (!msg) return
      stopVoice() // taie vocea rămasă din tura veche, să nu vorbească peste
      abortRef.current?.abort() // tura veche devine „superseded"; finally-ul ei nu mai resetează
      // NU return — cădem mai jos și pornim tura nouă chiar acum.
    }
    inFlightRef.current = true
    setInput('')
    setDelivered(false) // new turn — the ✓ lights only once the server answers
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
    const base = msg || (docBlock ? 'Am atașat un document — citește-l și spune-mi ce conține.' : t.imagePrompt)
    const outgoing = docBlock ? `${docBlock}\n\n${base}` : base
    // VEDEREA CONTINUĂ (Adrian, 11 iul): cu camera pornită pleacă ULTIMELE 8 CADRE
    // (≈2s de mișcare la 4 fps), nu unul singur — creierul vede MIȘCAREA, nu o
    // clipă înghețată. Pentru TOȚI userii la fel (regula nr. 9): cadrele merg prin
    // `images`, iar poza atașată explicit prin `image`.
    const camFrames = cameraOnRef.current && !attached ? frameBufRef.current.slice(-8) : []

    // Features vocale colectate de la ultima frază vorbită (dictare live sau batch).
    const voiceFeatures = getPendingVoiceFeatures() ?? undefined
    clearPendingVoiceFeatures()
    // Descriptorul facial GATA din fundal (dacă e camera pornită și-a prins o
    // față). Instant — nu așteaptă nicio inferență, nu încetinește trimiterea.
    const face = getPendingFaceDescriptor()

    const next: ChatMessage[] = [...messages, { role: 'user', content: outgoing, ts: Date.now() }]
    // ts STABIL pentru răspunsul-în-curs al ACESTEI ture — updater-ul funcțional
    // de mai jos îl recunoaște și îl înlocuiește, fără să șteargă mesajele
    // (ex. transcripte de voce) sosite între timp.
    const turnTs = Date.now()
    setMessages([...next, { role: 'assistant', content: '', ts: turnTs }])
    setChatImage(null) // a new turn clears any previously shown image
    // Controlerul de abandon al ACESTEI ture — „stop” îl abortează pe loc.
    const ac = new AbortController()
    abortRef.current = ac
    setBusy(true)
    let acc = ''
    // TIMP DE RĂSPUNS REAL (măsurat aici, în browser — ce simte userul): de la
    // trimitere → primul cuvânt vizibil → răspuns complet. Se afișează pe contor.
    const t0 = performance.now()
    let firstAt = 0
    try {
      const wsNow = getWorkspace()
      const screen = wsNow.open
        ? wsNow.tasks.map((tk) => ({ kind: tk.kind, title: tk.title, active: tk.id === wsNow.activeId }))
        : undefined
      for await (const chunk of streamChat(
        next,
        image ?? undefined,
        coordsRef.current ?? undefined,
        handleControl,
        screen,
        ac.signal,
        Boolean(attached), // poză lipită/încărcată explicit — analiză fără condiție
        // Vederea continuă pentru TOȚI userii (regula nr. 9): ultimele cadre.
        camFrames.length > 0 ? camFrames : undefined,
        voiceFeatures,
        face?.descriptor,
        face?.photo,
      )) {
        if (!firstAt && chunk && chunk.trim()) firstAt = performance.now() // primul cuvânt REAL
        acc += chunk
        // Updater FUNCȚIONAL, nu snapshot (25 iul): cu [...next, ...] fix, un
        // transcript de VOCE sosit în timpul turei scrise era suprascris de
        // următorul update și dispărea din chat. Păstrăm orice mesaj adăugat
        // între timp și doar înlocuim/adăugăm răspunsul în curs al turei.
        setMessages((cur) => {
          const base = cur.length >= next.length && cur.slice(0, next.length).every((m, i) => m === next[i])
            ? cur
            : next
          const rest = base.slice(next.length).filter((m) => !(m.role === 'assistant' && m.ts === turnTs))
          return [...next, ...rest, { role: 'assistant', content: acc, ts: turnTs }]
        })
      }
      // Publică timpul REAL pe contor (doar dacă a venit text vizibil).
      if (firstAt) {
        setRealLatency({ firstMs: firstAt - t0, totalMs: performance.now() - t0, at: Date.now() })
      }
      // A monitor-only / tool-only reply streams no visible text. Don't leave an
      // empty assistant turn in the history (it would 400 the next request).
      if (!acc.trim()) setMessages(next)
      else suggestFacial(acc) // fața însoțește tonul replicii încheiate
    } catch (err) {
      if (ac.signal.aborted) {
        // OPRIT de Adrian — fără mesaj de eroare; textul deja afișat rămâne așa.
      } else {
        // Nu lăsa vocea să spună mai mult decât s-a scris (bug 10 iul: scrisul
        // dispărea la eroare, dar audio-ul continua).
        stopVoice()
        const code = err instanceof Error ? err.message : 'error'
        const spoken = strings(resolveLang(replyLang))
        const m =
          code === 'brain_not_configured'
            ? t.brainNotActive
            : code === 'offline'
              ? spoken.offline
              : t.brainError
        // PĂSTREAZĂ textul deja primit (nu-l arunca) — doar adaugă o notă discretă,
        // ca scrisul să rămână complet față de ce s-a auzit.
        setMessages([
          ...next,
          { role: 'assistant', content: acc.trim() ? `${acc}\n⚠️ ${m}` : `⚠️ ${m}`, ts: Date.now() },
        ])
        if (code === 'offline') {
          offlineRef.current = true
          retryTextRef.current = msg // resume THIS message when the signal returns
        }
      }
    } finally {
      // BARGE-IN (full-duplex): dacă tura asta a fost ÎNLOCUITĂ de una nouă,
      // `abortRef` arată deja spre tura nouă — NU-i reseta flag-urile „lucrez"
      // (i le-ar clobber-a). Doar tura ÎNCĂ curentă se curăță pe sine.
      const stillCurrent = abortRef.current === ac
      if (stillCurrent) {
        abortRef.current = null
        inFlightRef.current = false
        setBusy(false)
      }
      // Compat: dacă a rămas ceva într-o coadă veche (nu se mai umple în mod
      // normal — full-duplex trimite direct), o trimitem, dar doar dacă nu tocmai
      // am fost înlocuiți de o tură nouă.
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

  // Microfonul e PERMANENT ON: pornește singur la intrare și se redeschide
  // singur când pista moare (apel telefonic, căști Bluetooth scoase, alt app ia
  // microfonul) sau când tabul redevine vizibil. Butonul rămâne doar ca pauză
  // manuală — singurul caz în care microfonul stă oprit intenționat.
  const micManualOffRef = useRef(false)
  const micStartingRef = useRef(false)
  const micRetryRef = useRef<number | null>(null)
  const micBackoffRef = useRef(1000)

  const onMicErr = (reason: string): void => {
    micRef.current = null
    coalescerRef.current?.cancel()
    setListening(false)
    setLiveVoice('')
    if (reason === 'not-allowed' || reason === 'unsupported') return
    micRetryRef.current = window.setTimeout(() => void ensureMicRef.current(), micBackoffRef.current)
    micBackoffRef.current = Math.min(micBackoffRef.current * 2, 15_000)
  }

  async function ensureMic(preWarmedStream?: MediaStream): Promise<void> {
    if (micRef.current || micStartingRef.current || micManualOffRef.current) return
    if (micRetryRef.current) {
      window.clearTimeout(micRetryRef.current)
      micRetryRef.current = null
    }
    micStartingRef.current = true

    // Adrian, 11 iul: „la restart butonul microfon se blochează / se
    // dezactivează”. Cauza: dacă pornirea arunca o excepție, flagul „pornesc
    // acum” rămânea agățat pe true pentru totdeauna → fiecare apăsare cădea pe
    // ramura de OPRIRE (nimic de oprit) și butonul părea mort. try/finally
    // garantează eliberarea flagului pe ORICE drum de ieșire.
    try {
      // ── VOCE LIVE OpenAI Realtime (full-duplex): microfon + WebRTC direct la
      // OpenAI (creierul de voce), care redă singur răspunsul + are barge-in/anti-
      // ecou nativ. Transcriptul curge pe bandă și se salvează pe server. Dacă nu
      // e disponibilă (fără cheie / eșec), cădem O DATĂ pe STT→creier→TTS.
      // Kelion își reia SINGUR vocea reală: dacă a fost latch-uit pe rezervă dar
      // a trecut fereastra de recuperare, deblochează și reîncearcă full-duplex.
      if (realtimeOffRef.current && Date.now() - realtimeOffAtRef.current > REALTIME_RECOVER_MS) {
        realtimeOffRef.current = false
        realtimeFailCountRef.current = 0
      }
      if (!realtimeOffRef.current) {
        try {
          const rv = await startRealtimeVoice({
            language: speechLangRef.current,
            // SCRISUL însoțește vorbirea (Adrian, 24 iul: „nu afișează ce zice,
            // doar vorbește"): parțialele curg pe banda live, iar transcriptul
            // FINAL al fiecărei ture intră în CHAT ca mesaj vizibil.
            onUserTranscript: (text, done) => {
              if (done) {
                setLiveVoice('')
                const t = text.trim()
                if (t) setMessages((ms) => [...ms, { role: 'user', content: t, ts: Date.now() }])
              } else setLiveVoice(text)
            },
            onAssistantTranscript: (text, done) => {
              if (done) {
                setLiveVoice('')
                const t = text.trim()
                if (t) setMessages((ms) => [...ms, { role: 'assistant', content: t, ts: Date.now() }])
                // REVENIRE LA FULL-DUPLEX: Kelion a terminat de rostit răspunsul
                // escaladat → reactivăm microfonul (ieșim din semi-duplex).
                if (thinkingRef.current) {
                  thinkingRef.current = false
                  micRef.current?.setMuted?.(false)
                }
              } else setLiveVoice(text)
            },
            // AUTONOMIA VOCII (Adrian, 24 iul: „nu apelează instrumentele, îi
            // lipsesc instrumente de a afișa pe ecran"): uneltele cerute de
            // modelul de voce se execută AICI — show_on_screen direct în client
            // (monitorul e al browserului), restul prin server, care întoarce
            // rezultatul + eventualul screen_url de pus pe monitor.
            onToolCall: async (name, argsJson) => {
              let args: Record<string, unknown> = {}
              try {
                args = JSON.parse(argsJson || '{}') as Record<string, unknown>
              } catch {
                /* argumente stricate → obiect gol */
              }
              // ESCALADARE LA CREIER → SEMI-DUPLEX: cât timp creierul greu
              // gândește și Kelion urmează să rostească răspunsul, punem
              // microfonul pe mut ca să nu se audă peste el. Revenim la
              // full-duplex când transcriptul FINAL al lui Kelion sosește
              // (vezi onAssistantTranscript). Aceeași voce tot timpul.
              if (name === 'ask_brain') {
                thinkingRef.current = true
                micRef.current?.setMuted?.(true)
                // Plasă de siguranță: dacă răspunsul nu mai sosește (eroare),
                // reactivăm microfonul ca să nu rămână mut definitiv. 125s, nu
                // 30s (25 iul): creierul are timeout 120s — cu 30s, plasa se
                // deschidea ÎN TIMPUL gândirii la cereri grele de 40-60s și
                // vorbirea userului pornea un răspuns paralel peste cel în lucru.
                window.setTimeout(() => {
                  if (thinkingRef.current) {
                    thinkingRef.current = false
                    micRef.current?.setMuted?.(false)
                  }
                }, 125000)
              }
              // VEDEREA ÎN VOCE (Adrian: „de ce nu vede?"): la „look", capturăm
              // cadrul curent din camera userului și-l injectăm în apel, ca
              // serverul să-l dea modelului cu vedere. Fără cameră/cadru →
              // serverul întoarce „no_camera" și Kelion o spune firesc.
              if (name === 'look' || name === 'see') {
                // DOAR cu camera PORNITĂ (25 iul): cu camera închisă,
                // latestFrameRef păstra ultimul cadru dinaintea opririi și
                // Kelion „vedea" cu convingere o scenă veche de minute.
                const frame = cameraOnRef.current
                  ? (latestFrameRef.current ?? captureRef.current?.() ?? '')
                  : ''
                if (frame) (args as Record<string, unknown>).image = frame
              }
              if (name === 'show_on_screen') {
                const url = String(args.url ?? '').trim()
                const title = String(args.title ?? '') || 'Ecran'
                if (url) handleControl({ monitor: { url, title } })
                else closeAllTasks()
                return JSON.stringify({ shown: true, url })
              }
              // ACCES REAL LA APLICAȚIE (Adrian, 24 iul): Kelion deschide panourile
              // proprii ale aplicației prin voce. Se execută în client (e UI-ul lui):
              // dispatch un eveniment pe care Stage/WalletButton îl ascultă. Gate-ul
              // de admin e în Stage (un user obișnuit nu poate deschide adminul).
              if (name === 'open_app_view') {
                const view = String(args.view ?? '').trim()
                const section = String(args.section ?? '').trim()
                window.dispatchEvent(new CustomEvent('kelion:navigate', { detail: { view, section } }))
                return JSON.stringify({ opened: view || 'home', section: section || null })
              }
              try {
                const r = await fetch('/api/realtime/tool', {
                  method: 'POST',
                  credentials: 'include',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ name, args }),
                })
                const j = (await r.json()) as {
                  output?: string
                  screen?: { url: string; title: string }
                }
                if (j.screen?.url) handleControl({ monitor: { url: j.screen.url, title: j.screen.title } })
                return String(j.output ?? '{}')
              } catch (e) {
                return JSON.stringify({ error: String(e).slice(0, 200) })
              }
            },
            onState: (s, note) => {
              // Conexiune Realtime SOLIDĂ (WebRTC `connected`) → resetează contorul
              // de eșecuri: full-duplex merge, orice pățanie de dinainte se iartă.
              if (s === 'live') {
                realtimeFailCountRef.current = 0
                return
              }
              if (s === 'error') {
                // ROTAȚIE DE SESIUNE ≠ EȘEC (dovadă F12 live, 24 iul: „Your
                // session hit the maximum duration of 60 minutes" → contorul
                // ajungea la 3 după 3 ore de folosire continuă și stingea
                // definitiv full-duplexul). Limita de 60 min a OpenAI e ciclu de
                // viață NORMAL: repornim FĂRĂ să penalizăm.
                const isRotation = /maximum duration|session.*(expired|limit)|60 minutes/i.test(note ?? '')
                if (!isRotation) {
                  // Numărăm eșecul REAL. Latch pe STT DOAR după 3 eșecuri; sub
                  // prag următoarea pornire REÎNCEARCĂ full-duplex.
                  realtimeFailCountRef.current += 1
                  const giveUp = realtimeFailCountRef.current >= REALTIME_MAX_FAILS
                  console.error(
                    `voce realtime a picat (${realtimeFailCountRef.current}/${REALTIME_MAX_FAILS}):`,
                    note ?? 'fără detalii',
                  )
                  if (giveUp) { realtimeOffRef.current = true; realtimeOffAtRef.current = Date.now() }
                }
                if (micRef.current) {
                  // Curăță sesiunea Realtime dacă mai există (mic + WebRTC),
                  // altfel rămânea capturată în paralel cu microfonul STT.
                  micRef.current?.stop?.()
                  micRef.current = null
                  setListening(false)
                  setLiveVoice('')
                  micStartingRef.current = false
                  void ensureMicRef.current()
                }
              }
            },
          })
          if (micManualOffRef.current || micRef.current) {
            rv.stop()
            return
          }
          micRef.current = rv as unknown as MicHandle
          // Dacă TTS-ul de rezervă încă redă în momentul instalării, pornim MUT
          // (anti-ecou), ca pe căile STT — unmute-ul vine de la stopVoice/onEnd.
          if (isVoicePlaying()) rv.setMuted(true)
          // ROTIRE PROACTIVĂ la 55 min (limita OpenAI e 60): repornim sesiunea
          // ÎNAINTE să ne-o taie serverul — utilizatorul nu simte nicio ruptură
          // și niciun „eșec" nu se numără. Timerul moare odată cu sesiunea.
          const rotateTimer = window.setTimeout(() => {
            if (micRef.current === (rv as unknown as MicHandle) && !micManualOffRef.current) {
              rv.stop()
              micRef.current = null
              setListening(false)
              micStartingRef.current = false
              void ensureMicRef.current()
            }
          }, 55 * 60_000)
          const origStop = rv.stop.bind(rv)
          rv.stop = () => {
            clearTimeout(rotateTimer)
            origStop()
          }
          micBackoffRef.current = 1000
          setListening(true)
          return
        } catch {
          // Pornirea Realtime a aruncat (fără cheie / WebRTC blocat). Numărăm la
          // fel: 3 șanse înainte de a latch-ui pe STT — un eșec pasager la pornire
          // nu mai stinge full-duplex-ul pentru toată sesiunea.
          realtimeFailCountRef.current += 1
          if (realtimeFailCountRef.current >= REALTIME_MAX_FAILS) { realtimeOffRef.current = true; realtimeOffAtRef.current = Date.now() }
        }
      }

      // ── DICTARE LIVE (streaming): fiecare cuvânt apare pe bandă instant, se
      // validează când e confirmat, iar la o PAUZĂ > 3s fraza pleacă la creier
      // (ordinul lui Adrian, 10 iul). Dacă WS-ul pică sau rămâne mut, cădem O DATĂ
      // pe calea batch dovedită — vocea nu se rupe niciodată.
      if (streamModeRef.current) {
        const sh = await startMicStream({
          preWarmedStream,
          onLive: (t) => setLiveVoice(t),
          onPhrase: (t) => {
            setLiveVoice('')
            void sendRef.current(t)
          },
          onError: (reason) => {
            if (reason === 'ws' || reason === 'failed' || reason === 'silent' || reason === 'unsupported') {
              // streamingul nu merge → treci pe batch pentru restul sesiunii
              streamModeRef.current = false
              micRef.current?.stop()
              micRef.current = null
              setListening(false)
              setLiveVoice('')
              micStartingRef.current = false
              void ensureMicRef.current()
              return
            }
            onMicErr(reason)
          },
          getLang: () => speechLangRef.current,
          onBargeIn: () => {
            stopVoice()
            micRef.current?.setMuted(false)
          },
        })
        if (sh) {
          // Apăsat OPRIT cât porneam, sau altă pornire a instalat deja un
          // microfon — respectă starea existentă, nu instala peste ea.
          if (micManualOffRef.current || micRef.current) {
            sh.stop()
            return
          }
          micRef.current = sh
          micBackoffRef.current = 1000
          setListening(true)
          if (isVoicePlaying()) sh.setMuted(true)
        }
        return
      }

      // ── BATCH (dovedit): înregistrează fraza, o transcrie la /api/asr. ──
      coalescerRef.current = createUtteranceCoalescer((text) => void sendRef.current(text))
      const h = await startMic(
        (text) => coalescerRef.current?.push(text),
        onMicErr,
        () => speechLangRef.current,
        // BARGE-IN (ordinul lui Adrian): când i se aude vocea peste Kelion,
        // vocea lui Kelion se taie PE LOC și microfonul revine să-l asculte.
        () => {
          stopVoice()
          micRef.current?.setMuted(false)
        },
        // „doar vocea mea sau scrisul meu, nu se acceptă alta” — adminul e singurul
        // rol restrâns la vocea proprie calibrată; demo (vizitatori) rămâne neschimbat.
        isAdmin,
        preWarmedStream,
      )
      if (h) {
        // Apăsat OPRIT cât porneam, sau altă pornire a instalat deja un
        // microfon — respectă starea existentă, nu instala peste ea.
        if (micManualOffRef.current || micRef.current) {
          h.stop()
          return
        }
        micRef.current = h
        micBackoffRef.current = 1000
        setListening(true)
        // Repornit cât încă vorbește creierul: pornește mut (anti-ecou); revine
        // singur la finalul redării, ca la orice replică.
        if (isVoicePlaying()) h.setMuted(true)
      }
    } finally {
      micStartingRef.current = false
    }
  }
  const ensureMicRef = useRef(ensureMic)
  ensureMicRef.current = ensureMic

  function toggleMic(): void {
    // Adrian, 11 iul: „butonul microfon nu funcționează corect”. Cauza: pornirea
    // e asincronă (~0,5–2s); o apăsare în fereastra aia nu găsea încă micRef
    // și cădea pe ramura de PORNIRE — adică oprirea era imposibil de exprimat
    // cât timp boot-ul era în zbor, iar dublu-click lăsa microfonul mereu
    // aprins. Acum: apăsat în timpul pornirii = OPRIRE (manualOff), iar
    // ensureMic verifică manualOff după fiecare await înainte să instaleze.
    if (micRef.current || micStartingRef.current) {
      micManualOffRef.current = true
      // Eliberează și flagul de pornire: dacă boot-ul chiar e în zbor, vede
      // manualOff la final și se oprește singur; dacă flagul era agățat dintr-o
      // eroare veche, butonul se vindecă aici în loc să rămână mort.
      micStartingRef.current = false
      micRef.current?.stop()
      micRef.current = null
      // oprire intenționată: un fragment agățat NU trebuie trimis după teardown
      coalescerRef.current?.cancel()
      setListening(false)
      return
    }
    micManualOffRef.current = false

    // PRE-WARM: deschidem microfonul înainte de startMicStream, ca la apăsarea
    // butonului "mic on" activarea să fie aproape instantă. Dacă userul apasă
    // OPRIT în timpul warmup-ului, oprim stream-ul pre-încălzit și renunțăm.
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
          await ensureMicRef.current(stream)
          if (!micRef.current) {
            stream.getTracks().forEach((t) => t.stop())
          }
        } catch {
          // Pre-warm eșuat → lăsăm calea normală să raporteze eroarea/corect.
          micStartingRef.current = false
          void ensureMicRef.current()
        }
      })()
      return
    }
    void ensureMicRef.current()
  }

  // Permanent hearing: pornește la montare, revine când tabul redevine vizibil
  // (browserele opresc captarea în fundal), curăță tot la demontare.
  useEffect(() => {
    void ensureMicRef.current()
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void ensureMicRef.current()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      if (micRetryRef.current) window.clearTimeout(micRetryRef.current)
      micRef.current?.stop()
      micRef.current = null
      coalescerRef.current?.cancel()
      stopVoice()
    }
  }, [])

  // FULL-DUPLEX STREAMING ULTRA-RAPID PENTRU TOȚI, LA FEL (Adrian, 14 iul: „audio
  // full duplex streaming ultra rapid pentru toți, acum; toți la fel de rapid").
  // SCOS ocolul LiveKit doar-pentru-admin: intra SINGUR în camera LiveKit și oprea
  // microfonul HTTP, dar când agentul de voce de pe VPS NU procesa audio, starea
  // rămânea `live` (fallback DOAR pe `error`/`closed`) → adminul „pleca dar nu
  // auzea", altă experiență (surdă) decât clienții. ACUM admin ȘI clienți folosesc
  // EXACT aceeași cale: streaming instant (`micStream` → /api/asr-stream Google STT,
  // VOX + barge-in, primul cuvânt rapid), pornită default-on din „Permanent hearing"
  // de mai sus — dovedită că merge (amprentele reale se creează pe ea). Zero canal
  // separat de admin, zero dependență de agentul LiveKit.

  // Cât ascultă, ecranul nu adoarme — un telefon cu ecranul stins își taie
  // microfonul, iar „permanent on” ar muri la primul screen-off.
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
      if (retry) {
        // Resume from where we were cut off: drop the failed user+error bubbles
        // and re-send, so Kelion answers the message that got interrupted.
        setMessages((cur) => cur.slice(0, -2))
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

  // Permanent device GPS for the location-aware skills. Runs independently of the
  // camera so "weather/where am I/near me" works even with the camera off. The
  // latest fix is sent with each chat turn; the backend resolves the place name.
  useEffect(() => {
    if (!navigator.geolocation) return
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        coordsRef.current = { lat: pos.coords.latitude, lon: pos.coords.longitude }
      },
      () => undefined,
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 10_000 },
    )
    return () => navigator.geolocation.clearWatch(id)
  }, [])

  // Captură la 4 cadre/s PERMANENT (Adrian, 11 iul — vechiul ritm de 1 fps pe
  // loc lăsa vederea discontinuă; GPS-ul în casă nu detectează mișcare, deci
  // rămânea veșnic pe 1). În mișcare urcă până la 8 fps. Cadrele se strâng în
  // tamponul circular (ultimele 4); pleacă la creier doar la o tură — trimiterea
  // continuă rămâne interzisă de cost.
  useEffect(() => {
    if (!cameraOn) return
    let timer: number | null = null
    let watchId: number | null = null
    let fps = 4
    let last: { lat: number; lon: number; t: number } | null = null

    const tick = (): void => {
      const f = captureRef.current?.()
      if (f) {
        latestFrameRef.current = f
        const b = frameBufRef.current
        b.push(f)
        // Reținem ULTIMELE 8 cadre (≈2s la 4 fps) — creierul K2 vede mișcarea pe
        // o fereastră mai lungă (Adrian, 13 iul). Trimiterea ia `slice(-8)`.
        if (b.length > 8) b.shift()
      }
    }
    const arm = (): void => {
      if (timer) globalThis.clearInterval(timer)
      timer = globalThis.setInterval(tick, Math.round(1000 / fps))
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
      // Cameră oprită → tamponul se golește (cadre vechi nu au voie să apară
      // într-o tură de mai târziu, după repornire). Și latestFrameRef (25 iul):
      // rămânea plin și `look` din voce descria o scenă veche cu camera închisă.
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
  function onCameraError(): void {
    setCameraOn(false)
  }

  // Calibrare voiceprint: 3s de captat vocea lui Adrian, apoi profilul se
  // salvează local (audioIO.ts) și microfonul permanent începe să-l filtreze.
  async function calibrateVoice(): Promise<void> {
    if (voiceCalState === 'listening') return
    setVoiceCalState('listening')
    const ok = await calibrateVoiceprint(3000)
    setHasVoicePrint(hasVoiceprint())
    setVoiceCalState(ok ? 'ok' : 'fail')
    window.setTimeout(() => setVoiceCalState('idle'), 2000)
  }
  // AUTOMAT (Adrian, 12 iul: „ăla cu butonul se face automat”): recunoașterea
  // vocii nu mai cere click. Când adminul intră și n-are încă amprentă, o
  // calibrăm SINGURI (din primele secunde de vorbire); dacă nu prinde (liniște),
  // reîncearcă până reușește. Butonul manual a fost scos.
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
  const monitorMode = wsOpen || monitorBusy
  // Show the CURRENT exchange in writing: the user's request (so he sees it
  // arrived correctly the instant he types) AND Kelion's reply, which updates
  // live as it streams — not just one sentence.
  const lastUser = messages.filter((m) => m.role === 'user').at(-1)
  const lastAssistant = messages.filter((m) => m.role === 'assistant').at(-1)
  const hint = t.chatHint
  // Butonul din dreapta ține DOAR de chatul SCRIS. Ai ceva de trimis (text sau
  // fișier atașat) → e activ. Câmpul gol → chatul e AUDIO (microfonul e mereu
  // pornit, vocea intră singură), deci butonul rămâne o săgeată neutră, NU un
  // pătrat-stop mort. Pătratul ■ apare NUMAI când chiar ai text de stivuit peste
  // o tură în curs (atunci click = îl pui în coadă, nu întrerupe nimic).
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
      {/* FĂRĂ BULE ÎN CENTRU (Adrian, 11 iul: „tot ce e chat trebuie să fie în
          spațiul unde apare semnul de creier... nu se mai afișează în afara
          spațiului de acolo răspunsurile de chat”). Bulele care pluteau peste
          monitor au fost SCOASE — schimbul de replici trăiește exclusiv în
          benzile de lângă composer (👤 tu / K Kelion, teletext). În centru
          rămân doar îndemnul de start și imaginile generate. */}
      {!monitorMode && (
        <div className="chat-log">
          {messages.length === 0 && <p className="chat-hint">{hint}</p>}
          {chatImage && (
            <img className="chat-image" src={chatImage} alt="Kelion generated" />
          )}
        </div>
      )}
      {scenarioRunning && <p className="scenario-live">● {t.scenarioRecording}</p>}
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
        {/* DICTARE LIVE cu efect cinematografic (ca în filmele cu AI): pe măsură
            ce Adrian vorbește, fraza apare cuvânt cu cuvânt, cu cursor care
            clipește; la pauză > 3s pleacă la creier și banda se golește. */}
        {/* REGULĂ FIXĂ (Adrian, 10 iul: „nu vreau să văd pe interfață ceva ce
            acoperă pagina — textul curge ca teletextul, pe o singură linie”):
            ORICE bandă live e o linie fixă, text pe o singură linie, care
            derulează (teletext) dacă nu încape — NICIODATĂ nu crește pe
            verticală, niciodată nu acoperă pagina. */}
        {liveVoice && (
          <div className="voice-live" aria-live="polite">
            <span className="voice-live-dot" />
            <span className="ticker">
              <span
                className="ticker-text"
                key={liveVoice}
                style={{ '--ticker-dur': tickerDur(liveVoice) } as CSSProperties}
              >
                {liveVoice}
              </span>
            </span>
            <span className="voice-live-caret" />
          </div>
        )}
        {/* O SINGURĂ BANDĂ, AMBELE SENSURI (Adrian, 11 iul seara: „aici
            trebuiesc baleiate dinspre creier și înspre creier — în afară de
            asta nu se mai afișează chat scris”). Aceeași bandă de la creier
            își schimbă semnul după faza turei: 👤 = mesajul tău pleacă
            ÎNSPRE creier (dispare la preluare — „după ce ai baleiat ce am
            scris, nu se mai afișează”); 🧠 = creierul l-a primit și gândește
            (arată ce a auzit efectiv — confirmat de server, nu ecou local);
            K = răspunsul curge DINSPRE creier (coada textului cât streamează,
            teletext când e terminat). Un rând, mereu, nimic în afara ei. */}
        {busy && !delivered && lastUser?.content ? (
          <div className="heard-band user-band" aria-live="polite">
            <span className="heard-band-label" title="Tu — înspre creier">👤</span>
            <span className="ticker">
              <span
                className="ticker-text"
                key={lastUser.content}
                style={{ '--ticker-dur': tickerDur(lastUser.content) } as CSSProperties}
              >
                {lastUser.content.slice(0, 400)}
              </span>
            </span>
          </div>
        ) : busy && !lastAssistant?.content ? (
          <div className="heard-band" aria-live="polite">
            <span className="heard-band-label" title="Creierul a primit și gândește">🧠</span>
            <span className="ticker">
              <span
                className="ticker-text"
                key={heard || '…'}
                style={{ '--ticker-dur': tickerDur(heard || '…') } as CSSProperties}
              >
                {heard ? `„${heard}”` : '…'}
              </span>
            </span>
          </div>
        ) : lastAssistant?.content || busy ? (
          <div className="heard-band kelion-band" aria-live="polite">
            <span className="heard-band-label kelion-k" title="Kelion — dinspre creier">K</span>
            {busy ? (
              <span className="speech-tail">
                <span className="speech-tail-text">
                  {lastAssistant?.content || (heard ? synthesize(heard) : '…')}
                </span>
              </span>
            ) : (
              <span className="ticker">
                <span
                  className="ticker-text"
                  key={lastAssistant?.ts ?? 'empty'}
                  style={{ '--ticker-dur': tickerDur(lastAssistant?.content ?? '') } as CSSProperties}
                >
                  {lastAssistant?.content}
                </span>
              </span>
            )}
          </div>
        ) : null}
        {/* SCOS (ordin Adrian, 10 iul: „scoate chestia aia microphone is muted,
            că e greșită” + „microfon cu autovox, instant”): microfonul nu mai
            stă mut până la calibrare — amprenta se învață AUTOMAT din primele
            fraze (audioIO.ts, auto-înrolare), deci indiciul era fals. */}
        {attachments.length > 0 && (
          <div className="composer-atts">
            {attachments.map((a) => (
              <div className="att-chip" key={a.id}>
                <img src={a.url} alt={a.name} />
                <button
                  type="button"
                  className="att-remove"
                  onClick={() => removeAttachment(a.id)}
                  aria-label="Remove"
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
            // Un click oriunde în bară (în afara butoanelor și a inputului însuși)
            // focalizează câmpul de scris DIN PRIMA — gata cu clickurile multiple.
            const el = e.target as HTMLElement
            if (el.closest('button') || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return
            composerInputRef.current?.focus()
          }}
        >
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
                {/* Full-duplex mâini-libere: NU mai există buton — microfonul se
                    deschide SINGUR la montarea chatului (vezi useEffect „Permanent
                    hearing”), cu VOX + barge-in. Butonul LiveKit a fost scos (ordin
                    Adrian, 13 iul): era un dublet mort (serverul LiveKit nici nu e
                    pornit), full-duplexul real merge pe calea vocală automată. */}
                {/* Butonul „Trezire Kelion” a fost SCOS (Adrian, 13 iul): trezirea e
                    AUTOMATĂ — microfonul e deja mereu pornit (useEffect „Permanent
                    hearing”), deci Kelion se trezește la PRIMUL SUNET auzit; iar la
                    scris se trezește la PRIMA LITERĂ tastată (câmpul e mereu activ).
                    Nu mai e nimic de apăsat. */}
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
                {/* Butoanele „Recunoaște-mi vocea” ȘI „Resetează vocea” au fost
                    SCOASE (Adrian, 13 iul): calibrarea vocală e complet automată
                    (vezi useEffect-ul de calibrare de mai sus); nu mai e nimic de
                    apăsat manual. */}
              </div>
            )}
          </div>
          <input
            ref={composerInputRef}
            className="composer-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPaste={onPasteFiles}
            onDrop={onDropFiles}
            onDragOver={(e) => e.preventDefault()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                // Textul scris are PRIORITATE peste vocea in asteptare (Adrian,
                // 11 iul: mesaje scrise pierdute — nu lasa un fragment de voce
                // sa sara inaintea textului). Coalescerul se anuleaza, nu flush.
                coalescerRef.current?.cancel()
                void send(input)
              }
            }}
            placeholder={t.chatPlaceholder}
          />
          <button
            type="button"
            className={`composer-mic ${listening ? 'live' : ''}`}
            onClick={toggleMic}
            aria-label="Microfon"
            title={listening ? 'Oprește microfonul' : 'Vorbește (microfon)'}
          >
            {listening ? '●' : '🎤'}
          </button>
          {/* VOLUMUL VOCII (25 iul — Adrian: „volumul audio incontrolabil"):
              o singură comandă pentru TOATĂ vocea lui Kelion (Realtime + TTS),
              persistată; până azi nu exista niciun control de volum în aplicație. */}
          <input
            type="range"
            className="composer-volume"
            min={0}
            max={100}
            value={Math.round(voiceVol * 100)}
            onChange={(e) => {
              const v = Number(e.target.value) / 100
              setVoiceVolState(v)
              setVoiceVolume(v)
            }}
            aria-label="Volumul vocii lui Kelion"
            title={`Volum voce: ${Math.round(voiceVol * 100)}%`}
            style={{ width: 64, accentColor: 'var(--accent, #7aa2ff)', alignSelf: 'center' }}
          />
          <button
            type="button"
            className={`composer-send ${queueing ? 'queueing' : ''}`}
            onClick={() => {
              // Textul scris are PRIORITATE: anulăm vocea în așteptare,
              // nu o trimitem înaintea textului (bug mesaje scrise pierdute).
              coalescerRef.current?.cancel()
              void send(input)
            }}
            // Activ cât ai ceva SCRIS de trimis. Câmpul gol (chat audio) → rămâne
            // săgeată neutră, dezactivată — nu un pătrat-stop mort. Un text trimis
            // în timp ce Kelion răspunde NU întrerupe tura: se pune în coadă
            // (send() îl stivuiește) și pleacă imediat ce tura se termină.
            disabled={!hasDraft}
            aria-label={queueing ? 'Pune în coadă' : t.send}
            title={
              queueing
                ? 'Se procesează — mesajul tău se pune în coadă, nu întrerupe'
                : t.send
            }
          >
            {queueing ? '■' : '↑'}
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.csv,.txt,.html,.htm,.json,.xml,.rtf,.epub"
          multiple
          hidden
          onChange={onFilesPicked}
        />
      </div>
    </div>
  )
}
