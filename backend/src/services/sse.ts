// ── SURSĂ UNICĂ pentru citirea unui flux SSE (`data: {json}` pe linii) ────────
// Streaming-ul de la creier (OpenRouter format-OpenAI + Gemini direct) livrează
// evenimentele ca linii `data: {…}`; ambele servicii parsau MANUAL exact același
// schelet (reader + decoder + buffer + split pe \n + prefix `data:` + [DONE] +
// JSON.parse). Aici o singură dată (principiul permanent: unic, fără duplicate).
// `onEvent` primește fiecare eveniment JSON parsat, ÎN ORDINE și SINCRON — deci
// latența (primul cuvânt instant) rămâne IDENTICĂ; procesarea specifică fiecărui
// furnizor (choices/delta vs candidates/parts) stă la apelant.
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
