// CLIENTUL FULL-DUPLEX (Adrian, 12 iul: „chatul full duplex") — pasul 3.
//
// Jumătatea de FRONTEND a vocii full-duplex: intră în camera LiveKit proprie a
// userului, publică microfonul și redă vocea agentului lui Kelion (pista audio
// din cameră). Agentul de voce de pe VPS (bridge/voice-agent) ține bucla
// STT→creier→TTS cu barge-in; aici doar deschidem microfonul și ascultăm.
//
// COMPLET IZOLAT de traseul de voce HTTP actual (getUserMedia→/api/asr→chat→
// /api/tts): e un modul separat, pornit DOAR când userul apasă butonul
// full-duplex. Dacă LiveKit nu e configurat / conexiunea pică, aruncă o eroare
// clară și nu atinge nimic din calea care merge acum.

import type { RemoteTrack, RemoteTrackPublication, RemoteParticipant } from 'livekit-client'
import { driveVoiceLevelFrom } from './audioIO'

export type LiveVoiceState = 'connecting' | 'live' | 'error' | 'closed'

export interface LiveVoiceHandle {
  stop: () => Promise<void>
}

interface StartOpts {
  onState?: (s: LiveVoiceState, note?: string) => void
}

// Elementele <audio> atașate pistelor agentului — le curățăm la oprire.
function attachAudio(track: RemoteTrack): HTMLAudioElement {
  const el = track.attach() as HTMLAudioElement
  el.autoplay = true
  el.style.display = 'none'
  document.body.appendChild(el)
  return el
}

/**
 * Pornește sesiunea full-duplex. Cere un token de la backend (/api/livekit/token,
 * cameră deterministă per user), se conectează, publică microfonul (cu anulare de
 * ecou/zgomot ca să nu se audă singur în buclă) și redă vocea agentului. Întoarce
 * un mâner cu stop(); aruncă dacă tokenul / conexiunea eșuează.
 */
export async function startLiveVoice(opts: StartOpts = {}): Promise<LiveVoiceHandle> {
  const { onState } = opts
  onState?.('connecting')

  // Import LENEȘ: livekit-client (~mare) se încarcă DOAR la prima pornire a
  // modului full-duplex, nu în bundle-ul principal — traseul de chat/voce care
  // trebuie să pornească în <1s rămâne subțire.
  const { Room, RoomEvent, Track, createLocalAudioTrack } = await import('livekit-client')

  const res = await fetch('/api/livekit/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: '{}',
  })
  if (!res.ok) {
    const err = res.status === 401 ? 'trebuie să fii logat' : res.status === 503 ? 'LiveKit neconfigurat' : `token ${res.status}`
    onState?.('error', err)
    throw new Error(`live-voice token: ${err}`)
  }
  const { url, token } = (await res.json()) as { url?: string; token?: string }
  if (!url || !token) {
    onState?.('error', 'token invalid')
    throw new Error('live-voice: url/token lipsă')
  }

  const room = new Room({ adaptiveStream: true, dynacast: true })
  const audioEls: HTMLAudioElement[] = []
  // Opritorii de lip-sync (unul per pistă audio a agentului) — curățați la stop.
  const lipStops: Array<() => void> = []

  room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _pub: RemoteTrackPublication, _p: RemoteParticipant) => {
    if (track.kind === Track.Kind.Audio) {
      const el = attachAudio(track)
      audioEls.push(el)
      // GURA avatarului pe vocea agentului (pasul 4): conduce voiceLevel din
      // amplitudinea acestei piste. Bonus vizual — dacă pică, sunetul rămâne.
      lipStops.push(driveVoiceLevelFrom(el))
    }
  })
  room.on(RoomEvent.Disconnected, () => onState?.('closed'))

  try {
    await room.connect(url, token)
    // Microfon cu anulare de ecou/zgomot — fără ea, vocea agentului redată în
    // difuzor s-ar întoarce în microfon și ar declanșa barge-in la nesfârșit.
    const mic = await createLocalAudioTrack({ echoCancellation: true, noiseSuppression: true, autoGainControl: true })
    await room.localParticipant.publishTrack(mic)
  } catch (e) {
    try {
      await room.disconnect()
    } catch {
      /* best-effort */
    }
    onState?.('error', String(e).slice(0, 120))
    throw e
  }

  onState?.('live')

  return {
    async stop() {
      for (const s of lipStops) {
        try {
          s()
        } catch {
          /* best-effort */
        }
      }
      lipStops.length = 0
      for (const el of audioEls) {
        try {
          el.pause()
          el.remove()
        } catch {
          /* best-effort */
        }
      }
      audioEls.length = 0
      try {
        await room.disconnect()
      } catch {
        /* best-effort */
      }
      onState?.('closed')
    },
  }
}
