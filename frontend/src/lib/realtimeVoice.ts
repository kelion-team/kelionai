// ── LIVE VOICE — GOOGLE-ONLY (Chirp 3 ears + Gemini brain + Chirp 3 HD mouth) ─
// OPENAI SCOS COMPLET DIN VOCE (Adrian, 3 aug: „OpenAI scos din toată
// aplicația"). Nu se mai deschide NICIO sesiune WebRTC OpenAI, nici rezervă.
// Sesiunea vocală rulează integral pe Google + Gemini:
//
//   • EARS — Google Chirp 3 streaming (/api/asr-stream, lib/micStream.ts).
//     Fiecare frază închisă pleacă prin onPhrase(text, features, audio) →
//     poarta comună → onAddressed → send() → /api/chat, EXACT ca un mesaj
//     tastat. Audio-ul BRUT al frazei (WAV 16k) merge nativ la creierul Gemini
//     (câmpul `audio`) — Gemini AUDE vocea; poarta de timbru a proprietarului
//     funcționează FĂRĂ text.
//   • BRAIN — creierul unic (pipeline-ul /api/chat), la fel ca la scris.
//   • MOUTH — sinteza o face SERVERUL (Google TTS Chirp 3 HD) și sosește ca
//     cadre {audio}, redate de ChatPanel prin playVoice (audioIO). Handle-ul e
//     marcat `guraChirp: true` ca panoul să NU-l trateze isRealtime (altfel
//     cadrele {audio} ar fi suprimate și serverul ar opri sinteza).
//
// Când urechile Chirp NU sunt disponibile (serverul n-are streaming STT), NU
// deschidem OpenAI: aruncăm o eroare clară, iar ChatPanel cade pe propria cale
// nativă Gemini (dictare locală-VAD + WAV → /api/chat). Zero OpenAI, oriunde.

import { stopVoice, type VoiceFeatures } from './audioIO'
import { startMicStream, marcheazaUrechiChirpMoarte, type MicStreamHandle } from './micStream'

export type RealtimeVoiceState = 'connecting' | 'live' | 'error' | 'closed'

export interface RealtimeVoiceHandle {
  /**
   * true MEREU acum (voce Google-only): urechi Chirp 3 + vocea serverului
   * (Chirp 3 HD) sosită ca {audio}. ChatPanel citește flag-ul și NU marchează
   * handle-ul isRealtime — cadrele {audio} SUNT vocea lui Kelion (trebuie
   * redate, iar serverul trebuie să le sintetizeze în continuare).
   */
  guraChirp?: boolean
  stop: () => void
  setMuted: (muted: boolean) => void
  /** Întrerupe imediat vorbirea lui Kelion (barge-in manual). */
  interrupt: () => void
  /**
   * Vocea o rostește SERVERUL (cadre {audio}). speak() doar urmărește
   * întrebările din replică pentru a deschide fereastra de un răspuns —
   * nu trimite nimic nicăieri.
   */
  speak: (text: string) => void
  /** Taie ce se rostește acum (barge-in / STOP / o tură înlocuită). */
  stopSpeaking: () => void
}

export interface RealtimeVoiceOpts {
  /** Limba curentă (hint). Sursa de adevăr rămâne preferința persistată pe server. */
  language?: string
  onState?: (s: RealtimeVoiceState, note?: string) => void
  /** Transcriptul userului: (text, final). */
  onUserTranscript?: (text: string, final: boolean) => void
  /** Ce spune gura: (text, final) — doar pentru UI; replica creierului deja curge în chat prin send(). */
  onAssistantTranscript?: (text: string, final: boolean) => void
  /**
   * URECHILE → CREIERUL: un transcript final a trecut poarta de nume (userul i-a
   * vorbit lui Kelion). Clientul îl trimite la creierul unic prin send() — identic
   * cu un mesaj tastat. `vf` = amprenta vocală a rostirii (verificare speaker);
   * `audio` = vocea BRUTĂ a frazei (WAV), pe care Gemini o aude nativ.
   */
  onAddressed?: (text: string, vf: VoiceFeatures | null, speaker?: string, audio?: string) => void
  /** VAD-ul a auzit început de vorbire cât Kelion tăcea (barge-in / anti-ecou). */
  onSpeechStart?: () => void
  /** GPS de la dispozitiv — păstrat pentru compatibilitate (contextul îl citește creierul la nevoie). */
  coords?: { lat: number; lon: number }
  signal?: AbortSignal
}

