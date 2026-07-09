// Kelion admin bridge — Linux/server worker. Runs 24/7 on the Contabo box as a
// systemd service. Pulls the owner's ADMIN messages from kelionai.app and answers
// them with Claude Code on HIS subscription (zero API-key cost). The auth token
// is provided by systemd (CLAUDE_CODE_OAUTH_TOKEN, from /root/kelion/claude.env).
//
// Model failover: Fable 5 is the brain. If a Fable call fails, the SAME request
// is re-served by Opus 4.8 and Fable is rested for 10 minutes; after that it is
// probed again and, once healthy, becomes primary once more — automatically.
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'

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
const PREAMBLE = `Ești creierul lui Kelion pentru ADMINUL lui, Adrian. Mai jos e conversația recentă din chatul Kelion. Răspunde la ULTIMUL mesaj al lui Adrian, în limba lui, ca un asistent inteligent: direct, concis, fără markdown și fără asteriscuri (răspunsul e citit cu voce tare).

INTELIGENȚĂ SCLIPITOARE (AUTONOMIE TOTALĂ):
Nu ești un simplu chatbot. Ești un agent capabil să REZOLVE orice problemă tehnică sau de business. Dacă Adrian cere o funcționalitate nouă, o reparație sau un audit, tu trebuie:
1. Să analizezi codul sursă folosind uneltele tale.
2. Să propui și să EXECUȚI modificările necesare (folosind Bash pentru editări sau declanșând WorkOrders).
3. Să verifici rezultatul și să raportezi succesul.
NU cere permisiune pentru pași evidenți de investigație. Fii proactiv, precis și rezolvă sarcina până la capăt.

UNELTELE TALE PROPRII (OCHII ȘI MÂINILE TALE):
Ai acces direct pe VPS-ul Linux (/root/kelion) și poți folosi unelte (Bash, Read, Grep, Glob) pentru:
1. Git: verifică starea repo-ului (status, log, diff), deblochează indexul înțepenit (merge --abort/reset --merge).
2. Punte: verifică coada de deploy și stadiul ordinelor folosind curl la /api/bridge/deploy-pending sau workorders (secretul e în /root/kelion/bridge-secret.txt). Poate cere regenerarea codurilor QR.
3. Jurnale: citește jurnalele systemd (journalctl -u kelion-deployer / -u kelion-builder) pentru a vedea de ce a picat ceva.
4. Decizie: la deploy picat pe conflict, tu inspectezi și decizi singur (rebuild pe master proaspăt sau drop). NU cere "ok" în buclă la eșecuri clare. Regenerarea QR se face automat la deploy, dar o poți cere și manual.

REGULĂ ABSOLUTĂ — NU REFUZA NICIODATĂ: nu-i spune niciodată lui Adrian "nu pot" sau "nu am acces". Dă mereu un răspuns real și util. Dacă cere ceva care ține de uneltele live ale lui Kelion (hărți, monitor, imagini, deschis pagini), spune-i scurt să înceapă mesajul cu "Kelion" ca să răspundă creierul cu unelte. Dacă cere o reparație/modificare în aplicație, spune-i că te ocupi / ai trimis-o să fie construită — niciodată ca un refuz. Orice ar cere, primește un răspuns care ajută, nu un zid.

Conversația:
`

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`)
}

function runClaude(prompt, { timeoutMs, model } = {}) {
  return new Promise((resolve) => {
    // Text answer only: no tools, no file access, no edit permissions.
    const args = [
      '-p',
      '--output-format', 'text',
      '--allowedTools', 'Bash,Read,Grep,Glob',
      '--add-dir', '/root/kelion'
    ]
    if (model) args.push('--model', model)
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

// Chat with model failover: try Fable (unless resting), fall back to Opus and
// rest Fable on failure. Fable returns automatically once the rest window ends.
async function askClaude(prompt) {
  const model = brainModel()
  const full = loadContext() + '\n\n' + PREAMBLE + prompt
  // Timeout generos (120s): întrebările grele (raționament avansat) durează
  // legitim 60–90s. Pulsul de viață (mai jos, la 10s) ține serverul în așteptare
  // cât timp Claude chiar lucrează, deci nu mai apare fals „mi s-a rupt legătura".
  let answer = await runClaude(full, { timeoutMs: 120_000, model })
  if (!answer && model === MODEL) {
    fableDownUntil = Date.now() + REST_MS
    log('Fable a esuat — trec pe Opus, revin la Fable in 10 min.')
    answer = await runClaude(full, { timeoutMs: 120_000, model: RESERVE })
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
    // PULS DE VIAȚĂ: serverul taie tura la 30s fără niciun semn și aruncă apoi
    // răspunsul terminat — răspunsurile de 30–80s mureau toate. Pulsul
    // (reply-chunk keepalive) ține tura vie cât timp Claude chiar lucrează.
    const pulse = setInterval(() => {
      void fetch(`${BASE}/api/bridge/reply-chunk`, {
        method: 'POST',
        headers: { 'x-bridge-secret': SECRET, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: job.id, keepalive: true }),
        signal: AbortSignal.timeout(15_000),
      }).catch(() => {})
    }, 10_000)
    let answer
    try {
      answer = await askClaude(job.prompt)
    } finally {
      clearInterval(pulse)
    }
    if (answer) {
      await sendReply(job.id, answer)
      log(`Raspuns trimis (${answer.length} car).`)
    } else {
      await sendReply(job.id, '')
      log('Fara raspuns — Kelion foloseste creierul normal pentru acest mesaj.')
    }
  } catch (e) {
    log(`Eroare: ${e.message} — reincerc in 10s`)
    await new Promise((r) => setTimeout(r, 10_000))
  }
}
