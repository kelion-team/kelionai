// ── SINGLE SOURCE for reading an SSE stream (`data: {json}` lines) ──────────
// The brain's streaming (OpenRouter OpenAI-format + Gemini direct) delivers
// events as `data: {…}` lines; both services used to MANUALLY parse the exact
// same skeleton (reader + decoder + buffer + split on \n + `data:` prefix +
// [DONE] + JSON.parse). Here, once (the permanent principle: unique, no
// duplicates). `onEvent` receives each parsed JSON event, IN ORDER and
// SYNCHRONOUSLY — so the latency (instant first word) stays IDENTICAL; the
// provider-specific processing (choices/delta vs candidates/parts) stays
// with the caller.
export async function readSSE(
  body: ReadableStream<Uint8Array>,
  onEvent: (ev: unknown) => void,
): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (!data || data === '[DONE]') continue
      let ev: unknown
      try {
        ev = JSON.parse(data)
      } catch {
        continue
      }
      onEvent(ev)
    }
  }
}
