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
  // A device command the SERVER interpreted (camera / monitor tabs) — the
  // regexes moved off the browser; the client just executes what this says.
  device?: {
    camera?: 'on' | 'off' | 'front' | 'back' | 'switch'
    screen?: { op: 'close' | 'closeAll' | 'closeKind' | 'switchKind'; kind?: string }
  }
  // The server committed a new speech language (detected + persisted there);
  // the client applies it to the recognizer and mirrors it locally.
  lang?: string
  // Out of credit — the client should open the top-up (buy credit) flow.
  paywall?: boolean
  // The server has received the message — the delivery check mark in the UI.
  receipt?: boolean
  // VOCEA CREIERULUI: MP3 (base64) sintetizat pe server (Chirp 3) și trimis prin
  // punte. Aplicația doar îl decodează + redă — nu sintetizează nimic local.
  audio?: string
  // STREAMING pe fraze: prima bucată de voce a unei replici → aplicația golește
  // coada replicii anterioare înainte s-o pornească. Bucățile următoare: fără first.
  first?: boolean
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

// U+001F (unit separator) brackets a JSON control frame in the text stream.
const CTRL = String.fromCharCode(31)

// POST the conversation to the backend and yield streamed text chunks.
// `image` (base64 JPEG data URL) is the latest camera frame for Claude's vision.
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
  // ADMIN only: raw attachments (any file type) that ride the bridge to Claude.
  files?: { name: string; type: string; data: string }[],
): AsyncGenerator<string> {
  let res: Response
  try {
    res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        messages,
        image,
        coords,
        screen,
        files,
        // Kelion's built-in sense of "now": the client's real local time + zone,
        // sent every turn so he always knows today's date and the current time.
        now: new Date().toISOString(),
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
    })
  } catch {
    // The request never reached the server — no connection (e.g. a tunnel while
    // driving). Signal 'offline' so the UI says so clearly (and speaks it).
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
    // Throw a stable code; the UI maps it to the user's language.
    throw new Error(code)
  }

  let reader = res.body.getReader()
  let decoder = new TextDecoder()
  let buf = ''
  // Resumable stream: the server sends a {turn} frame first; we remember it and
  // count every raw character received, so if the mobile link drops mid-reply we
  // reconnect to /api/chat/resume and continue from exactly where we left off —
  // the "buffer + resume" behaviour of internet radio, no words lost.
  let turnId: string | null = null
  let rawReceived = 0
  let resumeTries = 0

  // Split the buffer into visible text (yielded) and control frames (parsed),
  // holding back any partial frame until its closing separator arrives.
  function drain(final: boolean): string {
    let out = ''
    for (;;) {
      const i = buf.indexOf(CTRL)
      if (i === -1) {
        out += buf
        buf = ''
        break
      }
      out += buf.slice(0, i)
      const j = buf.indexOf(CTRL, i + 1)
      if (j === -1) {
        // Incomplete frame. Keep it (unless this is the final flush — then drop).
        buf = final ? '' : buf.slice(i)
        break
      }
      const json = buf.slice(i + 1, j)
      try {
        const frame = JSON.parse(json) as ChatControl & { turn?: string }
        if (typeof frame.turn === 'string') {
          turnId = frame.turn // internal — not a control
          // The {turn} frame is the FIRST thing the server sends — so it doubles
          // as proof of receipt: the message reached the server (delivery check).
          onControl?.({ receipt: true })
        } else onControl?.(frame)
      } catch {
        /* malformed control frame — ignore */
      }
      buf = buf.slice(j + 1)
    }
    return out
  }

  // Reconnect to the resume endpoint after a drop; returns a fresh reader that
  // continues the SAME reply from `rawReceived`, or null if it can't.
  async function resume(): Promise<boolean> {
    if (!turnId || resumeTries >= 6) return false
    resumeTries++
    await new Promise((r) => setTimeout(r, Math.min(4000, 400 * resumeTries)))
    try {
      const rr = await fetch(
        `/api/chat/resume?turn=${encodeURIComponent(turnId)}&from=${rawReceived}`,
        { credentials: 'include' },
      )
      if (!rr.ok || !rr.body) return false
      reader = rr.body.getReader()
      decoder = new TextDecoder() // fresh — the dropped one may hold a partial byte
      return true
    } catch {
      return false
    }
  }

  for (;;) {
    let chunk: ReadableStreamReadResult<Uint8Array>
    try {
      chunk = await reader.read()
    } catch {
      // The stream dropped mid-reply (signal lost). Try to resume where we left
      // off; only if that fails do we surface 'offline' (partial answer stays).
      if (await resume()) continue
      throw new Error('offline')
    }
    if (chunk.done) break
    const text = decoder.decode(chunk.value, { stream: true })
    rawReceived += text.length
    buf += text
    const out = drain(false)
    if (out) yield out
  }
  buf += decoder.decode()
  const tail = drain(true)
  if (tail) yield tail
}
