// ── MESSENGER KELION↔KELION — CLIENTUL DE PREZENȚĂ + APEL (Adrian, 11 aug) ───────
// Cât ești logat, ținem deschis /api/apel ca să POȚI fi sunat. La un „invite"
// ridicăm interfața de apel primit; la accept/refuz/închidere anunțăm Stage prin
// evenimente `window`. Inițierea („apelează-l pe X") vine din creier (unealta
// apeleaza_user) și ajunge la APELANT ca frame de control {apel} — vezi ChatPanel.
// FAZA 1: sunat + acceptă/refuză + conectat + închide. FAZA 2 (audio + traducere)
// se va releъa tot pe socketul ăsta.

import { playVoice } from './audioIO'
import { pornesteCapturaApel, type CapturaApel } from './apelMic'
import { pornesteSonerie, opresteSonerie } from './apelSonerie'
import { strings, resolveLang } from './i18n'
import { loadLocalLang } from './prefs'

let ws: WebSocket | null = null
let pornit = false
let reconnectTimer: number | null = null
// FAZA 2: apelul în care ești ACUM + captura microfonului cât e conectat.
let apelCurent: string | null = null
let captura: CapturaApel | null = null
// FAZA 3 (hands-free): cât SUNĂ un apel primit — anunțul vocal + captura care
// ascultă „răspunde"/„refuză".
let intraCallId: string | null = null
let hfCaptura: CapturaApel | null = null
let hfTimeout: number | null = null

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

// ── FAZA 3: SONERIE + ANUNȚ VOCAL + HANDS-FREE (Adrian: „sonerie/anunț vocal, îi
// spui răspunde și se face legătura") ───────────────────────────────────────────
// La un apel primit: sună + Kelion SPUNE „te sună X, spune răspunde sau refuză",
// apoi ascultă răspunsul tău vocal (fără să apeși) și acceptă/refuză. Butoanele
// rămân mereu (dacă microfonul e blocat). Se oprește la accept/refuz/închidere.
function opresteHF(): void {
  opresteSonerie()
  hfCaptura?.opreste()
  hfCaptura = null
  if (hfTimeout !== null) {
    window.clearTimeout(hfTimeout)
    hfTimeout = null
  }
  intraCallId = null
}

/** Anunțul vocal — sintetizat pe server (aceeași voce Chirp), redat o dată; `gata`
 *  se cheamă la sfârșitul redării (SAU la eșec), ca să pornim ascultarea DUPĂ ce
 *  s-a terminat de spus „răspunde/refuză" (altfel s-ar auzi pe sine). */
async function anunta(text: string, lang: string, gata: () => void): Promise<void> {
  let terminat = false
  const term = (): void => {
    if (terminat) return
    terminat = true
    gata()
  }
  try {
    const r = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ text, lang }),
    })
    if (!r.ok) {
      term()
      return
    }
    const buf = new Uint8Array(await r.arrayBuffer())
    let bin = ''
    for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i])
    playVoice(btoa(bin), undefined, term) // term = onEnd
  } catch {
    term()
  }
}

async function startHFCapture(callId: string): Promise<void> {
  if (hfCaptura || intraCallId !== callId) return
  hfCaptura = await pornesteCapturaApel(
    (audioB64, mime) => {
      if (intraCallId === callId) trimite({ type: 'comanda-apel', callId, audio: audioB64, mime })
    },
    () => {
      /* microfon blocat — butoanele Răspunde/Refuză rămân */
    },
  )
  // Nu ascultăm la nesfârșit — după ~25s renunțăm la hands-free (interfața rămâne).
  hfTimeout = window.setTimeout(() => opresteHF(), 25000)
}

function pornesteHF(callId: string, from: unknown): void {
  intraCallId = callId
  pornesteSonerie()
  const nume = (from as { name?: string; email?: string })?.name || (from as { email?: string })?.email || ''
  const lang = loadLocalLang() || 'ro'
  const text = strings(resolveLang(lang)).apelAnunt.replace('{name}', nume)
  const dupaAnunt = (): void => {
    // Ringul se oprește când începe ascultarea (ca bip-ul să nu declanșeze VAD-ul).
    opresteSonerie()
    if (intraCallId === callId) void startHFCapture(callId)
  }
  void anunta(text, lang, dupaAnunt)
  // Plasă: dacă anunțul se blochează, pornim oricum ascultarea după 4s.
  window.setTimeout(() => {
    if (intraCallId === callId && !hfCaptura) dupaAnunt()
  }, 4000)
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
      // Cineva mă sună → interfața „X te sună" + sonerie + anunț vocal + hands-free.
      emite('kelion:apel-intra', { callId: m.callId, from: m.from })
      if (m.callId) pornesteHF(m.callId, m.from)
      break
    case 'accepted':
      opresteHF() // s-a răspuns (buton sau voce) → oprim soneria/ascultarea de apel
      apelCurent = m.callId ?? null
      if (m.callId) void pornesteMic(m.callId) // Faza 2: pornește captura vocii
      emite('kelion:apel-stare', { stare: 'conectat', callId: m.callId, cu: m.cu })
      break
    case 'declined':
      opresteHF()
      if (m.callId === apelCurent) {
        opresteMic()
        apelCurent = null
      }
      emite('kelion:apel-stare', { stare: 'refuzat', callId: m.callId })
      break
    case 'hangup':
      opresteHF()
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

/** Cel sunat acceptă apelul (buton sau voce). */
export function acceptaApel(callId: string): void {
  opresteHF()
  trimite({ type: 'accept', callId })
}
/** Cel sunat refuză apelul (buton sau voce). */
export function refuzaApel(callId: string): void {
  opresteHF()
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
  opresteHF()
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
