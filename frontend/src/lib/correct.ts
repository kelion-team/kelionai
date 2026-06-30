// Clean up a low-confidence speech transcript via the backend (Gemini) before
// it reaches Claude. Best-effort: returns the original text on any failure, so
// hearing never breaks. Only call this when recognizer confidence is low — high
// confidence should pass straight through to keep latency down.

export async function correctTranscript(
  text: string,
  context: string,
  lang: string,
): Promise<string> {
  try {
    const res = await fetch('/api/correct', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ text, context, lang }),
    })
    if (!res.ok) return text
    const j = (await res.json()) as { text?: string }
    return j.text?.trim() || text
  } catch {
    return text
  }
}
