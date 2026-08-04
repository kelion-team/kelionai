// ── VOCEA UNIFICATĂ — UN SINGUR MODEL GEMINI LIVE FACE TOT (4 aug 2026) ──────
//
// Adrian: „un singur AI, voce masculină, face tot" (aude full-duplex + gândește
// + vorbește + unelte). Confirmat la sursa oficială Google (Live API) ȘI măsurat
// pe cheia ownerului: modelul `gemini-3.1-flash-live-preview` acceptă, într-o
// SINGURĂ sesiune bidiGenerateContent:
//   • audio de INTRARE în flux (PCM16 16kHz) — te aude live, cu barge-in;
//   • audio de IEȘIRE (PCM 24kHz) — îți vorbește CU voce masculină (Puck…);
//   • transcriere pe AMBELE sensuri (ce zici tu + ce zice el);
//   • function calling — poate chema uneltele lui Kelion în timp ce vorbește.
//
// De ce izolat, într-un modul nou: calea vocală ACTUALĂ (Chirp urechi + creier
// /api/chat + Chirp 3 HD gură) rămâne NEATINSĂ până la comutare — nimic din ce
// merge azi nu se strică. Ăsta e MOTORUL; ruta WS + frontendul îl leagă separat.
//
// Onestitate: orice eroare urcă NUMITĂ prin onEroare — niciun „merge" prefăcut.

import WebSocket from 'ws'
import { config } from '../config.js'

// MODELUL Live. NU există „3.6 Live" (Google n-a scos unul — măsurat: 3.6 e
// refuzat pe bidiGenerateContent). Owner (4 aug): „fără 3.1" → folosim
// native-audio (dec. 2025): voce NATURALĂ (emoție/ton) + apel de unealtă
// NON_BLOCKING (Kelion vorbește în timp ce unealta rulează). Pe variabilă
// (VOCAL_LIVE_MODEL) → o linie de schimbat când Google scoate un Live mai nou.
export const VOCAL_LIVE_MODEL = process.env.VOCAL_LIVE_MODEL || 'gemini-2.5-flash-native-audio-preview-12-2025'
// Voce MASCULINĂ implicită (măsurat: acceptată). Owner o poate schimba din env
// (Puck / Charon / Fenrir / Orus sunt toate acceptate) după ce o ascultă.
export const VOCAL_LIVE_VOICE = process.env.VOCAL_LIVE_VOICE || 'Charon'

const WS_URL = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent'

/** O unealtă pe care modelul o poate chema în timpul conversației vocale. */
export interface UnealtaVocala {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface VocalLiveEvenimente {
  /** Sesiunea e gata (setupComplete de la server). */
  onGata?(): void
  /** Cadru de audio de la Kelion (gura), PCM 24kHz base64 — de redat în browser. */
  onAudioIesire(base64pcm24: string): void
  /** Transcrierea a ce AUDE (userul), în flux. */
  onTranscriereUser(text: string, final: boolean): void
  /** Transcrierea a ce SPUNE Kelion, în flux. */
  onTranscriereKelion(text: string, final: boolean): void
  /** Modelul cere o unealtă. Apelantul o execută și cheamă `raspundeUnealta`. */
  onUnealta(apel: { id: string; name: string; args: Record<string, unknown> }): void
  /** Kelion a fost întrerupt (barge-in) — oprește redarea imediat. */
  onIntrerupt?(): void
  /** Sfârșit de tură (Kelion a terminat de vorbit). */
  onTuraGata?(): void
  /** Orice eroare, NUMITĂ. */
  onEroare(motiv: string): void
}

export interface VocalLive {
  /** Trimite audio de la microfon: PCM16 mono 16kHz (base64 sau Buffer). */
  scrieAudio(pcm: Buffer): void
  /** Răspunde la un apel de unealtă, cu rezultatul (obiect JSON). */
  raspundeUnealta(id: string, name: string, rezultat: unknown): void
  /** Închide sesiunea. */
  inchide(): void
}

export function vocalLiveDisponibila(): boolean {
  return Boolean(config.geminiKey)
}

/** Construiește mesajul de setup al sesiunii Live. PUR (fără WS), exportat ca să
 *  fie probat: e inima contractului cu Google și nu vreau să-l verific „pe
 *  încredere". `instructiune` = persona lui Kelion; `unelte` = ce poate chema. */
export function construiesteSetup(
  model: string,
  voce: string,
  instructiune: string,
  unelte: UnealtaVocala[],
): Record<string, unknown> {
  const setup: Record<string, unknown> = {
    model: `models/${model}`,
    generationConfig: {
      // Modelele Live moderne cer AUDIO ca modalitate de RĂSPUNS (măsurat: cu
      // TEXT dau cod 1007). Vocea = prebuiltVoiceConfig.voiceName (masculină).
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voce } } },
    },
    // Transcrierea pe AMBELE sensuri — pentru istoric + subtitrări în UI.
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    systemInstruction: { parts: [{ text: instructiune }] },
  }
  if (unelte.length) {
    setup.tools = [{ functionDeclarations: unelte.map((u) => ({ name: u.name, description: u.description, parameters: u.parameters })) }]
  }
  return { setup }
}