// ── THE VOICE VERDICT (one POST per utterance) ──────────────────────────────
// Serverul compară amprenta rostirii cu referința proprietarului și spune CINE
// vorbește:
//   • holder          → tura merge la creier (și lacătul de admin se poate
//                       deschide — kelion:admin-unlock);
//   • foreign + guest → invitat APROBAT (recunoscut după timbru): permis, cu
//                       drepturi de invitat — `speaker` merge la /api/chat;
//   • foreign + guestPending → proprietarul tocmai a deschis o fereastră: permis,
//                       creierul cere proprietarului să confirme păstrarea amprentei;
//   • foreign singur  → IGNORAT COMPLET (femei, bărbați, tv, radio): tura NU
//                       ajunge la creier, nu se spune nimic, nu se arată nimic.
// Tura AȘTEAPTĂ acest verdict — înainte de el, nimic nu pleacă la creier.
export interface TranscriptVerdict {
  lang?: string
  foreignVoice?: boolean
  adminUnlocked?: boolean
  // PROPRIETAR VERIFICAT: serverul a confirmat că vocea CHIAR e a proprietarului
  // acestui cont (referință + potrivire). Doar atunci lăsăm vocea la creier FĂRĂ
  // „Kelion" (full-duplex real, doar pentru user/admin).
  holder?: boolean
  guest?: { id: number; name: string; relation: string }
  guestPending?: { id: number; name: string; relation: string }
}
async function transcriptVerdict(
  text: string,
  vf: VoiceFeatures | null,
  audio?: string,
): Promise<TranscriptVerdict | null> {
  const t = text.trim()
  // AMPRENTĂ NEURALĂ (Adrian, 6 aug): pe VOCE fraza n-are text (t gol), dar are
  // AUDIO brut — îl trimitem oricum, ca SERVERUL să calculeze amprenta neurală
  // (înrolare + recunoaștere robustă la răgușeală). Înainte ieșea aici pe text gol,
  // deci verdictul de timbru nici nu se cerea pe voce. Trimitem dacă avem ORICE:
  // text, audio sau amprenta clasică.
  if (!t && !audio && !vf?.vector?.length) return null
  try {
    const r = await fetch('/api/realtime/transcript', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ role: 'user', text: t, voiceFeatures: vf ?? undefined, audio: audio || undefined }),
    })
    return (await r.json().catch(() => null)) as TranscriptVerdict | null
  } catch {
    return null
  }
}

// ── ONE SINGLE VOICE SESSION, ACROSS ALL TABS ────────────────────────────────
// Două sesiuni în paralel (un tab vechi lăsat deschis, un restart într-o cursă)
// = urechi duble. Gardă dublă: (1) singleton per-tab — o sesiune nouă OPREȘTE
// precedenta; (2) BroadcastChannel între taburi — sesiunea nouă le închide pe
// celelalte.
let activeVoice: { stop: () => void } | null = null
const VOICE_BC = 'kelion-voice'
const voiceSessionId = (): string => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
let voiceBc: BroadcastChannel | null = null
try {
  voiceBc = new BroadcastChannel(VOICE_BC)
} catch {
  voiceBc = null /* browser vechi — gardă per-tab rămâne */
}

/**
 * Pornește sesiunea vocală urechi+gură pe Google/Gemini (fără OpenAI).
 * Aruncă dacă microfonul e refuzat sau urechile Chirp nu sunt disponibile
 * (caz în care ChatPanel cade pe dictarea nativă Gemini).
 */
