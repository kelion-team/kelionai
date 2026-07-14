#!/usr/bin/env node
// CODERUL NATIV KELION — agentic tool-use loop DIRECT pe API-ul Messages
// (compatibil Anthropic) al lui Kimi / GLM, prin `fetch`. ZERO binar `claude`,
// ZERO `@anthropic-ai/*`, ZERO Anthropic (ordinul lui Adrian: „tot înseamnă
// tot, 0 Anthropic"). MODELUL rămâne Kimi/GLM; doar hamul (CLI-ul claude) a
// fost înlocuit cu bucla asta nativă.
//
// Export: async function runNativeCoder(prompt, opts)
//   opts = { model, base, apiKey, cwd, onEvent, timeoutMs, maxRounds=60 }
//   base Kimi  = https://api.kimi.com/coding/   (are slash final)
//   base GLM   = https://api.z.ai/api/anthropic (fără slash)
//   → POST <base fără slash-uri finale>/v1/messages
// Întoarce { code, out } — `out` = textul final al asistentului („rezultatul"),
// `code` = 0 la succes, non-0 la eșec/timeout/cotă golită.
//
// Parametrii onEvent sunt compatibili cu consumatorul existent din
// kelion-builder-server.mjs (build()): reacționează la evenimente
// { type:'assistant', message:{ content:[ { type:'tool_use', name, input } ] } }
// cu NUME de unelte în stil CLI (Read/Edit/Write/MultiEdit/Bash/Grep/Glob/LS) —
// de aceea traducem numele native (read_file/…) în numele alea la emitere, ca
// monitorul lui Adrian să afișeze aceleași linii ca înainte. La final emitem
// { type:'result', result:<text>, is_error:<bool> } (detecția de cotă a
// constructorului se leagă de asta).
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

// ── Limite prudente ────────────────────────────────────────────────────────
const READ_CAP_BYTES = 400_000 // nu înecăm contextul cu fișiere uriașe
const BASH_OUT_CAP = 30_000 // capul + coada ieșirii unei comenzi
const GLOB_MAX = 500
const GREP_OUT_CAP = 20_000
const DEFAULT_BASH_TIMEOUT = 120_000
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '.turbo'])

