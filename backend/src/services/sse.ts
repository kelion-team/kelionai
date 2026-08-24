// Single strict SSE JSON reader used by Responses streaming. It preserves
// event order, flushes a final unterminated event and never hides malformed
// provider data as if the stream had completed successfully.
export async function readSSE(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: unknown) => void,
): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let dataLines: string[] = []

  const dispatch = (): void => {
    if (!dataLines.length) return
    const data = dataLines.join('\n').trim()
    dataLines = []
    if (!data || data === '[DONE]') return
    let event: unknown
    try {
      event = JSON.parse(data)
    } catch {
      throw new Error('sse_invalid_json')
    }
    onEvent(event)
  }

  const processLine = (raw: string): void => {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    if (!line) return dispatch()
    if (line.startsWith(':')) return
    if (line === 'data' || line.startsWith('data:')) {
      dataLines.push(line === 'data' ? '' : line.slice(5).replace(/^ /, ''))
    }
  }

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let newline: number
      while ((newline = buffer.indexOf('\n')) >= 0) {
        processLine(buffer.slice(0, newline))
        buffer = buffer.slice(newline + 1)
      }
    }
    buffer += decoder.decode()
    if (buffer) processLine(buffer)
    dispatch()
  } catch (error) {
    await reader.cancel().catch(() => {})
    throw error
  } finally {
    reader.releaseLock()
  }
}