export async function startRealtimeVoice(
  opts: RealtimeVoiceOpts = {},
): Promise<RealtimeVoiceHandle> {
  const { onState, onUserTranscript, onAddressed, onSpeechStart, signal } = opts
  onState?.('connecting')

  // Orice sesiune anterioară din ACEST tab moare înainte să pornească alta.
  activeVoice?.stop()
  activeVoice = null
  // Anunță celelalte taburi: sesiunea vocală e AICI de acum.
  const myId = voiceSessionId()
  voiceBc?.postMessage({ takeover: myId })

  let closed = false
  const cleanups: (() => void)[] = []

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
    onState?.('closed')
  }

  // „Shadow" handle pentru singleton: există înainte de return, ca stop() să
  // poată curăța referința globală pe orice cale (inclusiv la eroare).
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
    // 1) Microfon — cu anulare de ecou/zgomot ca Kelion să nu se audă pe el în buclă.
    const mic = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    })
    cleanups.push(() => mic.getTracks().forEach((t) => t.stop()))

    let chirpEar: MicStreamHandle | null = null
    cleanups.push(() => chirpEar?.stop())

    // ── POARTA (doar TIMBRU → creier) ───────────────────────────────────────
    // Fără STT: fraza vine ca AUDIO brut. Aici rămâne DOAR poarta de TIMBRU (o voce
    // străină neaprobată e ignorată COMPLET — nu ajunge la creier, nu răspunde la
    // TV/străini). Poarta de NUME („Kelion"/„Kei") și fereastra de răspuns au
    // DISPĂRUT de pe client: creierul unic (Gemini 3 Pro) aude fraza și decide
    // SINGUR dacă i se vorbește — sau tace (Adrian, 5 aug: „tot decis de creierul
    // unic; dacă nu aude «Kelion»/«Kei», să nu vorbească neîntrebat"). Un „stop"
    // rostit peste Kelion îl oprește prin barge-in-ul local (mai jos).
    let anchoredLang = ''
    const poartaDupaFraza = (vf: VoiceFeatures | null, audio?: string): void => {
      void (async () => {
        // Verificarea vorbitorului merge FĂRĂ text (amprenta e din voiceFeatures) —
        // serverul întoarce holder/foreignVoice/guest/adminUnlocked din timbru.
        const verdict = await transcriptVerdict('', vf, audio)
        if (verdict?.lang && verdict.lang !== anchoredLang) anchoredLang = verdict.lang
        // LACĂTUL DE ADMIN: amprenta s-a potrivit → serverul a pus cookie-ul de
        // unlock; anunțăm UI-ul să aprindă butonul Admin.
        if (verdict?.adminUnlocked) window.dispatchEvent(new Event('kelion:admin-unlock'))
        // NU MAI ARUNCĂM TĂCUT O VOCE „STRĂINĂ" (Adrian, 6 aug: „nu merge nici măcar
        // să audă; la altcineva merge foarte bine"). CAUZA: o amprentă vocală VECHE a
        // proprietarului care nu se mai potrivește îl clasifica `foreignVoice` și-i
        // arunca fraza ÎNAINTE de creier — la un om NOU (fără amprentă) mergea, la el
        // NU. Acum vocea nevalidată AJUNGE la creier (care oricum decide pe „Kelion"/
        // „Kei"), dar marcată `nevalidat` → serverul îi PROTEJEAZĂ datele sensibile
        // (fără puteri de admin; cardul rămâne gardat de potrivirea reală holder). Un
        // invitat aprobat/în așteptare merge pe eticheta lui de guest, ca înainte.
        const guest = verdict?.guest ?? verdict?.guestPending
        const nevalidat = !!verdict?.foreignVoice && !guest
        const speaker = verdict?.guest
          ? `guest:${verdict.guest.id}:${verdict.guest.name}${verdict.guest.relation ? ` (${verdict.guest.relation})` : ''}`
          : verdict?.guestPending
            ? `guest-pending:${verdict.guestPending.id}:${verdict.guestPending.name}${verdict.guestPending.relation ? ` (${verdict.guestPending.relation})` : ''}`
            : nevalidat
              ? 'nevalidat'
              : undefined
        // La creier pleacă AUDIO-ul; creierul decide adresarea. Fără audio nu are
        // ce decide, deci nu-l chemăm.
        if (!audio) return
        onAddressed?.('', vf, speaker, audio)
      })()
    }

    // ── THE ONE CHIRP EAR ────────────────────────────────────────────────────
    // Urechea Chirp: PCM → /api/asr-stream → finaluri. Finalurile curg prin
    // poartaDupaTranscript (aceeași poartă), iar vocea BRUTĂ a frazei (audio)
    // merge nativ la Gemini. onSpeechBegin = barge-in (anti-ecou la caller).
    // Dacă urechea moare mid-sesiune o marcăm și închidem — următorul start
    // re-sondează (cooldown), nu intră în buclă.
    const ear = await startMicStream({
      preWarmedStream: mic,
      onLive: (t) => onUserTranscript?.(t, false),
      onPhrase: (_t, vf, audio) => {
        // Fără transcript — fraza pleacă la creier ca AUDIO; poarta de timbru decide
        // dacă ajunge acolo, apoi creierul decide dacă i se vorbește.
        poartaDupaFraza(vf, audio)
      },
      onError: (reason) => {
        if (closed) return
        console.error(`[voce] urechea Chirp a murit (${reason}) — sesiunea se închide (fără OpenAI)`)
        marcheazaUrechiChirpMoarte()
        stop()
        onState?.('error', `urechi-chirp-${reason}`)
      },
      getLang: () => anchoredLang || opts.language || '',
      // Barge-in: vocea ta taie redarea Chirp a serverului pe loc + trezește UI-ul.
      onSpeechBegin: () => {
        stopVoice()
        onSpeechStart?.()
      },
      // BARGE-IN LOCAL: cât Kelion vorbește, urechea e mută (anti-ecou), deci
      // serverul nu trimite speech_begin — detecția locală din micStream taie AICI.
      onBargeIn: () => {
        stopVoice()
        onSpeechStart?.()
      },
      storePendingFeatures: false,
    })
    if (!ear) {
      // Urechile Chirp nu sunt disponibile (serverul n-are streaming STT). NU
      // deschidem OpenAI: aruncăm, iar ChatPanel cade pe dictarea nativă Gemini
      // (local-VAD + WAV → /api/chat). Un start eșuat e numărat de panou.
      throw new Error('chirp_ear_unavailable')
    }
    chirpEar = ear
    // GAURA C (auditul din 4 Aug): dacă o eroare a sosit și a închis sesiunea în
    // fereastra dintre 'live' și instalarea handle-ului în panou, handle-ul mort
    // se instala totuși — surd, cu punctul roșu aprins, fără niciun retry. Un
    // handle deja închis nu se mai predă niciodată: aruncăm, panoul numără și
    // reprogramează pornirea.
    if (closed) throw new Error('voice_session_closed')
    onState?.('live')
    console.info('[voce] urechi Chirp 3 (Google) + creier Gemini + gura Chirp 3 HD a serverului — fără OpenAI')
    return {
      guraChirp: true,
      stop,
      // Microfonul aparține urechii Chirp — mute acolo (nu există senderi WebRTC).
      setMuted: (muted: boolean) => {
        chirpEar?.setMuted(muted)
      },
      // Barge-in manual: taie redarea Chirp a serverului acum.
      interrupt: () => stopVoice(),
      // Vocea o rostește serverul ({audio}). Fereastra de răspuns a dispărut —
      // creierul unic decide singur, din audio, dacă i se răspunde. speak() rămâne
      // no-op (ChatPanel îl cheamă pe calea veche a gurii; nu mai are ce urmări).
      speak: (_text: string) => {},
      stopSpeaking: () => stopVoice(),
    }
  } catch (e) {
    stop()
    // NU chemăm onState('error') aici — aruncăm, iar catch-ul din ChatPanel
    // numără el însuși eșecul de start (evită dubla numărare).
    throw e
  }
}
