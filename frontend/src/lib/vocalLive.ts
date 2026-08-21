import { downsample, float32ToPcm16, base64ToBytes, pcm16ToFloat32 } from './pcm'
import { OpusVoceClient, esteSuportat as opusSuportat } from './opusVoce'
import { alimenteazaNivelVoce } from './audioIO'
import { pornesteCulesPcm, type CulesPcm } from './pcmWorklet'
import { pasVad, stareVadInitiala, rmsDin, zcrDin, PARAM_VAD_IMPLICIT, type StareVad } from './vad'
import { inscrieVoceaLuiKelion } from './vociKelion'
import { deblocheazaAudioLaGest } from './audioGraph'
import { ensureAudioContextRunning, setupAudioContextAutoResume, startVoiceHeartbeat } from './voiceHeartbeat'

// ── VOCEA LIVE FULL-DUPLEX — PARTEA DIN BROWSER (7 aug 2026) ─────────────────
//
// Ce lipsea: motorul (`backend/src/services/vocalLive.ts`), ruta WS
// (`/api/vocal-live`) și uneltele de admin erau scrise și înregistrate din 4 aug,
// dar `grep -rn "vocal-live" frontend/src` întorcea ZERO — browserul nu deschidea
// niciodată socketul. Șoseaua exista, nu circula nimeni pe ea. Ăsta e capătul
// care lipsea.
//
// DE CE MERITĂ (măsurat de owner pe VPS-ul lui, sesiune bidi reală):
//   gemini-3.1-flash-live-preview   90 ms handshake · 491 ms primul răspuns · unelte DA · 66 KB audio
// Adică modelul AUDE, GÂNDEȘTE, VORBEȘTE și CHEAMĂ UNELTE într-o singură sesiune,
// cu primul cuvânt sub jumătate de secundă. Lanțul vechi face trei drumuri
// separate (ureche → creier → gură).
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

