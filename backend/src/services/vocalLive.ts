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
export const VOCAL_LIVE_MODEL = process.env.VOCAL_LIVE_MODEL || 'gemini-3.1-flash-live-preview'
// MĂSURAT 7 aug pe cheia ownerului, de pe VPS (scripts/proba-modele.py, faza 3 —
// sesiune bidi reală, cu AUDIO cerut corect; „KB" = voce chiar emisă, nu doar o
// conexiune deschisă):
//   gemini-3.1-flash-live-preview                  90 ms handshake |  491 ms primul răspuns | unelte DA | 66 KB
//   gemini-2.5-flash-native-audio-preview-12-2025  77 ms handshake |  775 ms primul răspuns | unelte DA | 65 KB
//   gemini-2.5-flash-native-audio-preview-09-2025  92 ms handshake |  871 ms primul răspuns | unelte DA | 65 KB
//   gemini-2.5-flash-native-audio-latest           92 ms handshake |  915 ms primul răspuns | unelte DA | 65 KB
// Adrian a ales 3.1 pe cifra asta (284 ms mai repede la primul cuvânt), ridicând
// explicit refuzul lui din 4 aug („fără 3.1").
//
// CE NU AM MĂSURAT, și trebuie spus: proba a măsurat LATENȚA și faptul că iese
// voce cu unelte — NU cât de natural SUNĂ. Familiile diferă prin construcție:
// `native-audio` scoate vocea direct din model (intonație/emoție) și cheamă
// uneltele NON_BLOCKING (vorbește în timp ce unealta rulează), pe când familia
// `live` trece prin sinteză, deci sună mai plat. Diferența aia se judecă doar cu
// urechea, pe live — de-aia modelul stă pe env (`VOCAL_LIVE_MODEL`): o valoare
// schimbată și o repornire, fără atins codul, dacă vocea nu-i place.
// Voce MASCULINĂ implicită (măsurat: acceptată). Owner o poate schimba din env
// (Puck / Charon / Fenrir / Orus sunt toate acceptate) după ce o ascultă.
export const VOCAL_LIVE_VOICE = process.env.VOCAL_LIVE_VOICE || 'Charon'

/** ── INSTRUCȚIUNEA SESIUNII LIVE, CU MEMORIA OMULUI (8 aug, „execută cu
 *  Gemini") ─────────────────────────────────────────────────────────────────
 *  Sesiunea Live pornește de la zero la fiecare deschidere — fără blocul ăsta,
 *  Kelion ar fi un străin politicos la fiecare apăsare de microfon. PURĂ și
 *  exportată: contractul cu memoria se probează, nu se ia pe încredere. */
