// ── VOCE LIVE — client OpenAI Realtime (WebRTC) ──────────────────────────────
// Jumătatea de FRONTEND a vocii, reconstruită fidel din aplicația live (adusă
// în git ca sursă unică). Fluxul, verificat din bundle-ul live:
//   1. RTCPeerConnection + microfon (addTrack)
//   2. dataChannel „oai-events" → primim transcript (user + Kelion) și erori
//   3. createOffer → POST /api/realtime/session {sdp, language} → answer SDP
//   4. ontrack → redăm vocea lui Kelion și animăm avatarul (nivel audio)
// Cheia OpenAI NU e niciodată aici — o ține backendul. Modelul + vocea + limba
// se injectează server-side; clientul trimite doar limba curentă ca hint.

import { driveVoiceLevelFromElement, registerVoiceAudioElement, buildVoiceFeatures, estimateEnergy, estimateF0, estimateZcr, estimateCentroid, estimateRolloff, type VoiceFeatures } from './audioIO'

export type RealtimeVoiceState = 'connecting' | 'live' | 'error' | 'closed'

export interface RealtimeVoiceHandle {
  stop: () => void
  setMuted: (muted: boolean) => void
  /** Întrerupe imediat vorbirea lui Kelion (barge-in manual). */
  interrupt: () => void
  /**
   * GPS LA CERERE (Adrian, 26 iul: „doar când se folosesc aplicații GPS sau e
   * necesară detecția locației" — fluxul permanent a fost respins explicit).
   * Poziția intră în context o dată, la pornire; când o unealtă de locație
   * (vreme/hărți/trasee) citește poziția REALĂ a momentului, clientul o dă și
   * sesiunii prin metoda asta — un item de sistem cu noii lat/lon, ca „aici"
   * să însemne locul de acum, nu cel de la pornire. Nu se apelează periodic.
   */
  updateCoords: (c: { lat: number; lon: number }) => void
}

export interface RealtimeVoiceOpts {
  /** Limba curentă (hint). Sursa de adevăr rămâne preferința persistată pe server. */
  language?: string
  onState?: (s: RealtimeVoiceState, note?: string) => void
  /** Transcriptul userului: (text, final). */
  onUserTranscript?: (text: string, final: boolean) => void
  /** Transcriptul lui Kelion: (text, final). */
  onAssistantTranscript?: (text: string, final: boolean) => void
  /**
   * AUTONOMIA VOCII: modelul cere o unealtă (hărți/vreme/web/Gmail/afișare pe
   * ecran...). Handler-ul o execută (de regulă prin POST /api/realtime/tool)
   * și întoarce rezultatul ca string — trimis înapoi modelului, care continuă
   * vorbind. Fără handler, vocea rămâne fără unelte (doar conversație).
   */
  onToolCall?: (name: string, argsJson: string) => Promise<string>
  /**
   * COMANDĂ DE DISPOZITIV DIN VOCE (cameră/ecran): serverul interpretează
   * transcriptul userului cu ACELAȘI interpretor ca în scris și întoarce comanda;
   * clientul o execută (comută camera față/spate, închide monitorul etc.).
   */
  onDevice?: (device: DeviceCommandFrame) => void
  /** GPS live de pe dispozitiv — băgat în contextul sesiunii (vreme/„unde sunt"). */
  coords?: { lat: number; lon: number }
  signal?: AbortSignal
}

// Forma comenzii de dispozitiv întoarsă de server (identică cu {device} din SSE-ul
// chatului scris) — clientul o mapează pe handleControl({ device }).
export interface DeviceCommandFrame {
  camera?: 'on' | 'off' | 'front' | 'back' | 'switch'
  screen?: { op: 'close' | 'closeAll' | 'closeKind' | 'switchKind'; kind?: string }
}

// TIMBRUL PE VOCEA PRINCIPALĂ (Adrian, 26 iul): robinetul de amprentă al
// sesiunii ACTIVE (o singură sesiune — garantat de singleton). finalize()
// întoarce amprenta frazei tocmai rostite și golește tamponul. liveInject
// bagă un mesaj de SISTEM în sesiune (avertismentul de voce străină).
let liveVoiceTap: { finalize: () => VoiceFeatures | null } | null = null
let liveInject: ((text: string) => void) | null = null

