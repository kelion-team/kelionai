// ── VOCE LIVE — client OpenAI Realtime (WebRTC) ──────────────────────────────
// Jumătatea de FRONTEND a vocii, reconstruită fidel din aplicația live (adusă
// în git ca sursă unică). Fluxul, verificat din bundle-ul live:
//   1. RTCPeerConnection + microfon (addTrack)
//   2. dataChannel „oai-events" → primim transcript (user + Kelion) și erori
//   3. createOffer → POST /api/realtime/session {sdp, language} → answer SDP
//   4. ontrack → redăm vocea lui Kelion și animăm avatarul (nivel audio)
// Cheia OpenAI NU e niciodată aici — o ține backendul. Modelul + vocea + limba
// se injectează server-side; clientul trimite doar limba curentă ca hint.

import { driveVoiceLevelFromElement } from './audioIO'

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
  signal?: AbortSignal
}

// Salvează o tură în istoric (memorie + continuitate între sesiuni). Best-effort.
function persistTranscript(role: 'user' | 'assistant', text: string): void {
  const t = text.trim()
  if (!t) return
  void fetch('/api/realtime/transcript', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ role, text: t }),
  }).catch(() => {})
}

/**
 * Pornește o sesiune de voce full-duplex prin OpenAI Realtime.
 * Aruncă dacă microfonul e refuzat sau sesiunea backend eșuează.
 */
export async function startRealtimeVoice(
  opts: RealtimeVoiceOpts = {},
): Promise<RealtimeVoiceHandle> {
  const { onState, onUserTranscript, onAssistantTranscript, signal } = opts
  onState?.('connecting')

  let closed = false
  const cleanups: (() => void)[] = []
  const pc = new RTCPeerConnection()

  const stop = (): void => {
    if (closed) return
    closed = true
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

    pc.onconnectionstatechange = () => {
      if (closed) return
      if (pc.connectionState === 'connected') onState?.('live')
      else if (pc.connectionState === 'failed') {
        stop()
        onState?.('error', 'connection-failed')
      }
    }

    // 3) dataChannel — evenimentele OpenAI Realtime (transcript + erori + barge-in).
    const dc = pc.createDataChannel('oai-events')
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
        persistTranscript('user', t)
      } else if (type === 'response.output_audio_transcript.delta') {
        const t = (asstText.get(itemId) ?? '') + String(m.delta ?? '')
        asstText.set(itemId, t)
        onAssistantTranscript?.(t, false)
      } else if (type === 'response.output_audio_transcript.done') {
        const t = String(m.transcript ?? asstText.get(itemId) ?? '')
        asstText.delete(itemId)
        onAssistantTranscript?.(t, true)
        persistTranscript('assistant', t)
      } else if (type === 'error') {
        const err = (m.error as Record<string, unknown>) ?? {}
        onState?.('error', String(err.message ?? 'realtime-error'))
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
    const aborted = signal?.aborted || (e instanceof DOMException && e.name === 'AbortError')
    stop()
    if (!aborted) onState?.('error', e instanceof Error ? e.message : 'connection failed')
    throw e
  }
}
