// Kelion admin bridge — Linux/server worker. Runs 24/7 on the Contabo box as a
// systemd service. Pulls the owner's ADMIN messages from kelionai.app and answers
// them with Claude Code on HIS subscription (zero API-key cost). The auth token
// is provided by systemd (CLAUDE_CODE_OAUTH_TOKEN, from /root/kelion/claude.env).
//
// Model failover: Fable 5 is the brain. If a Fable call fails, the SAME request
// is re-served by Opus 4.8 and Fable is rested for 10 minutes; after that it is
// probed again and, once healthy, becomes primary once more — automatically.
import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

const BASE = process.env.KELION_BASE ?? 'https://kelionai.app'
const SECRET = readFileSync('/root/kelion/bridge-secret.txt', 'utf8').trim()
const CLAUDE = 'claude'

// Full project + session memory so this fresh server session knows everything
// (Kelionai, the architecture, what was built, decisions). Prepended to every
// admin message so Kelion never starts "blank". Reloaded on each message so it
// can be updated without restarting the service.
function loadContext() {
  try {
    return readFileSync('/root/kelion/context.md', 'utf8')
  } catch {
    return ''
  }
}

const MODEL = 'claude-fable-5'
const RESERVE = 'claude-opus-4-8'
const REST_MS = 10 * 60_000
let fableDownUntil = 0
const brainModel = () => (Date.now() < fableDownUntil ? RESERVE : MODEL)

