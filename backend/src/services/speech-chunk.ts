// Împarte textul de rostit în BUCĂȚI la graniță de frază, ca sinteza (TTS) să
// curgă pe bucăți: Kelion începe să vorbească din PRIMA frază (time-to-first-
// audio mic), în loc să aștepte sinteza întregii replici. Bucăți scurte → prima
// voce iese repede; restul se sintetizează cât se redă prima. Funcție PURĂ,
// testabilă separat.
export function splitForSpeech(text: string, maxLen = 200): string[] {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) return []
  // fraze: rup DUPĂ . ! ? … (păstrând punctuația); ultima poate fi fără punct.
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
      // frază uriașă (fără punctuație): golește tamponul, apoi taie dur pe spații
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
      buf += ' ' + s // împachetează fraze scurte împreună (dar ≤ maxLen)
    } else {
      flush()
      buf = s
    }
  }
  flush()
  return chunks
}
