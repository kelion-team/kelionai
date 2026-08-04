// ── URECHEA LIVE GEMINI — full-duplex, ultra-rapid (4 aug 2026) ──────────────
//
// Adrian: „am cerut auzul pe Gemini … full duplex ultra rapid". Asta e exact
// Gemini Live API: un WebSocket bidirecțional către generativelanguage
// (BidiGenerateContent) — audio-ul curge în timp real, iar serverul întoarce
// TRANSCRIEREA intrării în flux (inputTranscription), cu detecție de activitate
// vocală făcută de model. Cheia: GEMINI_API_KEY — fără cont de serviciu, fără
// IAM, fără Chirp.
//
// Rolul acestui serviciu: DOAR urechea (audio → text). Nu cerem modelului să
// răspundă — responseModalities TEXT + un prompt care îi spune să tacă; noi
// consumăm doar inputTranscription. Maparea pe contractul WS al clientului
// (partial/final/speech_begin/speech_end) o face asr-stream.ts.
//
// Onestitate: orice eroare urcă NUMITĂ prin onEroare — niciun „merge" prefăcut.

import WebSocket from 'ws'
import { config } from '../config.js'

// Modelul Live (jumătatea-flash e cea rapidă). Suprascriibil prin env fără
// deploy de cod — numele modelelor Live se mai schimbă.
const MODEL_LIVE = process.env.GEMINI_LIVE_MODEL || 'gemini-1.5-flash'

export interface UrecheLive {
  /** PCM16 mono 16kHz, exact ce trimite browserul pe /api/asr-stream. */
  scrieAudio(pcm: Buffer): void
  inchide(): void
}

export interface UrecheLiveEvenimente {
  onPartial(text: string): void
  onFinal(text: string): void
  onVorbireIncepe(): void
  onVorbireSeTermina(): void
  onEroare(motiv: string): void
}

export function urecheLiveDisponibila(): boolean {
  return Boolean(config.geminiKey)
}

/** Deschide o sesiune Live cu transcrierea intrării. Întoarce null doar fără
 *  cheie — orice altă problemă vine prin onEroare, numită. */
export function deschideUrecheaLive(langHint: string, ev: UrecheLiveEvenimente): UrecheLive | null {
  if (!config.geminiKey) return null
  const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${config.geminiKey}`
  const ws = new WebSocket(url)
  let gata = false // setup confirmat de server
  let inchisa = false
  let transcrierePartiala = ''
  const coadaAudio: Buffer[] = [] // audio sosit înainte de setupComplete

  ws.on('open', () => {
    ws.send(
      JSON.stringify({
        setup: {
          model: `models/${MODEL_LIVE}`,
          generationConfig: { responseModalities: ['TEXT'] },
          // Urechea propriu-zisă: serverul transcrie ce AUDE, în flux.
          inputAudioTranscription: {},
          systemInstruction: {
            parts: [
              {
                text:
                  'You are a transcription-only listener. NEVER reply, NEVER comment. Stay silent.' +
                  (langHint ? ` The speaker uses language: ${langHint}.` : ''),
              },
            ],
          },
        },
      }),
    )
  })

  ws.on('message', (data: Buffer) => {
    let m: {
      setupComplete?: unknown
      serverContent?: {
        inputTranscription?: { text?: string }
        turnComplete?: boolean
        interrupted?: boolean
      }
    }
    try {
      m = JSON.parse(data.toString('utf8'))
    } catch {
      return
    }
    if (m.setupComplete !== undefined) {
      gata = true
      for (const b of coadaAudio.splice(0)) trimite(b)
      return
    }
    const sc = m.serverContent
    if (!sc) return
    const bucata = sc.inputTranscription?.text ?? ''
    if (bucata) {
      if (!transcrierePartiala) ev.onVorbireIncepe()
      transcrierePartiala += bucata
      ev.onPartial(transcrierePartiala)
    }
    // Sfârșitul turei de vorbire (VAD-ul modelului): ce s-a strâns devine FINAL.
    if (sc.turnComplete || sc.interrupted) {
      const text = transcrierePartiala.trim()
      transcrierePartiala = ''
      ev.onVorbireSeTermina()
      if (text) ev.onFinal(text)
    }
  })

  ws.on('error', (e: Error) => {
    if (!inchisa) ev.onEroare(`live_ws: ${String(e?.message ?? e).slice(0, 200)}`)
  })
  ws.on('close', (cod: number, motiv: Buffer) => {
    if (inchisa) return
    // Închiderea neanunțată (cotă, model inexistent, cheie) e o eroare NUMITĂ —
    // asr-stream decide plasa (rafale), nu murim tăcut.
    ev.onEroare(`live_inchis: cod ${cod} ${motiv.toString('utf8').slice(0, 160)}`)
  })

  const trimite = (pcm: Buffer): void => {
    try {
      ws.send(
        JSON.stringify({
          realtimeInput: { audio: { data: pcm.toString('base64'), mimeType: 'audio/pcm;rate=16000' } },
        }),
      )
    } catch {
      /* eroarea reală vine pe canalul 'error' al ws-ului */
    }
  }

  return {
    scrieAudio(pcm: Buffer): void {
      if (inchisa) return
      if (!gata) {
        coadaAudio.push(pcm)
        if (coadaAudio.length > 200) coadaAudio.shift() // plafon: ~20s, nu memorie infinită
        return
      }
      trimite(pcm)
    },
    inchide(): void {
      inchisa = true
      try {
        ws.close()
      } catch {
        /* deja închis */
      }
    },
  }
}