export interface VocalLiveOpts {
  /** Sesiunea e deschisă și modelul e gata să asculte. */
  onGata?(): void
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
  onEroare(motiv: string): void
  /** Coordonatele device-ului, la cerere (8 aug: „nu are acces la gps, meteo"
   *  + „îi trebuiesc date de la gps real"). `acc` = precizia MĂSURATĂ a fixului
   *  (±metri, raportată de senzor) — pleacă și ea, ca serverul să spună
   *  modelului cât de bun e locul. null = nu avem (lipsa se declară). */
  coordonate?(): { lat: number; lon: number; acc?: number } | null
  /** Cadrele camerei, LA CEREREA serverului (8 aug: „hai și cu vedere") —
   *  când ușa cere_creierului se deschide, tura escaladată pleacă cu ochii.
   *  Gol/absent = fără cameră; tura pleacă fără imagini, nu se blochează. */
  cadre?(): string[]
  /** VEDEREA CONTINUĂ (8 aug: „trebuie să poată folosi camera"): un cadru
   *  PROASPĂT (data-URL JPEG) sau null când camera e oprită. Cât sesiunea e
   *  vie, un cadru pleacă la fiecare ~2,5 s direct în sesiunea Live — modelul
   *  vede în timp ce vorbește. null = nu se trimite nimic (nu cadre stătute). */
  cadruLive?(): string | null
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

export interface VocalLiveHandle {
  inchide(): void
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
  /** JARVIS pasul 1 + §10 (tastatura opțională): trimite un rând SCRIS în sesiunea
   *  Live — modelul îi răspunde cu VOCEA lui (un singur motor; fără Chirp, fără
   *  coliziune). Întoarce true dacă rândul chiar a plecat (socket deschis). */
  trimiteText(text: string): boolean
}

/** Serverul are cheia și modelul Live? Se întreabă ÎNAINTE de a deschide socketul,
 *  ca să nu pornim o cale vocală spre gol. */
export async function vocalLiveDisponibila(): Promise<{ disponibil: boolean; model: string; voce: string } | null> {
  try {
    const r = await fetch('/api/vocal-live/capability', { cache: 'no-store' })
    if (!r.ok) return null
    return (await r.json()) as { disponibil: boolean; model: string; voce: string }
  } catch {
    return null
  }
}

function urlWs(): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${location.host}/api/vocal-live`
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
// deci urmează ruta de muzică la căști / mașină. Compromis, spus pe
// față: AEC-ul prin WebRTC dispare (rămâne anularea de ecou din microfon,
// `echoCancellation:true`); pe boxe Bluetooth/mașină AEC-ul oricum nu era
// necesar (boxele sunt departe de microfon). Dacă pe difuzorul telefonului
// revine ecoul, pasul următor e ruta-conștientă (AEC pe difuzor, media pe
// Bluetooth) — dar întâi trebuie ca vocea să AJUNGĂ în mașină.

// O SINGURĂ sesiune live per tab, garantată AICI, nu în apelant (auditul de
// noapte, 9 aug): gărzile apelantului sunt check-then-act peste await-uri de
// secunde — cronometrul de reluare și apăsarea pe microfon puteau deschide
// DOUĂ sesiuni, prima rămânând scursă cu microfonul și WS-ul vii (și factura
// curgând). Modelul e exact cel al căii vechi (realtimeVoice.ts: activeVoice).
let sesiuneActiva: { inchide: () => void } | null = null

export async function deschideVocalLive(opts: VocalLiveOpts): Promise<VocalLiveHandle | null> {
  if (!navigator.mediaDevices?.getUserMedia) {
    opts.onEroare('browserul nu dă acces la microfon')
    return null
  }
  // Orice a doua deschidere o omoară determinist pe prima, indiferent din ce
  // cursă a apelantului vine.
  sesiuneActiva?.inchide()
  sesiuneActiva = null

  let ws: WebSocket
  try {
    ws = new WebSocket(urlWs())
  } catch (e) {
    opts.onEroare(`nu pot deschide sesiunea vocală: ${String(e).slice(0, 60)}`)
    return null
  }
  ws.binaryType = 'arraybuffer'

  let stream: MediaStream | null = null
  let ctxIn: AudioContext | null = null
  let ctxOut: AudioContext | null = null
  let proc: ScriptProcessorNode | null = null
  let cules: CulesPcm | null = null
  let resumeTimer: ReturnType<typeof setInterval> | null = null
  let inchis = false
  // O SINGURĂ eroare urcă per deschidere: la un server picat, `onerror` și
  // `onclose` trag amândouă — fără frâna asta, ChatPanel ar porni DOUĂ lanțuri
  // de reluare în paralel (adică două sesiuni) la fiecare ratare de conectare.
  let eroareUrcata = false
  const urcaEroarea = (m: string): void => {
    if (eroareUrcata) return
    eroareUrcata = true
    // Simptomul ajunge ȘI la Kelion, nu doar ca toast la om: console.error e
    // canalul prins de errorReport → /api/client-errors → contextul creierului.
    // Fără asta, Kelion NU știa că sesiunea vocală a picat și răspundea „încearcă
    // din nou" la „ce e eroarea asta?". (Adrian, 12 aug — autodiagnostic.)
    try {
      console.error(`[voce] ${m}`)
    } catch {
      /* raportarea nu poate arunca */
    }
    opts.onEroare(m)
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
  let ceasPingWs: ReturnType<typeof setInterval> | null = null

  const inchide = (): void => {
    if (inchis) return
    inchis = true
    if (ceasPingWs) clearInterval(ceasPingWs)
    if (sesiuneActiva?.inchide === inchide) sesiuneActiva = null // zăvorul se predă curat
    if (rafGura) cancelAnimationFrame(rafGura)
    alimenteazaNivelVoce(0)
    curataHeartbeat?.()
    curataAutoResumeOut?.()
    curataAutoResumeIn?.()
    if (resumeTimer) clearInterval(resumeTimer)
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
    void ctxIn?.close().catch(() => {})
    void ctxOut?.close().catch(() => {})
    try {
      ws.close()
    } catch {
      /* deja închis */
    }
  }
  // Zăvorul se ia IMEDIAT ce sesiunea are un `inchide` întreg — inclusiv în
  // fereastra de setup (getUserMedia/AEC durează secunde): a doua deschidere
  // sosită între timp o omoară pe asta, nu-i lasă microfonul scurs.
  sesiuneActiva = { inchide }

  /** Barge-in: userul a vorbit peste Kelion → oprim redarea INSTANT și golim coada.
   *  Fără asta, Kelion ar continua să vorbească peste om încă câteva secunde. */
  const taieRedarea = (): void => {
    for (const s of surseActive) {
      try {
        s.stop()
      } catch {
        /* deja oprită */
      }
    }
    surseActive = []
    cursorRedare = 0
    alimenteazaNivelVoce(0)
    opts.onVorbeste?.(false)
  }

  // ── GURA AVATARULUI (8 aug: „atașez avatarul — merge?") ────────────────────
  // Avatarul își ia deschiderea gurii din getVoiceLevel(), hrănit până acum doar
  // de redarea <audio> a căii vechi. Aici redarea e WebAudio, deci nivelul se
  // calculează dintr-un analizor pus pe drumul sunetului și se împinge în
  // același loc — gura mișcă la fel, indiferent de cale.
  let analizor: AnalyserNode | null = null
  let bufAnalizor: Uint8Array<ArrayBuffer> | null = null
  let rafGura = 0
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
    } else if (cursorRedare > acum + 2.0) {
      // Buffer drift / latency buildup protection during burst inference
      cursorRedare = acum + 0.05
    }
    src.start(cursorRedare)
    cursorRedare += buf.duration
    surseActive.push(src)
    pornesteGura()
    opts.onVorbeste?.(true)
    src.onended = () => {
      surseActive = surseActive.filter((s) => s !== src)
      if (!surseActive.length) opts.onVorbeste?.(false)
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
    let m: { type?: string; data?: string; text?: string; final?: boolean; motiv?: string; frame?: unknown; opus?: boolean; codec?: string }
    try {
      m = JSON.parse(ev.data) as typeof m
    } catch {
      return
    }
    switch (m.type) {
      case 'gata':
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
              if (inchis || ws.readyState !== WebSocket.OPEN) return
              const cadru = new Uint8Array(octeti.length + 1)
              cadru[0] = 1
              cadru.set(octeti, 1)
              try { ws.send(cadru.buffer) } catch { /* close-ul curăță */ }
            },
            (pcm) => redaFloat32(pcm), // Opus de jos decodat → difuzor
          ).then((c) => {
            if (!c || inchis) { c?.inchide(); return }
            opusClient = c
            opusTx = true
            try { ws.send(JSON.stringify({ type: 'opus_ready' })) } catch { /* close-ul curăță */ }
          })
        }
        // CAMERA DOAR LA CERINȚĂ (9 aug, ownerul: „camera doar la cerință" —
        // pentru economie). Am SCOS ceasul care trimitea un cadru la ~2,5s cât
        // sesiunea era vie: ardea credit CONTINUU chiar și când nimeni nu cerea
        // să vadă (cadrele video se taxează, măsurat). Vederea rămâne întreagă,
        // dar DOAR când modelul o cere: ușa cere_creierului declanșează
        // `cere_cadre` → atunci trimitem cadrele proaspete (vezi handlerul
        // 'cere_cadre' mai jos). Fără cerere = zero cadre = zero cost.
        opts.onGata?.()
        break
      case 'control':
        if (m.frame) opts.onControl?.(m.frame)
        break
      case 'cere_cadre': {
        // Serverul deschide ușa creierului și vrea ochii: trimitem cadrele
        // camerei ACUM (gol = fără cameră — serverul nu așteaptă degeaba).
        try {
          ws.send(JSON.stringify({ type: 'cadre', cadre: opts.cadre?.() ?? [] }))
        } catch {
          /* socket picat — close-ul curăță */
        }
        break
      }
      case 'audio':
        if (!m.data) break
        // OPUS: cadrele de jos vin tag-uite `codec:'opus'` cât e activ; le dăm
        // decoderului (ieșirea lui cade pe redaFloat32). Fără tag = PCM base64,
        // ca azi. Dacă decoderul lipsește dintr-un motiv, cadrul Opus se pierde
        // (nu-l putem reda ca PCM) — dar asta doar cât Opus e pornit explicit.
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
        urcaEroarea(m.motiv ?? 'eroare necunoscută în sesiunea vocală')
        break
      default:
        break
    }
  }

  // onerror NU se raportează separat: specificația WebSocket spune că onerror e
  // întotdeauna urmat de onclose (cu codul și motivul real). Raportarea de aici
  // fura guardul eroareUrcata și ascundea cauza reală din onclose — utilizatorul
  // vedea doar „(rețea)" în loc de codul/serverul/Google care a picat cu adevărat.
  ws.onerror = (err): void => {
    console.warn('[vocalLive] websocket error encountered:', err)
  }
  ws.onclose = (ev: CloseEvent): void => {
    if (inchis) return
    // Specific WebSocket code handling: 1006 is abnormal closure (network drop / timeout)
    if (ev.code === 1008) {
      urcaEroarea('sesiune vocală: nu ești autentificat')
    } else if (ev.code === 1011) {
      urcaEroarea('sesiune vocală indisponibilă pe server (lipsește cheia?)')
    } else if (ev.code === 1006) {
      urcaEroarea('sesiune vocală întreruptă de rețea (cod 1006 abnormal closure) — reîncercare conexiune')
    } else if (ev.code !== 1000) {
      urcaEroarea(`sesiunea vocală s-a închis singură (cod ${ev.code}${ev.reason ? `: ${ev.reason.slice(0, 80)}` : ''})`)
    } else {
      // BUG REPARAT (registrul frontend #2, blocant): închiderea „politicoasă" (1000)
      // venită de la SERVER (noi n-am cerut-o — `inchis` e false aici) lăsa omul SURD
      // și MUT tăcut: vlRef rămânea setat, becul aprins, ensureMic ieșea pe gardă, iar
      // nimeni nu era anunțat — până la refresh. O ridicăm ca pe orice cădere, ca
      // apelantul (ChatPanel) să curețe și să re-armeze lanțul vocal.
      urcaEroarea('sesiunea vocală a fost închisă de server (cod 1000) — reiau conexiunea')
    }
    inchide()
  }

  // PING/KEEPALIVE WS: la fiecare 15s trimitem ping ca proxy-ul/Caddy să nu
  // închidă socket-ul pe liniște cu cod 1006 (abnormal closure).
  ceasPingWs = setInterval(() => {
    if (inchis) return
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: 'ping', t: Date.now() }))
      } catch {
        /* tratat la onclose */
      }
    }
  }, 15_000)

  // Microfonul pornește DUPĂ ce socketul e deschis: altfel primele cadre s-ar
  // pierde în gol și primele cuvinte ale omului ar dispărea.
  await new Promise<void>((gata, esec) => {
    ws.onopen = () => {
      // Ancora realității pleacă PRIMA, chiar la deschidere — serverul o
      // așteaptă puțin înainte să construiască instrucțiunea sesiunii.
      trimiteCoords()
      curataHeartbeat = startVoiceHeartbeat(() => ws, 10_000)
      gata()
    }
    setTimeout(() => esec(new Error('timeout la deschiderea sesiunii')), 10_000)
  }).catch((e: Error) => {
    urcaEroarea(e.message)
    inchide()
  })
  if (inchis || ws.readyState !== WebSocket.OPEN) return null

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
    const eMobil = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: !eMobil, noiseSuppression: false, autoGainControl: !eMobil },
    })
  } catch {
    urcaEroarea('microfonul nu a fost permis')
    inchide()
    return null
  }

  ctxIn = new AudioContext()
  ctxOut = new AudioContext()
  // MOBIL — CONTEXTUL PORNIT 'suspended' (owner, 13 aug: „primul cuvânt nu-l aude
  // corect"). Contextele astea se creează DUPĂ două await-uri (deschiderea
  // socketului + getUserMedia), deci nasc SUSPENDATE pe iOS/Android — gestul care
  // a pornit sesiunea s-a „consumat" până aici. Cât rămân suspendate,
  // `onaudioprocess` NU rulează → microfonul e surd și primele cuvinte se pierd.
  // `resumeTimer` de mai jos face `resume()` pe interval, DAR — cum spune chiar
  // audioGraph.ts — `resume()` fără gest „nu ajută" pe mobil. Armăm deci
  // deblocajul pe PRIMUL tap, exact cum face deja cealaltă cale (openMicGraph):
  // additiv (pe desktop contextul e deja 'running' → practic no-op, iar ascultătorii
  // se auto-retrag la prima trezire). Verificat: nu pot proba efectul de mobil din
  // headless — se confirmă LIVE pe telefonul ownerului.
  if (ctxIn.state !== 'running') deblocheazaAudioLaGest(ctxIn)
  if (ctxOut.state !== 'running') deblocheazaAudioLaGest(ctxOut)
  curataAutoResumeIn = setupAudioContextAutoResume(ctxIn, () => !inchis)
  curataAutoResumeOut = setupAudioContextAutoResume(ctxOut, () => !inchis)
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
  const destInregistrare = ctxOut.createMediaStreamDestination()
  analizor.connect(destInregistrare)
  radiazaVocea = inscrieVoceaLuiKelion(destInregistrare.stream)
  // BOXA MEDIA: analizor → MediaStreamDestination → <audio> obișnuit. Fiind un
  // flux WebAudio (NU WebRTC), Android îl clasează drept MEDIA (A2DP) → vocea
  // urmează ruta de muzică pe Bluetooth/mașină (vezi antetul de sus).
  const destBoxe = ctxOut.createMediaStreamDestination()
  analizor.connect(destBoxe)
  boxe = new Audio()
  boxe.srcObject = destBoxe.stream
  boxe.autoplay = true
  boxe.setAttribute('playsinline', '') // iOS: nu deschide playerul pe tot ecranul
  void boxe.play().catch(() => {
    /* politica de autoplay — reîncercat de ceasul de deblocaj (mai jos) */
  })
  // Serverul află că nu mai e AEC prin WebRTC: fără el, „vocea de peste el" ar
  // putea fi chiar ecoul, deci NU-i dăm voie serverului să-i taie vorba pe voce
  // (barge-in server OFF). Pe căști/mașină oricum nu e ecou; pe difuzor rămâne
  // anularea din microfon (echoCancellation:true).
  const spuneAec = (): void => {
    try {
      ws.send(JSON.stringify({ type: 'aec', activ: false }))
    } catch {
      /* sesiunea se închide oricum */
    }
  }
  if (ws.readyState === WebSocket.OPEN) spuneAec()
  else ws.addEventListener('open', spuneAec, { once: true })
  const sursa = ctxIn.createMediaStreamSource(stream)
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
  // PRE-ROLL după DURATĂ (~250 ms), robust la mărimea cadrului: la deschidere trimitem
  // întâi audio-ul reținut, ca primul cuvânt să nu fie tăiat de onset + debounce.
  const PREROLL_MS = 250
  const preRoll: Float32Array[] = []
  let preRollMs = 0
  const durataMs = (b: Float32Array): number => (b.length / 16000) * 1000
  // O SINGURĂ cale de trimitere (Opus dacă e activ, altfel PCM) — folosită și de
  // cadrul curent, și de pre-roll, ca să nu se dubleze logica.
  const trimiteCadru = (buf: Float32Array): void => {
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
    // Tăcere cât Kelion e audibil. Array NOU, nu mutăm bufferul microfonului —
    // downsample îl întoarce ca ATARE când rata e deja 16 kHz (ar corupe captura).
    const poarta = kelionAudibil()
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
    // POARTA DE VOCE: doar în faza de ASCULTARE (Kelion nu vorbește). Măsurăm cadrul
    // REAL (ds) și lăsăm VAD-ul să decidă. Pe tăcere/zgomot NU trimitem nimic (0 octeți
    // → 0 cost). La nesiguranță poarta stă deschisă (nu tăiem vorba). Cât Kelion
    // vorbește (poarta==true), trimitem cadrele-zero ca înainte (half-duplex/AEC neatins).
    if (vadPornit && !poarta) {
      const rez = pasVad(stVad, { rms: rmsDin(ds), zcr: zcrDin(ds), tMs: performance.now() }, PARAM_VAD_IMPLICIT)
      stVad = rez.st
      if (rez.deschis && !eraDeschis) {
        // închis→deschis: golim pre-roll-ul întâi, ca primul cuvânt să fie întreg.
        for (const b of preRoll) trimiteCadru(b)
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
    proc.onaudioprocess = (ev: AudioProcessingEvent): void => laCadru(ev.inputBuffer.getChannelData(0))
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

  console.info(`[vocalLive] sesiune deschisă — microfon ${RATA_INTRARE} Hz → server, redare ${RATA_IESIRE} Hz`)
  return {
    inchide,
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
    trimiteText: (text: string): boolean => {
      const t = (text || '').trim()
      if (!t || inchis || ws.readyState !== WebSocket.OPEN) return false
      try {
        ws.send(JSON.stringify({ type: 'text', text: t.slice(0, 4000) }))
        return true
      } catch {
        return false
      }
    },
  }
}