// Salvează o tură în istoric (memorie + continuitate între sesiuni). Best-effort.
function persistTranscript(
  role: 'user' | 'assistant',
  text: string,
  onCommittedLang?: (lang: string) => void,
  onDevice?: (device: DeviceCommandFrame) => void,
): void {
  const t = text.trim()
  if (!t) return
  void fetch('/api/realtime/transcript', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      role,
      text: t,
      // Amprenta frazei tocmai rostite (numai pe turele userului) — serverul o
      // compară cu referința titularului, ca în chatul scris.
      voiceFeatures: role === 'user' ? (liveVoiceTap?.finalize() ?? undefined) : undefined,
    }),
  })
    .then(async (r) => {
      // Serverul a COMIS limba detectată (2 mesaje consecutive) → ancorăm
      // sesiunea live pe ea (vezi apelantul) — transcrierea nu mai ghicește.
      const j = (await r.json().catch(() => null)) as { lang?: string; device?: DeviceCommandFrame; foreignVoice?: boolean; adminUnlocked?: boolean } | null
      // VOCE STRĂINĂ (timbrul nu se potrivește cu titularul): sesiunea primește
      // pe loc regula de protecție — nimic administrativ până la confirmare.
      if (j?.foreignVoice)
        liveInject?.(
          'ATENȚIE (verificare de timbru): vocea curentă NU se potrivește cu amprenta titularului contului. Poartă conversația normal, dar NU executa comenzi de administrare, financiare sau distructive până când titularul nu confirmă ÎN SCRIS în chat.',
        )
      // LACĂTUL ADMIN: amprenta s-a potrivit → serverul a pus cookie-ul de
      // deblocare; anunțăm UI-ul (Stage) să aprindă butonul Admin.
      if (j?.adminUnlocked) window.dispatchEvent(new Event('kelion:admin-unlock'))
      if (j?.lang && onCommittedLang) onCommittedLang(j.lang)
      // Comanda verbală de cameră/ecran → clientul o execută pe loc.
      if (j?.device && onDevice) onDevice(j.device)
    })
    .catch(() => {})
}

// ── O SINGURĂ SESIUNE DE VOCE, PE TOATE TABURILE (25 iul — Adrian: „rusa vine
// peste chatul live, mai e un canal") ────────────────────────────────────────
// Două sesiuni Realtime în paralel (tab vechi rămas deschis, repornire în
// cursă) = două voci suprapuse, iar cea veche fără config → rusă. Gardă dublă:
// (1) singleton pe tab — pornirea unei sesiuni o OPREȘTE pe cea dinainte;
// (2) BroadcastChannel între taburi — sesiunea nouă le închide pe ale altora.
let activeVoice: { stop: () => void } | null = null
const VOICE_BC = 'kelion-voice'
// ELEMENT AUDIO PERSISTENT (25 iul — Adrian: „în setarea actuală nu are
// audio"): un `<audio>` nou creat la fiecare (re)pornire a sesiunii poate lovi
// blocajul de autoplay al browserului dacă pornirea aia nu vine dintr-un gest
// direct al userului. Fix: UN SINGUR element, creat o singură dată și
// REFOLOSIT la fiecare pornire — odată deblocat de un gest real, rămâne
// deblocat (schimbăm doar `srcObject`, nu elementul).
let sharedAudioEl: HTMLAudioElement | null = null
function getSharedAudioEl(): HTMLAudioElement {
  if (sharedAudioEl && document.body.contains(sharedAudioEl)) return sharedAudioEl
  const el = document.createElement('audio')
  el.autoplay = true
  el.style.display = 'none'
  document.body.appendChild(el)
  sharedAudioEl = el
  return el
}

// ── IEȘIREA AUDIO PE CĂȘTI BLUETOOTH (Adrian, 29 iul: „de ce nu se poate trece
// audio pe căști bluetooth?") ────────────────────────────────────────────────
// Cauza (fapt din cod): aplicația NU ruta NICIODATĂ ieșirea audio — elementul
// <audio> reda pe dispozitivul implicit și nu reacționa la conectarea căștilor.
// setSinkId (Chromium desktop/Android) leagă elementul de un dispozitiv anume;
// pe iOS Safari NU există (sistemul rutează singur — aici e no-op inofensiv).
// Regula: dacă apar căști/BT, le PREFERĂM; altfel urmăm implicitul. Reaplicăm la
// fiecare `devicechange`, ca sunetul să MIGREZE pe căști când le conectezi în
// timpul convorbirii. Tolerant la eșec: orice pică → rămânem pe implicit, fără
// să rupem redarea. Etichetele au nevoie de permisiunea de microfon (o avem —
// sesiunea de voce e activă), altfel labels vin goale și rămânem pe implicit.
const AUDIO_OUT_RE = /bluetooth|blueto|airpod|headset|headphone|c[ăa][șs]ti|wireless|buds|earbud|hands?-?free/i
async function routeAudioOutput(el: HTMLAudioElement): Promise<void> {
  const sinkEl = el as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }
  if (typeof sinkEl.setSinkId !== 'function') return // iOS/Safari: rutează sistemul
  try {
    let target = 'default'
    if (navigator.mediaDevices?.enumerateDevices) {
      const devs = await navigator.mediaDevices.enumerateDevices()
      const bt = devs.find((d) => d.kind === 'audiooutput' && AUDIO_OUT_RE.test(d.label))
      if (bt?.deviceId) target = bt.deviceId
    }
    await sinkEl.setSinkId(target)
  } catch {
    /* dispozitivul a dispărut / refuzat — rămânem pe implicit, sunetul nu se rupe */
  }
}
const voiceSessionId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
let voiceBc: BroadcastChannel | null = null
try {
  voiceBc = new BroadcastChannel(VOICE_BC)
} catch {
  voiceBc = null /* browser vechi — rămâne garda pe tab */
}

