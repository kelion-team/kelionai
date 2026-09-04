import { downsample, float32ToPcm16, base64ToBytes, pcm16ToFloat32 } from './pcm'
import { OpusVoceClient, esteSuportat as opusSuportat } from './opusVoce'
import { alimenteazaNivelVoce } from './audioIO'
import { pornesteCulesPcm, type CulesPcm } from './pcmWorklet'
import { pasVad, stareVadInitiala, rmsDin, zcrDin, PARAM_VAD_IMPLICIT, type StareVad } from './vad'
import { inscrieVoceaLuiKelion } from './vociKelion'
import { obtineAudioContext } from './audioContextPartajat'
import { ensureAudioContextRunning, setupAudioContextAutoResume, startVoiceHeartbeat } from './voiceHeartbeat'
import { faraBluetoothSigur } from './rutaAudio'
import { apiFetch, openApiWebSocket } from './transport'
import { marcheazaFaza } from './errorReport'
import {
  clasificaInchidereVocalLive,
  esteCodEroareVocalLive,
  esteEroareVocalLiveTranzitorie,
  parseazaCapabilitateVocalLive,
  type VocalLiveCapability,
  type VocalLiveFailureCode,
} from './vocalLiveAvailability'

// ── OPENAI REALTIME FULL-DUPLEX — CLIENTUL DIN BROWSER ───────────────────────
//
// Ce lipsea: motorul (`backend/src/services/vocalLive.ts`), ruta WS
// (`/api/vocal-live`) și uneltele de admin erau scrise și înregistrate din 4 aug,
// dar `grep -rn "vocal-live" frontend/src` întorcea ZERO — browserul nu deschidea
// niciodată socketul. Șoseaua exista, nu circula nimeni pe ea. Ăsta e capătul
// care lipsea.
//
// Backend-ul este singurul care cunoaște modelul și credentialele OpenAI. Browserul
// păstrează doar protocolul media/control și nu expune tokenuri sau selectoare de provider.
//
// CONTRACTUL cu serverul (definit în `backend/src/routes/vocalLive.ts`):
//   client → server:  cadre BINARE = PCM16 mono 16kHz de la microfon
//   server → client:  JSON — gata · audio(base64 PCM 24kHz) · user · kelion ·
//                     intrerupt · tura_gata · eroare
//
// CALE EXCLUSIVĂ: nu se pornește peste calea veche. Comentariul rutei avertizează
// „vei avea 2 voci în același timp" — de-aia `deschideVocalLive` cere apelantului
// să fi oprit deja sesiunea veche, iar `vocalLiveDisponibila()` există ca să se
// poată alege ÎNAINTE de a deschide ceva.

const RATA_INTRARE = 16000 // ce trimitem (PCM16 mono)
const RATA_IESIRE = 24000 // ce primim de la model (PCM 24kHz)
const MAX_WS_BUFFERED_BYTES = 512 * 1024
const MAX_INPUT_IMAGE_CHARS = 2_000_000

/** Acceptă cel mult un instantaneu explicit, pe care backendul îl mapează la `input_image`. */
export function instantaneeInputImage(values: string[] | undefined): string[] {
  const image = values?.find((value) =>
    /^data:image\/(?:jpeg|png|webp);base64,[a-zA-Z0-9+/=]+$/.test(value) && value.length <= MAX_INPUT_IMAGE_CHARS)
  return image ? [image] : []
}

export function poateTrimiteLive(bufferedAmount: number): boolean {
  return Number.isFinite(bufferedAmount) && bufferedAmount <= MAX_WS_BUFFERED_BYTES
}

export function golesteSurseAudio<T extends { stop(): void }>(sources: T[]): T[] {
  for (const source of sources) {
    try {
      source.stop()
    } catch {
      // O sursă deja terminată nu împiedică golirea restului cozii.
    }
  }
  return []
}

export function asteaptaDeschidereaSocket(
  ws: Pick<WebSocket, 'onopen'>,
  onOpen: () => void,
  signal: AbortSignal,
  timeoutMs = 10_000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false
    const cleanup = (): void => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
    }
    const finish = (action: () => void): void => {
      if (settled) return
      settled = true
      cleanup()
      action()
    }
    const onAbort = (): void => finish(() => reject(new DOMException('socket opening cancelled', 'AbortError')))
    const timer = setTimeout(() => finish(() => reject(new Error('timeout la deschiderea sesiunii'))), timeoutMs)
    signal.addEventListener('abort', onAbort, { once: true })
    ws.onopen = () => finish(() => {
      onOpen()
      resolve()
    })
  })
}

export interface VocalLiveOpts {
  /** Cancels a start that became stale because the user pressed Stop, the tab
   * unmounted or another audio owner took over. */
  signal?: AbortSignal
  /** Armat numai de clickul manual pe microfon. Serverul îl consumă o singură
   * dată; reconectările automate nu trebuie să-l trimită. */
  explicitStart?: boolean
  /** Starea transportului/conversației, pentru indicatorul persistent din UI. */
  onState?(state: VocalLiveState): void
  /** Sesiunea e deschisă și modelul e gata să asculte. */
  onGata?(): void
  /** Serverul a închis CURAT (cod 1000, fără motiv de eroare): nu e eroare,
   * nu se reia — interfața doar se întoarce la repaus. */
  onInchis?(): void
  /** Ce AUDE (subtitrarea userului), în flux. */
  onUser?(text: string, final: boolean): void
  /** Ce SPUNE Kelion, în flux. */
  onKelion?(text: string, final: boolean): void
  /** Tura s-a închis (tura_gata sau barge-in) — banda de transcriere se
   *  golește AICI, determinist (auditul 15 aug: fragmentul unei ture tăiate
   *  sau suprimate rămânea lipit pe ecran pe termen nelimitat — exact
   *  „bălăriile" fotografiate de owner). */
  onTuraInchisa?(): void
  /** Kelion a început/terminat de vorbit — pentru animația avatarului. */
  onVorbeste?(activ: boolean): void
  /** Cadru de ECRAN venit de la creierul complet prin ușa cere_creierului
   *  (8 aug: „kelion nu are acces la unelte"): monitor/doc/app/card — se dă
   *  aceluiași handleControl ca la chatul scris. Vocea NU vine pe aici. */
  onControl?(frame: unknown): void
  /** Orice eroare, NUMITĂ. Niciun „merge" prefăcut. */
  onEroare(motiv: string, code?: VocalLiveFailureCode): void
  /** Coordonatele device-ului, la cerere (8 aug: „nu are acces la gps, meteo"
   *  + „îi trebuiesc date de la gps real"). `acc` = precizia MĂSURATĂ a fixului
   *  (±metri, raportată de senzor) — pleacă și ea, ca serverul să spună
   *  modelului cât de bun e locul. null = nu avem (lipsa se declară). */
  coordonate?(): { lat: number; lon: number; acc?: number } | null
  /** Un instantaneu al camerei numai la cererea serverului și numai după
   *  consimțământul local. Backendul îl trimite OpenAI ca `input_image`;
   *  aceasta nu este o transmisie video continuă. */
  instantaneeLaCerere?(): string[] | Promise<string[]>
  /** CE E PE MONITOR (10 aug, ownerul: „nu are acces la ce se afișează pe
   *  monitor" — și pe VOCE): conținutul tabului activ, ca la chatul scris.
   *  Serverul îl ține și-l retransmite prin ușa creierului la get_monitor.
   *  null = nimic afișat. */
  monitor?(): { kind: string; title: string; url?: string; text?: string } | null
  /** ANCORA CENTRULUI DE TRANZACȚIONARE pe VOCE (N val 2a): cât tabul de
   *  trading e deschis, starea REALĂ de pe grafic (simbol, preț, interval,
   *  punctul de sub cursor) pleacă cu aceeași bătaie ca `monitor`. Serverul o
   *  ține și-o dă creierului prin ușă, ca la chatul scris — abia atunci
   *  răspunsul vocal produce frame-ul {niveluri} care se desenează pe grafic.
   *  null = tabul de trading nu e pe ecran (nu ancorăm pe date stătute). */
  tranzactii?(): { simbol: string; pret: number | null; interval: string; sursa: string; peste?: unknown; la: number } | null
  /** BARGRAF DE INTRARE (owner, 16 aug: „vreau sa vad un mic bargraf cu nivelul
   *  de la intrarea urechii modelului live… sa se identifice daca nu se
   *  trunchiaza nimic"). Nivelul REAL al microfonului pe fiecare cadru trimis
   *  modelului: `nivel` (RMS 0..1) + `pic` (vârf 0..1); `poarta`=true când
   *  half-duplex taie trimiterea (model primește tăcere); `clip`=true când
   *  vârful atinge plafonul (distorsiune/tăiere). Ca ownerul să VADĂ, măsurat,
   *  dacă vocea ajunge la model și dacă se trunchiază ceva. */
  onNivelIntrare?(n: { nivel: number; pic: number; poarta: boolean; clip: boolean }): void
  /** PREAMP inițial (owner, 16 aug): factorul de amplificare la deschiderea
   *  sesiunii (din preferința salvată a userului). 1 = neutru. Poate fi schimbat
   *  live cu handle.setPreamp. */
  preampInitial?: number
}

