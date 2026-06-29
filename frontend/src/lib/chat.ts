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
    let msg = 'Eroare la creier.'
    try {
      const j = (await res.json()) as { message?: string; error?: string }
      if (j.error === 'brain_not_configured') {
        msg = 'Creierul nu e încă activat (lipsește cheia Anthropic).'
      } else if (j.message) {
        msg = j.message
      }
    } catch {
      /* non-JSON error body */
    }
    throw new Error(msg)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    yield decoder.decode(value, { stream: true })
  }
}
