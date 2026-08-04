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

// Modelul Live (bidiGenerateContent). Suprascriibil prin env fără deploy —
// numele modelelor Live se schimbă des.
// NOTĂ (4 aug 2026): 'gemini-1.5-*' au fost SCOASE de Google (măsurat: 404, cod
// 1008 „not supported for bidiGenerateContent") → full-duplex era PICAT.
// NU EXISTĂ model „3.6 Live" — Google n-a scos unul (măsurat: 3.6 e refuzat pe
// bidiGenerateContent). Modelele Live de pe cheie: 2.5-native-audio și 3.1.
// Owner (4 aug): „fără 3.1" → urechea rămâne pe 2.5-native-audio (dec. 2025),
// singurul non-3.1. Cere responseModalities:['AUDIO']; citim doar transcrierea.
// URECHEA CEA MAI BUNĂ LA AUZ (Adrian, 4 aug: „care Gemini e cel mai performant
// la auz? pune-l doar pentru auz"). MĂSURAT pe cheia lui — 6 modele cu bidi;
// alesul: `native-audio-latest` = familia native-audio (cea mai bună la
// transcriere, confirmat în docs Google) MEREU la ultima versiune. Pe celelalte
// le-am exclus cu dovadă: 3.1-flash-live = MUT (zero transcriere, măsurat);
// 3.5-live-translate = TRADUCE (schimbă limba — exact ce nu vrem); robotics =
// pentru roboți. Fixul de rezervă rămâne prin env (dacă „latest" regresează
// vreodată, GEMINI_LIVE_MODEL=...-preview-12-2025). DOAR urechea — creierul
// (BRAIN_*/GEMINI_MODEL) nu se atinge.
const MODEL_LIVE = process.env.GEMINI_LIVE_MODEL || 'gemini-2.5-flash-native-audio-latest'

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
// GARDUL DE ALFABET (Adrian, 4 aug: urechea scria românește în greacă/arabă/
// chirilic — „Και όλοι", „Чекався"). Urechea native-audio ghicește limba pe
// audio scurt și scoate alt alfabet. Dacă limba așteptată e LATINĂ și
// transcrierea vine majoritar în alt alfabet, e o greșeală de ureche — o
// aruncăm, nu o arătăm și nu o trimitem la creier.
const LIMBI_NELATINE = /^(ru|uk|bg|sr|mk|be|el|ar|he|fa|ur|hi|bn|ta|th|zh|ja|ko|ka|hy|am)/i
export function alfabetStrain(text: string, langHint: string): boolean {
  if (!langHint || LIMBI_NELATINE.test(langHint)) return false // limba chiar e ne-latină → nu filtrăm
  const litere = text.replace(/[^\p{L}]/gu, '')
  if (litere.length < 2) return false
  const neLatine = litere.replace(/\p{Script=Latin}/gu, '')
  return neLatine.length / litere.length > 0.5
}

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
          // Modelele Live moderne cer AUDIO ca modalitate de RĂSPUNS (măsurat:
          // cu TEXT dau cod 1007). Nouă ne trebuie DOAR urechea, deci îi cerem să
          // tacă (systemInstruction) și consumăm exclusiv `inputTranscription`;
          // eventualul audio de ieșire al modelului e ignorat mai jos.
          generationConfig: { responseModalities: ['AUDIO'] },
          // Urechea propriu-zisă: serverul transcrie ce AUDE, în flux.
          inputAudioTranscription: {},
          systemInstruction: {
            parts: [
              {
                text:
                  'You are a transcription-only listener. NEVER reply, NEVER comment. Stay silent.' +
                  (langHint
                    ? ` The speaker speaks ${langHint}. Transcribe STRICTLY in ${langHint}, using its native alphabet (for Romanian: the Latin alphabet with ă â î ș ț). NEVER transliterate or output Greek, Cyrillic, Arabic, Hebrew, or Han characters.`
                    : ''),
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
      // Nu arătăm în bandă transcrierea în alfabet străin (greacă/chirilic/arabă
      // pe limbă latină) — e ghiceala greșită a urechii, nu ce a spus omul.
      if (!alfabetStrain(transcrierePartiala, langHint)) ev.onPartial(transcrierePartiala)
    }
    // Sfârșitul turei de vorbire (VAD-ul modelului): ce s-a strâns devine FINAL.
    if (sc.turnComplete || sc.interrupted) {
      const text = transcrierePartiala.trim()
      transcrierePartiala = ''
      ev.onVorbireSeTermina()
      // Alfabet străin = mis-transcriere → NU pleacă la creier (altfel ajunge
      // „Чекався" ca mesajul userului). O aruncăm cinstit.
      if (text && !alfabetStrain(text, langHint)) ev.onFinal(text)
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