export type VocalLiveState =
  | 'connecting'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'interrupted'
  | 'error'

export function vocalLiveStateForServerEvent(
  eventType: string | undefined,
  final = false,
): VocalLiveState | null {
  if (eventType === 'gata' || eventType === 'tura_gata') return 'listening'
  if (eventType === 'user') return final ? 'thinking' : 'listening'
  if (eventType === 'kelion' || eventType === 'audio') return 'speaking'
  if (eventType === 'intrerupt') return 'interrupted'
  if (eventType === 'eroare') return 'error'
  return null
}

export interface VocalLiveHandle {
  inchide(): void
  /** Fluxul de intrare deja permis, numai pentru tap-uri locale pasive
   * (nivel ambiental/dans). Apelantul nu îi oprește track-urile. */
  fluxMicrofon(): MediaStream | null
  /** Oprește imediat redarea WebAudio a turei curente, fără a închide urechea live. */
  taieRedarea(): void
  /** Oprește redarea locală și cere serverului să suprime restul turei curente. */
  intrerupeRedarea(): void
  /** Mut/dezmut microfonul fără a rupe sesiunea (butonul de microfon al UI-ului). */
  setMuted(muted: boolean): void
  /** Câți octeți de microfon au plecat — dovadă că se trimite ceva, nu doar că
   *  socketul e deschis (exact distincția care a lipsit la prima probă live). */
  octetiTrimisi(): number
  /** PREAMP microfon (owner, 16 aug: „reglaj preamp de la minim la maxim"):
   *  factor de amplificare aplicat microfonului ÎNAINTE de trimitere. 1 = neutru,
   *  >1 = mai tare (dacă e „surd"), <1 = mai încet. Se vede în bargraf. */
  setPreamp(gain: number): void
  /** REDARE EXTERNĂ (owner, 14 aug: „audio obligatoriu pe scris"): true cât timp
   *  se redă vocea unei ture SCRISE prin audioIO — poarta half-duplex ține atunci
   *  urechea live mută (anti-ecou), ca modelul să nu se audă pe el însuși. */
  setRedareExterna(activ: boolean): void
}

/** Serverul are cheia și modelul Live? Se întreabă ÎNAINTE de a deschide socketul,
 *  ca să nu pornim o cale vocală spre gol. */
export async function vocalLiveDisponibila(): Promise<VocalLiveCapability | null> {
  try {
    const r = await apiFetch('/api/vocal-live/capability', { cache: 'no-store' })
    if (!r.ok) {
      const code: VocalLiveFailureCode = r.status === 401 || r.status === 403
        ? 'unauthorized'
        : r.status === 429
          ? 'rate_limit'
          : r.status >= 500
            ? 'transport'
            : 'transport'
      return {
        disponibil: false,
        model: '',
        voce: '',
        code,
        retryable: esteEroareVocalLiveTranzitorie(code),
      }
    }
    return parseazaCapabilitateVocalLive(await r.json())
  } catch {
    return null
  }
}

// PREAMP microfon (owner, 16 aug: „reglaj de la minim la maxim"): factor de
// amplificare mărginit sigur [0.1, 20]. Valoare invalidă → 1 (neutru).
function clampPreamp(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? Math.min(20, Math.max(0.1, n)) : 1
}

// ── IEȘIREA CA MEDIA (A2DP), NU CA „CONVORBIRE" — ca vocea să ajungă pe
// BLUETOOTH / BOXELE MAȘINII (11 aug, MĂSURAT de owner: „de ce nu se
// trimite vocea prin bluetooth, rămâne pe telefon; am încercat pe căști, clar
// nici la car audio") ────────────────────────────────────────────────────────
//
// Ce era înainte: vocea lui Kelion trecea printr-o BUCLĂ WebRTC locală (două
// conexiuni peer legate în aceeași pagină) redată dintr-un <audio> cu fluxul
// „primit" — trucul care dădea browserului referință pentru anularea de ecou
// (AEC). PROBLEMA măsurată de owner: audio-ul sosit prin WebRTC e clasat de
// Android drept „convorbire" (canalul VOICE_CALL / SCO al Bluetooth-ului), care
// RĂMÂNE PE TELEFON și NU folosește canalul A2DP de MUZICĂ pe care-l cer căștile
// și sistemul mașinii. De-aia vocea SCRISĂ (mp3 printr-un <audio>
// obișnuit, în audioIO.ts) mergea pe Bluetooth, dar cea LIVE nu.
//
// Ce e acum: vocea live iese printr-un <audio> obișnuit alimentat de WebAudio
// (`MediaStreamDestination` de pe analizor) — audio de MEDIA, exact ca mp3-ul —
// deci urmează ruta de muzică la căști / mașină. Din 22 aug „ruta-conștientă"
// anticipată aici chiar EXISTĂ: anularea de ecou din microfon e ADAPTIVĂ
// (`echoCancellation: procesare` — desktop pornită; pe mobil pornită DOAR
// când e cert că nu e niciun Bluetooth, vezi rutaAudio.ts); pe boxe
// Bluetooth/mașină rămâne oprită (acolo nu era necesară și pornirea ei ar
// rupe A2DP — bugul măsurat pe 11 aug).

// O SINGURĂ sesiune live per tab, garantată AICI, nu în apelant (auditul de
// noapte, 9 aug): gărzile apelantului sunt check-then-act peste await-uri de
// secunde — cronometrul de reluare și apăsarea pe microfon puteau deschide
// DOUĂ sesiuni, prima rămânând scursă cu microfonul și WS-ul vii (și factura
// curgând). Modelul este ales exclusiv de backend din configurația OpenAI.
let sesiuneActiva: { inchide: () => void } | null = null

