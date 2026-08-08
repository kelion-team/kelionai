// Splits the text to speak into CHUNKS at sentence boundaries, so the
// synthesis (TTS) flows in pieces: Kelion starts speaking from the FIRST
// sentence (small time-to-first-audio), instead of waiting for the whole
// reply to be synthesized. Short chunks → the first voice comes out fast;
// the rest is synthesized while the first plays. PURE function, separately
// testable.
export function splitForSpeech(text: string, maxLen = 200): string[] {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) return []
  // sentences: split AFTER . ! ? … (keeping the punctuation); the last one may have no full stop.
  const sentences =
    clean.match(/[^.!?…]*[.!?…]+|[^.!?…]+$/g)?.map((s) => s.trim()).filter(Boolean) ?? [clean]

  const chunks: string[] = []
  let buf = ''
  const flush = (): void => {
    if (buf) {
      chunks.push(buf)
      buf = ''
    }
  }
  for (const s of sentences) {
    if (s.length > maxLen) {
      // huge sentence (no punctuation): flush the buffer, then cut hard on spaces
      flush()
      let rest = s
      while (rest.length > maxLen) {
        let cut = rest.lastIndexOf(' ', maxLen)
        if (cut <= 0) cut = maxLen
        chunks.push(rest.slice(0, cut).trim())
        rest = rest.slice(cut).trim()
      }
      if (rest) buf = rest
    } else if (!buf) {
      buf = s
    } else if (buf.length + 1 + s.length <= maxLen) {
      buf += ' ' + s // packs short sentences together (but ≤ maxLen)
    } else {
      flush()
      buf = s
    }
  }
  flush()
  return chunks
}
