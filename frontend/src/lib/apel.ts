// ── MESSENGER KELION↔KELION — CLIENTUL DE PREZENȚĂ + APEL (Adrian, 11 aug) ───────
// Cât ești logat, ținem deschis /api/apel ca să POȚI fi sunat. La un „invite"
// ridicăm interfața de apel primit; la accept/refuz/închidere anunțăm Stage prin
// evenimente `window`. Inițierea („apelează-l pe X") vine din creier (unealta
// apeleaza_user) și ajunge la APELANT ca frame de control {apel} — vezi ChatPanel.
// FAZA 1: sunat + acceptă/refuză + conectat + închide. FAZA 2 (audio + traducere)
// se va releъa tot pe socketul ăsta.

import { playVoice } from './audioIO'
import { pornesteCapturaApel, type CapturaApel } from './apelMic'

let ws: WebSocket | null = null
let pornit = false
let reconnectTimer: number | null = null
// FAZA 2: apelul în care ești ACUM + captura microfonului cât e conectat.
let apelCurent: string | null = null
let captura: CapturaApel | null = null

function urlWs(): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${location.host}/api/apel`
}

function emite(nume: string, detail: unknown): void {
  window.dispatchEvent(new CustomEvent(nume, { detail }))
}

// FAZA 2: cât apelul e conectat, ascultăm microfonul și trimitem frazele la server
// pentru traducere. Suspendarea vocii cu Kelion se face în ChatPanel (pe conectat),
// ca să nu concureze două microfoane.
async function pornesteMic(callId: string): Promise<void> {
  if (captura) return
  captura = await pornesteCapturaApel(
    (audioB64, mime) => {
      if (apelCurent === callId) trimite({ type: 'vorbire', callId, audio: audioB64, mime })
    },
    () => {
      /* microfon indisponibil — măcar auzi ce spune celălalt (tradus) */
    },
  )
}
function opresteMic(): void {
  captura?.opreste()
  captura = null
}

function laMesaj(m: {
  type?: string
  callId?: string
  from?: unknown
  cu?: unknown
  motiv?: string
  text?: string
  audio?: string
  de_la?: string
}): void {
  switch (m.type) {
    case 'gata':
      break // prezența e activă
    case 'invite':
      // Cineva mă sună → Stage arată ecranul „X te sună".
      emite('kelion:apel-intra', { callId: m.callId, from: m.from })
      break
    case 'accepted':
      apelCurent = m.callId ?? null
      if (m.callId) void pornesteMic(m.callId) // Faza 2: pornește captura vocii
      emite('kelion:apel-stare', { stare: 'conectat', callId: m.callId, cu: m.cu })
      break
    case 'declined':
      if (m.callId === apelCurent) {
        opresteMic()
        apelCurent = null
      }
      emite('kelion:apel-stare', { stare: 'refuzat', callId: m.callId })
      break
    case 'hangup':
      if (m.callId === apelCurent) {
        opresteMic()
        apelCurent = null
      }
      emite('kelion:apel-stare', { stare: 'inchis', callId: m.callId, motiv: m.motiv })
      break
    case 'tradus':
      // Ce a spus celălalt, TRADUS în limba mea: îl aud (vocea Chirp) + îl văd
      // (subtitrare). Faza 2 — inima messenger-ului.
      if (m.audio) playVoice(m.audio)
      emite('kelion:apel-tradus', { callId: m.callId, text: m.text, de_la: m.de_la })
      break
    default:
      break
  }
}

/** Deschide (o singură dată) canalul de prezență și-l ține viu cât ești logat.
 *  Idempotent — se poate chema din nou fără să deschidă un al doilea socket. */
export function pornestePrezentaApel(): void {
  if (pornit) return
  pornit = true
  deschide()
}

function deschide(): void {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return
  let s: WebSocket
  try {
    s = new WebSocket(urlWs())
  } catch {
    programeazaReconectare()
    return
  }
  ws = s
  s.onmessage = (ev) => {
    if (typeof ev.data !== 'string') return
    try {
      laMesaj(JSON.parse(ev.data))
    } catch {
      /* mesaj stricat — îl sărim */
    }
  }
  s.onclose = () => {
    if (ws === s) ws = null
    if (pornit) programeazaReconectare()
  }
  s.onerror = () => {
    try {
      s.close()
    } catch {
      /* deja închis */
    }
  }
}

function programeazaReconectare(): void {
  if (reconnectTimer !== null) return
  // Prezența trebuie să revină singură (ca să poți fi sunat după o cădere de rețea
  // sau o repunere din adormire). Reîncercare simplă la 4s.
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null
    if (pornit) deschide()
  }, 4000)
}

function trimite(o: unknown): boolean {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    deschide()
    return false
  }
  try {
    ws.send(JSON.stringify(o))
    return true
  } catch {
    return false
  }
}

/** Cel sunat acceptă apelul. */
export function acceptaApel(callId: string): void {
  trimite({ type: 'accept', callId })
}
/** Cel sunat refuză apelul. */
export function refuzaApel(callId: string): void {
  trimite({ type: 'decline', callId })
}
/** Oricare parte închide apelul. Serverul anunță DOAR cealaltă parte, deci cel
 *  care închide își oprește singur microfonul + starea local. */
export function inchideApel(callId: string): void {
  trimite({ type: 'hangup', callId })
  if (callId === apelCurent) {
    opresteMic()
    apelCurent = null
  }
}

/** Închide canalul de prezență (la delogare). */
export function oprestePrezentaApel(): void {
  pornit = false
  opresteMic()
  apelCurent = null
  if (reconnectTimer !== null) {
    window.clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  try {
    ws?.close()
  } catch {
    /* deja închis */
  }
  ws = null
}
