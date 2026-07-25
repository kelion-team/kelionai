export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  /** Când a fost trimis (epoch ms) — afișat ca oră lângă fiecare mesaj. */
  ts?: number
}

export interface Coords {
  lat: number
  lon: number
}

// Control commands Kelion can push on the stream (stripped from the visible
// text; never shown or spoken). Currently: drive the monitor surface.
// A structured "skill card" Kelion renders on the monitor (emails, calendar,
// tasks, Drive files, contacts, web results). One generic shape for all types.
export interface CardItem {
  primary: string
  secondary?: string
  meta?: string
  url?: string
}
export interface SkillCard {
  type: string
  title: string
  items: CardItem[]
}

export interface ChatControl {
  monitor?: { url: string; title: string }
  // A generated image to show inline in the chat (in addition to the monitor).
  image?: { url: string }
  // A structured skill result to render as a card on the monitor.
  card?: SkillCard
  // A readable text deliverable from an agent (email, translation, findings),
  // shown as a copyable panel on the monitor.
  doc?: { title: string; text: string }
  // O pagină web COMPLETĂ scrisă de Kelion (run_web_app) — rulează live pe
  // monitor într-un cadru izolat (srcdoc + sandbox) și se poate salva ca .html.
  app?: { title: string; html: string }
  // A device command the SERVER interpreted (camera / monitor tabs) — the
  // regexes moved off the browser; the client just executes what this says.
  device?: {
    camera?: 'on' | 'off' | 'front' | 'back' | 'switch'
    screen?: { op: 'close' | 'closeAll' | 'closeKind' | 'switchKind'; kind?: string }
  }
  // The server committed a new speech language (detected + persisted there);
  // the client applies it to the recognizer and mirrors it locally.
  lang?: string
  // ACCES LA TAB-URILE APLICAȚIEI din chatul scris (unealta open_app_view):
  // clientul traduce în evenimentul kelion:navigate; Stage deschide panoul.
  nav?: { view: string; section?: string }
  // Out of credit — the client should open the top-up (buy credit) flow.
  paywall?: boolean
  // Puls de viață de la server cât gândește creierul (nimic de afișat) — ține
  // conexiunea deschisă prin Cloudflare și hrănește ceasul de gardă de mai jos.
  ping?: number
  // The server has received the message — the delivery check mark in the UI.
  receipt?: boolean
  // GEST LA COMANDĂ: numele clipului din regia de mișcare (AvatarModel) pe
  // care creierul îl cere prin eticheta [GEST nume] — avatarul îl execută o dată.
  gest?: string
  // Eticheta tool-ului server-side play_avatar_gesture (release v2.3) —
  // ChatPanel o traduce în clipul RPM echivalent, pe același canal de gest.
  gesture?: string
  // BARGRAF LA INTRAREA ÎN CREIER (Adrian, 10 iul): textul EXACT pe care
  // serverul îl predă creierului la această tură — trimis de pe server, nu un
  // ecou local. Se afișează ca bandă distinctă, ca să se vadă ce „a auzit".
  heard?: string
  // VOCEA CREIERULUI: MP3 (base64) sintetizat pe server (Chirp 3) și trimis prin
  // punte. Aplicația doar îl decodează + redă — nu sintetizează nimic local.
  audio?: string
  // Owner promo pipeline: an APPROVED clip script + shot list — arm the recorder;
  // when recording starts the script is spoken (voice only, no text on screen)
  // while the scenes appear on the monitor at their times.
  promo?: {
    subject: string
    duration: number
    script: string
    // The script's own language (BCP-47/2-letter) — the clip is narrated in it
    // so the voice always matches the text (a mismatch is what silenced it).
    lang?: string | null
    scenes?: { at: number; title: string; url?: string; close?: boolean }[]
  }
}

import type { VoiceFeatures } from './audioIO.js'

// U+001F (unit separator) brackets a JSON control frame in the text stream.
const CTRL = String.fromCharCode(31)

// POST the conversation to the backend and yield streamed text chunks.
// `image` (base64 JPEG data URL) is the latest camera frame for the brain's vision.
// `coords` is the live device GPS so location-dependent skills work.
// `onControl` receives any control frames Kelion emits (e.g. open the monitor).
// A snapshot of the monitor tabs currently open, sent with each turn so Kelion
// knows what it's already showing (and which surface is active) — it works inside
// whichever task is active and swaps content instead of re-opening.
export interface ScreenTask {
  kind: string
  title: string
  active: boolean
}

