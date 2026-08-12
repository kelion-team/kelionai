import { downsample, float32ToPcm16, base64ToBytes, pcm16ToFloat32 } from './pcm'
import { alimenteazaNivelVoce } from './audioIO'
import { pornesteCulesPcm, type CulesPcm } from './pcmWorklet'
import { inscrieVoceaLuiKelion } from './vociKelion'

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
  // (ceasCadre scos 9 aug — camera doar la cerință; vezi handlerul 'gata'.)
  // Radierea vocii din registrul de înregistrare (vezi mai jos, la analizor).
  let radiazaVocea: (() => void) | null = null

  const inchide = (): void => {
    if (inchis) return
    inchis = true
    if (sesiuneActiva?.inchide === inchide) sesiuneActiva = null // zăvorul se predă curat
    if (rafGura) cancelAnimationFrame(rafGura)
    alimenteazaNivelVoce(0)
    if (resumeTimer) clearInterval(resumeTimer)
    if (ceasCoords) clearInterval(ceasCoords)
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

  const redaCadru = (b64: string): void => {
    if (!ctxOut || inchis || !analizor) return
    const f32 = pcm16ToFloat32(base64ToBytes(b64))
    if (!f32.length) return
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
        }),
      )
    } catch {
      /* socket picat — close-ul curăță */
    }
  }

  ws.onmessage = (ev: MessageEvent): void => {
    if (typeof ev.data !== 'string') return
    let m: { type?: string; data?: string; text?: string; final?: boolean; motiv?: string; frame?: unknown }
    try {
      m = JSON.parse(ev.data) as typeof m
    } catch {
      return
    }
    switch (m.type) {
      case 'gata':
        trimiteCoords()
        if (!ceasCoords) ceasCoords = setInterval(trimiteCoords, 120_000)
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
        urcaEroarea(m.motiv ?? 'eroare necunoscută în sesiunea vocală')
        break
      default:
        break
    }
  }

  ws.onerror = (): void => urcaEroarea('sesiunea vocală a căzut (rețea)')
  ws.onclose = (ev: CloseEvent): void => {
    if (inchis) return
    // Motivele numite ale serverului urcă la om, nu mor în consolă.
    if (ev.code === 1008) urcaEroarea('sesiune vocală: nu ești autentificat')
    else if (ev.code === 1011) urcaEroarea('sesiune vocală indisponibilă pe server (lipsește cheia?)')
    // ORICE altă închidere neinițiată de noi era MOARTE TĂCUTĂ (8 aug: „salută
    // și moare"): cod 1000/1006 → niciun mesaj, nicio reluare, iar vlRef rămas
    // setat bloca ȘI audio-ul căii vechi — bec aprins, totul mort. Acum urcă la
    // ChatPanel: 3 reluări, apoi coboară singur pe calea veche — orice cauză ar
    // avea serverul/Google, vocea se întoarce în secunde, cu motivul pe bandă.
    else urcaEroarea(`sesiunea vocală s-a închis singură (cod ${ev.code}${ev.reason ? `: ${ev.reason.slice(0, 80)}` : ''})`)
    inchide()
  }

  // Microfonul pornește DUPĂ ce socketul e deschis: altfel primele cadre s-ar
  // pierde în gol și primele cuvinte ale omului ar dispărea.
  await new Promise<void>((gata, esec) => {
    ws.onopen = () => {
      // Ancora realității pleacă PRIMA, chiar la deschidere — serverul o
      // așteaptă puțin înainte să construiască instrucțiunea sesiunii.
      trimiteCoords()
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
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    })
  } catch {
    urcaEroarea('microfonul nu a fost permis')
    inchide()
    return null
  }

  ctxIn = new AudioContext()
  ctxOut = new AudioContext()
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
  const laCadru = (brut: Float32Array): void => {
    if (inchis || ws.readyState !== WebSocket.OPEN) return
    // FĂRĂ garda de prag (ștearsă 8 aug): ecoul rămâne pe seama anulării din
    // microfon (`echoCancellation:true` la getUserMedia) — adaptiv, nu ghicit.
    const la16k = downsample(brut, ctxIn!.sampleRate)
    const pcm = float32ToPcm16([la16k])
    ws.send(pcm.buffer)
    octeti += pcm.byteLength
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
    octetiTrimisi: () => octeti,
    setMuted: (m: boolean) => {
      // Track-ul rămâne viu (sesiunea nu se rupe) — doar nu mai produce cadre.
      stream?.getAudioTracks().forEach((t) => (t.enabled = !m))
    },
  }
}
