// Model text that resembles protocol markup is never shown or spoken. It is
// only a presentation sanitizer: markup is never parsed into an executable
// action. Effects require a structured Responses `function_call` item.
// Two shapes:
//  - makeToolMarkupStripper(): STATEFUL, for the streaming path. Chunks arrive
//    piecemeal; a marker can be split across two chunks, so we hold back a
//    possible fragment. Complete marked sections are dropped and LOGGED whole
//    (server-side diagnosis); an opened-but-never-closed section holds the
//    rest of the stream (it is never a real reply).
//  - stripToolMarkup(): one-shot, for the full text at the end of the turn
//    (history save + the "did the brain say anything?" check — a reply made
//    ONLY of markup counts as EMPTY instead of being shown as an answer).

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

// ── BARE TYPED CALLS — STANDALONE LINES ONLY (Adrian, Aug 2 — live
// screenshot: the bubble showed a bare line `get_weather` ABOVE the real
// answer to "Câte grade sunt afară?") ────────────────────────────────────────
// Any line that is EXACTLY a typed
// call of a tool offered THIS TURN — `get_weather`, `get_weather()`,
// `call:get_weather{...}`, `system_health()` — is hidden (stream AND final
// text AND voice). The same name INSIDE a sentence ("folosesc get_weather
// pentru...") stays visible: only standalone call-shaped lines go. The name
// set ALWAYS comes from the tools the turn offered — never hardcoded here.
//
// TOOL-RESPONSE / RESULT ECHO (Adrian, 13 aug — live screenshot: the bubble
// showed RAW `response:secret_publica{result:{rezultat:{…}}}`). A weak model
// TYPED a tool's RESULT wrapper as text: an optional protocol keyword
// (`response:` / `result:` / `output:` / `observation:`, maybe `tool_`-prefixed)
// before a real tool name + a brace block. It's markup, never a human reply, and
// unlike a bare call it must ONLY be hidden — never executed (it's a fabricated
// result, not a request). Same guard as above: the tool name must be one the
// turn offered, so a sentence like "response: secret_publica e o unealtă" stays.
const CALL_LINE_RE =
  /^\s*(?:(?:tool[_-])?(?:response|result|output|observation)\s*[:=]\s*)?(?:call:)?([A-Za-z_][\w.]*)\s*(\([\s\S]*\)|\{[\s\S]*\})?\s*$/

function isBareCallLine(line: string, knownTools: ReadonlySet<string>): boolean {
  const m = CALL_LINE_RE.exec(line)
  return m !== null && knownTools.has(m[1])
}

// Drops the standalone typed-call lines from a whole text; each dropped line
// is logged whole, exactly like the marked sections.
function stripBareCallLines(
  text: string,
  knownTools: ReadonlySet<string>,
  onLog?: (swallowed: string) => void,
): string {
  if (knownTools.size === 0) return text
  const lines = text.split('\n')
  let changed = false
  const kept: string[] = []
  for (const line of lines) {
    if (isBareCallLine(line, knownTools)) {
      changed = true
      onLog?.(line)
      continue
    }
    kept.push(line)
  }
  return changed ? kept.join('\n') : text
}

// STREAMING: a PARTIAL last line (no newline yet) is held back ONLY while it
// can still grow into a bare typed call — the identifier typed so far is a
// prefix of a real tool name, optionally followed by the start of the
// argument block. Anything else flows through at once: normal text never waits.
const PARTIAL_CALL_LINE_RE =
  /^\s*(?:(?:tool[_-])?(?:response|result|output|observation)\s*[:=]\s*)?(?:call:)?([A-Za-z_][\w.]*)?\s*(\([\s\S]*|\{[\s\S]*)?$/

function couldGrowIntoBareCallLine(line: string, knownTools: ReadonlySet<string>): boolean {
  const m = PARTIAL_CALL_LINE_RE.exec(line)
  if (!m) return false
  const nameSoFar = m[1] ?? ''
  if (!nameSoFar) return true // only whitespace / "call:" typed so far
  for (const t of knownTools) if (t.startsWith(nameSoFar)) return true
  return false
}

export function stripToolMarkup(
  text: string,
  onLog?: (swallowed: string) => void,
  knownTools?: ReadonlySet<string>,
): string {
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
  // Bare typed-call lines (see above): with the turn's tool-name set, a
  // standalone `get_weather` / `system_health()` line never survives.
  if (knownTools && knownTools.size > 0) out = stripBareCallLines(out, knownTools, onLog)
  return out
}

export function makeToolMarkupStripper(
  onLog: (swallowed: string) => void,
  knownTools?: ReadonlySet<string>,
): {
  push: (chunk: string) => string
  flush: () => string
} {
  let buf = ''
  // The bare-call line filter on EMITTED text: only COMPLETE lines (ended by
  // \n) are certain; the trailing partial line is held back ONLY while it can
  // still grow into a bare typed call, otherwise it flows through unchanged.
  const emit = (out: string): string => {
    if (!knownTools || knownTools.size === 0 || !out) return out
    const nl = out.lastIndexOf('\n')
    if (nl < 0) {
      if (couldGrowIntoBareCallLine(out, knownTools)) {
        buf = out + buf
        return ''
      }
      return out
    }
    const head = out.slice(0, nl + 1)
    const tail = out.slice(nl + 1)
    const shown = stripBareCallLines(head, knownTools, onLog)
    if (tail && couldGrowIntoBareCallLine(tail, knownTools)) {
      buf = tail + buf
      return shown
    }
    return shown + tail
  }
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
      return emit(out)
    }
    // 3. A trailing fragment that COULD be the start of a marker: hold it.
    const lt = buf.lastIndexOf('<')
    if (lt >= 0 && buf.length - lt < 20) {
      const tail = buf.slice(lt)
      if (FRAGMENTS.some((f) => f.startsWith(tail))) {
        const out = buf.slice(0, lt)
        buf = tail
        return emit(out)
      }
    }
    const out = buf
    buf = ''
    return emit(out)
  }
  const flush = (): string => {
    if (!buf) return ''
    // With the turn's tool names, the buffer may hold a PARTIAL LINE (a
    // would-be bare call), not only marker fragments: a line that never
    // became a bare call is real text and reaches the human; a true bare
    // call line is logged and dropped.
    if (knownTools && knownTools.size > 0) {
      // A held buffer can mix a partial line with a marker fragment
      // (e.g. "get_wea<|tool"): the part from the marker on is never real text.
      let text = buf
      const lt = text.indexOf('<')
      if (lt >= 0) {
        const fromMarker = text.slice(lt)
        if (OPEN_RE.test(fromMarker) || FRAGMENTS.some((f) => f.startsWith(fromMarker))) {
          onLog(fromMarker)
          text = text.slice(0, lt)
        }
      }
      const out = stripBareCallLines(text, knownTools, onLog)
      buf = ''
      return out
    }
    // Whatever is still held is either a marker fragment or an unclosed
    // section — it never reaches the human. Log it, drop it.
    onLog(buf)
    buf = ''
    return ''
  }
  return { push, flush }
}