export async function* streamChat(
  messages: ChatMessage[],
  image?: string,
  coords?: Coords,
  onControl?: (c: ChatControl) => void,
  screen?: ScreenTask[],
  // STOP: semnal de abandon — „stop" scris/vorbit taie tura PE LOC (nu în coadă).
  signal?: AbortSignal,
  // Poza a fost ATAȘATĂ EXPLICIT (lipită cu Ctrl+V sau încărcată) — cerere de
  // analiză fără echivoc, spre deosebire de cadrul camerei mereu-pornite (care
  // se analizează doar la cerere explicită în text). Vezi ChatPanel.tsx.
  imageIsAttachment?: boolean,
  // VEDEREA CONTINUĂ (Adrian, 11 iul): ultimele 4 cadre ale camerei — pentru
  // TOȚI userii (regula nr. 9: aceleași capabilități), nu doar admin.
  images?: string[],
  // Features vocale extrase client-side pentru identificare speaker + gen.
  voiceFeatures?: VoiceFeatures,
  // Descriptor facial 128-d (face-api) + miniatură, extrase în fundal când camera
  // e pornită. Declanșat de voce, fără buton, off-hot-path.
  faceDescriptor?: number[],
  facePhoto?: string,
): AsyncGenerator<string> {
  // BUG FINANCIAR REPARAT (audit 24 iul): aici mai exista un POST /api/chat al
  // cărui răspuns NU era citit niciodată — openStream() de mai jos deschidea AL
  // DOILEA POST identic, singurul consumat. Serverul rula deci FIECARE mesaj de
  // DOUĂ ori: dublu cost la creier, istoric dublat, frame-urile primei ture
  // pierdute. Un singur POST rămâne: cel din openStream().

  // Deduplication set: a reconnect may re-send events we already processed.
  const seenIds = new Set<string>()
  let lastEventId = ''
  let turnId: string | null = null
  let resumeTries = 0
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  let decoder = new TextDecoder()
  let sseBuf = '' // raw SSE text buffer, split on \n\n
  let textBuf = '' // visible text + control frames buffer, split on CTRL

  // Parse fully-delimited SSE events from the accumulated buffer. Returns the
  // parsed events and the leftover incomplete text.
  function parseSSE(chunk: string): { id?: string; data?: string }[] {
    sseBuf += chunk
    const events: { id?: string; data?: string }[] = []
    for (;;) {
      const end = sseBuf.indexOf('\n\n')
      if (end === -1) break
      const block = sseBuf.slice(0, end)
      sseBuf = sseBuf.slice(end + 2)
      let id: string | undefined
      const dataLines: string[] = []
      for (const line of block.split('\n')) {
        if (line.startsWith('id:')) id = line.slice(3).trim()
        else if (line.startsWith('data:')) {
          // SSE spec: dacă după "data:" urmează UN spațiu, acel spațiu e parte
          // din framing și se scoate (serverul scrie „data: <chunk>"). FĂRĂ asta,
          // fiecare token venea cu un spațiu în față și cuvintele se spărgeau —
          // „detaliat" (token-urile det/ali/at) → „det ali at" (bug raportat de
          // Adrian). Se scoate EXACT un spațiu, deci spațiile reale din text rămân.
          let v = line.slice(5)
          if (v.startsWith(' ')) v = v.slice(1)
          dataLines.push(v)
        }
        // comment lines (heartbeat) and other fields are ignored
      }
      if (id !== undefined || dataLines.length > 0) {
        events.push({ id, data: dataLines.join('\n') })
      }
    }
    return events
  }

  // Split the accumulated text buffer into visible text (yielded) and control
  // frames (parsed), holding back any partial frame until its closing separator.
  function drain(final: boolean): string {
    let out = ''
    for (;;) {
      const i = textBuf.indexOf(CTRL)
      if (i === -1) {
        out += textBuf
        textBuf = ''
        break
      }
      out += textBuf.slice(0, i)
      const j = textBuf.indexOf(CTRL, i + 1)
      if (j === -1) {
        // Incomplete frame. Keep it (unless this is the final flush — then drop).
        textBuf = final ? '' : textBuf.slice(i)
        break
      }
      const json = textBuf.slice(i + 1, j)
      // desync se propagă ÎN AFARA try-ului (25 iul): aruncat înăuntru, era
      // înghițit de catch-ul „malformed frame" și mecanismul de tură-proaspătă
      // descris mai jos nu se declanșa niciodată.
      let desynced = false
      try {
        const frame = JSON.parse(json) as ChatControl & { turn?: string; desync?: boolean }
        if (typeof frame.turn === 'string') {
          turnId = frame.turn
          // The {turn} frame is the FIRST thing the server sends — it doubles as
          // proof of receipt: the message reached the server (delivery check).
          onControl?.({ receipt: true })
        } else if (frame.desync) {
          // Server ring buffer overflowed: we can no longer resume this turn.
          turnId = null
          desynced = true
        } else {
          onControl?.(frame)
        }
      } catch {
        /* malformed control frame — ignore */
      }
      textBuf = textBuf.slice(j + 1)
      if (desynced) throw new Error('desync')
    }
    return out
  }

  async function openStream(): Promise<void> {
    let res: Response
    try {
      if (turnId && lastEventId) {
        // Reconnect after a drop: resume the same turn from the last seen id.
        res = await fetch(
          `/api/chat/resume?turn=${encodeURIComponent(turnId)}`,
          {
            method: 'GET',
            credentials: 'include',
            headers: { 'Last-Event-ID': lastEventId },
            signal,
          },
        )
      } else {
        res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          signal,
          body: JSON.stringify({
            messages,
            image,
            images,
            imageIsAttachment,
            coords,
            screen,
            voiceFeatures,
            faceDescriptor,
            facePhoto,
            now: new Date().toISOString(),
            tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
          }),
        })
      }
    } catch {
      throw new Error('offline')
    }

    if (!res.ok || !res.body) {
      let code = 'error'
      try {
        const j = (await res.json()) as { error?: string }
        if (j.error === 'brain_not_configured') code = 'brain_not_configured'
      } catch {
        /* non-JSON error body */
      }
      throw new Error(code)
    }

    reader = res.body.getReader()
    decoder = new TextDecoder()
  }

  // Reconnect to the resume endpoint after a drop; returns true if a fresh
  // reader was opened. Uses Last-Event-ID so the server replays only missing events.
  async function resume(): Promise<boolean> {
    if (!turnId || !lastEventId || resumeTries >= 6) return false
    resumeTries++
    await new Promise((r) => setTimeout(r, Math.min(4000, 400 * resumeTries)))
    try {
      if (reader) await reader.cancel()
    } catch {
      /* reader already dead */
    }
    try {
      await openStream()
      return true
    } catch {
      return false
    }
  }

  await openStream()

  // CEAS DE GARDĂ: o conexiune moartă dar „deschisă" nu aruncă niciodată din
  // read() — tura rămânea blocată la nesfârșit. Serverul pulsează heartbeat la
  // ≤15s, deci 50s fără NICIUN octet = fir mort sigur → resume, iar dacă nici
  // asta nu merge, tura se închide ('offline') și chatul se deblochează.
  const READ_SILENCE_MS = 50_000
  for (;;) {
    let chunk: ReadableStreamReadResult<Uint8Array>
    let watchdog: number | undefined
    try {
      chunk = await Promise.race([
        reader!.read(),
        new Promise<never>((_, rej) => {
          watchdog = window.setTimeout(() => rej(new Error('silent')), READ_SILENCE_MS)
        }),
      ])
    } catch {
      if (await resume()) continue
      throw new Error('offline')
    } finally {
      window.clearTimeout(watchdog)
    }
    if (chunk.done) break
    const text = decoder.decode(chunk.value, { stream: true })
    const events = parseSSE(text)
    for (const ev of events) {
      if (ev.id) {
        if (seenIds.has(ev.id)) continue
        seenIds.add(ev.id)
        lastEventId = ev.id
      }
      if (ev.data !== undefined) {
        textBuf += ev.data
        const out = drain(false)
        if (out) yield out
      }
    }
  }
  // Flush any partial SSE event and any trailing control frame.
  const events = parseSSE('\n\n')
  for (const ev of events) {
    if (ev.id && !seenIds.has(ev.id)) {
      seenIds.add(ev.id)
      lastEventId = ev.id
    }
    if (ev.data !== undefined) textBuf += ev.data
  }
  textBuf += decoder.decode()
  const tail = drain(true)
  if (tail) yield tail
}
