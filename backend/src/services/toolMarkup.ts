// ── FAKE TOOL-CALL MARKUP — NEVER SHOWN, NEVER SPOKEN ──────────────────────
//
// Adrian, Aug 1 (screenshot): the chat bubble displayed RAW
// „<|tool_call|>call:system_health()<|tool_call|>”. A small free model emitted
// tool-call SYNTAX as plain text instead of invoking the tool. The human must
// never read or hear that garbage — it makes Kelion look broken.
//
// Two shapes:
//  - makeToolMarkupStripper(): STATEFUL, for the streaming path. Chunks arrive
//    piecemeal; a marker can be split across two chunks, so we hold back a
//    possible fragment. Complete marked sections are dropped and LOGGED whole
//    (server-side diagnosis); an opened-but-never-closed section holds the
//    rest of the stream (it is never a real reply).
//  - stripToolMarkup(): one-shot, for the full text at the end of the turn
//    (history save + the "did the brain say anything?" check — a reply made
//    ONLY of markup counts as EMPTY, so the free rotation tries the next
//    model instead of showing nothing).

const OPEN_RE = /<\|?tool_call\|?>|<\/?tool_call>/
const PAIR_RES = [
  /<\|?tool_call\|?>[\s\S]*?<\|?\/?tool_call\|?>/g,
  /<tool_call>[\s\S]*?<\/tool_call>/g,
  /<\|im_(?:start|end)\|>[^\n]*\n?/g,
  // JSON-STYLE FAKE CALLS (Adrian, Aug 1 — live screenshot: the bubble showed
  // RAW „{"tool": "maps_search", "arguments": {"lat": 51.79, ...}}"). Models
  // with no tool access TYPE the call as JSON instead of invoking it. One
  // line, flat arguments — the shape every faker produces.
  /\{\s*"(?:tool|tool_call|name|function)"\s*:\s*"[^"\n]+"\s*,\s*"(?:arguments|args|parameters|input)"\s*:\s*\{[^{}\n]*\}\s*\}/g,
]
// The WHOLE bubble is one typed JSON call (multiline, possibly nested) —
// caught as a whole in stripToolMarkup (streaming chunks can't hold it).
const JSON_TOOL_WHOLE_RE = /"(?:tool|tool_call|name|function)"\s*:\s*"[^"\n]+"/
const JSON_TOOL_ARGS_RE = /"(?:arguments|args|parameters|input)"\s*:/
const FRAGMENTS = [
  '<|tool_call|>',
  '<|/tool_call|>',
  '<tool_call>',
  '</tool_call>',
  '<|im_start|>',
  '<|im_end|>',
]

export function stripToolMarkup(text: string, onLog?: (swallowed: string) => void): string {
  let out = text
  for (const re of PAIR_RES) {
    out = out.replace(re, (m) => {
      onLog?.(m)
      return ''
    })
  }
  // An unclosed opener at the END: drop it too (nothing real follows it).
  const openIdx = out.search(OPEN_RE)
  if (openIdx >= 0) {
    onLog?.(out.slice(openIdx))
    out = out.slice(0, openIdx)
  }
  // The WHOLE remaining text is one typed JSON call (multiline / nested args
  // the one-line regex above cannot hold): it is never a human answer. Drop
  // it ALL → stripToolMarkup returns empty → the racer with no real tools
  // LOSES the race and the turn falls to the sequential tool path, where the
  // map actually opens instead of the model narrating fake coordinates.
  const trimmed = out.trim()
  if (
    trimmed.startsWith('{') &&
    trimmed.endsWith('}') &&
    JSON_TOOL_WHOLE_RE.test(trimmed) &&
    JSON_TOOL_ARGS_RE.test(trimmed)
  ) {
    onLog?.(trimmed)
    out = ''
  }
  return out
}

export function makeToolMarkupStripper(onLog: (swallowed: string) => void): {
  push: (chunk: string) => string
  flush: () => string
} {
  let buf = ''
  const push = (chunk: string): string => {
    buf += chunk
    // 1. Drop complete marked sections (log them whole).
    for (const re of PAIR_RES) {
      buf = buf.replace(re, (m) => {
        onLog(m)
        return ''
      })
    }
    // 2. An open marker with no close yet: hold back everything from it on.
    const openIdx = buf.search(OPEN_RE)
    if (openIdx >= 0) {
      const out = buf.slice(0, openIdx)
      buf = buf.slice(openIdx)
      return out
    }
    // 3. A trailing fragment that COULD be the start of a marker: hold it.
    const lt = buf.lastIndexOf('<')
    if (lt >= 0 && buf.length - lt < 20) {
      const tail = buf.slice(lt)
      if (FRAGMENTS.some((f) => f.startsWith(tail))) {
        const out = buf.slice(0, lt)
        buf = tail
        return out
      }
    }
    const out = buf
    buf = ''
    return out
  }
  const flush = (): string => {
    // Whatever is still held is either a marker fragment or an unclosed
    // section — it never reaches the human. Log it, drop it.
    if (buf) onLog(buf)
    const out = ''
    buf = ''
    return out
  }
  return { push, flush }
}