// ── Cale-sigură: nimic nu iese vreodată din cwd ─────────────────────────────
function safePath(cwd, p) {
  if (typeof p !== 'string' || !p) throw new Error('cale lipsă')
  const abs = path.resolve(cwd, p)
  const rel = path.relative(cwd, abs)
  if (rel !== '' && (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel))) {
    throw new Error(`cale în afara directorului de lucru: ${p}`)
  }
  return abs
}
function shq(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`
}
function capTail(s, cap) {
  if (s.length <= cap) return s
  const half = Math.floor(cap / 2)
  return s.slice(0, half) + `\n…[trunchiat ${s.length - cap} caractere]…\n` + s.slice(-half)
}

// ── EXECUTORII DE UNELTE (rădăcină = cwd) ───────────────────────────────────
function toolReadFile(cwd, { path: p, offset, limit }) {
  const abs = safePath(cwd, p)
  if (!existsSync(abs)) throw new Error(`fișierul nu există: ${p}`)
  const st = statSync(abs)
  if (st.isDirectory()) throw new Error(`${p} e un director, nu un fișier`)
  let buf = readFileSync(abs)
  let truncatedNote = ''
  if (buf.length > READ_CAP_BYTES) {
    buf = buf.subarray(0, READ_CAP_BYTES)
    truncatedNote = `\n…[fișier trunchiat la ${READ_CAP_BYTES} octeți]…`
  }
  let text = buf.toString('utf8')
  if (offset != null || limit != null) {
    const lines = text.split('\n')
    const start = Math.max(0, (offset | 0) - 0)
    const end = limit != null ? start + (limit | 0) : lines.length
    text = lines.slice(start, end).join('\n')
  }
  return text + truncatedNote
}
function toolWriteFile(cwd, { path: p, content }) {
  const abs = safePath(cwd, p)
  mkdirSync(path.dirname(abs), { recursive: true })
  writeFileSync(abs, String(content ?? ''), 'utf8')
  return `scris ${p} (${Buffer.byteLength(String(content ?? ''))} octeți)`
}
function applyEdit(content, old_string, new_string, replace_all) {
  if (old_string === new_string) throw new Error('old_string și new_string sunt identice')
  if (!content.includes(old_string)) throw new Error(`old_string nu a fost găsit în fișier`)
  if (replace_all) return content.split(old_string).join(new_string)
  const first = content.indexOf(old_string)
  const second = content.indexOf(old_string, first + old_string.length)
  if (second !== -1) throw new Error('old_string nu e unic (apare de mai multe ori) — dă mai mult context sau folosește replace_all')
  return content.slice(0, first) + new_string + content.slice(first + old_string.length)
}
function toolEditFile(cwd, { path: p, old_string, new_string, replace_all }) {
  const abs = safePath(cwd, p)
  if (!existsSync(abs)) throw new Error(`fișierul nu există: ${p}`)
  const before = readFileSync(abs, 'utf8')
  const after = applyEdit(before, String(old_string ?? ''), String(new_string ?? ''), !!replace_all)
  writeFileSync(abs, after, 'utf8')
  return `editat ${p}`
}
function toolMultiEdit(cwd, { path: p, edits }) {
  const abs = safePath(cwd, p)
  if (!existsSync(abs)) throw new Error(`fișierul nu există: ${p}`)
  if (!Array.isArray(edits) || edits.length === 0) throw new Error('edits e gol')
  let content = readFileSync(abs, 'utf8')
  // ATOMIC: aplicăm în memorie; scriem pe disc DOAR dacă toate reușesc.
  for (let i = 0; i < edits.length; i++) {
    const e = edits[i]
    try {
      content = applyEdit(content, String(e.old_string ?? ''), String(e.new_string ?? ''), !!e.replace_all)
    } catch (err) {
      throw new Error(`editarea #${i + 1} a picat: ${err.message} (nimic nu s-a scris — atomic)`)
    }
  }
  writeFileSync(abs, content, 'utf8')
  return `aplicat ${edits.length} editări pe ${p}`
}
function runBashCapture(cwd, command, timeoutMs) {
  return new Promise((resolve) => {
    const c = spawn('bash', ['-lc', command], { cwd })
    let out = ''
    let killed = false
    const t = setTimeout(() => {
      killed = true
      c.kill('SIGKILL')
    }, timeoutMs || DEFAULT_BASH_TIMEOUT)
    c.stdout?.on('data', (d) => (out += d))
    c.stderr?.on('data', (d) => (out += d))
    c.on('close', (code) => {
      clearTimeout(t)
      resolve({ code: killed ? 124 : code ?? 0, out: capTail(out, BASH_OUT_CAP) })
    })
    c.on('error', (e) => {
      clearTimeout(t)
      resolve({ code: -1, out: String(e) })
    })
  })
}
async function toolBash(cwd, { command, timeout }) {
  if (!command) throw new Error('command lipsă')
  const r = await runBashCapture(cwd, command, timeout)
  return `exit ${r.code}\n${r.out || '(fără ieșire)'}`
}
function globToRegex(pattern) {
  let re = ''
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        re += '.*'
        i++
        if (pattern[i + 1] === '/') i++ // **/  →  .*
      } else {
        re += '[^/]*'
      }
    } else if (ch === '?') re += '[^/]'
    else if ('.+^${}()|[]\\'.includes(ch)) re += '\\' + ch
    else re += ch
  }
  return new RegExp('^' + re + '$')
}
function toolGlob(cwd, { pattern }) {
  if (!pattern) throw new Error('pattern lipsă')
  const rx = globToRegex(pattern)
  const out = []
  const walk = (dir) => {
    if (out.length >= GLOB_MAX) return
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (out.length >= GLOB_MAX) return
      const full = path.join(dir, e.name)
      const rel = path.relative(cwd, full)
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue
        walk(full)
      } else if (rx.test(rel)) {
        out.push(rel)
      }
    }
  }
  walk(cwd)
  return out.length ? out.join('\n') : '(niciun fișier potrivit)'
}
async function toolGrep(cwd, { pattern, path: p, glob }) {
  if (!pattern) throw new Error('pattern lipsă')
  const target = p ? shq(p) : '.'
  // Preferăm rg (rapid, respectă .gitignore); altfel grep -rn.
  const rgCheck = await runBashCapture(cwd, 'command -v rg >/dev/null 2>&1 && echo yes || echo no', 10_000)
  const useRg = /yes/.test(rgCheck.out)
  let cmd
  if (useRg) {
    const g = glob ? `--glob ${shq(glob)} ` : ''
    cmd = `rg --line-number --no-heading --color never ${g}-e ${shq(pattern)} ${target} 2>/dev/null | head -400`
  } else {
    const inc = glob ? `--include=${shq(glob)} ` : ''
    cmd = `grep -rn ${inc}-e ${shq(pattern)} ${target} 2>/dev/null | head -400`
  }
  const r = await runBashCapture(cwd, cmd, 30_000)
  const body = capTail(r.out.trim(), GREP_OUT_CAP)
  return body || '(nicio potrivire)'
}
function toolLs(cwd, { path: p }) {
  const abs = safePath(cwd, p || '.')
  if (!existsSync(abs)) throw new Error(`nu există: ${p}`)
  const st = statSync(abs)
  if (!st.isDirectory()) return `${p} (fișier, ${st.size} octeți)`
  const entries = readdirSync(abs, { withFileTypes: true })
  return entries
    .map((e) => (e.isDirectory() ? e.name + '/' : e.name))
    .sort()
    .join('\n')
}

