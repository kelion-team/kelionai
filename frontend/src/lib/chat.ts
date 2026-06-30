export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface Coords {
  lat: number
  lon: number
}

// Control commands Kelion can push on the stream (stripped from the visible
// text; never shown or spoken). Currently: drive the monitor surface.
export interface ChatControl {
  monitor?: { url: string; title: string }
}

// U+001F (unit separator) brackets a JSON control frame in the text stream.
const CTRL = String.fromCharCode(31)

// POST the conversation to the backend and yield streamed text chunks.
// `image` (base64 JPEG data URL) is the latest camera frame for Claude's vision.
// `coords` is the live device GPS so location-dependent skills work.
// `onControl` receives any control frames Kelion emits (e.g. open the monitor).
export async function* streamChat(
  messages: ChatMessage[],
  image?: string,
  coords?: Coords,
  onControl?: (c: ChatControl) => void,
): AsyncGenerator<string> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ messages, image, coords }),
  })

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

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''

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
        onControl?.(JSON.parse(json) as ChatControl)
      } catch {
        /* malformed control frame — ignore */
      }
      buf = buf.slice(j + 1)
    }
    return out
  }

  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const text = drain(false)
    if (text) yield text
  }
  buf += decoder.decode()
  const tail = drain(true)
  if (tail) yield tail
}
