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

// ── THE FAKE-CALL INTERPRETER (Adrian, Aug 2) ──────────────────────────────
//
// Live proof (server journal, Aug 2): a weak free model ends the turn having
// TYPED `<|tool_call>call:system_health{}<tool_call|>` as plain text instead
// of invoking the tool. The stripper above hid it from the human, the turn
// returned EMPTY, and the human was left with just the ack and silence — "the
// command never reached the brain". The professional fix is not to patch the
// model's words one by one; it is to UNDERSTAND what it meant: parse the
// typed call, run the real tool, and let the turn continue with the result.
//
// Safety: only names that really exist in the turn's tool list are honoured,
// and arguments must be valid JSON. Prose like `print("hello")` stays prose
// (unknown name), and a call we cannot parse honestly is left untouched.

export interface FakeToolCall {
  name: string
  argsJson: string
}

// Extracts a balanced {...} or (...) block starting at `start`. Returns null
// when the block never closes. Tolerant by design — JSON.parse validates
// afterwards, so a brace inside a string can only make us SKIP a fake call,
// never invent one.
function balancedBlock(text: string, start: number, open: string, close: string): string | null {
  let depth = 0
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (ch === open) depth++
    else if (ch === close) {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

const SECTION_RES = [
  /<\|?tool_call\|?>([\s\S]*?)<\|?\/?tool_call\|?>/g,
  /<tool_call>([\s\S]*?)<\/tool_call>/g,
]
const JSON_CALL_INLINE_RE =
  /\{\s*"(?:tool|tool_call|name|function)"\s*:\s*"[^"\n]+"\s*,\s*"(?:arguments|args|parameters|input)"\s*:\s*\{[^{}\n]*\}\s*\}/g

/**
 * Finds tool calls the model TYPED as text instead of invoking for real.
 * `knownTools` = the names of the tools actually offered this turn; anything
 * else is prose and is ignored. At most 4 calls, duplicates removed.
 */
export function parseFakeToolCalls(
  text: string,
  knownTools: ReadonlySet<string>,
): FakeToolCall[] {
  const found: FakeToolCall[] = []
  const seen = new Set<string>()
  const add = (name: string, argsJson: string): void => {
    if (!knownTools.has(name)) return
    try {
      JSON.parse(argsJson)
    } catch {
      return
    }
    const key = `${name}${argsJson}`
    if (seen.has(key)) return
    seen.add(key)
    if (found.length < 4) found.push({ name, argsJson })
  }
  // "call:NAME{...}" / "call:NAME(...)" / bare "NAME{...}" / "NAME(...)"
  // inside one fragment. With parens we only accept EMPTY () or a JSON object
  // inside — anything else would mean guessing argument names, and a guessed
  // call is worse than no call.
  const fromNameShape = (frag: string): void => {
    const m = /(?:call:)?\s*([A-Za-z_][\w.]*)\s*([({])/.exec(frag)
    if (!m) return
    const name = m[1]
    if (!knownTools.has(name)) return
    const openCh = m[2]
    const openIdx = frag.indexOf(openCh, m.index + m[0].length - 1)
    if (openCh === '{') {
      const block = balancedBlock(frag, openIdx, '{', '}')
      if (block) add(name, block)
      return
    }
    const block = balancedBlock(frag, openIdx, '(', ')')
    if (block === null) return
    const inner = block.slice(1, -1).trim()
    if (inner === '') add(name, '{}')
    else if (inner.startsWith('{')) add(name, inner)
  }
  const fromJson = (frag: string): void => {
    try {
      const obj = JSON.parse(frag.trim()) as Record<string, unknown>
      const name = String(obj.tool ?? obj.tool_call ?? obj.name ?? obj.function ?? '')
      const args = obj.arguments ?? obj.args ?? obj.parameters ?? obj.input ?? {}
      if (name) add(name, JSON.stringify(args))
    } catch {
      /* not JSON — the name-shape path handles it */
    }
  }

  // 1. Marked sections: <|tool_call>call:NAME{...}<tool_call|> and variants.
  for (const re of SECTION_RES) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      const inner = m[1].trim()
      if (inner.startsWith('{')) fromJson(inner)
      else fromNameShape(inner)
    }
  }
  // 2. Inline typed JSON calls: {"tool": "NAME", "arguments": {...}}.
  JSON_CALL_INLINE_RE.lastIndex = 0
  let jm: RegExpExecArray | null
  while ((jm = JSON_CALL_INLINE_RE.exec(text)) !== null) fromJson(jm[0])
  // 3. The WHOLE reply is one bare typed call — "system_health()" as the
  // entire bubble (live screenshot, Aug 2). Checked on the markup-stripped
  // text so a wrapper of markers doesn't hide it. Only a single short line
  // with no spaces outside the call can qualify — prose never matches.
  const bare = stripToolMarkup(text).trim()
  if (bare.length > 0 && bare.length < 300) {
    if (bare.startsWith('{') && bare.endsWith('}')) {
      fromJson(bare)
    } else {
      const m = /^(?:call:)?([A-Za-z_][\w.]*)\s*(\([\s\S]*\)|\{[\s\S]*\})$/.exec(bare)
      if (m) fromNameShape(bare)
    }
  }
  return found
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
