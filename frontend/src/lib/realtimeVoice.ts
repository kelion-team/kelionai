// ── VOCE LIVE — client OpenAI Realtime (WebRTC) ──────────────────────────────
// Jumătatea de FRONTEND a vocii, reconstruită fidel din aplicația live (adusă
// în git ca sursă unică). Fluxul, verificat din bundle-ul live:
//   1. RTCPeerConnection + microfon (addTrack)
//   2. dataChannel „oai-events" → primim transcript (user + Kelion) și erori
//   3. createOffer → POST /api/realtime/session {sdp, language} → answer SDP
//   4. ontrack → redăm vocea lui Kelion și animăm avatarul (nivel audio)
// Cheia OpenAI NU e niciodată aici — o ține backendul. Modelul + vocea + limba
// se injectează server-side; clientul trimite doar limba curentă ca hint.

import { driveVoiceLevelFromElement, registerVoiceAudioElement } from './audioIO'

export type RealtimeVoiceState = 'connecting' | 'live' | 'error' | 'closed'

export interface RealtimeVoiceHandle {
  stop: () => void
  setMuted: (muted: boolean) => void
  /** Întrerupe imediat vorbirea lui Kelion (barge-in manual). */
  interrupt: () => void
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
  signal?: AbortSignal
}

// Salvează o tură în istoric (memorie + continuitate între sesiuni). Best-effort.
function persistTranscript(
  role: 'user' | 'assistant',
  text: string,
  onCommittedLang?: (lang: string) => void,
): void {
  const t = text.trim()
  if (!t) return
  void fetch('/api/realtime/transcript', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ role, text: t }),
  })
    .then(async (r) => {
      // Serverul a COMIS limba detectată (2 mesaje consecutive) → ancorăm
      // sesiunea live pe ea (vezi apelantul) — transcrierea nu mai ghicește.
      const j = (await r.json().catch(() => null)) as { lang?: string } | null
      if (j?.lang && onCommittedLang) onCommittedLang(j.lang)
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
  const { onState, onUserTranscript, onAssistantTranscript, onToolCall, signal } = opts
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
    for (const track of mic.getTracks()) {
      pc.addTrack(track, mic)
      // Dacă pistele de intrare se termină brusc (device scos), semnalăm eroare.
      track.addEventListener(
        'ended',
        () => {
          if (!closed) {
            stop()
            onState?.('error', 'input-ended')
          }
        },
        { once: true },
      )
    }

    // 2) Vocea lui Kelion (pista remote) + animarea avatarului din nivelul audio.
    const audioEl = document.createElement('audio')
    audioEl.autoplay = true
    audioEl.style.display = 'none'
    document.body.appendChild(audioEl)
    // VOLUM CONTROLABIL (25 iul): vocea Realtime urmează volumul global al
    // aplicației (sliderul din chat) — până azi pornea fix pe 1.0, nereglabil.
    const unregisterVol = registerVoiceAudioElement(audioEl)
    cleanups.push(unregisterVol)
    cleanups.push(() => audioEl.remove())
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
    // PLASĂ DE SIGURANȚĂ (25 iul — dovedit cu experiment A/B: multipart-ul
    // „session" trimis ca Blob era IGNORAT de OpenAI → NICIO instrucțiune nu
    // s-a aplicat vreodată: de-aia rusa, de-aia „nu vede/nu escaladează").
    // Pe lângă fixul din server (string, nu Blob), aplicăm instrucțiunile și
    // AICI, prin session.update pe dataChannel — calea documentată, garantată.
    dc.onopen = () => {
      void fetch('/api/realtime/config', { credentials: 'include' })
        .then((r) => (r.ok ? r.json() : null))
        .then((cfg: { instructions?: string; tools?: unknown[] } | null) => {
          if (!cfg?.instructions || dc.readyState !== 'open') return
          send({
            type: 'session.update',
            session: {
              type: 'realtime',
              instructions: cfg.instructions,
              tools: cfg.tools ?? [],
              tool_choice: 'auto',
            },
          })
        })
        .catch(() => {})
    }
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
    // Ultima limbă ANCORATĂ în sesiunea live — re-ancorăm doar la schimbare.
    let anchoredLang = ''
    // Apelurile de unelte: numele vine pe output_item.added, argumentele pe
    // function_call_arguments.done — legate prin call_id.
    const toolNames = new Map<string, string>()
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
        // La limba COMISĂ de server: ancorăm transcrierea sesiunii LIVE pe ea
        // (session.update, fără repornire) — „limba aleatoare" dispare.
        // DOAR LA SCHIMBARE (25 iul — testul live al lui Adrian: „sacadat, voci
        // necontrolate"): înainte, ancora rula session.update + injecție de
        // sistem la FIECARE frază — zgâlțâia sesiunea audio în plin răspuns.
        // Limba nu se schimbă frază de frază; ancorăm o dată și re-ancorăm
        // numai când serverul comite ALTĂ limbă.
        persistTranscript('user', t, (lang) => {
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
        })
      } else if (type === 'response.output_audio_transcript.delta') {
        const t = (asstText.get(itemId) ?? '') + String(m.delta ?? '')
        asstText.set(itemId, t)
        onAssistantTranscript?.(t, false)
      } else if (type === 'response.output_audio_transcript.done') {
        const t = String(m.transcript ?? asstText.get(itemId) ?? '')
        asstText.delete(itemId)
        onAssistantTranscript?.(t, true)
        persistTranscript('assistant', t)
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
        if (name && onToolCall) {
          void onToolCall(name, argsJson)
            .catch((e) => JSON.stringify({ error: String(e).slice(0, 200) }))
            .then((output) => {
              send({
                type: 'conversation.item.create',
                item: { type: 'function_call_output', call_id: callId, output: String(output ?? '{}') },
              })
              send({ type: 'response.create' })
            })
        } else {
          // Nume nerezolvabil (sau fără handler): răspundem totuși — altfel
          // modelul rămâne agățat așteptând rezultatul funcției.
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
      body: JSON.stringify({ sdp: pc.localDescription?.sdp ?? '', language: opts.language }),
    })
    if (!res.ok) {
      const note = res.status === 401 ? 'trebuie să fii logat' : `realtime ${res.status}`
      throw new Error(note)
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