/**
 * Pornește o sesiune de voce full-duplex prin OpenAI Realtime.
 * Aruncă dacă microfonul e refuzat sau sesiunea backend eșuează.
 */
export async function startRealtimeVoice(
  opts: RealtimeVoiceOpts = {},
): Promise<RealtimeVoiceHandle> {
  const { onState, onUserTranscript, onAssistantTranscript, onToolCall, onDevice, signal } = opts
  onState?.('connecting')

  // Orice sesiune anterioară din ACEST tab moare înainte să pornească alta.
  activeVoice?.stop()
  activeVoice = null
  // Anunță celelalte taburi: sesiunea de voce e AICI de-acum.
  const myId = voiceSessionId()
  voiceBc?.postMessage({ takeover: myId })

  let closed = false
  const cleanups: (() => void)[] = []
  const pc = new RTCPeerConnection()

  const stop = (): void => {
    if (closed) return
    closed = true
    if (activeVoice === handleShell) activeVoice = null
    for (const c of cleanups) {
      try {
        c()
      } catch {
        /* ignore */
      }
    }
    try {
      pc.getSenders().forEach((s) => s.track?.stop())
    } catch {
      /* ignore */
    }
    try {
      pc.close()
    } catch {
      /* ignore */
    }
    onState?.('closed')
  }

  // Handle-ul „umbră" pentru singleton: există înainte de return, ca stop()-ul
  // să poată curăța referința globală pe orice drum (eroare inclusă).
  const handleShell = { stop }
  activeVoice = handleShell
  // Alt tab a pornit o sesiune → a noastră se închide (o singură voce, mereu).
  if (voiceBc) {
    const onTakeover = (ev: MessageEvent): void => {
      const d = ev.data as { takeover?: string } | null
      if (d?.takeover && d.takeover !== myId && !closed) {
        stop()
        onState?.('error', 'preluat-de-alt-tab')
      }
    }
    voiceBc.addEventListener('message', onTakeover)
    cleanups.push(() => voiceBc?.removeEventListener('message', onTakeover))
  }

  if (signal) {
    if (signal.aborted) {
      stop()
      throw new DOMException('aborted', 'AbortError')
    }
    signal.addEventListener('abort', stop, { once: true })
  }

  try {
    // 1) Microfon — cu anulare de ecou/zgomot ca Kelion să nu se audă în buclă.
    const mic = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    })
    cleanups.push(() => mic.getTracks().forEach((t) => t.stop()))
    // Robinetul de amprentă: analizor paralel pe ACELAȘI microfon (nu atinge
    // WebRTC). Colectează cadre doar când e energie de vorbire; amprenta se
    // finalizează per frază (la transcriptul final) — ca pe calea STT.
    try {
      const tapCtx = new AudioContext()
      const tapSrc = tapCtx.createMediaStreamSource(mic)
      const tapAn = tapCtx.createAnalyser()
      tapAn.fftSize = 2048
      tapSrc.connect(tapAn)
      const tBuf = new Float32Array(tapAn.fftSize)
      const fBuf = new Float32Array(tapAn.frequencyBinCount)
      const f0s: number[] = []
      const energies: number[] = []
      let cSum = 0, cN = 0, rSum = 0, zSum = 0, eSum = 0, frames = 0
      const tick = window.setInterval(() => {
        tapAn.getFloatTimeDomainData(tBuf)
        const e = estimateEnergy(tBuf)
        if (e < 0.004) return // liniște/zgomot — nu poluăm amprenta
        energies.push(e); eSum += e; zSum += estimateZcr(tBuf)
        const f0 = estimateF0(tBuf, tapCtx.sampleRate)
        if (f0 > 0) f0s.push(f0)
        tapAn.getFloatFrequencyData(fBuf)
        const c = estimateCentroid(fBuf, tapCtx.sampleRate, tapAn.fftSize)
        if (c > 0) { cSum += c; cN++ }
        rSum += estimateRolloff(fBuf, tapCtx.sampleRate, tapAn.fftSize)
        frames++
      }, 150)
      liveVoiceTap = {
        finalize: () => {
          if (frames < 8) return null // prea puțin semnal — fără amprentă
          const out = buildVoiceFeatures(f0s.slice(), energies.slice(), cN ? cSum / cN : 0, rSum / frames, zSum / frames, eSum / frames)
          f0s.length = 0; energies.length = 0; cSum = 0; cN = 0; rSum = 0; zSum = 0; eSum = 0; frames = 0
          return out
        },
      }
      cleanups.push(() => {
        window.clearInterval(tick)
        liveVoiceTap = null
        liveInject = null
        void tapCtx.close().catch(() => {})
      })
    } catch {
      /* fără robinet de amprentă — vocea merge normal, timbrul rămâne pe STT */
    }
    // VINDECAREA AUZULUI ÎN LOC (Adrian, 27 iul: „sunt buguri multiple pe auzul
    // lui"; F12 arăta `input-ended` — pista microfonului MOARE la schimbarea
    // device-ului/suspendarea browserului). Înainte, un track încheiat omora
    // TOATĂ sesiunea (stop + eroare + reconectare completă = secunde de surzenie
    // + un „eșec" numărat spre căderea pe vocea robotică). Acum: RE-CERE
    // microfonul și înlocuiește pista PE LOC (replaceTrack) — sesiunea WebRTC
    // rămâne vie, auzul revine în sub o secundă. Doar dacă re-cererea pică
    // (permisiune retrasă, fără device) declarăm eroarea, ca înainte.
    const bindMicTrack = (track: MediaStreamTrack, sender: RTCRtpSender): void => {
      track.addEventListener(
        'ended',
        () => {
          if (closed) return
          void navigator.mediaDevices
            .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
            .then(async (fresh) => {
              if (closed) {
                fresh.getTracks().forEach((t) => t.stop())
                return
              }
              const newTrack = fresh.getAudioTracks()[0]
              if (!newTrack) throw new Error('no_audio_track')
              await sender.replaceTrack(newTrack)
              cleanups.push(() => fresh.getTracks().forEach((t) => t.stop()))
              bindMicTrack(newTrack, sender) // și noua pistă se vindecă la fel
              console.log('[realtime] microfon reînnoit în loc (input-ended vindecat, sesiunea a rămas vie)')
            })
            .catch(() => {
              if (!closed) {
                stop()
                onState?.('error', 'input-ended')
              }
            })
        },
        { once: true },
      )
    }
    for (const track of mic.getTracks()) {
      const sender = pc.addTrack(track, mic)
      bindMicTrack(track, sender)
    }

    // 2) Vocea lui Kelion (pista remote) + animarea avatarului din nivelul audio.
    // ELEMENT PARTAJAT (nu unul nou de fiecare dată) — vezi comentariul de la
    // `getSharedAudioEl`: odată deblocat de un gest real, rămâne deblocat pe
    // toate redeschiderile automate ulterioare (voce pe frază).
    const audioEl = getSharedAudioEl()
    // VOLUM CONTROLABIL (25 iul): vocea Realtime urmează volumul global al
    // aplicației (sliderul din chat) — până azi pornea fix pe 1.0, nereglabil.
    const unregisterVol = registerVoiceAudioElement(audioEl)
    cleanups.push(unregisterVol)
    // NU elimina elementul din DOM la stop() — e partajat între sesiuni; doar
    // sesiunea îl eliberează, elementul rămâne pentru următoarea redeschidere.
    cleanups.push(() => {
      audioEl.srcObject = null
    })
    // IEȘIREA PE CĂȘTI/BT: rutează acum + reaplică ori de câte ori se schimbă
    // dispozitivele (conectezi căștile în timpul convorbirii → sunetul migrează).
    void routeAudioOutput(audioEl)
    const onDeviceChange = (): void => {
      void routeAudioOutput(audioEl)
    }
    navigator.mediaDevices?.addEventListener?.('devicechange', onDeviceChange)
    cleanups.push(() => navigator.mediaDevices?.removeEventListener?.('devicechange', onDeviceChange))
    let stopLip: (() => void) | null = null
    pc.ontrack = (ev) => {
      audioEl.srcObject = ev.streams[0] ?? new MediaStream([ev.track])
      // AUTOPLAY: browserul poate refuza redarea audio până la un gest al
      // userului. Vechea variantă înghițea refuzul (`.catch(()=>{})`) → Kelion
      // se conecta dar „vocea lipsea cu desăvârșire". Acum, dacă redarea e
      // blocată, o REÎNCERCĂM la primul gest (click/tastă/atingere) și apoi
      // curățăm ascultătorii — vocea pornește de la prima interacțiune.
      const GESTURES = ['pointerdown', 'keydown', 'touchstart'] as const
      const removeUnlock = (): void => {
        for (const g of GESTURES) window.removeEventListener(g, unlock)
      }
      const unlock = (): void => {
        void audioEl.play?.().then(removeUnlock).catch(() => {})
      }
      void audioEl.play?.().catch(() => {
        for (const g of GESTURES) window.addEventListener(g, unlock, { passive: true })
      })
      cleanups.push(removeUnlock)
      stopLip?.()
      stopLip = driveVoiceLevelFromElement(audioEl)
      cleanups.push(() => stopLip?.())
    }

    // FIX „moare tăcut" (audit 24 iul, P2): înainte tratam DOAR `failed`.
    // Când OpenAI închide apelul (limită de sesiune, idle, cădere server) starea
    // trece prin `disconnected`/`closed` FĂRĂ să ajungă vreodată la `failed` →
    // micRef rămânea instalat, UI arăta „ascult", dar nu mai exista nici auz,
    // nici voce („audio nu există"). Acum: `closed` = fatal imediat; la
    // `disconnected` dăm un răgaz de 4s (ICE își poate reveni) și abia apoi
    // declarăm sesiunea moartă — handler-ul din ChatPanel repornește singur.
    let discTimer: number | null = null
    const clearDisc = (): void => {
      if (discTimer != null) {
        clearTimeout(discTimer)
        discTimer = null
      }
    }
    cleanups.push(clearDisc)
    pc.onconnectionstatechange = () => {
      if (closed) return
      const st = pc.connectionState
      if (st === 'connected') {
        clearDisc()
        onState?.('live')
      } else if (st === 'failed' || st === 'closed') {
        clearDisc()
        stop()
        onState?.('error', `connection-${st}`)
      } else if (st === 'disconnected') {
        clearDisc()
        discTimer = window.setTimeout(() => {
          if (!closed && pc.connectionState === 'disconnected') {
            stop()
            onState?.('error', 'connection-disconnected')
          }
        }, 4000)
      }
    }

    // 3) dataChannel — evenimentele OpenAI Realtime (transcript + erori + barge-in).
    const dc = pc.createDataChannel('oai-events')
    // Canalul de evenimente închis grațios de server = sesiune moartă (fără el
    // nu mai există nici transcript, nici tool-calls) — tratăm ca eroare fatală.
    dc.onclose = () => {
      if (!closed) {
        stop()
        onState?.('error', 'dc-closed')
      }
    }
    // O SINGURĂ injecție (25 iul — Adrian: „injectezi de o mie de ori, dublezi").
    // Instrucțiunile + uneltele + contextul vin ACUM în sesiunea inițială de pe
    // server (multipart string, acceptat de OpenAI cu 201). NU mai dublăm aici
    // prin session.update — era exact stratul redundant.
    const send = (obj: unknown): void => {
      if (dc.readyState === 'open') {
        try {
          dc.send(JSON.stringify(obj))
        } catch {
          /* ignore */
        }
      }
    }
    // Textul parțial pe id-uri, ca să salvăm turele complete în istoric.
    const userText = new Map<string, string>()
    const asstText = new Map<string, string>()
    // ── POARTA NUMELUI, MECANICĂ (Adrian, 27 iul: „nu intră în chat dacă nu
    // își aude numele — e deja făcut dar nu merge") ─────────────────────────
    // Serverul a oprit răspunsul automat (create_response:false); AICI se
    // decide cine primește răspuns: (1) fraza conține numele („Kelion"/„Kei",
    // tolerant la variații de transcriere) → răspunde și DESCHIDE fereastra de
    // conversație; (2) fereastra e deschisă (schimb recent) → conversația curge
    // liber, fără să repeți numele — exact ce lipsea porții vechi din 24 iul,
    // care cerea numele la FIECARE frază și părea surdă; (3) altfel → tăcere:
    // discuția din cameră nu-i e adresată. „STOP" închide fereastra.
    const GATE_WINDOW_MS = 120_000
    // FEREASTRA E DESCHISĂ LA PORNIREA SESIUNII (bug găsit live de Adrian,
    // 27 iul, „parcă nu aude": userul tocmai a PORNIT microfonul — evident că
    // i se adresează lui Kelion; a cere numele chiar la prima frază, cu o
    // transcriere care îl stâlcește, îl făcea complet mut la deschidere).
    let gateUntil = Date.now() + GATE_WINDOW_MS
    // Regex TOLERANT la transcrierea reală (dovadă live: „Kelion, ce faci" a
    // ieșit „Elioncevaci"): acceptăm și variantele fără consoana de început
    // (elion/eleon), lipite de cuvântul următor.
    const NAME_RE = /[ckg]h?e?l[iy]?[oae]n|elion|eleon|\bkei\b|\bkay\b/i
    // Plasa anti-„nu mă aude": dacă VAD-ul a închis fraza dar transcriptul nu
    // mai vine (transcrierea a picat), în conversație ACTIVĂ răspundem oricum.
    let speechStopTimer: number | null = null
    cleanups.push(() => {
      if (speechStopTimer != null) clearTimeout(speechStopTimer)
    })
    // Ultima limbă ANCORATĂ în sesiunea live — re-ancorăm doar la schimbare.
    let anchoredLang = ''
    // Apelurile de unelte: numele vine pe output_item.added, argumentele pe
    // function_call_arguments.done — legate prin call_id.
    const toolNames = new Map<string, string>()
    // Injecția de sistem devine disponibilă odată cu canalul de evenimente.
    liveInject = (text: string) =>
      send({ type: 'conversation.item.create', item: { type: 'message', role: 'system', content: [{ type: 'input_text', text }] } })
    dc.onmessage = (ev) => {
      let m: Record<string, unknown>
      try {
        m = JSON.parse(String(ev.data)) as Record<string, unknown>
      } catch {
        return
      }
      const type = String(m.type ?? '')
      const itemId = String((m.item_id as string) ?? (m.response_id as string) ?? '')

      if (type === 'conversation.item.input_audio_transcription.delta') {
        const t = (userText.get(itemId) ?? '') + String(m.delta ?? '')
        userText.set(itemId, t)
        onUserTranscript?.(t, false)
      } else if (type === 'conversation.item.input_audio_transcription.completed') {
        const t = String(m.transcript ?? userText.get(itemId) ?? '')
        userText.delete(itemId)
        onUserTranscript?.(t, true)
        // Transcriptul a sosit — plasa pe „transcript lipsă" nu mai e necesară.
        if (speechStopTimer != null) {
          clearTimeout(speechStopTimer)
          speechStopTimer = null
        }
        // COMANDA „STOP" (Adrian, 27 iul: „kelion nu ascultă comanda stop"):
        // rostită SINGURĂ („stop", „taci", „gata", „oprește-te"...), taie PE
        // LOC și generarea și sunetul deja produs — determinist, în client,
        // fără să aștepte bunăvoința modelului — apoi lasă ordin de tăcere.
        // A doua tăiere la 400ms omoară și răspunsul pe care VAD-ul îl
        // pornește automat CA REACȚIE la fraza „stop" însăși.
        if (/^\W*(stop|stai|taci|gata|opre[sș]te(?:-te)?|shut ?up|be quiet|basta)[\s.!…]*$/i.test(t.trim())) {
          gateUntil = 0 // STOP închide și fereastra — până la următorul „Kelion"
          send({ type: 'response.cancel' })
          send({ type: 'output_audio_buffer.clear' })
          send({
            type: 'conversation.item.create',
            item: {
              type: 'message',
              role: 'system',
              content: [{ type: 'input_text', text: 'STOP de la user: taci IMEDIAT. NU răspunde la acest ordin — nicio confirmare, niciun cuvânt. Rămâi complet tăcut până când userul îți vorbește din nou.' }],
            },
          })
          window.setTimeout(() => {
            send({ type: 'response.cancel' })
            send({ type: 'output_audio_buffer.clear' })
          }, 400)
        } else if (t.trim()) {
          // POARTA NUMELUI: cine primește răspuns. Numele deschide/reînnoiește
          // fereastra; fereastra deschisă lasă conversația să curgă fără nume;
          // altfel — tăcere (discuția nu-i e adresată; numele îl recheamă).
          const named = NAME_RE.test(t)
          const engaged = Date.now() < gateUntil
          if (named || engaged) {
            gateUntil = Date.now() + GATE_WINDOW_MS
            send({ type: 'response.create' })
          }
        }
        // La limba COMISĂ de server: ancorăm transcrierea sesiunii LIVE pe ea
        // (session.update, fără repornire) — „limba aleatoare" dispare.
        // DOAR LA SCHIMBARE (25 iul — testul live al lui Adrian: „sacadat, voci
        // necontrolate"): înainte, ancora rula session.update + injecție de
        // sistem la FIECARE frază — zgâlțâia sesiunea audio în plin răspuns.
        // Limba nu se schimbă frază de frază; ancorăm o dată și re-ancorăm
        // numai când serverul comite ALTĂ limbă.
        persistTranscript(
          'user',
          t,
          (lang) => {
            if (lang === anchoredLang) return
            anchoredLang = lang
            send({
              type: 'session.update',
              session: {
                type: 'realtime',
                audio: { input: { transcription: { model: 'gpt-4o-transcribe', language: lang } } },
              },
            })
            const names: Record<string, string> = { ro: 'Romanian', en: 'English', fr: 'French', es: 'Spanish', pt: 'Portuguese', it: 'Italian', de: 'German' }
            const nm = names[lang] ?? 'English'
            send({
              type: 'conversation.item.create',
              item: {
                type: 'message',
                role: 'system',
                content: [{ type: 'input_text', text: `Reminder: reply ONLY in ${nm}. Never switch language. If you heard only noise or silence, stay silent.` }],
              },
            })
          },
          // COMANDĂ VERBALĂ DE CAMERĂ/ECRAN (25 iul): serverul a interpretat
          // transcriptul → o executăm în client (comută camera, închide monitorul).
          onDevice,
        )
      } else if (type === 'response.output_audio_transcript.delta') {
        const t = (asstText.get(itemId) ?? '') + String(m.delta ?? '')
        asstText.set(itemId, t)
        onAssistantTranscript?.(t, false)
      } else if (type === 'response.output_audio_transcript.done') {
        const t = String(m.transcript ?? asstText.get(itemId) ?? '')
        asstText.delete(itemId)
        onAssistantTranscript?.(t, true)
        persistTranscript('assistant', t)
        // Kelion a vorbit → conversația e vie: fereastra porții se reînnoiește.
        gateUntil = Date.now() + GATE_WINDOW_MS
      } else if (type === 'input_audio_buffer.speech_stopped') {
        // Plasa anti-„nu mă aude" (cauza scoaterii porții vechi, 24 iul): VAD-ul
        // a închis fraza; dacă transcriptul NU sosește în 2.8s (transcrierea a
        // picat) și conversația e ACTIVĂ, răspundem oricum — o defecțiune de
        // transcriere nu are voie să-l facă surd în mijlocul discuției. În
        // afara conversației (poarta închisă), tăcerea rămâne tăcere.
        if (speechStopTimer != null) clearTimeout(speechStopTimer)
        speechStopTimer = window.setTimeout(() => {
          speechStopTimer = null
          if (Date.now() < gateUntil) send({ type: 'response.create' })
        }, 2800)
      } else if (type === 'response.output_item.added') {
        // Numele funcției cerute — memorat pe call_id pentru pasul de argumente.
        const item = (m.item as Record<string, unknown>) ?? {}
        if (item.type === 'function_call') {
          toolNames.set(String(item.call_id ?? ''), String(item.name ?? ''))
        }
      } else if (type === 'response.function_call_arguments.done') {
        // AUTONOMIA VOCII: execută unealta și trimite rezultatul înapoi, apoi
        // cere continuarea răspunsului — Kelion vorbește pe baza rezultatului.
        const callId = String(m.call_id ?? '')
        const name = String(m.name ?? toolNames.get(callId) ?? '')
        toolNames.delete(callId)
        const argsJson = String(m.arguments ?? '{}')
        // ANTI-„2 VOCI" LA ESCALADARE (Adrian, 25 iul): dacă modelul rostea deja
        // ceva când a cerut unealta (ex. „stai să verific"), `response.create` de
        // mai jos pornea o A DOUA rostire PESTE prima → două voci suprapuse.
        // Tăiem orice răspuns în curs ÎNAINTE de a rosti rezultatul uneltei.
        if (name && onToolCall) {
          void onToolCall(name, argsJson)
            .catch((e) => JSON.stringify({ error: String(e).slice(0, 200) }))
            .then((output) => {
              send({ type: 'response.cancel' })
              send({
                type: 'conversation.item.create',
                item: { type: 'function_call_output', call_id: callId, output: String(output ?? '{}') },
              })
              send({ type: 'response.create' })
            })
        } else {
          // Nume nerezolvabil (sau fără handler): răspundem totuși — altfel
          // modelul rămâne agățat așteptând rezultatul funcției.
          send({ type: 'response.cancel' })
          send({
            type: 'conversation.item.create',
            item: { type: 'function_call_output', call_id: callId, output: '{"error":"unknown_tool"}' },
          })
          send({ type: 'response.create' })
        }
      } else if (type === 'error') {
        const err = (m.error as Record<string, unknown>) ?? {}
        const msg = String(err.message ?? err.code ?? 'realtime-error')
        // Erori BENIGNE (cancellation_failed / conversation_already_has_active_
        // response) nu dărâmă sesiunea — doar le notăm și mergem mai departe.
        if (/cancel|active_response/i.test(`${String(err.code ?? '')} ${msg}`)) {
          console.warn('realtime eroare benignă:', msg)
        } else {
          // FATAL: oprim sesiunea ÎNAINTE de a anunța — altfel rămânea vie
          // (mic capturat, facturare) și pornea AL DOILEA microfon în paralel.
          stop()
          onState?.('error', msg)
        }
      }
    }

    // 4) SDP: ofertă locală → backend (proxy la OpenAI) → answer.
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    const res = await fetch('/api/realtime/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      signal,
      // ANCORA DE TIMP (fix „bună seara" dimineața): vocea primea GPS-ul dar NU
      // ora — creierul de voce ghicea partea zilei. Trimitem ora reală + fusul
      // dispozitivului, exact ca scrisul, ca salutul să urmeze ceasul adevărat.
      body: JSON.stringify({
        sdp: pc.localDescription?.sdp ?? '',
        language: opts.language,
        coords: opts.coords,
        now: new Date().toISOString(),
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
    })
    if (!res.ok) {
      // MOTIVUL, PE ÎNȚELESUL OMULUI (D7). Serverul trimite de mult un corp
      // structurat (`code`, `retryable`), dar clientul îl arunca și afișa
      // „realtime 502" — un număr care nu spune nimic și nu ajută pe nimeni să
      // decidă dacă merită reîncercat.
      const corp = (await res.json().catch(() => null)) as
        | { code?: string; retryable?: boolean }
        | null
      const dupaCod: Record<string, string> = {
        realtime_not_configured: 'vocea nu e configurată pe server',
        upstream_timeout: 'furnizorul vocii n-a răspuns la timp — încearcă din nou',
        upstream_unreachable: 'nu am putut ajunge la furnizorul vocii — verifică rețeaua',
        upstream_5xx: 'furnizorul vocii are o pană — încearcă din nou peste puțin',
        upstream_empty: 'furnizorul vocii a răspuns gol — încearcă din nou',
        upstream_refuz: 'cererea de pornire a vocii a fost refuzată',
      }
      const note =
        res.status === 401
          ? 'trebuie să fii logat'
          : res.status === 402
            ? 'nu mai ai credit'
            : (corp?.code && dupaCod[corp.code]) || `realtime ${res.status}`
      const err = new Error(note)
      // Cine prinde eroarea poate decide dacă arată butonul „încearcă din nou".
      ;(err as Error & { retryable?: boolean }).retryable = corp?.retryable !== false
      throw err
    }
    const answer = await res.text()
    await pc.setRemoteDescription({ type: 'answer', sdp: answer })
    if (closed || signal?.aborted) throw new DOMException('ended-before-live', 'AbortError')

    return {
      stop,
      setMuted: (muted: boolean) => {
        pc.getSenders().forEach((s) => {
          if (s.track?.kind === 'audio') s.track.enabled = !muted
        })
      },
      // Barge-in manual: cerem modelului să taie răspunsul curent.
      interrupt: () => send({ type: 'response.cancel' }),
      // Poziția s-a schimbat → un item de SISTEM cu noii lat/lon (nu dublăm
      // instrucțiunile prin session.update — regula „o singură injecție").
      updateCoords: (c: { lat: number; lon: number }) =>
        send({
          type: 'conversation.item.create',
          item: {
            type: 'message',
            role: 'system',
            content: [
              {
                type: 'input_text',
                text:
                  `ACTUALIZARE GPS LIVE: poziția CURENTĂ a utilizatorului este ACUM latitudine ${c.lat.toFixed(5)}, longitudine ${c.lon.toFixed(5)}. ` +
                  'De acum, „aici", „lângă mine", „unde sunt" și vremea locală folosesc ACEASTĂ poziție (cea veche nu mai e valabilă); la get_weather pasează exact acești lat/lon.',
              },
            ],
          },
        }),
    }
  } catch (e) {
    stop()
    // FIX „numărare dublă" (audit 24 iul, P3): aici NU mai chemăm onState('error')
    // — aruncăm excepția, iar catch-ul din ChatPanel numără EL eșecul de pornire.
    // Înainte, un singur eșec incrementa contorul de 2 ori (onState + catch) →
    // „3 șanse" erau de fapt 2 și full-duplexul se stingea prematur pe STT.
    throw e
  }
}