// ── SCHEMELE UNELTELOR (format Messages API `tools`) ────────────────────────
const TOOLS = [
  {
    name: 'read_file',
    description: 'Citește conținutul unui fișier text din repo. Opțional offset (linia de start, 0-based) și limit (număr de linii).',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'cale relativă la rădăcina repo-ului' },
        offset: { type: 'integer', description: 'linia de început (0-based), opțional' },
        limit: { type: 'integer', description: 'câte linii, opțional' },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Scrie (creează sau suprascrie) un fișier cu conținutul dat. Creează directoarele lipsă.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'edit_file',
    description: 'Înlocuire de șir EXACT într-un fișier existent. Eroare dacă old_string lipsește sau nu e unic (dacă replace_all nu e true).',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        old_string: { type: 'string', description: 'textul exact de înlocuit (cu suficient context ca să fie unic)' },
        new_string: { type: 'string', description: 'textul nou' },
        replace_all: { type: 'boolean', description: 'înlocuiește toate aparițiile' },
      },
      required: ['path', 'old_string', 'new_string'],
    },
  },
  {
    name: 'multi_edit',
    description: 'Mai multe înlocuiri de șir pe ACELAȘI fișier, aplicate în ordine, ATOMIC (toate sau niciuna).',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        edits: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              old_string: { type: 'string' },
              new_string: { type: 'string' },
              replace_all: { type: 'boolean' },
            },
            required: ['old_string', 'new_string'],
          },
        },
      },
      required: ['path', 'edits'],
    },
  },
  {
    name: 'bash',
    description: 'Rulează o comandă bash în rădăcina repo-ului (build, test, git, curl). Întoarce exit code + stdout/stderr. Așa compilezi și testezi.',
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string' },
        timeout: { type: 'integer', description: 'timeout ms (implicit 120000)' },
      },
      required: ['command'],
    },
  },
  {
    name: 'glob',
    description: 'Găsește fișiere după un pattern glob (ex: **/*.ts, src/**/routes/*.ts). Sare peste node_modules/.git.',
    input_schema: {
      type: 'object',
      properties: { pattern: { type: 'string' } },
      required: ['pattern'],
    },
  },
  {
    name: 'grep',
    description: 'Caută un pattern (regex) în cod. Opțional path (director/fișier) și glob (filtru de fișiere).',
    input_schema: {
      type: 'object',
      properties: {
        pattern: { type: 'string' },
        path: { type: 'string' },
        glob: { type: 'string' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'ls',
    description: 'Listează conținutul unui director.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },
]

async function execTool(cwd, name, input) {
  switch (name) {
    case 'read_file':
      return toolReadFile(cwd, input)
    case 'write_file':
      return toolWriteFile(cwd, input)
    case 'edit_file':
      return toolEditFile(cwd, input)
    case 'multi_edit':
      return toolMultiEdit(cwd, input)
    case 'bash':
      return await toolBash(cwd, input)
    case 'glob':
      return toolGlob(cwd, input)
    case 'grep':
      return await toolGrep(cwd, input)
    case 'ls':
      return toolLs(cwd, input)
    default:
      throw new Error(`unealtă necunoscută: ${name}`)
  }
}

// ── Traducere nume nativ → nume/înput CLI, pentru monitorul existent ────────
// build()'s onEvent recunoaște Read/Edit/Write/MultiEdit/Bash/Grep/Glob/LS și
// citește input.file_path / input.command / input.pattern / new_string|content.
function toCliBlock(id, name, input) {
  const i = input || {}
  switch (name) {
    case 'read_file':
      return { type: 'tool_use', id, name: 'Read', input: { file_path: i.path } }
    case 'write_file':
      return { type: 'tool_use', id, name: 'Write', input: { file_path: i.path, content: i.content } }
    case 'edit_file':
      return { type: 'tool_use', id, name: 'Edit', input: { file_path: i.path, new_string: i.new_string } }
    case 'multi_edit':
      return {
        type: 'tool_use',
        id,
        name: 'MultiEdit',
        input: { file_path: i.path, new_string: Array.isArray(i.edits) && i.edits[0] ? i.edits[0].new_string : '' },
      }
    case 'bash':
      return { type: 'tool_use', id, name: 'Bash', input: { command: i.command, description: i.command } }
    case 'glob':
      return { type: 'tool_use', id, name: 'Glob', input: { pattern: i.pattern } }
    case 'grep':
      return { type: 'tool_use', id, name: 'Grep', input: { pattern: i.pattern } }
    case 'ls':
      return { type: 'tool_use', id, name: 'LS', input: { path: i.path } }
    default:
      return { type: 'tool_use', id, name, input: i }
  }
}

const SYSTEM_PROMPT =
  `Ești CONSTRUCTORUL AUTONOM al proiectului Kelionai (asistent AI live: avatar 3D, voce, viziune). ` +
  `Lucrezi DIRECT în repo prin uneltele de mai jos. Scopul: rezolvi sarcina primită editând cod REAL, ` +
  `apoi DOVEDEȘTI că build-ul trece.\n\n` +
  `MODEL DE ABORDARE — 4 PAȘI, ÎN ORDINE:\n` +
  `1) SPEC: într-o propoziție, OBIECTIVUL concret și observabil + 1-3 criterii de ACCEPTARE verificabile. ` +
  `Extrage DOAR cererea reală, ignoră balastul de context. Dacă ordinul e prea vag ca să dai un obiectiv editabil, ` +
  `scrie pe o linie "SPEC_NECLAR: <ce lipsește>" și oprește-te — NU edita la întâmplare (mai ales NU fișiere de test/config/infra).\n` +
  `2) LOCALIZEAZĂ: găsește cu grep/glob/ls/read_file fișierul EXACT care guvernează comportamentul cerut. ` +
  `Citește-l înainte de a-l edita. Repere: chat/ton/gesturi → backend/src/routes/chat.ts + frontend/src/components/ChatPanel.tsx + AvatarModel.tsx; ` +
  `STT → backend/src/routes/asr*.ts + frontend/src/lib/audioIO.ts; TTS → backend/src/services/tts.ts.\n` +
  `3) EXECUTĂ: fă cea mai mică schimbare care satisface ACCEPTAREA, cu edit_file/multi_edit/write_file. ` +
  `REGULA DE FIER: a rezolva înseamnă a MODIFICA fișiere reale — a termina cu ZERO fișiere modificate = EȘEC, nu „gata". ` +
  `Un singur edit real bate zece explicații. Nu atinge *.test.ts/config/infra dacă cererea nu e despre ele.\n` +
  `4) VERIFICĂ: rulează cu bash \`npm run build\` în backend/ ȘI frontend/ și \`npm test\` în backend/ până trec fără erori; ` +
  `dacă pică, citește eroarea reală și repar-o. Apoi re-citește \`git diff\` și confirmă criteriu cu criteriu că OBIECTIVUL e chiar ATINS ` +
  `(nu doar „a compilat"). NU face deploy, NU rula railway.\n\n` +
  `DOVADĂ ÎNAINTE DE AFIRMAȚIE: nu spune că merge ceva fără să fi rulat comanda (build/test/curl) și văzut ieșirea reală. ` +
  `Pentru un bug raportat, întâi REPRODU-l cu o comandă reală; dacă nu se mai reproduce, scrie "NU SE MAI REPRODUCE" și oprește-te.\n\n` +
  `LA FINAL, răspunde SCURT cu, pe linii separate:\n` +
  `SUMAR: <ce ai schimbat, fișierele>\n` +
  `ACCEPTARE: <fiecare criteriu → ÎNDEPLINIT/NU, cu dovada (exit code-uri build/test)>`

// ── BUCLA AGENTICĂ ──────────────────────────────────────────────────────────
export async function runNativeCoder(prompt, opts = {}) {
  const { model, base, apiKey, cwd, onEvent, timeoutMs, maxRounds = 60 } = opts
  const emit = typeof onEvent === 'function' ? onEvent : () => {}
  if (!model) return finish(1, 'EROARE: model lipsă', true, emit)
  if (!base) return finish(1, 'EROARE: base API lipsă', true, emit)
  if (!apiKey) return finish(1, 'EROARE: apiKey lipsă (cheia de treaptă)', true, emit)
  if (!cwd) return finish(1, 'EROARE: cwd lipsă', true, emit)

  const url = base.replace(/\/+$/, '') + '/v1/messages'
  const headers = {
    'content-type': 'application/json',
    'x-api-key': apiKey,
    // unele endpoint-uri compat vor și Bearer (ca ANTHROPIC_AUTH_TOKEN din CLI) —
    // trimitem ambele, e inofensiv.
    authorization: `Bearer ${apiKey}`,
    'anthropic-version': '2023-06-01',
  }
  const ac = new AbortController()
  let timedOut = false
  const timer = timeoutMs
    ? setTimeout(() => {
        timedOut = true
        ac.abort()
      }, timeoutMs)
    : null

  const messages = [{ role: 'user', content: prompt }]
  let finalText = ''

  try {
    for (let round = 0; round < maxRounds; round++) {
      let data
      try {
        const resp = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify({ model, max_tokens: 8000, system: SYSTEM_PROMPT, tools: TOOLS, messages }),
          signal: ac.signal,
        })
        if (!resp.ok) {
          const bodyText = await resp.text().catch(() => '')
          const isQuota = resp.status === 429 || /quota|usage limit|credit|rate.?limit/i.test(bodyText)
          const tag = isQuota ? `429 quota/limită de folosire` : `HTTP ${resp.status}`
          if (timer) clearTimeout(timer)
          return finish(1, `${tag}: ${bodyText.slice(0, 400)}`, true, emit)
        }
        data = await resp.json()
      } catch (e) {
        if (timedOut) {
          if (timer) clearTimeout(timer)
          return finish(124, `TIMEOUT după ${timeoutMs}ms — oprit`, true, emit)
        }
        if (timer) clearTimeout(timer)
        return finish(1, `eroare de rețea către API: ${String(e).slice(0, 300)}`, true, emit)
      }

      if (data && data.type === 'error') {
        const msg = data.error?.message || JSON.stringify(data.error || data)
        const isQuota = /quota|usage limit|credit|rate.?limit|429/i.test(msg)
        if (timer) clearTimeout(timer)
        return finish(1, `${isQuota ? '429 quota' : 'eroare API'}: ${msg.slice(0, 400)}`, true, emit)
      }

      const content = Array.isArray(data.content) ? data.content : []
      const textThisRound = extractText(content)
      if (textThisRound) {
        finalText = textThisRound
        emit({ type: 'assistant', message: { content: [{ type: 'text', text: textThisRound }] } })
      }

      const toolUses = content.filter((b) => b && b.type === 'tool_use')
      // Emitem fiecare tool_use ca eveniment CLI-compatibil (pentru monitor).
      for (const tu of toolUses) {
        emit({ type: 'assistant', message: { content: [toCliBlock(tu.id, tu.name, tu.input)] } })
      }

      if (data.stop_reason !== 'tool_use' || toolUses.length === 0) {
        // Oprire naturală.
        if (timer) clearTimeout(timer)
        return finish(0, finalText || '(fără text final)', false, emit)
      }

      // Executăm uneltele și construim tura de user cu tool_result.
      messages.push({ role: 'assistant', content })
      const results = []
      for (const tu of toolUses) {
        let resultText = ''
        let isErr = false
        try {
          resultText = await execTool(cwd, tu.name, tu.input || {})
        } catch (e) {
          resultText = `EROARE: ${String(e && e.message ? e.message : e).slice(0, 500)}`
          isErr = true
        }
        results.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: String(resultText).slice(0, 40_000),
          ...(isErr ? { is_error: true } : {}),
        })
      }
      messages.push({ role: 'user', content: results })
    }
    // Am atins plafonul de runde — nu e eroare de cotă, dar munca poate fi incompletă.
    if (timer) clearTimeout(timer)
    return finish(0, (finalText || '') + `\n[plafon de ${maxRounds} runde atins]`, false, emit)
  } catch (e) {
    if (timer) clearTimeout(timer)
    if (timedOut) return finish(124, `TIMEOUT după ${timeoutMs}ms — oprit`, true, emit)
    return finish(1, `eroare neașteptată: ${String(e).slice(0, 300)}`, true, emit)
  }
}

