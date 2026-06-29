export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

// POST the conversation to the backend and yield streamed text chunks.
export async function* streamChat(messages: ChatMessage[]): AsyncGenerator<string> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ messages }),
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
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    yield decoder.decode(value, { stream: true })
  }
}