/** Interpretează UN cadru de la server. PUR, exportat pentru probe. Întoarce o
 *  listă de evenimente normalizate (poate fi goală). */
export function interpreteazaCadru(m: Record<string, unknown>): Array<
  | { fel: 'gata' }
  | { fel: 'audio'; data: string }
  | { fel: 'user'; text: string; final: boolean }
  | { fel: 'kelion'; text: string; final: boolean }
  | { fel: 'unealta'; id: string; name: string; args: Record<string, unknown> }
  | { fel: 'intrerupt' }
  | { fel: 'turaGata' }
> {
  const ev: ReturnType<typeof interpreteazaCadru> = []
  if (m.setupComplete !== undefined) ev.push({ fel: 'gata' })

  const sc = m.serverContent as
    | {
        inputTranscription?: { text?: string }
        outputTranscription?: { text?: string }
        modelTurn?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }> }
        turnComplete?: boolean
        interrupted?: boolean
      }
    | undefined
  if (sc) {
    const it = sc.inputTranscription?.text
    if (it) ev.push({ fel: 'user', text: it, final: Boolean(sc.turnComplete) })
    const ot = sc.outputTranscription?.text
    if (ot) ev.push({ fel: 'kelion', text: ot, final: Boolean(sc.turnComplete) })
    for (const p of sc.modelTurn?.parts ?? []) {
      const d = p.inlineData?.data
      if (d && /audio/i.test(p.inlineData?.mimeType ?? '')) ev.push({ fel: 'audio', data: d })
    }
    if (sc.interrupted) ev.push({ fel: 'intrerupt' })
    if (sc.turnComplete) ev.push({ fel: 'turaGata' })
  }

  const tc = m.toolCall as { functionCalls?: Array<{ id?: string; name?: string; args?: Record<string, unknown> }> } | undefined
  for (const f of tc?.functionCalls ?? []) {
    ev.push({ fel: 'unealta', id: String(f.id ?? f.name ?? ''), name: String(f.name ?? ''), args: (f.args ?? {}) as Record<string, unknown> })
  }
  return ev
}

/** Deschide o sesiune vocală unificată. Întoarce null doar fără cheie — orice
 *  altă problemă vine prin ev.onEroare, numită. */
export function deschideVocalLive(
  instructiune: string,
  unelte: UnealtaVocala[],
  ev: VocalLiveEvenimente,
): VocalLive | null {
  if (!config.geminiKey) return null
  const ws = new WebSocket(`${WS_URL}?key=${config.geminiKey}`)
  let gata = false
  let inchisa = false
  const coada: Buffer[] = [] // audio sosit înainte de setupComplete

  const trimiteAudio = (pcm: Buffer): void => {
    try {
      ws.send(JSON.stringify({ realtimeInput: { audio: { data: pcm.toString('base64'), mimeType: 'audio/pcm;rate=16000' } } }))
    } catch {
      /* eroarea reală vine pe canalul 'error' */
    }
  }

  ws.on('open', () => {
    try {
      ws.send(JSON.stringify(construiesteSetup(VOCAL_LIVE_MODEL, VOCAL_LIVE_VOICE, instructiune, unelte)))
    } catch (e) {
      ev.onEroare(`setup: ${String((e as Error)?.message ?? e).slice(0, 160)}`)
    }
  })

  ws.on('message', (data: Buffer) => {
    let m: Record<string, unknown>
    try {
      m = JSON.parse(data.toString('utf8'))
    } catch {
      return
    }
    for (const e of interpreteazaCadru(m)) {
      switch (e.fel) {
        case 'gata':
          gata = true
          for (const b of coada.splice(0)) trimiteAudio(b)
          ev.onGata?.()
          break
        case 'audio':
          ev.onAudioIesire(e.data)
          break
        case 'user':
          ev.onTranscriereUser(e.text, e.final)
          break
        case 'kelion':
          ev.onTranscriereKelion(e.text, e.final)
          break
        case 'unealta':
          ev.onUnealta({ id: e.id, name: e.name, args: e.args })
          break
        case 'intrerupt':
          ev.onIntrerupt?.()
          break
        case 'turaGata':
          ev.onTuraGata?.()
          break
      }
    }
  })

  ws.on('error', (e: Error) => {
    if (!inchisa) ev.onEroare(`vocal_ws: ${String(e?.message ?? e).slice(0, 200)}`)
  })
  ws.on('close', (cod: number, motiv: Buffer) => {
    if (inchisa) return
    ev.onEroare(`vocal_inchis: cod ${cod} ${motiv.toString('utf8').slice(0, 160)}`)
  })

  return {
    scrieAudio(pcm: Buffer): void {
      if (inchisa) return
      if (!gata) {
        coada.push(pcm)
        if (coada.length > 200) coada.shift() // plafon ~20s
        return
      }
      trimiteAudio(pcm)
    },
    raspundeUnealta(id: string, name: string, rezultat: unknown): void {
      if (inchisa) return
      try {
        ws.send(JSON.stringify({ toolResponse: { functionResponses: [{ id, name, response: { result: rezultat } }] } }))
      } catch {
        /* eroarea reală vine pe canalul 'error' */
      }
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