function extractText(content) {
  return content
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('')
    .trim()
}
function finish(code, out, isError, emit) {
  emit({ type: 'result', result: out, is_error: !!isError })
  return { code, out }
}

// ── AUTO-TEST (fără API — exersează executorii de unelte). Rulează cu:
//     node bridge/kelion-native-coder.mjs --selftest
if (import.meta.url === `file://${process.argv[1]}` && process.argv.includes('--selftest')) {
  await (async () => {
    const os = await import('node:os')
    const { mkdtempSync, rmSync } = await import('node:fs')
    const dir = mkdtempSync(path.join(os.tmpdir(), 'nativecoder-'))
    let pass = 0
    let fail = 0
    const ok = (cond, name) => (cond ? (pass++, console.log(`  ok  ${name}`)) : (fail++, console.error(`  FAIL ${name}`)))
    try {
      // write + read
      toolWriteFile(dir, { path: 'a/b.txt', content: 'hello\nworld\n' })
      ok(toolReadFile(dir, { path: 'a/b.txt' }).includes('hello'), 'write+read')
      ok(toolReadFile(dir, { path: 'a/b.txt', offset: 1, limit: 1 }).trim() === 'world', 'read offset/limit')
      // edit unique
      toolEditFile(dir, { path: 'a/b.txt', old_string: 'hello', new_string: 'salut' })
      ok(toolReadFile(dir, { path: 'a/b.txt' }).includes('salut'), 'edit unique')
      // edit non-unique should throw
      toolWriteFile(dir, { path: 'dup.txt', content: 'x x x' })
      let threw = false
      try {
        toolEditFile(dir, { path: 'dup.txt', old_string: 'x', new_string: 'y' })
      } catch {
        threw = true
      }
      ok(threw, 'edit non-unique throws')
      ok(toolEditFile(dir, { path: 'dup.txt', old_string: 'x', new_string: 'y', replace_all: true }) && toolReadFile(dir, { path: 'dup.txt' }) === 'y y y', 'edit replace_all')
      // multi_edit atomic: second fails → nothing written
      toolWriteFile(dir, { path: 'm.txt', content: 'alpha beta' })
      threw = false
      try {
        toolMultiEdit(dir, { path: 'm.txt', edits: [{ old_string: 'alpha', new_string: 'A' }, { old_string: 'ZZZ', new_string: 'Z' }] })
      } catch {
        threw = true
      }
      ok(threw && toolReadFile(dir, { path: 'm.txt' }) === 'alpha beta', 'multi_edit atomic rollback')
      ok(toolMultiEdit(dir, { path: 'm.txt', edits: [{ old_string: 'alpha', new_string: 'A' }, { old_string: 'beta', new_string: 'B' }] }) && toolReadFile(dir, { path: 'm.txt' }) === 'A B', 'multi_edit success')
      // path safety
      threw = false
      try {
        toolReadFile(dir, { path: '../../etc/passwd' })
      } catch {
        threw = true
      }
      ok(threw, 'path escape blocked')
      // ls
      ok(toolLs(dir, { path: '.' }).includes('a/'), 'ls lists dirs')
      // glob
      ok(toolGlob(dir, { pattern: '**/*.txt' }).split('\n').length >= 3, 'glob **/*.txt')
      // bash
      const b = await toolBash(dir, { command: 'echo hi && exit 3' })
      ok(b.includes('exit 3') && b.includes('hi'), 'bash exit code + output')
      // grep
      await toolWriteFile(dir, { path: 'src.ts', content: 'const needle = 1\n' })
      const g = await toolGrep(dir, { pattern: 'needle' })
      ok(g.includes('needle'), 'grep finds match')
      // finish emits result event
      let ev = null
      const r = finish(0, 'done', false, (e) => (ev = e))
      ok(r.code === 0 && ev && ev.type === 'result' && ev.result === 'done' && ev.is_error === false, 'finish emits result')
      // toCliBlock mapping
      const blk = toCliBlock('id1', 'edit_file', { path: 'x.ts', new_string: 'NEW' })
      ok(blk.name === 'Edit' && blk.input.file_path === 'x.ts' && blk.input.new_string === 'NEW', 'toCliBlock maps edit_file→Edit')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
    console.log(`\nAUTO-TEST: ${pass} trecute, ${fail} picate`)
    process.exit(fail ? 1 : 0)
  })()
}
