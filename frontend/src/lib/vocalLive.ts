import { downsample, float32ToPcm16, base64ToBytes, pcm16ToFloat32 } from './pcm'
import { alimenteazaNivelVoce } from './audioIO'

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
  /** Kelion a început/terminat de vorbit — pentru animația avatarului. */
  onVorbeste?(activ: boolean): void
  /** Orice eroare, NUMITĂ. Niciun „merge" prefăcut. */
  onEroare(motiv: string): void
}

export interface VocalLiveHandle {
  inchide(): void
  /** Mut/dezmut microfonul fără a rupe sesiunea (butonul de microfon al UI-ului). */
  setMuted(muted: boolean): void
  /** Câți octeți de microfon au plecat — dovadă că se trimite ceva, nu doar că
   *  socketul e deschis (exact distincția care a lipsit la prima probă live). */
  octetiTrimisi(): number
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

export async function deschideVocalLive(opts: VocalLiveOpts): Promise<VocalLiveHandle | null> {
  if (!navigator.mediaDevices?.getUserMedia) {
    opts.onEroare('browserul nu dă acces la microfon')
    return null
  }

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
  let resumeTimer: ReturnType<typeof setInterval> | null = null
  let inchis = false
  let octeti = 0
  // Coada de redare: fiecare cadru primit se programează DUPĂ ce se termină
  // precedentul. Fără asta, cadrele s-ar suprapune și vocea ar suna ca un cor.
  let cursorRedare = 0
  let surseActive: AudioBufferSourceNode[] = []

  const inchide = (): void => {
    if (inchis) return
    inchis = true
    if (rafGura) cancelAnimationFrame(rafGura)
    alimenteazaNivelVoce(0)
    if (resumeTimer) clearInterval(resumeTimer)
    try {
      proc?.disconnect()
    } catch {
      /* deja deconectat */
    }
    stream?.getTracks().forEach((t) => t.stop())
    void ctxIn?.close().catch(() => {})
    void ctxOut?.close().catch(() => {})
    try {
      ws.close()
    } catch {
      /* deja închis */
    }
  }

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

  const redaCadru = (b64: string): void => {
    if (!ctxOut || inchis) return
    const f32 = pcm16ToFloat32(base64ToBytes(b64))
    if (!f32.length) return
    if (!analizor) {
      analizor = ctxOut.createAnalyser()
      analizor.fftSize = 256
      analizor.connect(ctxOut.destination)
      bufAnalizor = new Uint8Array(analizor.fftSize)
    }
    const buf = ctxOut.createBuffer(1, f32.length, RATA_IESIRE)
    buf.copyToChannel(f32, 0)
    const src = ctxOut.createBufferSource()
    src.buffer = buf
    src.connect(analizor)
    const acum = ctxOut.currentTime
    if (cursorRedare < acum) cursorRedare = acum
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

  ws.onmessage = (ev: MessageEvent): void => {
    if (typeof ev.data !== 'string') return
    let m: { type?: string; data?: string; text?: string; final?: boolean; motiv?: string }
    try {
      m = JSON.parse(ev.data) as typeof m
    } catch {
      return
    }
    switch (m.type) {
      case 'gata':
        opts.onGata?.()
        break
      case 'audio':
        if (m.data) redaCadru(m.data)
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
        break
      case 'tura_gata':
        break
      case 'eroare':
        opts.onEroare(m.motiv ?? 'eroare necunoscută în sesiunea vocală')
        break
      default:
        break
    }
  }

  ws.onerror = (): void => opts.onEroare('sesiunea vocală a căzut (rețea)')
  ws.onclose = (ev: CloseEvent): void => {
    if (inchis) return
    // Motivele numite ale serverului urcă la om, nu mor în consolă.
    if (ev.code === 1008) opts.onEroare('sesiune vocală: nu ești autentificat')
    else if (ev.code === 1011) opts.onEroare('sesiune vocală indisponibilă pe server (lipsește cheia?)')
    // ORICE altă închidere neinițiată de noi era MOARTE TĂCUTĂ (8 aug: „salută
    // și moare"): cod 1000/1006 → niciun mesaj, nicio reluare, iar vlRef rămas
    // setat bloca ȘI audio-ul căii vechi — bec aprins, totul mort. Acum urcă la
    // ChatPanel: 3 reluări, apoi coboară singur pe calea veche — orice cauză ar
    // avea serverul/Google, vocea se întoarce în secunde, cu motivul pe bandă.
    else opts.onEroare(`sesiunea vocală s-a închis singură (cod ${ev.code}${ev.reason ? `: ${ev.reason.slice(0, 80)}` : ''})`)
    inchide()
  }

  // Microfonul pornește DUPĂ ce socketul e deschis: altfel primele cadre s-ar
  // pierde în gol și primele cuvinte ale omului ar dispărea.
  await new Promise<void>((gata, esec) => {
    ws.onopen = () => gata()
    setTimeout(() => esec(new Error('timeout la deschiderea sesiunii')), 10_000)
  }).catch((e: Error) => {
    opts.onEroare(e.message)
    inchide()
  })
  if (inchis || ws.readyState !== WebSocket.OPEN) return null

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    })
  } catch {
    opts.onEroare('microfonul nu a fost permis')
    inchide()
    return null
  }

  ctxIn = new AudioContext()
  ctxOut = new AudioContext()
  const sursa = ctxIn.createMediaStreamSource(stream)
  // ScriptProcessor: deprecat, dar universal și fără fișier separat — aceeași
  // alegere ca în micStream.ts, pe aceeași motivație („merge pur și simplu" pe
  // calea critică a vocii).
  proc = ctxIn.createScriptProcessor(4096, 1, 1)
  proc.onaudioprocess = (ev: AudioProcessingEvent): void => {
    if (inchis || ws.readyState !== WebSocket.OPEN) return
    const brut = ev.inputBuffer.getChannelData(0)
    // ── GARDA DE ECOU (8 aug: „audio lui se oprește la jumătatea frazei") ────
    // Redarea live e prin WebAudio, pe care anularea de ecou a browserului n-o
    // acoperă sigur — microfonul aude vocea lui Kelion din difuzor, modelul o
    // ia drept „omul vorbește peste" și își taie singur vorba. Cât timp Kelion
    // vorbește, cadrele SLABE (ecoul rezidual) nu se trimit; vocea adevărată,
    // apropiată, trece — barge-in-ul real rămâne.
    if (surseActive.length > 0) {
      let s2 = 0
      for (let i = 0; i < brut.length; i++) s2 += brut[i] * brut[i]
      if (Math.sqrt(s2 / brut.length) < 0.028) return
    }
    const la16k = downsample(brut, ctxIn!.sampleRate)
    const pcm = float32ToPcm16([la16k])
    // `.buffer` e exact bufferul acestui Int16Array proaspăt creat — nu o felie
    // dintr-un buffer partajat — deci trimiterea lui întreg e corectă.
    ws.send(pcm.buffer)
    octeti += pcm.byteLength
  }
  sursa.connect(proc)
  proc.connect(ctxIn.destination) // necesar ca onaudioprocess să ruleze în unele browsere

  // DEBLOCAJ CONTINUU (lecția din 6 aug: „se deschide să preia dar nu se preia
  // nimic audio"). Un AudioContext pornit fără gest rămâne 'suspended' și
  // `onaudioprocess` NU rulează NICIODATĂ — microfonul e SURD deși becul e aprins.
  // Vorbitul nu e gest, deci trezirea pe gest nu acoperă cazul. Un context deja
  // 'running' ignoră `resume()`, deci zero risc.
  resumeTimer = setInterval(() => {
    if (inchis) return
    if (ctxIn && ctxIn.state !== 'running') void ctxIn.resume().catch(() => {})
    if (ctxOut && ctxOut.state !== 'running') void ctxOut.resume().catch(() => {})
  }, 1200)

  console.info(`[vocalLive] sesiune deschisă — microfon ${RATA_INTRARE} Hz → server, redare ${RATA_IESIRE} Hz`)
  return {
    inchide,
    octetiTrimisi: () => octeti,
    setMuted: (m: boolean) => {
      // Track-ul rămâne viu (sesiunea nu se rupe) — doar nu mai produce cadre.
      stream?.getAudioTracks().forEach((t) => (t.enabled = !m))
    },
  }
}
