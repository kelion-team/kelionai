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
// LECȚIA (5 aug, dovadă din PRODUCȚIE): pe 4 aug am mutat urechea pe
// `native-audio-latest` crezând că „familia native-audio e cea mai bună la
// transcriere" (din docs) — dar NU măsurasem că CHIAR transcrie, doar că se
// conectează pe bidi. Rezultat live: 25 erori „urechea silent" într-o oră —
// jurnalul serverului arată sesiuni care se deschid, primesc 180+ cadre audio
// (16s) și se închid cu ZERO transcriere, fără nicio eroare = MUT, exact ca
// 3.1-flash-live. Regula 1: „cel mai bun din docs" ≠ măsurat că merge. Urechea
// revine pe `preview-12-2025` — versiunea DOVEDITĂ că transcrie (mergea înainte
// de 4 aug; plângerea de-atunci era despre alfabet, adică PRODUCEA text). Un
// model nou intră DOAR după o probă care confirmă `inputTranscription` real, nu
// doar conectarea. DOAR urechea — creierul (BRAIN_*/GEMINI_MODEL) nu se atinge.
const MODEL_LIVE = process.env.GEMINI_LIVE_MODEL || 'gemini-1.5-flash-latest'

// CÂINELE DE PAZĂ AL MUȚENIEI (5 aug — muțenia MĂSURATĂ: Live se conectează,
// primește 180+ cadre (16s), întoarce ZERO transcriere, FĂRĂ nicio eroare, deci
// nimeni nu declara urechea moartă și clientul murea „silent" după 15s, iar
// auzul nu cădea pe rezervă). Acum: dacă a curs audio REAL (≥ MUT_CADRE cadre)
// pe o fereastră de MUT_MS și n-a venit NICIO transcriere, urechea Live e MUTĂ
// → eroare NUMITĂ, iar asr-stream cade pe rezerva Gemini (rafale). O ureche care
// a produs măcar o transcriere e considerată VIE și nu e atinsă niciodată.
const MUT_MS = 8_000
const MUT_CADRE = 40

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
  // Starea câinelui de pază (vezi MUT_MS/MUT_CADRE sus).
  let transcriereVreodata = false // a venit VREODATĂ o transcriere? (dacă da, urechea e vie)
  let audioScris = 0 // câte cadre de audio REAL au plecat spre Live (după setup)
  let primulAudioLa = 0 // când a plecat primul cadru real (ms)
  let watchdog: ReturnType<typeof setInterval> | null = null
  const opresteWatchdog = (): void => {
    if (watchdog) {
      clearInterval(watchdog)
      watchdog = null
    }
  }
  const declaraMuta = (): void => {
    if (inchisa) return
    opresteWatchdog()
    inchisa = true // oprește re-firing pe 'close'
    try {
      ws.close()
    } catch {
      /* deja închis */
    }
    const sec = primulAudioLa ? Math.round((Date.now() - primulAudioLa) / 1000) : 0
    ev.onEroare(`mut: ${audioScris} cadre audio, zero transcriere în ${sec}s — urechea Live nu aude`)
  }

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
                  // BIASING (Adrian, 5 aug — „Kelion" auzit „te rugăm"): numele
                  // asistentului e „Kelion"; scrie-l exact, nu cuvinte asemănătoare.
                  ' The AI assistant is named "Kelion" (a proper noun) — whenever you hear that name, transcribe it EXACTLY as "Kelion", never as similar-sounding words.' +
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
      // Pornește câinele de pază: dacă audio curge dar nu vine nicio transcriere
      // pe fereastra MUT_MS, urechea Live e mută → cădem pe rafale (onEroare).
      if (!watchdog) {
        watchdog = setInterval(() => {
          if (inchisa || transcriereVreodata) return
          if (primulAudioLa && audioScris >= MUT_CADRE && Date.now() - primulAudioLa >= MUT_MS) declaraMuta()
        }, 2_000)
      }
      return
    }
    const sc = m.serverContent
    if (!sc) return
    const bucata = sc.inputTranscription?.text ?? ''
    if (bucata) {
      transcriereVreodata = true // urechea a produs text → e VIE; câinele nu mai latră
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
    opresteWatchdog()
    if (!inchisa) ev.onEroare(`live_ws: ${String(e?.message ?? e).slice(0, 200)}`)
  })
  ws.on('close', (cod: number, motiv: Buffer) => {
    opresteWatchdog()
    if (inchisa) return
    // Închiderea neanunțată (cotă, model inexistent, cheie) e o eroare NUMITĂ —
    // asr-stream decide plasa (rafale), nu murim tăcut.
    ev.onEroare(`live_inchis: cod ${cod} ${motiv.toString('utf8').slice(0, 160)}`)
  })

  const trimite = (pcm: Buffer): void => {
    audioScris += 1 // câinele de pază numără audio-ul REAL trimis
    if (!primulAudioLa) primulAudioLa = Date.now()
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
      opresteWatchdog()
      try {
        ws.close()
      } catch {
        /* deja închis */
      }
    },
  }
}
