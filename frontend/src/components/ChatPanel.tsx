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
// VOCE SCOASĂ (21 aug clean-slate): contorFraza (frazaInchisa/gata) măsura latența
// frazei vocale — nu mai există cale vocală, deci importul a dispărut.
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
  // VOCE SCOASĂ (21 aug): getMonitorContent/getStareTranzactii hrăneau sesiunea
  // vocală live cu contextul ecranului — nu mai sunt chemate din ChatPanel.
} from '../lib/workspace'
import { startRecording, type RecordingHandle } from '../lib/recorder'
import {
  playVoice,
  getVoiceVolume,
  setVoiceVolume,
  getVoiceLevel,
} from '../lib/audioIO'
import { interruptAll } from '../lib/audioFocus'
import { getPendingFaceDescriptor } from '../lib/faceprint'
import { watchdogEnter, watchdogBeat, watchdogExit } from '../lib/watchdog'
import { setRealLatency, getRealLatency, subscribeRealLatency } from '../lib/latency'
// VOCE — CLEAN SLATE (21 aug): toată calea vocală de pe FRONTEND a fost scoasă
// (surd/mut/nu scrie nimic de pe voce). Au rămas DOAR chatul TEXT, naratorul
// (/api/tts → playVoice), creierul TEXT offline, recorderul, camera și monitorul.
import { getTeava } from '../lib/retea'
import { pushFacial } from '../lib/facialQueue'
import { reportActivity } from '../lib/activity'
import { isCarMode, setCarMode, subscribeCarMode } from '../lib/carMode'
import { esteConectat, useConectat, verificaConexiuneReala } from '../lib/conexiune'
import { vorbesteOffline } from '../lib/voceOffline'
import { ascultaOffline, stareUrecheOffline, type ControlAscultare } from '../lib/urecheOffline'
import { streamLocalRaspuns, pregatesteModelOffline, stareCreierLocal, webgpuDisponibil, sincronizeazaStareOffline, incalzesteCodOffline } from '../lib/creierLocal'
import { contextPentruCreier, vitezaDinPozitii } from '../lib/contextOffline'
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
  // PRE-PREGĂTIREA CREIERULUI OFFLINE (mod companion, faza 1): cât timp ai net BUN
  // (Wi-Fi/4G+, confirmat de țeavă — nu ardem datele omului) și dispozitivul are
  // WebGPU, descărcăm O DATĂ modelul local, ca să fie GATA când pierzi semnalul.
  // Pe net lent/economie/necunoscut NU descărcăm gigabytes (ex. iOS raportează
  // „necunoscut" → rămâne pe declanșare manuală, faza următoare). Idempotent.
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
        if (anulat || stareCreierLocal().stare === 'descarcat') {
          // Modelul E în cache. Aducem ȘI chunk-ul de cod WebLLM în cache (cheap,
          // fără GPU), ca importul offline să nu poată pica după un redeploy. NU-l
          // urcăm în GPU cât ești online (economie de baterie) — se urcă la offline.
          void incalzesteCodOffline()
          return
        }
        // Nu e în cache → PRIMA descărcare, doar pe net decent (nu ardem date mobile).
        // Sărim doar 2G/3G/economie (getTeava 'slab'/'mediu'); Wi‑Fi/4G+ și „necunoscut"
        // (desktop/iOS) descarcă.
        const tv = getTeava()
        if (!esteConectat() || tv === 'slab' || tv === 'mediu') return
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
  // VOICE VOLUME (Jul 25): the value persisted from audioIO, mirrored in the slider.
  // Rămâne pentru NARATOR (playVoice) — volumul de redare, nu vocea scoasă (21 aug).
  const [voiceVol, setVoiceVolState] = useState(() => getVoiceVolume())
  // BRAIN-INPUT TICKER (Adrian, Jul 10): the EXACT text handed
  // to the brain on the current turn — it comes from the SERVER ({heard}), not a local echo.
  const [heard, setHeard] = useState('')
  // THE VISIBLE CONVERSATION (Aug 1): the chat log stays pinned to the newest
  // bubble — auto-scroll on every new message and on every streaming update.
  const chatLogRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = chatLogRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])
  // THE CALM SIGNAL for the auto-update countdown (lib/activity.ts): voice
  // session open / request in flight / draft in the composer — while any of
  // these is true, the countdown stands still so the reset never cuts work.
  useEffect(() => {
    // VOCE SCOASĂ (21 aug clean-slate): nu mai există sesiune vocală → semnalul
    // „voce" e mereu fals; textul/naratorul rămân semnalul de calm al update-ului.
    reportActivity({ voice: false, busy, draft: input.trim().length > 0 })
  }, [busy, input])
  useEffect(() => () => reportActivity({ voice: false, busy: false, draft: false }), [])
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
  // VOCE SCOASĂ (21 aug clean-slate): microfonul, sesiunile live (Gemini/Realtime),
  // amprenta vocală și tura vocală au fost șterse cu totul de pe frontend. Rămâne
  // DOAR chatul TEXT; nu mai există micRef, realtime*, voiceprint sau voiceTurnRef.
  // Messages typed during an active turn — visible, not lost in a queue.
  const [queued, setQueued] = useState<string[]>([])
  // Adrian, Jul 11: "the camera didn't start [after restart] — that's wrong" → the camera
  // starts BY DEFAULT on every load; the button remains for turning it off.
  const [cameraOn, setCameraOn] = useState(true)
  // URECHEA OFFLINE (Faza 1 · M4): microfonul apare DOAR când urechea (Whisper) e
  // descărcată; apăsat → ascultă, apăsat iar → transcrie offline în caseta de scris.
  const [urecheGata, setUrecheGata] = useState(() => stareUrecheOffline().stare === 'gata')
  const [asculta, setAsculta] = useState(false)
  const ascultareRef = useRef<ControlAscultare | null>(null)
  // Lacăt SINCRON de pornire + strajă de montare: `ascultaOffline` are un await lung
  // (getUserMedia → promptul de permisiune). Fără ele, un al doilea click în fereastra
  // aia (iconul rămâne 🎤, ref-ul e încă null) ar deschide un AL DOILEA microfon +
  // AudioContext și l-ar orfaniza pe primul (mic/context scurs până la închiderea paginii);
  // iar o demontare în timpul await-ului ar lipi controlul pe un ref demontat → tot scurs.
  const pornireRef = useRef(false)
  const montatRef = useRef(true)
  useEffect(() => {
    montatRef.current = true
    // Starea urechii trăiește în modulul urecheOffline (nereactivă) — o citim periodic.
    const id = window.setInterval(() => setUrecheGata(stareUrecheOffline().stare === 'gata'), 1500)
    return () => {
      window.clearInterval(id)
      montatRef.current = false
      ascultareRef.current?.anuleaza()
      ascultareRef.current = null
    }
  }, [])
  const toggleAscultare = useCallback(async (): Promise<void> => {
    if (ascultareRef.current) {
      // A doua apăsare: oprește + transcrie offline → în caseta de scris.
      const ctrl = ascultareRef.current
      ascultareRef.current = null
      setAsculta(false)
      const text = await ctrl.opreste()
      if (text) setInput((prev) => (prev ? prev.trimEnd() + ' ' : '') + text)
      return
    }
    if (pornireRef.current) return // o singură pornire în zbor (anti dublu-click)
    pornireRef.current = true
    interruptAll('asculta-offline') // gura tace cât ascult (să nu se-audă pe el)
    try {
      const ctrl = await ascultaOffline(resolveLang(speechLangRef.current))
      if (!ctrl) return
      // Demontat sau altă ascultare deja pornită cât așteptam → eliberează ACEST control,
      // nu-l lăsa microfon deschis nefolosit.
      if (!montatRef.current || ascultareRef.current) {
        ctrl.anuleaza()
        return
      }
      ascultareRef.current = ctrl
      setAsculta(true)
    } finally {
      pornireRef.current = false
    }
  }, [])
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
  // VOCE SCOASĂ (21 aug clean-slate): sesiunile live (rvLiveRef/vlRef), bargraful
  // urechii (micNivelRef), preampul, contoarele/sondele de reluare și canalele
  // audio ale turei vocale (pendingSpeakerRef/pendingAudioRef) au dispărut cu totul.
  const busyRef = useRef(busy)
  busyRef.current = busy
  // The abort controller of the current turn — "stop" aborts it on the spot.
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
    // VOCE SCOASĂ (21 aug clean-slate): cadrul {ignored} (creierul a decis că nu i
    // se vorbea) apărea DOAR pe turele vocale — nu mai există cale vocală, deci nu
    // mai există bulă-substituent de șters. Handlerul a fost eliminat.
    // The brain-input ticker: the server says EXACTLY what text it hands
    // to the brain — shown on the dedicated ticker until the next turn.
    if (c.heard !== undefined) {
      setHeard(c.heard)
      return
    }
    // VOCE SCOASĂ (21 aug clean-slate): cadrul {audio} (gura Chirp de pe server →
    // playVoice) era gura chatului vocal. Pe calea vocală MUTĂ nu se mai redă. Gura
    // rămasă e DOAR naratorul promo (/api/tts → playVoice, insulă separată, mai jos).
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

  async function send(text: string): Promise<void> {
    const msg = text.trim()
    const atts = attachments
    // VOCE SCOASĂ (21 aug clean-slate): o trimitere e MEREU o tură TEXT — nu mai
    // există tură vocală (audio brut / pendingAudioRef). Fără text și fără atașamente
    // nu e nimic de trimis.
    if (!msg && atts.length === 0) return
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
      interruptAll('stop-command') // taie orice redare a naratorului (insula /api/tts)
      abortRef.current?.abort()
      pendingSendsRef.current = [] // stop means stop — empty the queue
      setQueued([])
      inFlightRef.current = false
      setBusy(false)
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
      // turns. No text (attachment only) → we leave the current turn alone, we don't cut it.
      // Atașament fără text → NU tăiem tura curentă (barge-in doar pe text).
      if (!msg) return
      interruptAll('barge-in-text') // taie redarea naratorului dacă e activă
      abortRef.current?.abort() // the old turn becomes "superseded"; its finally no longer resets
      // NO return — we fall through below and start the new turn right now.
    } else {
      // O tură nouă taie orice redare rămasă a naratorului (o singură ieșire audio).
      interruptAll('tura-noua')
    }
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
    // VOCE SCOASĂ (21 aug): o trimitere e mereu TEXT — fără ramura de tură vocală.
    const base = msg || (docBlock ? t.docPrompt : attached ? t.imagePrompt : t.greetPrompt)
    const outgoing = docBlock ? `${docBlock}\n\n${base}` : base
    // CONTINUOUS VISION (Adrian, Jul 11): with the camera on, the LAST 8 FRAMES leave
    // (≈2s of motion at 4 fps), not a single one — the brain sees MOTION, not a
    // frozen blink. The same for ALL users (rule no. 9): the frames go through
    // `images`, while an explicitly attached picture goes through `image`.
    const camFrames = cameraOnRef.current && !attached ? frameBufRef.current.slice(-8) : []

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
    const uiUser: ChatMessage = { role: 'user', content: outgoing, ts: userTs }
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
    // VOCE SCOASĂ (21 aug clean-slate): gura live (mouth/feedSpeech) + gura de
    // siguranță a browserului nu mai există — răspunsul curge DOAR ca text.
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
          const base = cur.length >= next.length && cur.slice(0, next.length).every((m, i) => m === next[i]) ? cur : next
          const rest = base.slice(next.length).filter((m) => !(m.role === 'assistant' && m.ts === turnTs))
          return [...next, ...rest, { role: 'assistant', content: acc, ts: turnTs }]
        })
      }
      // RECONECTARE AUTOMATĂ LA TRIMITERE (owner, 21 aug: „când îi vine accesul la
      // net nu se reconectează automat"). esteConectat() e ULTIMA măsurătoare — dacă
      // CREDEM că suntem offline, netul poate să fi revenit TĂCUT între poll-uri.
      // Reverificăm REAL o dată, DOAR când pare offline (zero cost pe calea online),
      // ca mesajul să nu plece pe creierul local când serverul e iar la îndemână.
      if (!esteConectat()) await verificaConexiuneReala()
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
      // BUG REPARAT 21 aug 2026 (owner: „am oprit netul să testez și nu s-a comutat
      // pe offline"): modelul era 'descărcat' (în Cache Storage) dar NU 'gata'
      // (încărcat în GPU) în clipa în care cădea netul — cât ești online e ținut în
      // cache ca să nu ardă bateria, iar urcarea în GPU pornea abia la căderea
      // netului și durează secunde. În fereastra aia tura cădea pe `streamChat` →
      // serverul de neatins → „am pierdut conexiunea". FIX: dacă suntem offline și
      // modelul e în cache/se pregătește, îl TREZIM în GPU ÎNAINTE de decizie
      // (pregatesteModelOffline e idempotent), apoi decidem.
      const stLoc0 = stareCreierLocal().stare
      if (!esteConectat() && (stLoc0 === 'descarcat' || stLoc0 === 'se_pregateste')) {
        await pregatesteModelOffline()
        // Trezirea în GPU durează secunde: dacă între timp a venit „stop" sau
        // barge-in (tură nouă), NU continua cu snapshot-ul vechi — altfel ar clipi
        // peste tura curentă (audit 3 agenți, 21 aug). Cleanup-ul îl face finally-ul.
        if (ac.signal.aborted || abortRef.current !== ac) return
      }
      // OFFLINE = creierul LOCAL, nu serverul de neatins. esteConectat() întoarce
      // ULTIMA măsurătoare reală (ping /health, reîmprospătat periodic), deci
      // false = chiar nu e net → serverul
      // oricum n-ar răspunde; streamLocalRaspuns răspunde dacă e 'gata', altfel spune
      // CINSTIT (nepregătit), niciodată eroarea falsă „am pierdut conexiunea".
      // FAIL-SAFE (owner 20 aug): pe device FĂRĂ WebGPU creierul local nu merge
      // NICIODATĂ → acolo singura șansă de creier e serverul, deci lăsăm calea veche
      // (server + mesaj onest la eșec) în caz că detectorul s-a înșelat.
      const eTuraOffline = !esteConectat() && stareCreierLocal().stare !== 'fara_webgpu'
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
        face?.descriptor,
        face?.photo,
        // VOCE SCOASĂ (21 aug clean-slate): parametrii vocali morți (voiceFeatures /
        // serverVoiceOff / spoken / speaker / audio-nativ / voce-ambientală) au fost
        // scoși din semnătura streamChat — o tură e mereu TEXT. Contractul TEXT e neatins.
        // MODUL MAȘINĂ (11 aug; rescris 13 aug): userul e la volan → răspuns SCURT (text).
        // NU e cale vocală — doar UI-ul de mașină. Ce spune că face, execută („vorbă = faptă").
        isCarMode() || undefined,
      )
      for await (const chunk of sursaFlux) {
        if (!firstAt && chunk && chunk.trim()) firstAt = performance.now() // first REAL word
        acc += chunk
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
      flushMesaje() // FLUSH FINAL — garantează conținutul complet al răspunsului
      // Publishes the REAL time on the counter (only if visible text arrived).
      if (firstAt) {
        setRealLatency({ firstMs: firstAt - t0, totalMs: performance.now() - t0, at: Date.now() })
      }
      // A monitor-only / tool-only reply streams no visible text. Don't leave an
      // empty assistant turn in the history (it would 400 the next request).
      if (!acc.trim()) setMessages(next)
      else suggestFacial(acc) // the face follows the tone of the finished reply
      // FAZA 3 — COZILE OFFLINE: dacă tura a fost fără net, o punem în coada de
      // SYNC (chat + locație) ca serverul să se actualizeze la revenire; dacă
      // cererea CEREA net (căutare/vreme/email…), o punem și în coada de AMÂNATE,
      // s-o rezolvăm și s-o anunțăm civilizat când revine semnalul (owner).
      if (eTuraOffline) {
        const acum = Date.now()
        const lat = coordsRef.current?.lat
        const lon = coordsRef.current?.lon
        if (msg) adaugaTuraSync({ rol: 'user', text: msg, t: acum, lat, lon })
        if (acc.trim()) adaugaTuraSync({ rol: 'assistant', text: acc, t: acum })
        if (msg && necesitaNet(msg)) adaugaAmanata({ intrebare: msg, t: acum, lat, lon })
        // GURA OFFLINE (Faza 1 · M3): Kelion VORBEȘTE răspunsul fără net, prin TTS
        // local (Web Speech `speechSynthesis` — offline, gratis, zero descărcare),
        // reconstruit curat după teardown. Doar dacă tura NU a fost înlocuită/anulată
        // între timp (o singură gură). No-op cinstit dacă browserul n-are TTS.
        if (acc.trim() && !ac.signal.aborted && abortRef.current === ac) {
          vorbesteOffline(acc, resolveLang(replyLang))
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
        // Taie orice redare a naratorului dacă tura pică (o singură ieșire audio).
        interruptAll('chat-error')
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
          // VOCE SCOASĂ (21 aug): reîncercarea tăcută e o simplă tură TEXT.
          window.setTimeout(() => void sendRef.current(msg), 400)
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
                    ? spoken.offline // session expired / not signed in — honest, not "brain dead"
                    : code === 'paywall'
                      ? t.brainError
                      : code === 'rate_limited'
                        ? spoken.requestLost
                        : t.brainError
        if (code === 'paywall') {
          window.dispatchEvent(new Event('kelion:paywall'))
        }
        // KEEP the text already received (don't drop it) — just add a discreet note,
        // so the text stays complete versus what was heard.
        // FUNCTIONAL updater, not a snapshot — the same lesson as in the streaming
        // loop (line ~912): a message arriving meanwhile (voice transcript,
        // a new question) must not disappear because this turn failed.
        setMessages((cur) => {
          const baza = cur.length >= next.length && cur.slice(0, next.length).every((mm, i) => mm === next[i]) ? cur : next
          const rest = baza.slice(next.length).filter((mm) => !(mm.role === 'assistant' && mm.ts === turnTs))
          return [...next, ...rest, { role: 'assistant', content: acc.trim() ? `${acc}\n⚠️ ${m}` : `⚠️ ${m}`, ts: Date.now() }]
        })
        if (code === 'offline') {
          offlineRef.current = true
          retryTextRef.current = msg // resume THIS message when the signal returns
        }
        if (code === 'server_down') {
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

  // VOCE SCOASĂ (21 aug clean-slate): microfonul permanent, ensureMic/toggleMic,
  // sesiunile live (Gemini/Realtime), zăvorul cross-tab al vocii, dansul pe muzica
  // din microfon și trezirea la volan au fost ȘTERSE cu totul. App-ul e SURD pe
  // calea vocală — nu mai există captură microfon → creier. A rămas DOAR chatul TEXT.

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

    const tick = (): void => {
      // PAUZĂ CÂT REDĂ NARATORUL (owner, 13 aug — desincronizarea feței sub
      // sarcină): captarea = `toDataURL` SINCRON, care citește înapoi de pe
      // GPU-ul avatarului; cât redă naratorul (playVoice → getVoiceLevel > 0.06)
      // blochează firul principal și lip-sync-ul sare. Nu capturăm atunci —
      // vederea nu e cerută; se reia instant la tăcere.
      if (getVoiceLevel() > 0.06) return
      // VOCE SCOASĂ (21 aug): throttle-ul pe sesiunea live (vlRef) a dispărut odată
      // cu vocea — captarea merge la ritmul normal (4–8 fps, adaptat la mișcare).
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

  // VOCE SCOASĂ (21 aug clean-slate): calibrarea amprentei vocale (voiceprint) și
  // auto-înrolarea adminului au dispărut odată cu microfonul — nu se mai capturează
  // voce. calibrateVoiceprint/hasVoiceprint/startMic au fost ȘTERSE din audioIO
  // (jumătatea de captură), care păstrează DOAR redarea. Amprenta rămâne LIVE pe
  // altă cale (CustomerSettings.onRecordVoiceprint + routes/voiceprint.ts).

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
  // VOCE SCOASĂ (21 aug clean-slate): butonul de microfon (micButton) a dispărut —
  // nu mai există captură microfon → creier. Chatul e DOAR text.
  const hint = t.chatHint
  // The right-hand button concerns ONLY the WRITTEN chat. You have something to send (text or
  // attached file) → it's active. Empty field → the chat is AUDIO (the microphone is always
  // on, the voice comes in by itself), so the button stays a neutral arrow, NOT a
  // dead stop-square. The ■ square appears ONLY when you really have text to stack over
  // a turn in progress (then click = you queue it, it interrupts nothing).
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
              {heard || lastUser?.content ? (
                <p className="car-heard">{(heard || lastUser?.content || '').slice(0, 200)}</p>
              ) : null}
              <p className="car-reply">{cleanMsg(lastAssistant?.content ?? '') || t.carHint}</p>
            </div>
            {/* VOCE SCOASĂ (21 aug clean-slate): butonul de microfon full-duplex din
                modul mașină a dispărut odată cu vocea. Overlay-ul rămâne (glob, ieșire,
                răspunsul lui Kelion pe monitor); calea vocală se reconstruiește ulterior. */}
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
        {/* VOCE SCOASĂ (21 aug clean-slate): banda de dictare live (liveVoice) și
        bargraful urechii + sliderul de preamp au dispărut odată cu microfonul. A
        rămas DOAR banda de text de mai jos (👤/🧠/K). */}
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
        ) : null}
        {/* RĂSPUNSUL lui Kelion NU se mai arată/baleiază în banda de jos (Adrian,
            21 aug: „când răspunde Kelion, răspunde pe monitor, e ok; în bara de
            chat de jos nu trebuie să mai afișeze sau să baleze textul; și când e
            vorbit, gata audio"). Răspunsul rămâne pe MONITOR (+ audio la revenirea
            vocii). Banda de jos ține DOAR ecoul a ce transmiți TU (👤, regula ta
            veche „textul o singură dată") și semnul de gândire (🧠) — nu răspunsul. */}
        {/* REMOVED (Adrian's order, Jul 10: „remove that microphone-is-muted
        thing, it's wrong” + „microphone with autovox, instantly”): the mic-mute
        hint is gone. (21 aug: microfonul + auto-înrolarea din audioIO au fost
        ȘTERSE cu totul — calea vocală s-a scos; nota rămâne ca istoric.) */}
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
          {/* MICROFON OFFLINE (Faza 1 · M4): apare doar când urechea (Whisper) e
              descărcată. Apasă → ascultă; apasă iar → transcrie offline în caseta de scris. */}
          {urecheGata && (
            <button
              type="button"
              className={`composer-icon ${asculta ? 'live' : ''}`}
              onClick={() => void toggleAscultare()}
              title={asculta ? 'Oprește și transcrie (offline)' : 'Vorbește — Kelion aude offline'}
              aria-label="Microfon offline"
            >
              {asculta ? '⏺' : '🎤'}
            </button>
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
          />
          {/* VOCE SCOASĂ (21 aug clean-slate): butonul de microfon din compozitor a dispărut. */}
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