export async function deschideVocalLive(opts: VocalLiveOpts): Promise<VocalLiveHandle | null> {
  // FAZA, pentru cutia neagra din errorReport: daca tabul moare fara `pagehide`
  // (crash de randare/OOM), post-mortemul de la pornirea urmatoare spune EXACT
  // in ce punct al caii vocale a murit.
  marcheazaFaza('voce:pornire')
  opts.onState?.('connecting')
  if (opts.signal?.aborted) return null
  if (!navigator.mediaDevices?.getUserMedia) {
    opts.onState?.('error')
    opts.onEroare('browserul nu dă acces la microfon')
    return null
  }
  // Orice a doua deschidere o omoară determinist pe prima, indiferent din ce
  // cursă a apelantului vine.
  sesiuneActiva?.inchide()
  sesiuneActiva = null

  let ws: WebSocket
  try {
    ws = await openApiWebSocket('/api/vocal-live', 'vocal-live')
  } catch {
    opts.onEroare('nu pot deschide sesiunea vocală', 'transport')
    return null
  }
  if (opts.signal?.aborted) {
    try { ws.close() } catch { /* already closed */ }
    return null
  }
  ws.binaryType = 'arraybuffer'

  let stream: MediaStream | null = null
  let ctxIn: AudioContext | null = null
  let ctxOut: AudioContext | null = null
  let proc: ScriptProcessorNode | null = null
  let cules: CulesPcm | null = null
  let resumeTimer: ReturnType<typeof setInterval> | null = null
  const openController = new AbortController()
  let inchis = false
  // O SINGURĂ eroare urcă per deschidere: la un server picat, `onerror` și
  // `onclose` trag amândouă — fără frâna asta, ChatPanel ar porni DOUĂ lanțuri
  // de reluare în paralel (adică două sesiuni) la fiecare ratare de conectare.
  let eroareUrcata = false
  const urcaEroarea = (m: string, code?: VocalLiveFailureCode): void => {
    if (eroareUrcata) return
    eroareUrcata = true
    opts.onState?.('error')
    // Simptomul ajunge ȘI la Kelion, nu doar ca toast la om: console.error e
    // canalul prins de errorReport → /api/client-errors → contextul creierului.
    // Fără asta, Kelion NU știa că sesiunea vocală a picat și răspundea „încearcă
    // din nou" la „ce e eroarea asta?". (Adrian, 12 aug — autodiagnostic.)
    try {
      console.error(`[voce] ${m}`)
    } catch {
      /* raportarea nu poate arunca */
    }
    opts.onEroare(m, code)
  }
  let octeti = 0
  // Coada de redare: fiecare cadru primit se programează DUPĂ ce se termină
  // precedentul. Fără asta, cadrele s-ar suprapune și vocea ar suna ca un cor.
  let cursorRedare = 0
  let surseActive: AudioBufferSourceNode[] = []
  // BOXA = elementul <audio> media prin care iese vocea lui Kelion (vezi antetul
  // de mai jos: ieșirea trebuie să fie MEDIA/A2DP ca să ajungă pe Bluetooth/mașină).
  let boxe: HTMLAudioElement | null = null
  // Pârghia de rezervă: dacă boxa media rămâne pe pauză (camera/o întrerupere +
  // autoplay), cădem pe redarea directă WebAudio — o dată, fără s-o repornim.
  let iesireDirecta = false
  let ceasCoords: ReturnType<typeof setInterval> | null = null
  // OPUS (owner, 12 aug): codecul WebCodecs al sesiunii + steagul „upload pe
  // Opus". Rămân null/false până serverul oferă Opus la `gata` ȘI codecul
  // pornește; altfel toată calea e PCM, ca azi.
  let opusClient: OpusVoceClient | null = null
  let opusTx = false
  // (ceasCadre scos 9 aug — camera doar la cerință; vezi handlerul 'gata'.)
  // Radierea vocii din registrul de înregistrare (vezi mai jos, la analizor).
  let radiazaVocea: (() => void) | null = null
  let curataHeartbeat: (() => void) | null = null
  let curataAutoResumeOut: (() => void) | null = null
  let curataAutoResumeIn: (() => void) | null = null
  // Procesarea WebRTC (AEC/AGC) chiar aplicată pe microfonul sesiunii ăsteia —
  // decisă la getUserMedia după ruta audio (rutaAudio.ts). Condiționează poarta
  // half-duplex (cu AEC viu, microfonul NU mai tace cât vorbește Kelion) și
  // raportarea onestă {type:'aec'} către server.
  let procesareActiva = false
  let curataDispozitive: (() => void) | null = null
  let curataAnulareExterna: (() => void) | null = null
  // Nodurile sesiunii pe contextul PARTAJAT — se deconectează la închidere
  // (contextul rămâne viu pentru restul aplicației).
  let sursaMic: MediaStreamAudioSourceNode | null = null
  let destInregistrare: MediaStreamAudioDestinationNode | null = null
  let destBoxe: MediaStreamAudioDestinationNode | null = null
  let analizor: AnalyserNode | null = null
  let bufAnalizor: Uint8Array<ArrayBuffer> | null = null
  let rafGura = 0

  const inchide = (): void => {
    if (inchis) return
    inchis = true
    marcheazaFaza('voce:inchisa')
    if (sesiuneActiva?.inchide === inchide) sesiuneActiva = null // zăvorul se predă curat
    if (rafGura) cancelAnimationFrame(rafGura)
    alimenteazaNivelVoce(0)
    curataHeartbeat?.()
    curataDispozitive?.()
    curataAnulareExterna?.()
    curataAnulareExterna = null
    curataAutoResumeOut?.()
    curataAutoResumeIn?.()
    if (resumeTimer) clearInterval(resumeTimer)
    openController.abort()
    if (ceasCoords) clearInterval(ceasCoords)
    opusClient?.inchide() // eliberează encoderul/decoderul WebCodecs
    opusClient = null
    opusTx = false
    radiazaVocea?.() // vocea iese din registrul de înregistrare odată cu sesiunea
    try {
      proc?.disconnect()
      cules?.opreste()
      cules = null
    } catch {
      /* deja deconectat */
    }
    stream?.getTracks().forEach((t) => t.stop())
    if (boxe) {
      try {
        boxe.pause()
        boxe.srcObject = null
      } catch {
        /* deja oprită */
      }
      boxe = null
    }
    // Contextul e PARTAJAT (audioContextPartajat.ts) — NU se închide aici.
    // Îi deconectăm doar nodurile noastre, ca graful să nu rețină sesiunea.
    surseActive = golesteSurseAudio(surseActive)
    for (const nod of [sursaMic, analizor, destInregistrare, destBoxe]) {
      try {
        nod?.disconnect()
      } catch {
        /* deja deconectat */
      }
    }
    sursaMic = null
    analizor = null
    destInregistrare = null
    destBoxe = null
    // ctxIn/ctxOut rămân referite (nu se închid): un cadru întârziat din
    // worklet mai poate citi `sampleRate` după închidere, fără să arunce.
    try {
      ws.close()
    } catch {
      /* deja închis */
    }
  }
  if (opts.signal) {
    const onAbort = (): void => inchide()
    opts.signal.addEventListener('abort', onAbort, { once: true })
    curataAnulareExterna = () => opts.signal?.removeEventListener('abort', onAbort)
    if (opts.signal.aborted) {
      inchide()
      return null
    }
  }
  // Zăvorul se ia IMEDIAT ce sesiunea are un `inchide` întreg — inclusiv în
  // fereastra de setup (getUserMedia/AEC durează secunde): a doua deschidere
  // sosită între timp o omoară pe asta, nu-i lasă microfonul scurs.
  sesiuneActiva = { inchide }

  /** Barge-in: userul a vorbit peste Kelion → oprim redarea INSTANT și golim coada.
   *  Fără asta, Kelion ar continua să vorbească peste om încă câteva secunde. */
  const taieRedarea = (): void => {
    surseActive = golesteSurseAudio(surseActive)
    cursorRedare = 0
    alimenteazaNivelVoce(0)
    opts.onVorbeste?.(false)
  }

  // ── GURA AVATARULUI (8 aug: „atașez avatarul — merge?") ────────────────────
  // Avatarul își ia deschiderea gurii din getVoiceLevel(), hrănit până acum doar
  // de redarea <audio> a căii vechi. Aici redarea e WebAudio, deci nivelul se
  // calculează dintr-un analizor pus pe drumul sunetului și se împinge în
  // același loc — gura mișcă la fel, indiferent de cale.
  // (analizor/bufAnalizor/rafGura sunt declarate mai sus, lângă nodurile
  // sesiunii — `inchide()` le atinge și poate rula înainte de linia asta.)
  const pornesteGura = (): void => {
    if (rafGura || !analizor || !bufAnalizor) return
    const pas = (): void => {
      if (inchis || !analizor || !bufAnalizor) {
        rafGura = 0
        alimenteazaNivelVoce(0)
        return
      }
      analizor.getByteTimeDomainData(bufAnalizor)
      let s2 = 0
      for (let i = 0; i < bufAnalizor.length; i++) {
        const v = (bufAnalizor[i] - 128) / 128
        s2 += v * v
      }
      alimenteazaNivelVoce(Math.sqrt(s2 / bufAnalizor.length) * 3)
      if (surseActive.length) rafGura = requestAnimationFrame(pas)
      else {
        rafGura = 0
        alimenteazaNivelVoce(0)
      }
    }
    rafGura = requestAnimationFrame(pas)
  }

  // Redarea unui bloc Float32 @24 kHz — folosită și de PCM base64 (redaCadru),
  // și de decoderul Opus (care scoate direct Float32). Aceeași programare pe
  // cursorRedare, deci sunetul curge la fel indiferent de codecul de pe sârmă.
  const redaFloat32 = (f32: Float32Array): void => {
    if (!ctxOut || inchis || !analizor || !f32.length) return
    if (ctxOut.state !== 'running') {
      void ensureAudioContextRunning(ctxOut)
    }
    const buf = ctxOut.createBuffer(1, f32.length, RATA_IESIRE)
    // `.set` acceptă orice Float32Array (indiferent de tipul buffer-ului din
    // spate), spre deosebire de copyToChannel care cere strict ArrayBuffer.
    buf.getChannelData(0).set(f32)
    const src = ctxOut.createBufferSource()
    src.buffer = buf
    src.connect(analizor)
    const acum = ctxOut.currentTime
    if (cursorRedare < acum) {
      cursorRedare = acum
    }
    // NU există „protecție de drift" aici (F1 al marii verificări, 22 aug):
    // vechea ramură `cursorRedare > acum + 2` resetă cursorul FĂRĂ să
    // oprească sursele deja programate — pe orice replică mai lungă de ~2s
    // de buffer, cadrele noi se așezau PESTE coada încă redată (două fluxuri
    // simultan din aceeași gură). A programa înainte E normal la bursturi;
    // singurul reset legitim al cursorului e la întrerupere (taieRedarea → 0).
    src.start(cursorRedare)
    cursorRedare += buf.duration
    surseActive.push(src)
    pornesteGura()
    opts.onVorbeste?.(true)
    opts.onState?.('speaking')
    src.onended = () => {
      surseActive = surseActive.filter((s) => s !== src)
      if (!surseActive.length) {
        opts.onVorbeste?.(false)
        opts.onState?.('listening')
      }
    }
  }

  const redaCadru = (b64: string): void => {
    try {
      const bytes = base64ToBytes(b64)
      if (!bytes.length) return
      const f32 = pcm16ToFloat32(bytes)
      if (f32.length) redaFloat32(f32)
    } catch (err) {
      console.warn('[vocalLive] audio frame decode error:', err)
    }
  }

  // GPS-ul CĂTRE sesiune (8 aug: „nu are acces la gps, meteo"): serverul ține
  // ultimele coordonate și le dă creierului la fiecare trecere prin ușă. Se
  // trimit la `gata` și apoi la fiecare 2 minute (ritmul watcher-ului din
  // ChatPanel) — cadru JSON text, distinct de cadrele binare de microfon.
  const trimiteCoords = (): void => {
    if (inchis || ws.readyState !== WebSocket.OPEN) return
    const c = opts.coordonate?.()
    try {
      // ANCORA REALITĂȚII (8 aug: „nu e ancorat în realitate"): pe lângă GPS
      // pleacă și ORA + FUSUL device-ului — serverul le coace în instrucțiunea
      // sesiunii. Fără coordonate, ancora pleacă doar cu timpul (real, nu gol).
      ws.send(
        JSON.stringify({
          type: 'coords',
          lat: c?.lat,
          lon: c?.lon,
          acc: c?.acc,
          now: new Date().toISOString(),
          tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
          // Conținutul de pe monitor merge cu aceeași bătaie (10 aug): serverul
          // îl ține și-l dă creierului la get_monitor prin ușă, pe VOCE.
          monitor: opts.monitor?.() ?? null,
          // Starea Centrului de Tranzacționare merge cu aceeași bătaie (N val 2a):
          // serverul o ține și-o dă creierului prin ușă ca ancoră a clipei, ca la
          // chatul scris — abia atunci vocea produce frame-ul {niveluri}.
          tranzactii: opts.tranzactii?.() ?? null,
        }),
      )
    } catch {
      /* socket picat — close-ul curăță */
    }
  }

  ws.onmessage = (ev: MessageEvent): void => {
    if (typeof ev.data !== 'string') return
    let m: { type?: string; data?: string; text?: string; final?: boolean; motiv?: string; reason?: string; code?: string; frame?: unknown; opus?: boolean; codec?: string }
    try {
      m = JSON.parse(ev.data) as typeof m
    } catch {
      return
    }
    const nextState = vocalLiveStateForServerEvent(m.type, !!m.final)
    if (nextState) opts.onState?.(nextState)
    switch (m.type) {
      case 'gata':
        marcheazaFaza('voce:gata')
        // AUDIOCONTEXT gata ÎNAINTE să spunem „Kelion te așteaptă". Pe mobil/
        // desktop, contextul poate rămâne 'suspended' dacă începi să vorbești
        // imediat — primele cuvinte se pierd (userul repetă și a doua oară merge).
        void (async (): Promise<void> => {
          await ensureAudioContextRunning(ctxIn)
          await ensureAudioContextRunning(ctxOut)
          // Abia acum Kelion arată că ascultă — microfonul e deblocat.
          opts.onGata?.()
        })()
        trimiteCoords()
        if (!ceasCoords) ceasCoords = setInterval(trimiteCoords, 120_000)
        // OPUS: serverul a oferit Opus ȘI browserul are WebCodecs → pornim
        // codecul. Doar când e gata anunțăm serverul (`opus_ready`) și abia de
        // ATUNCI tag-uim uploadurile — ordinea WS ne scutește de curse. Orice
        // eșec = rămânem pe PCM (nimic nu se rupe).
        if (m.opus && opusSuportat() && !opusClient) {
          void OpusVoceClient.creeaza(
            (octeti) => {
              // pachet Opus de microfon → [octet codec = 1][payload]
              if (inchis || ws.readyState !== WebSocket.OPEN || !poateTrimiteLive(ws.bufferedAmount)) return
              const cadru = new Uint8Array(octeti.length + 1)
              cadru[0] = 1
              cadru.set(octeti, 1)
              try { ws.send(cadru.buffer) } catch { /* close-ul curăță */ }
            },
            (pcm) => redaFloat32(pcm), // Opus de jos decodat → difuzor
            (sens) => {
              // CODEC MORT ÎN ZBOR (registrul frontend, lot C): înainte, moartea
              // decoderului lăsa difuzorul PERMANENT mut — serverul continua să
              // trimită Opus, iar fiecare pachet se arunca tăcut. Acum: cădem
              // TOTAL pe PCM pe AMBELE sensuri și-i spunem serverului
              // (opus_cazut → el nu mai tag-uiește nimic Opus). Cadrele Opus
              // încă în zbor se pierd (scurt), apoi vocea curge pe PCM.
              if (inchis) return
              console.error(`[vocalLive] codecul Opus a murit în zbor (${sens}) — cad pe PCM, vocea continuă`)
              opusClient?.inchide()
              opusClient = null
              opusTx = false
              try { ws.send(JSON.stringify({ type: 'opus_cazut' })) } catch { /* close-ul curăță */ }
            },
          ).then((c) => {
            if (!c || inchis) { c?.inchide(); return }
            opusClient = c
            opusTx = true
            try { ws.send(JSON.stringify({ type: 'opus_ready' })) } catch { /* close-ul curăță */ }
          })
        }
        // Camera nu publică flux video. Serverul poate cere ulterior un singur
        // instantaneu, mapat la OpenAI `input_image`.
        break
      case 'control':
        if (m.frame) opts.onControl?.(m.frame)
        break
      case 'cere_cadre': {
        // Cerere explicită: cel mult un instantaneu curent; fără consimțământ,
        // callbackul întoarce gol. Protocolul existent rămâne compatibil.
        void Promise.resolve(opts.instantaneeLaCerere?.() ?? [])
          .then((snapshots) => {
            if (inchis || ws.readyState !== WebSocket.OPEN || !poateTrimiteLive(ws.bufferedAmount)) return
            const cadre = instantaneeInputImage(snapshots)
            ws.send(JSON.stringify({ type: 'cadre', cadre }))
          })
          .catch(() => {
            /* permisiune revocată, captură eșuată sau socket închis */
          })
        break
      }
      case 'audio':
        if (!m.data) break
        // OPUS: cadrele de jos vin tag-uite `codec:'opus'` cât e activ; le dăm
        // decoderului (ieșirea lui cade pe redaFloat32). Fără tag = PCM base64,
        // ca azi. După `opus_cazut` (codec mort în zbor), cadrele Opus ÎNCĂ în
        // zbor se pierd scurt (opusClient e null), apoi serverul trimite PCM.
        if (m.codec === 'opus') {
          opusClient?.incarcaOpusJos(base64ToBytes(m.data))
        } else {
          redaCadru(m.data)
        }
        break
      case 'user':
        opts.onUser?.(m.text ?? '', !!m.final)
        break
      case 'kelion':
        opts.onKelion?.(m.text ?? '', !!m.final)
        break
      case 'intrerupt':
        // SE SCRIE, nu se face mut (8 aug: „audio lui se oprește la jumătatea
        // frazei" — fără rândul ăsta, o tăiere venită de la model era
        // indistinctibilă de orice altă cauză).
        console.info('[vocalLive] modelul și-a tăiat vorba (barge-in) — a auzit voce peste el')
        taieRedarea()
        opts.onTuraInchisa?.() // tura tăiată nu-și lasă fragmentul pe bandă
        break
      case 'tura_gata':
        // FLUSH OPUS: dacă decoderul mai are cadre în coadă, le redăm acum,
        // altfel finalul frazei se trunchiază (tăiat pe difuzor).
        void opusClient?.flush().catch(() => {})
        opts.onTuraInchisa?.() // tura încheiată își ia textul de pe bandă
        break
      case 'ping':
        try {
          ws.send(JSON.stringify({ type: 'pong', t: (m as { t?: unknown }).t ?? Date.now() }))
        } catch {}
        break
      case 'pong':
        break
      case 'eroare':
        urcaEroarea(
          m.motiv ?? 'eroare necunoscută în sesiunea vocală',
          esteCodEroareVocalLive(m.code) ? m.code : undefined,
        )
        break
      case 'session_closed':
        if (m.reason === 'idle_timeout') {
          urcaEroarea('sesiune vocală închisă după inactivitate', 'idle_timeout')
        }
        break
      default:
        break
    }
  }

  // onerror NU se raportează separat: specificația WebSocket spune că onerror e
  // întotdeauna urmat de onclose (cu codul și motivul real). Raportarea de aici
  // fura guardul eroareUrcata și ascundea cauza reală din onclose — utilizatorul
  // vedea doar „(rețea)" în loc de codul și motivul real al serverului.
  ws.onerror = (err): void => {
    console.warn('[vocalLive] websocket error encountered:', err)
  }
  ws.onclose = (ev: CloseEvent): void => {
    if (inchis) return
    const failure = clasificaInchidereVocalLive(ev.code, ev.reason)
    if (failure === 'no_credit') {
      urcaEroarea('sesiune vocală: credit epuizat — reîncarcă pentru voce')
    } else if (failure === 'unauthorized') {
      // Textele sunt consumate de ChatPanel pentru verdictele de cont, nu de
      // classifierul OpenAI (creditul Kelion și sesiunea nu sunt erori provider).
      urcaEroarea('sesiune vocală: nu ești autentificat')
    } else if (failure) {
      urcaEroarea(
        failure === 'idle_timeout'
          ? 'sesiune vocală închisă după inactivitate'
          : 'sesiune vocală indisponibilă',
        failure,
      )
    } else {
      // Închidere CURATĂ (1000 fără motiv): nu e eroare, nu urcă în
      // console.error, nu pornește plasa de reluare. Interfața află doar ca
      // să se întoarcă la repaus.
      console.log('[vocalLive] sesiune închisă curat de server')
      opts.onInchis?.()
    }
    inchide()
  }

  // KEEPALIVE WS: un SINGUR ceas — voiceHeartbeat (pornit la onopen, 10s)
  // trimite {type:'ping'} ca proxy-ul/Caddy să nu închidă socket-ul pe liniște
  // cu 1006. Al doilea ceas de ping (15s, identic cadru cu cadru) a fost scos
  // la marea verificare din 22 aug (F11a): serverul doar RĂSPUNDE la ping-uri,
  // nu le cere, iar două cronometre pe același rol înseamnă două locuri de
  // curățat și zero câștig.

  // Microfonul pornește DUPĂ ce socketul e deschis: altfel primele cadre s-ar
  // pierde în gol și primele cuvinte ale omului ar dispărea.
  await asteaptaDeschidereaSocket(ws, () => {
      // WebSocket-ul este CONNECTING până la onopen; trimiterea mai devreme
      // aruncă InvalidStateError și pierde armarea clicului explicit.
      if (opts.explicitStart) {
        try {
          ws.send(JSON.stringify({ type: 'explicit_start' }))
        } catch {
          urcaEroarea('nu am putut arma sesiunea vocală', 'transport')
          inchide()
          return
        }
      }
      // Ancora realității pleacă PRIMA, chiar la deschidere — serverul o
      // așteaptă puțin înainte să construiască instrucțiunea sesiunii.
      trimiteCoords()
      curataHeartbeat = startVoiceHeartbeat(() => ws, 10_000)
  }, openController.signal).catch((e: Error) => {
    if (inchis) return
    urcaEroarea(e.message, 'transport')
    inchide()
  })
  if (inchis || ws.readyState !== WebSocket.OPEN) return null

  const eMobil = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)
  try {
    // PROCESAREA DE SUNET OPRITĂ CA VOCEA SĂ AJUNGĂ PE BLUETOOTH (11 aug, MĂSURAT
    // de owner: „nu funcționează ieșirea pe bluetooth" — chiar și DUPĂ ce redarea
    // a trecut pe media/A2DP, #1006). Cauza mai adâncă: pe Android, cât timp
    // microfonul e deschis CU procesare WebRTC (echoCancellation/noiseSuppression/
    // autoGainControl), Chrome ține tot dispozitivul în MODE_IN_COMMUNICATION —
    // iar în modul ăla ORICE ieșire (chiar și media) stă pe telefon / canalul SCO,
    // NU pe A2DP-ul de muzică al căștilor/mașinii. Oprind procesarea, captura e
    // brută → mod normal → ieșirea urmează ruta de media pe Bluetooth/mașină.
    // Preț: pe difuzorul telefonului ecoul nu mai e anulat de browser (barge-in
    // server e oricum OFF); zgomotul de drum nu mai e filtrat pe microfon — dacă
    // devine problemă în mașină, pasul următor e să reactivăm DOAR noiseSuppression
    // și să vedem dacă ruta A2DP rezistă. Întâi trebuie ca vocea să AJUNGĂ acolo.
    // ANTI-ECOU PE DESKTOP (owner, 15 aug: „am nevoie de un sistem care anulează
    // echo" — măsurat în consola lui: serverul îi tăia vorba lui Kelion pentru
    // că-și auzea propriul ecou). Motivul stingerii AEC (11 aug, #1006) e DOAR
    // pe Android: procesarea WebRTC ține telefonul în MODE_IN_COMMUNICATION și
    // rupe A2DP-ul. Pe DESKTOP modul ăla nu există → AEC pornit acolo omoară
    // ecoul la sursă, fără să atingă Bluetooth-ul reparat pe mobil.
    // AMPLIFICARE PENTRU MICROFON SURD (owner, 16 aug: „poate o fi mai surd… ce
    // faci daca e surd?"). Diagnosticul a găsit că exact calea LIVE avea
    // autoGainControl OPRIT, în timp ce celelalte căi îl au pornit — de-aia era
    // mai puțin sensibilă. Îl PORNIM pe DESKTOP (ridică vocea slabă/departe la
    // sursă), gardat de eMobil ca să NU strice ruta A2DP Bluetooth de pe Android
    // (unde procesarea ține telefonul în MODE_IN_COMMUNICATION). noiseSuppression
    // rămâne OFF: pe vocea joasă ar putea tăia chiar vorba (ar înrăutăți „surdul").
    // Peste asta, preamp-ul manual (setPreamp) dă boost suplimentar la cerere.
    // AEC ADAPTIV PE RUTA AUDIO (owner, 22 aug: „identifica toate optiunile de
    // device… 0 greseli de auz"). Regula veche „mobil = fără procesare" plătea
    // pe DIFUZORUL telefonului (ecoul nu era anulat → half-duplex → microfonul
    // tăcea cât vorbea Kelion). Regula nouă: pe mobil procesarea pornește DOAR
    // când e CERT că nu există niciun dispozitiv Bluetooth (citirea listei a
    // reușit + niciun nume nu pare BT — rutaAudio.ts); orice îndoială =
    // comportamentul de azi (oprită), ca bugul măsurat pe 11 aug („nu
    // funcționează ieșirea pe bluetooth", MODE_IN_COMMUNICATION rupe A2DP) să
    // nu se poată întoarce. Desktop: pornită, ca până acum.
    const procesare = !eMobil || (await faraBluetoothSigur())
    if (inchis) return null
    procesareActiva = procesare
    const streamNou = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: procesare, noiseSuppression: false, autoGainControl: procesare },
    })
    if (inchis) {
      streamNou.getTracks().forEach((track) => track.stop())
      return null
    }
    stream = streamNou
  } catch {
    urcaEroarea('microfonul nu a fost permis')
    inchide()
    return null
  }

  // UN SINGUR CONTEXT, PARTAJAT (4 sept: „chatul audio live rupe aplicația").
  // Chrome refuză peste 6 AudioContext-uri per document; aplicația ținea patru
  // deschise permanent (nivel, sonerie, spațial, companion) și sesiunea vocală
  // mai deschidea DOUĂ la fiecare pornire — la al șaptelea constructorul ARUNCA,
  // sesiunea murea imediat după „session ready" și reluarea o lua de la capăt,
  // în buclă. Acum intrarea (microfonul) și ieșirea (vocea) merg pe același
  // context partajat cu restul aplicației (audioContextPartajat.ts): bufferele
  // de ieșire se creează la RATA_IESIRE și contextul le reeșantionează singur,
  // iar intrarea se reduce la 16 kHz din `sampleRate`-ul contextului (ca înainte).
  // Dacă totuși nu se poate deschide, eșecul e raportat curat și sesiunea se închide.
  const ctxPartajat = obtineAudioContext()
  if (!ctxPartajat) {
    urcaEroarea('nu pot deschide ieșirea audio: Web Audio indisponibil', 'transport')
    inchide()
    return null
  }
  ctxIn = ctxPartajat
  ctxOut = ctxPartajat
  // MOBIL — CONTEXTUL PORNIT 'suspended' (owner, 13 aug: „primul cuvânt nu-l aude
  // corect"). Contextele astea se creează DUPĂ două await-uri (deschiderea
  // socketului + getUserMedia), deci nasc SUSPENDATE pe iOS/Android — gestul care
  // a pornit sesiunea s-a „consumat" până aici. Cât rămân suspendate,
  // `onaudioprocess` NU rulează → microfonul e surd și primele cuvinte se pierd.
  // `resumeTimer` de mai jos face `resume()` pe interval, DAR — cum spune chiar
  // audioGraph.ts — `resume()` fără gest „nu ajută" pe mobil. Armăm deci
  // deblocajul pe PRIMUL tap, exact cum face deja cealaltă cale (openMicGraph):
  // additiv (pe desktop contextul e deja 'running' → practic no-op, iar ascultătorii
  // se auto-retrag la prima trezire). Deblocajul pe gest îl armează
  // obtineAudioContext() o dată per context; aici rămâne doar auto-resume-ul
  // legat de viața sesiunii (un singur set — contextul e unul).
  // Verificat: nu pot proba efectul de mobil din headless — se confirmă LIVE.
  curataAutoResumeIn = setupAudioContextAutoResume(ctxIn, () => !inchis)
  curataAutoResumeOut = null
  // Lanțul de ieșire se ridică ACUM, nu leneș la primul cadru: analizorul
  // (gura avatarului) → <audio> media → boxe/Bluetooth (vezi antetul de mai sus:
  // media, nu WebRTC, ca să ajungă în mașină).
  analizor = ctxOut.createAnalyser()
  analizor.fftSize = 256
  bufAnalizor = new Uint8Array(analizor.fftSize)
  // VOCEA LUI PE FILMARE (8 aug, ownerul: „trebuie când se înregistrează să se
  // audă vocea lui Kelion" — MĂSURAT de el: bifa „Distribuie audio" era PUSĂ
  // și tot nu se auzea decât microfonul lui). Cauza: vocea trece prin bucla
  // WebRTC a AEC-ului, iar captura de tab EXCLUDE audio-ul sosit prin WebRTC.
  // De-aia gura se înscrie în registrul vocilor: recorder.ts o amestecă
  // DIRECT în pistă, ocolind complet captura de tab.
  destInregistrare = ctxOut.createMediaStreamDestination()
  analizor.connect(destInregistrare)
  radiazaVocea = inscrieVoceaLuiKelion(destInregistrare.stream)
  // BOXA MEDIA: analizor → MediaStreamDestination → <audio> obișnuit. Fiind un
  // flux WebAudio (NU WebRTC), Android îl clasează drept MEDIA (A2DP) → vocea
  // urmează ruta de muzică pe Bluetooth/mașină (vezi antetul de sus).
  destBoxe = ctxOut.createMediaStreamDestination()
  analizor.connect(destBoxe)
  boxe = new Audio()
  boxe.srcObject = destBoxe.stream
  boxe.autoplay = true
  boxe.setAttribute('playsinline', '') // iOS: nu deschide playerul pe tot ecranul
  void boxe.play().catch(() => {
    /* politica de autoplay — reîncercat de ceasul de deblocaj (mai jos) */
  })
  // Serverul află starea REALĂ a anulării de ecou (22 aug — înainte se raporta
  // `activ:false` pentru toți, chiar și pe desktop unde AEC era pornit): cu
  // AEC viu, serverul are voie să judece „vocea de peste el" (tăierea la voce);
  // fără AEC, vocea de peste el poate fi chiar ecoul → tăierea rămâne oprită.
  const spuneAec = (): void => {
    try {
      ws.send(JSON.stringify({ type: 'aec', activ: procesareActiva }))
    } catch {
      /* sesiunea se închide oricum */
    }
  }
  if (ws.readyState === WebSocket.OPEN) spuneAec()
  else ws.addEventListener('open', spuneAec, { once: true })
  // SCHIMBAREA RUTEI AUDIO ÎN ZBOR (22 aug): conectezi/deconectezi un Bluetooth
  // cât sesiunea e vie → regula procesării tocmai a devenit greșită (cel mai
  // rău caz: BT conectat cu procesarea PORNITĂ = bugul din 11 aug, live —
  // ieșirea nu mai ajunge pe A2DP). La fiecare schimbare de dispozitive se
  // reevaluează; verdict diferit → sesiunea se închide cu motiv onest, iar
  // plasa de reluare din ChatPanel o repornește în secunde cu regula rutei noi.
  const laSchimbareDispozitive = (): void => {
    void faraBluetoothSigur().then((faraBt) => {
      if (inchis) return
      if ((!eMobil || faraBt) !== procesareActiva) {
        urcaEroarea('ruta audio s-a schimbat (Bluetooth) — reiau sesiunea cu regula potrivită', 'transport')
        inchide()
      }
    })
  }
  try {
    navigator.mediaDevices.addEventListener('devicechange', laSchimbareDispozitive)
    curataDispozitive = () => {
      try {
        navigator.mediaDevices.removeEventListener('devicechange', laSchimbareDispozitive)
      } catch {
        /* deja scos */
      }
    }
  } catch {
    /* API absent (browser vechi) — regula rămâne cea aleasă la pornire */
  }
  const sursa = ctxIn.createMediaStreamSource(stream)
  sursaMic = sursa
  // Culesul microfonului (9 aug, „scoate alertele prin rezolvări reale"):
  // ÎNTÂI AudioWorklet (API-ul curent, pe firul audio — fără [Deprecation] și
  // fără să țină firul principal); doar dacă browserul nu poate, cădem pe
  // ScriptProcessor, cu deprecarea lui cu tot — mai bine deprecat decât mut.
  // HALF-DUPLEX ANTI-ECOU (owner, 13 aug: „aec e problema"). Microfonul e deschis
  // FĂRĂ echoCancellation (linia getUserMedia de mai sus — ca ieșirea să prindă
  // ruta A2DP pe Bluetooth/mașină). Prețul măsurat de owner: cât Kelion vorbește,
  // propria lui voce intră în microfon și, trimisă la creier, iese „varză" în
  // recunoaștere („Kelion" → „Kelemen"). Fără AEC în browser, plasa corectă e
  // half-duplex: cât Kelion e AUDIBIL (redarea deja programată + o coadă scurtă
  // pentru ecoul rămas în aer), trimitem TĂCERE în locul microfonului — fluxul
  // rămâne continuu pentru VAD-ul serverului, dar creierul nu-și mai aude propria
  // voce. Pe căști nu strică nimic (ecou ~0); pe difuzor exact aici se stinge
  // „varza". Preț acceptat: nu se poate întrerupe prin voce cât vorbește (barge-in
  // server e oricum OFF). `cursorRedare` e ora (în ceasul lui ctxOut) până la care
  // e programat sunetul lui Kelion; peste ea + coada = tăcut.
  // Coada 0,6s, nu 0,25s (15 aug — ecoul tăia vocea și CU poarta pornită):
  // drumul real al sunetului trece prin elementul <audio> al boxei (ruta A2DP)
  // care are bufferul lui + latența dispozitivului — 0,25s se termina înainte
  // ca sunetul să fi ieșit din boxe. Și sursele încă vii numără ca audibil,
  // nu doar ceasul programării — două măsurători, nu una singură optimistă.
  const COADA_ECOU_S = 0.6
  // Pe context SUSPENDAT nimic nu iese din difuzor (currentTime îngheață,
  // sursele nu se scurg) — vechea formulă rămânea „audibil" pe veci și poarta
  // înlocuia microfonul cu tăcere la nesfârșit: Kelion simultan MUT și SURD,
  // fără nicio eroare (auditul 15 aug). Suspendat = inaudibil = microfonul
  // trece; ecoul nu are de unde să vină cât difuzorul tace.
  // REDARE EXTERNĂ (owner, 14 aug: „audio obligatoriu pe scris"): cât timp se redă
  // vocea unei ture SCRISE prin audioIO (nu prin WS-ul live), urechea live TREBUIE
  // să tacă, altfel se aude pe ea însăși („varză"). ChatPanel ridică steagul pe
  // durata redării prin handle.setRedareExterna → poarta half-duplex include și asta.
  let redareExterna = false
  const kelionAudibil = (): boolean =>
    redareExterna ||
    (!!ctxOut &&
      ctxOut.state === 'running' &&
      (surseActive.length > 0 || ctxOut.currentTime < cursorRedare + COADA_ECOU_S))
  let ultimNivelLa = 0
  let preampGain = clampPreamp(opts.preampInitial)
  // ── POARTA DE VOCE (VAD local) ── owner 20 aug: „nu se poate activa doar la voce?
  // nu la zgomot?" + „fa profi de la inceput". Cât Kelion ASCULTĂ, ar trimite spre model
  // DOAR când se vorbește (vad.ts) → economie pe tăcere.
  // OPRIT IMPLICIT (owner 20 aug, MĂSURAT LIVE: „in continuare nu merge vocea, am apasat
  // butonul dar nimic"). Regula #2 — schimbarea mea e primul suspect: VAD-ul putea să NU
  // deschidă niciodată (dacă înveți fondul din primele cadre cât vorbești, pragul urcă
  // peste vocea ta), tăind vocea complet. Până nu-l pot proba pe un dispozitiv real că NU
  // taie vocea, rămâne OPT-IN: `localStorage.kelion_vad='1'` îl PORNEȘTE; implicit e oprit,
  // deci trimiterea e continuă ca înainte (voce funcțională > cost).
  const vadPornit = (() => {
    try {
      return localStorage.getItem('kelion_vad') === '1'
    } catch {
      return false
    }
  })()
  let stVad: StareVad = stareVadInitiala(performance.now())
  let eraDeschis = false
  let eraPoarta = false // tranziția porții (Kelion audibil → liniște), pt. pre-roll-ul de barge-in
  // PRE-ROLL după DURATĂ (~250 ms), robust la mărimea cadrului: la deschidere trimitem
  // întâi audio-ul reținut, ca primul cuvânt să nu fie tăiat de onset + debounce.
  // 250 → 500 (owner, 22 aug, punctul 2 „ok — trebuie verificat"): dublăm
  // fereastra recuperată la barge-in ca prima silabă a frazei tale să nu se
  // piardă; verificat prin teste + proba pe dispozitiv la owner.
  const PREROLL_MS = 500
  const preRoll: Float32Array[] = []
  let preRollMs = 0
  const durataMs = (b: Float32Array): number => (b.length / 16000) * 1000
  // O SINGURĂ cale de trimitere (Opus dacă e activ, altfel PCM) — folosită și de
  // cadrul curent, și de pre-roll, ca să nu se dubleze logica.
  const trimiteCadru = (buf: Float32Array): void => {
    // O coadă mare înseamnă latență veche, nu audio live. Aruncăm cadrul curent
    // până când socketul recuperează, în loc să creștem memoria fără limită.
    if (!poateTrimiteLive(ws.bufferedAmount)) return
    if (opusTx && opusClient) {
      if (opusClient.incarcaMic(buf)) return
      const pcm0 = float32ToPcm16([buf])
      const octetiPcm = new Uint8Array(pcm0.buffer, pcm0.byteOffset, pcm0.byteLength)
      const cadru = new Uint8Array(octetiPcm.length + 1)
      cadru[0] = 0
      cadru.set(octetiPcm, 1)
      try { ws.send(cadru.buffer) } catch { /* close-ul curăță */ }
      octeti += octetiPcm.length
      return
    }
    const pcm = float32ToPcm16([buf])
    ws.send(pcm.buffer)
    octeti += pcm.byteLength
  }
  const laCadru = (brut: Float32Array): void => {
    if (inchis || ws.readyState !== WebSocket.OPEN) return
    let ds = downsample(brut, ctxIn!.sampleRate)
    // PREAMP (owner, 16 aug: „reglaj preamp de la minim la maxim" + „ce faci daca e
    // surd?"): amplifică microfonul ÎNAINTE de trimitere. Array NOU (nu mutăm bufferul
    // capturii, pe care downsample îl întoarce ca atare la 16 kHz), cu clamp la ±1
    // (peste plafon = clip, se vede roșu în bargraf). Boost manual peste autoGainControl.
    if (preampGain !== 1) {
      const g = preampGain
      const amp = new Float32Array(ds.length)
      for (let i = 0; i < ds.length; i++) { const v = ds[i] * g; amp[i] = v > 1 ? 1 : v < -1 ? -1 : v }
      ds = amp
    }
    // Tăcere cât Kelion e audibil — DOAR pe drumul FĂRĂ anulare de ecou
    // (Bluetooth/nesigur): acolo half-duplexul e singura plasă contra „verzei".
    // Cu procesarea VIE (desktop, difuzorul telefonului fără BT — 22 aug),
    // browserul scoate vocea lui Kelion din microfon la sursă → microfonul NU
    // mai tace deloc: auzi tot, oricând, inclusiv peste vocea lui (ordinul
    // „0 greșeli de auz", punctul 1). Array NOU, nu mutăm bufferul
    // microfonului — downsample îl întoarce ca ATARE la 16 kHz (ar corupe captura).
    const poarta = !procesareActiva && kelionAudibil()
    // eslint-disable-next-line no-console
    if (poarta !== eraPoarta) console.log(`[vocalLive] poarta half-duplex: ${poarta ? 'TĂCERE (Kelion audibil)' : 'MICROFON (ascultă)'} | surseActive=${surseActive.length} | redareExterna=${redareExterna} | ctxState=${ctxOut?.state ?? 'null'} | cursorRedare=${cursorRedare.toFixed(2)} | currentTime=${ctxOut?.currentTime.toFixed(2) ?? 'null'} | coada=${COADA_ECOU_S}`)
    const la16k = poarta ? new Float32Array(ds.length) : ds
    // BARGRAF DE INTRARE (owner, 16 aug): măsurăm nivelul REAL al microfonului pe
    // ACEST cadru — exact semnalul care (dacă poarta nu-l taie) pleacă la model —
    // și-l dăm UI-ului throttlat la ~60ms. `poarta` arată truncherea half-duplex;
    // `clip` arată vârful în plafon. Ownerul VEDE dacă vocea ajunge și dacă se taie.
    if (opts.onNivelIntrare) {
      let sum = 0
      let pic = 0
      for (let i = 0; i < ds.length; i++) { const a = Math.abs(ds[i]); sum += a * a; if (a > pic) pic = a }
      const rms = ds.length ? Math.sqrt(sum / ds.length) : 0
      const acum = performance.now()
      if (acum - ultimNivelLa > 60) {
        ultimNivelLa = acum
        opts.onNivelIntrare({ nivel: rms, pic, poarta, clip: pic >= 0.98 })
      }
    }
    // BARGE-IN PRE-ROLL (registrul frontend, lot C): cât Kelion e audibil,
    // cadrele trimise sunt ZERO (half-duplex) — dar exact vorbele care ÎL
    // întrerup se rostesc în fereastra asta și se PIERDEAU: modelul auzea fraza
    // de la jumătate. Reținem cadrele REALE în același inel mărginit (~250 ms);
    // la prima deschidere după întrerupere, inelul pleacă întâi — primul cuvânt
    // al barge-in-ului ajunge întreg. (AEC-ul browserului ține ecoul difuzorului
    // mic, iar inelul e scurt tocmai ca să nu care ecou vechi.)
    if (poarta) {
      preRoll.push(ds)
      preRollMs += durataMs(ds)
      while (preRollMs > PREROLL_MS && preRoll.length > 1) {
        preRollMs -= durataMs(preRoll.shift() as Float32Array)
      }
    } else if (eraPoarta && !vadPornit) {
      // Poarta tocmai s-a ridicat pe calea FĂRĂ VAD (kelion_vad='0'): golim
      // inelul aici (cu VAD, golirea se face la închis→deschis, mai jos) —
      // DAR doar dacă inelul chiar pare să conțină VOCE. Pe drumul FĂRĂ
      // procesare (mobil cu Bluetooth/nesigur — echoCancellation: procesare,
      // 22 aug) și fără gardul ăsta coada de ecou a
      // lui Kelion din difuzor ar pleca la model la FIECARE sfârșit de tură
      // (agentul lotului C). Vocea care întrerupe e tare (peste difuzor);
      // ecoul rezidual/tăcerea rămân sub prag și inelul se aruncă.
      // hardcod-permis: prag tehnic client (RMS) al inelului de barge-in, nu valoare afișată/tarifată
      const PRAG_RMS_PREROLL = 0.02
      const areVoce = preRoll.some((b) => rmsDin(b) >= PRAG_RMS_PREROLL)
      if (areVoce) for (const b of preRoll) trimiteCadru(b)
      preRoll.length = 0
      preRollMs = 0
    }
    eraPoarta = poarta
    // POARTA DE VOCE: doar în faza de ASCULTARE (Kelion nu vorbește). Măsurăm cadrul
    // REAL (ds) și lăsăm VAD-ul să decidă. Pe tăcere/zgomot NU trimitem nimic (0 octeți
    // → 0 cost). La nesiguranță poarta stă deschisă (nu tăiem vorba). Cât Kelion
    // vorbește (poarta==true), trimitem cadrele-zero ca înainte (half-duplex/AEC neatins).
    if (vadPornit && !poarta) {
      const rez = pasVad(stVad, { rms: rmsDin(ds), zcr: zcrDin(ds), tMs: performance.now() }, PARAM_VAD_IMPLICIT)
      stVad = rez.st
      if (rez.deschis && !eraDeschis) {
        // închis→deschis: golim pre-roll-ul întâi, ca primul cuvânt să fie
        // întreg — cu ACELAȘI gard RMS ca pe calea fără VAD (F10 al marii
        // verificări): pe mobil AEC-ul e oprit, iar fără gard coada de ecou
        // a lui Kelion reținută cât era audibil pleca la model la fiecare
        // deschidere VAD.
        // hardcod-permis: același prag tehnic client (RMS) ca la calea fără VAD
        const PRAG_RMS_PREROLL_VAD = 0.02
        if (preRoll.some((b) => rmsDin(b) >= PRAG_RMS_PREROLL_VAD)) {
          for (const b of preRoll) trimiteCadru(b)
        }
        preRoll.length = 0
        preRollMs = 0
      }
      eraDeschis = rez.deschis
      if (!rez.deschis) {
        // reținem pentru pre-roll (mărginit la ~250 ms), apoi ieșim FĂRĂ să trimitem.
        preRoll.push(la16k)
        preRollMs += durataMs(la16k)
        while (preRollMs > PREROLL_MS && preRoll.length > 1) {
          preRollMs -= durataMs(preRoll.shift() as Float32Array)
        }
        return
      }
    }
    trimiteCadru(la16k)
  }
  cules = await pornesteCulesPcm(ctxIn, sursa, laCadru)
  if (!cules) {
    console.warn('[vocalLive] AudioWorklet indisponibil — cad pe ScriptProcessor (deprecat, dar merge)')
    proc = ctxIn.createScriptProcessor(4096, 1, 1)
    // .slice() la SURSĂ (agentul lotului C): browserul REFOLOSEȘTE bufferul
    // canalului între evenimente, iar downsample îl întoarce CA ATARE la 16 kHz —
    // fără copie, cadrele reținute (pre-roll, inelul de barge-in) se suprascriau
    // până la trimitere (audio corupt). Un singur punct repară ambele căi.
    proc.onaudioprocess = (ev: AudioProcessingEvent): void => laCadru(ev.inputBuffer.getChannelData(0).slice())
    sursa.connect(proc)
    proc.connect(ctxIn.destination) // necesar ca onaudioprocess să ruleze în unele browsere
  }

  // DEBLOCAJ CONTINUU (lecția din 6 aug: „se deschide să preia dar nu se preia
  // nimic audio"). Un AudioContext pornit fără gest rămâne 'suspended' și
  // `onaudioprocess` NU rulează NICIODATĂ — microfonul e SURD deși becul e aprins.
  // Vorbitul nu e gest, deci trezirea pe gest nu acoperă cazul. Un context deja
  // 'running' ignoră `resume()`, deci zero risc.
  //
  // AUTO-RECUPERAREA AUDIO LA PORNIREA CAMEREI (11 aug, MĂSURAT de owner pe APK:
  // „i-am zis porneste camera, a pornit-o dar a murit audio" → confirmat că o a
  // doua atingere îl aduce înapoi). Cauza: când se deschide camera (sau vine o
  // întrerupere de sistem — apel, notificare, blocare ecran), OS-ul pune pe
  // PAUZĂ elementul <audio> al boxei, iar politica de autoplay de pe mobil
  // REFUZĂ `play()` fără un gest nou → audio-ul rămâne mort până la o atingere
  // manuală. „nimeni nu învață manualul" — deci se face automat: întâi
  // reîncercăm blând `boxe.play()`; dacă rămâne pe pauză două bătăi la rând
  // (~2,4 s), cădem SINGURI pe redarea directă WebAudio (ctxOut.destination),
  // care NU cere gest fiindcă `ctxOut` a fost deblocat de gestul de la pornirea
  // sesiunii. Vocea se ÎNTOARCE singură — mut e infinit mai rău. (NB: redarea
  // directă e doar plasa de siguranță pentru „mut de tot"; ruta preferată rămâne
  // boxa media, cea care ajunge pe Bluetooth/mașină.)
  let boxaPauzata = 0
  resumeTimer = setInterval(() => {
    if (inchis) return
    if (ctxIn && ctxIn.state !== 'running') void ctxIn.resume().catch(() => {})
    if (ctxOut && ctxOut.state !== 'running') void ctxOut.resume().catch(() => {})
    if (boxe && ctxOut && analizor && !iesireDirecta) {
      if (boxe.paused) {
        // Întâi calea blândă: repornirea elementului (merge dacă tocmai a fost un
        // gest recent — pe desktop, sau după ce userul a atins ecranul).
        void boxe.play().catch(() => {})
        boxaPauzata++
        if (boxaPauzata >= 2) {
          // Blocat de politica de autoplay (tipic: camera a întrerupt audio pe
          // mobil). Cădem pe redarea directă, fără gest, ca vocea să revină acum.
          console.warn('[vocalLive] boxa media rămâne pe pauză (probabil camera/o întrerupere a oprit audio) — trec automat pe redare directă WebAudio, fără atingere')
          iesireDirecta = true
          try {
            boxe.pause()
            boxe.srcObject = null
          } catch {
            /* deja oprită */
          }
          boxe = null
          analizor.connect(ctxOut.destination)
        }
      } else {
        boxaPauzata = 0
      }
    }
  }, 1200)

  marcheazaFaza('voce:activa')
  console.info(`[vocalLive] sesiune deschisă — microfon ${RATA_INTRARE} Hz → server, redare ${RATA_IESIRE} Hz`)
  return {
    inchide,
    fluxMicrofon: () => stream,
    taieRedarea,
    intrerupeRedarea: () => {
      taieRedarea()
      if (inchis || ws.readyState !== WebSocket.OPEN) return
      try {
        ws.send(JSON.stringify({ type: 'intrerupe' }))
      } catch {
        /* socket picat — close-ul curăță */
      }
    },
    octetiTrimisi: () => octeti,
    setMuted: (m: boolean) => {
      // Track-ul rămâne viu (sesiunea nu se rupe) — doar nu mai produce cadre.
      stream?.getAudioTracks().forEach((t) => (t.enabled = !m))
    },
    setPreamp: (g: number) => {
      preampGain = clampPreamp(g)
    },
    setRedareExterna: (activ: boolean) => {
      redareExterna = activ
    },
  }
}