export function construiesteInstructiune(
  persona: string,
  numeUser: string,
  istoric: Array<{ role: string; content: string }>,
): string {
  let instructiune = `${persona}\nVorbești cu ${numeUser}.`
  if (istoric.length) {
    const randuri = istoric
      .slice(-12) // ultimele schimburi, nu toată arhiva — sesiunea vocală e vie, nu bibliotecă
      .map((r) => `${r.role === 'user' ? numeUser : 'Kelion'}: ${String(r.content).slice(0, 200)}`)
      .join('\n')
    instructiune +=
      `\n\nULTIMELE VOASTRE SCHIMBURI (context, nu de recitat — continuă natural de unde ați rămas):\n` +
      randuri.slice(0, 2400)
  }
  return instructiune
}

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
  reluareHandle?: string,
): Record<string, unknown> {
  const setup: Record<string, unknown> = {
    model: `models/${model}`,
    // ── RELUAREA SESIUNII (8 aug: „a funcționat 5 minute impecabil, după care
    // a amuțit") ─────────────────────────────────────────────────────────────
    // Sesiunile Live au limită de durată la Google. Fără blocul ăsta, la limită
    // sesiunea moare sec, reluările de la zero pot fi refuzate, iar vocea cade
    // pe calea veche. Cu el, serverul primește un HANDLE de reluare
    // (sessionResumptionUpdate) și un preaviz de închidere (goAway) — și
    // redeschide sesiunea CU CONTEXT, transparent pentru browser.
    sessionResumption: reluareHandle ? { handle: reluareHandle } : {},
    // „SĂ FIE NO LIMIT" (Adrian, 8 aug): a doua limită, pe lângă durata
    // conexiunii, e umplerea contextului — sesiunea moare când conversația
    // devine prea lungă. Fereastra glisantă e mecanismul oficial Google pentru
    // sesiuni de durată NELIMITATĂ: contextul vechi se comprimă din mers, în
    // loc să omoare sesiunea. Împreună cu reluarea pe handle, singurele limite
    // rămase sunt cele fizice (rețeaua ta, cheia ta).
    contextWindowCompression: { slidingWindow: {} },
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
  | { fel: 'handleReluare'; handle: string }
  | { fel: 'preavizInchidere'; msRamase?: number }
> {
  const ev: ReturnType<typeof interpreteazaCadru> = []
  if (m.setupComplete !== undefined) ev.push({ fel: 'gata' })

  // Handle-ul de reluare: Google îl împinge periodic; îl ținem pe cel mai nou
  // ca redeschiderea să continue ACEEAȘI conversație, nu una de la zero.
  const sru = m.sessionResumptionUpdate as { resumable?: boolean; newHandle?: string } | undefined
  if (sru?.resumable && sru.newHandle) ev.push({ fel: 'handleReluare', handle: sru.newHandle })

  // Preavizul de închidere: Google spune CÂND taie. Redeschidem ÎNAINTE.
  const ga = m.goAway as { timeLeft?: string } | undefined
  if (ga !== undefined) {
    const ms = ga?.timeLeft ? Math.max(0, Math.round(parseFloat(ga.timeLeft) * 1000)) : undefined
    ev.push({ fel: 'preavizInchidere', msRamase: ms })
  }

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

  // ── SESIUNEA CARE SUPRAVIEȚUIEȘTE LIMITEI (8 aug: „a funcționat 5 minute
  // impecabil, după care a amuțit") ─────────────────────────────────────────
  // Google închide sesiunile Live la limită de durată. Înainte, închiderea aia
  // urca drept EROARE, browserul relua de la zero de 3 ori și cădea pe calea
  // veche. Acum reconectarea e AICI, în motor: ținem handle-ul de reluare pe
  // care Google îl împinge periodic, iar la preaviz (goAway) sau la închidere
  // redeschidem cu ACELAȘI handle — conversația continuă de unde era, browserul
  // nu află nimic. Doar când și reluarea pică de 3 ori la rând urcă eroarea.
  let ws: WebSocket | null = null
  let gata = false
  let inchisa = false
  let handleReluare: string | undefined
  let reconectari = 0
  const coada: Buffer[] = [] // audio strâns cât sesiunea nu e gata (și în reconectări)

  const trimiteAudio = (pcm: Buffer): void => {
    try {
      ws?.send(JSON.stringify({ realtimeInput: { audio: { data: pcm.toString('base64'), mimeType: 'audio/pcm;rate=16000' } } }))
    } catch {
      /* eroarea reală vine pe canalul 'error' */
    }
  }

  const conecteaza = (): void => {
    if (inchisa) return
    gata = false
    const socket = new WebSocket(`${WS_URL}?key=${config.geminiKey}`)
    ws = socket

    socket.on('open', () => {
      try {
        socket.send(JSON.stringify(construiesteSetup(VOCAL_LIVE_MODEL, VOCAL_LIVE_VOICE, instructiune, unelte, handleReluare)))
      } catch (e) {
        ev.onEroare(`setup: ${String((e as Error)?.message ?? e).slice(0, 160)}`)
      }
    })

    socket.on('message', (data: Buffer) => {
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
            reconectari = 0 // sesiune vie → contorul intern se șterge
            for (const b of coada.splice(0)) trimiteAudio(b)
            ev.onGata?.()
            break
          case 'handleReluare':
            handleReluare = e.handle
            break
          case 'preavizInchidere':
            // Google taie curând. Nu așteptăm tăierea: închidem noi și
            // redeschidem cu handle-ul — drumul de reconectare e unul singur,
            // prin handlerul de 'close'.
            try {
              socket.close()
            } catch {
              /* deja închis */
            }
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

    socket.on('error', (e: Error) => {
      if (!inchisa && reconectari >= 3) ev.onEroare(`vocal_ws: ${String(e?.message ?? e).slice(0, 200)}`)
    })
    socket.on('close', (cod: number, motiv: Buffer) => {
      if (inchisa || ws !== socket) return
      if (reconectari < 3) {
        reconectari++
        setTimeout(conecteaza, 300 * reconectari)
        return
      }
      // Trei reluări interne picate la rând — abia ASTA e o eroare adevărată.
      ev.onEroare(`vocal_inchis: cod ${cod} ${motiv.toString('utf8').slice(0, 160)} (după ${reconectari} reluări interne)`)
    })
  }

  conecteaza()

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
        ws?.send(JSON.stringify({ toolResponse: { functionResponses: [{ id, name, response: { result: rezultat } }] } }))
      } catch {
        /* eroarea reală vine pe canalul 'error' */
      }
    },
    inchide(): void {
      inchisa = true
      try {
        ws?.close()
      } catch {
        /* deja închis */
      }
    },
  }
}