// CHAT ONLY. This unattended server worker answers the admin's messages with
// text — it NEVER edits or runs project code (no acceptEdits, no repo). Code
// repairs stay supervised (done with the owner present), never automatically
// from a chat message on a server.
// CHAT INSTANT (Adrian, 10 iul): preambul SCURT, conversațional. Cel vechi îl
// făcea agent care explora serverul (git/journalctl/curl) ~30s înainte să scrie
// un cuvânt — de-aia dura 31s. Acum: răspunde DIRECT din context, fără unelte.
const PREAMBLE = `Ești creierul lui Kelion, pentru adminul tău, Adrian. Mai jos e conversația recentă. Răspunde DIRECT și IMEDIAT la ultimul mesaj al lui Adrian, în limba lui, scurt și la obiect, fără markdown și fără asteriscuri (răspunsul e citit cu voce tare).

Ești conversațional: răspunde pe loc din ce ți se dă în context. NU folosi unelte, NU explora fișiere, NU rula comenzi — doar răspunde. Dacă Adrian cere o reparație/modificare în aplicație, spune-i scurt că te ocupi / ai trimis-o la execuție (n-o face tu aici). Dacă cere ceva ce ține de uneltele live ale lui Kelion (hărți, monitor, imagini, pagini), spune-i să înceapă mesajul cu „Kelion". Nu spune niciodată „nu pot" — dă mereu un răspuns real și util, pe loc.

Conversația:
`

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`)
}

// FIȘIERE ATAȘATE (Adrian, 10 iul: „dacă trimit poza cu textul nu merge").
// Cauza: jobul PURTA fișierele (job.files), dar workerul le ignora complet, deci
// pozele nu ajungeau niciodată la creier. Acum le scriem pe disc în /root/kelion
// (deja în --add-dir) și-i spunem creierului calea, ca să le citească/privească.
const INBOX = '/root/kelion/inbox'
function saveJobFiles(job) {
  const files = Array.isArray(job.files) ? job.files : []
  if (!files.length) return ''
  const paths = []
  try {
    mkdirSync(INBOX, { recursive: true })
  } catch {}
  for (const f of files) {
    try {
      const b64 = String(f?.data || '').split(',').pop() || ''
      if (!b64) continue
      const safe = String(f?.name || 'fisier').replace(/[^\w.\-]+/g, '_').slice(0, 80)
      const p = `${INBOX}/${job.id.slice(0, 8)}_${safe}`
      writeFileSync(p, Buffer.from(b64, 'base64'))
      paths.push(p)
    } catch (e) {
      log(`nu am putut scrie un fisier atasat: ${e.message}`)
    }
  }
  if (!paths.length) return ''
  log(`${paths.length} fisier(e) atasat(e) scrise pentru creier.`)
  return `\n\nFIȘIERE ATAȘATE de Adrian (citește-le/privește-le cu uneltele tale — Read — ÎNAINTE să răspunzi):\n${paths.map((p) => `- ${p}`).join('\n')}\n`
}

// VITEZA MAXIMĂ (Adrian, 10 iul: „creierul Linux e foarte încet"). Cauza reală:
// modul `--output-format text` aștepta ÎNTREG răspunsul (60–90s) și-l trimitea
// dintr-o dată — Adrian se holba la „analizează 30%" fără nimic, apoi apărea tot.
// Acum STREAM: cuvintele curg pe măsură ce creierul le scrie (primul cuvânt în
// ~2s), exact ce așteaptă puntea (reply-chunk → bara sare la 65%, textul curge).
// `onChunk(text)` primește fiecare bucată; întoarce textul COMPLET (sau null).
// Argumente CLI. Chat PUR = FĂRĂ unelte → modelul răspunde direct din context,
// primul cuvânt în ~2s (nu mai explorează serverul 30s). Cu POZĂ atașată =
// permite DOAR Read pe folderul de poze, ca să le poată privi. Peste tot tăiem
// secțiunile dinamice uriașe din promptul implicit → prefill mult mai mic.
function claudeArgs({ streaming, model, hasFiles }) {
  const args = ['-p']
  if (streaming) args.push('--output-format', 'stream-json', '--verbose', '--include-partial-messages')
  else args.push('--output-format', 'text')
  // CHAT PUR: NU grantăm unelte și NU dăm --add-dir. Cauza reală a celor 31s era
  // --add-dir /root/kelion (repo întreg de explorat) + unelte. Fără ele, modelul
  // răspunde direct din context (instant). Folosim DOAR flag-uri dovedite — flag-
  // urile noi (--disallowedTools/--exclude-dynamic...) lipseau din CLI-ul de pe
  // VPS și RUPEAU workerul (niciun răspuns). Cu POZĂ: Read + folderul de poze.
  if (hasFiles) args.push('--allowedTools', 'Read', '--add-dir', INBOX)
  if (model) args.push('--model', model)
  return args
}

function runClaudeStream(prompt, { timeoutMs, model, onChunk, hasFiles } = {}) {
  return new Promise((resolve) => {
    const args = claudeArgs({ streaming: true, model, hasFiles })
    const child = spawn(CLAUDE, args, { env: process.env })
    let streamed = '' // ce am trimis deja prin onChunk (bucățile difuzate)
    let finalText = '' // răspunsul autoritar din evenimentul `result`
    let buf = ''
    let err = ''
    const killer = setTimeout(() => {
      child.kill()
      resolve((finalText || streamed).trim() || null)
    }, timeoutMs)
    child.stdout.on('data', (d) => {
      buf += d.toString()
      let nl
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (!line) continue
        let ev
        try {
          ev = JSON.parse(line)
        } catch {
          continue
        }
        // Token-uri parțiale (creierul scrie ACUM) → difuzează-le pe loc.
        if (
          ev.type === 'stream_event' &&
          ev.event?.type === 'content_block_delta' &&
          ev.event.delta?.type === 'text_delta'
        ) {
          const t = ev.event.delta.text || ''
          if (t) {
            streamed += t
            onChunk?.(t)
          }
        } else if (ev.type === 'result' && typeof ev.result === 'string') {
          // Răspunsul final complet (autoritar). Îl păstrăm pe cel mai lung.
          if (ev.result.trim().length > finalText.trim().length) finalText = ev.result
        }
      }
    })
    child.stderr.on('data', (d) => (err += d))
    child.on('close', () => {
      clearTimeout(killer)
      const full = (finalText.trim().length >= streamed.trim().length ? finalText : streamed).trim()
      // Dacă finalul e mai lung decât ce-am difuzat (și e o continuare curată),
      // trimite coada lipsă ca ultimă bucată — să nu piardă Adrian sfârșitul.
      if (full && full.length > streamed.length && full.startsWith(streamed)) {
        const tail = full.slice(streamed.length)
        if (tail) onChunk?.(tail)
      }
      if (!full && err.trim()) log(`claude stderr: ${err.trim().slice(0, 200)}`)
      resolve(full || null)
    })
    child.stdin.write(prompt)
    child.stdin.end()
  })
}

// PLASĂ DE SIGURANȚĂ: modul text vechi (dovedit), fără streaming. Folosit doar
// dacă streamingul nu scoate nimic (versiune de CLI fără `stream-json`) — așa
// nu coborâm NICIODATĂ sub comportamentul de azi.
function runClaudeText(prompt, { timeoutMs, model, hasFiles } = {}) {
  return new Promise((resolve) => {
    const args = claudeArgs({ streaming: false, model, hasFiles })
    const child = spawn(CLAUDE, args, { env: process.env })
    let out = ''
    let err = ''
    const killer = setTimeout(() => {
      child.kill()
      resolve(null)
    }, timeoutMs)
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))
    child.on('close', () => {
      clearTimeout(killer)
      if (out.trim()) resolve(out.trim())
      else {
        if (err.trim()) log(`claude stderr: ${err.trim().slice(0, 200)}`)
        resolve(null)
      }
    })
    child.stdin.write(prompt)
    child.stdin.end()
  })
}

// Chat cu streaming + failover de model. Încearcă Fable (dacă nu se odihnește),
// stream; dacă streamul nu scoate text, cade pe modul text (aceeași cerere);
// dacă tot nimic și eram pe Fable, trece pe Opus și odihnește Fable 10 min.
async function askClaude(prompt, onChunk, hasFiles) {
  const model = brainModel()
  const full = loadContext() + '\n\n' + PREAMBLE + prompt
  // Buget de timp MĂRGINIT (Adrian, 10 iul + audit): serverul renunță la 75s și
  // maxTries=1, deci n-are rost să măcinăm minute pe un job pe care serverul
  // deja l-a uitat. Chatul fără unelte răspunde în ~2s, deci pragurile astea nu
  // se ating decât la rațiune grea; cascada e scurtă, nu 4×120s ca înainte.
  let answer = await runClaudeStream(full, { timeoutMs: 90_000, model, onChunk, hasFiles })
  if (!answer) answer = await runClaudeText(full, { timeoutMs: 45_000, model, hasFiles })
  if (!answer && model === MODEL) {
    fableDownUntil = Date.now() + REST_MS
    log('Fable a esuat — trec pe Opus, revin la Fable in 10 min.')
    answer = await runClaudeStream(full, { timeoutMs: 90_000, model: RESERVE, onChunk, hasFiles })
  }
  return answer
}

async function pull() {
  // Timeout obligatoriu: fără el, un sughiț de rețea lăsa fetch-ul agățat pe
  // veci și bucla murea „vie" — puntea părea căzută (4 iul). Long-poll = 25s.
  const res = await fetch(`${BASE}/api/bridge/pull`, {
    method: 'POST',
    headers: { 'x-bridge-secret': SECRET, 'Content-Type': 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(40_000),
  })
  if (res.status === 401) throw new Error('Secret respins de server')
  if (!res.ok) throw new Error(`pull HTTP ${res.status}`)
  const j = await res.json()
  const job = j.job ?? null
  // Confirmare de primire — serverul relivrează jobul dacă nu vede ack-ul.
  if (job) {
    void fetch(`${BASE}/api/bridge/ack`, {
      method: 'POST',
      headers: { 'x-bridge-secret': SECRET, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: job.id }),
      signal: AbortSignal.timeout(15_000),
    }).catch(() => {})
  }
  return job
}

async function sendReply(id, text) {
  await fetch(`${BASE}/api/bridge/reply`, {
    method: 'POST',
    headers: { 'x-bridge-secret': SECRET, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, text }),
    signal: AbortSignal.timeout(30_000),
  })
}

log(`Puntea non-stop PORNITA -> ${BASE} (model principal ${MODEL}, rezerva ${RESERVE})`)
for (;;) {
  try {
    const job = await pull()
    if (!job) continue
    if (job.kind === 'repair') {
      // Repairs are NOT executed by this unattended server worker (safety).
      // Return empty so the request is handled supervised elsewhere.
      await sendReply(job.id, '')
      log(`Reparatie ignorata pe server (se fac supravegheat): ${job.id.slice(0, 8)}`)
      continue
    }
    log(`Mesaj admin (${job.id.slice(0, 8)}) — model ${brainModel()}...`)
    const t0 = Date.now()
    let firstAt = 0
    // BUCĂȚILE difuzate se strâng într-un tampon și se trimit la ~150ms (coalesced)
    // ca să nu inundăm puntea cu zeci de POST-uri, dar textul tot curge live.
    let pending = ''
    const flush = () => {
      if (!pending) return
      const text = pending
      pending = ''
      void fetch(`${BASE}/api/bridge/reply-chunk`, {
        method: 'POST',
        headers: { 'x-bridge-secret': SECRET, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: job.id, text }),
        signal: AbortSignal.timeout(15_000),
      }).catch(() => {})
    }
    const onChunk = (t) => {
      if (!firstAt) firstAt = Date.now()
      pending += t
    }
    // La 150ms: dacă a curs text, trimite-l; altfel PULS DE VIAȚĂ (creierul
    // gândește) — ține tura vie cât timp Claude chiar lucrează (răspunsurile de
    // 30–80s mureau altfel). Ambele merg pe reply-chunk.
    let sinceBeat = 0
    const pulse = setInterval(() => {
      if (pending) {
        flush()
        sinceBeat = 0
      } else if ((sinceBeat += 150) >= 9000) {
        sinceBeat = 0
        void fetch(`${BASE}/api/bridge/reply-chunk`, {
          method: 'POST',
          headers: { 'x-bridge-secret': SECRET, 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: job.id, keepalive: true }),
          signal: AbortSignal.timeout(15_000),
        }).catch(() => {})
      }
    }, 150)
    let answer
    try {
      // Atașează pozele/fișierele jobului (dacă există) la prompt. Doar când
      // există fișiere permitem Read (ca să le privească); altfel chat pur, fără
      // unelte → instant.
      const fileNote = saveJobFiles(job)
      answer = await askClaude(job.prompt + fileNote, onChunk, fileNote !== '')
    } finally {
      clearInterval(pulse)
      flush() // orice bucată rămasă în tampon pleacă acum
    }
    if (answer) {
      await sendReply(job.id, answer)
      const totalMs = Date.now() - t0
      const firstMs = firstAt ? firstAt - t0 : 0
      log(`Raspuns trimis (${answer.length} car, ${totalMs}ms, primul cuvant ${firstMs || '—'}ms).`)
    } else {
      await sendReply(job.id, '')
      log('Fara raspuns — Kelion foloseste creierul normal pentru acest mesaj.')
    }
  } catch (e) {
    log(`Eroare: ${e.message} — reincerc in 10s`)
    await new Promise((r) => setTimeout(r, 10_000))
  }
}
