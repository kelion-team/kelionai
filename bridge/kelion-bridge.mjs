// Puntea de admin — rulează pe laptopul lui Adrian. Ia mesajele lui de admin
// din Kelion (long-poll), le răspunde cu Claude Code LOCAL (abonamentul lui,
// zero cost API) și trimite răspunsul înapoi în chatul Kelion.
//
// Pornire:  dublu-click pe PORNESTE-PUNTEA.cmd (sau: node kelion-bridge.mjs)
// Oprire:   închide fereastra. Kelion revine automat pe creierul normal.
import { spawn } from 'node:child_process'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import path from 'node:path'

const BASE = process.env.KELION_BASE ?? 'https://kelionai.app'

// Claude Code CLI vine cu aplicația desktop — alege automat cea mai nouă
// versiune instalată, ca update-urile aplicației să nu rupă puntea.
function findClaude() {
  const root = path.join(process.env.APPDATA ?? '', 'Claude', 'claude-code')
  const versions = readdirSync(root).sort((a, b) =>
    b.localeCompare(a, undefined, { numeric: true }),
  )
  for (const v of versions) {
    const exe = path.join(root, v, 'claude.exe')
    if (existsSync(exe)) return exe
  }
  throw new Error('claude.exe negăsit — instalează/deschide aplicația Claude Code desktop.')
}
const CLAUDE = findClaude()
const SECRET = readFileSync(
  process.env.BRIDGE_SECRET_FILE ?? 'C:\\Users\\adria\\Kelionai-secrets\\bridge-secret.txt',
  'utf8',
).trim()

const PREAMBLE = `Ești creierul lui Kelion pentru ADMINUL lui, Adrian. Mai jos e conversația recentă din chatul Kelion. Răspunde la ULTIMUL mesaj al lui Adrian, în limba lui, ca un asistent inteligent: direct, concis, fără markdown și fără asteriscuri (răspunsul e citit cu voce tare). Nu ai acces la uneltele lui Kelion (hărți, monitor, imagini) — dacă cere așa ceva, spune-i să înceapă mesajul cu "Kelion" ca să răspundă creierul cu unelte.

Conversația:
`

function log(msg) {
  console.log(`[${new Date().toLocaleTimeString()}] ${msg}`)
}

const PROJECT_DIR = 'C:\\Users\\adria\\Kelionai'
const REPAIR_PREAMBLE = `Ești Claude Code, lucrezi în proiectul Kelionai (aplicația live pe kelionai.app). ADMINUL, Adrian, ți-a trimis prin Kelion următoarea cerere de REPARAȚIE/MODIFICARE. Investighează, fă schimbarea corect în cod, compilează (backend: "cd backend; npm run build") și, dacă e o schimbare care trebuie live, spune la final CLAR ce ai schimbat și dacă e nevoie de redeploy. Nu inventa — dacă ai nevoie de o clarificare, spune-o. Cererea lui Adrian:

`

// Chat: Claude local pe abonament, DOAR text, fără unelte, promptul pe stdin.
// PUBLIC (ordin Adrian, 10 iul): jobul unui VIZITATOR nu primește personajul de
// admin — personaj neutru Kelion, fără nicio mențiune internă.
const PUBLIC_PREAMBLE = `You are Kelion — a refined, courteous personal AI assistant. The conversation below is with a VISITOR (not your owner). Answer their LAST message directly, briefly, in the language the instructions specify. Plain spoken sentences — no markdown, no asterisks (read aloud). Never mention your owner, his project, or any internal detail.

`
function askClaude(prompt, isPublic) {
  return runClaude([(isPublic ? PUBLIC_PREAMBLE : PREAMBLE) + prompt], { timeoutMs: 80_000 })
}

// Repair: Claude Code în directorul proiectului, cu drept de editare, ca să
// facă efectiv reparația cerută de admin. Durează mai mult — timeout generos.
function runRepair(description) {
  return runClaude(
    [REPAIR_PREAMBLE + description],
    { timeoutMs: 20 * 60_000, cwd: PROJECT_DIR, edit: true },
  )
}

function runClaude([prompt], { timeoutMs, cwd, edit } = {}) {
  return new Promise((resolve) => {
    const args = ['-p', '--output-format', 'text']
    // Pentru reparații: permite editarea fișierelor fără confirmare interactivă
    // (rulează neatins, headless). Doar pentru canalul de repair al adminului.
    if (edit) args.push('--permission-mode', 'acceptEdits')
    const child = spawn(CLAUDE, args, { windowsHide: true, cwd: cwd ?? undefined })
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

async function pull() {
  // Timeout obligatoriu: fără el, un sughiț de rețea lăsa fetch-ul agățat pe
  // veci și puntea murea „vie" — mesajele lui Adrian se pierdeau (4 iul).
  const res = await fetch(`${BASE}/api/bridge/pull`, {
    method: 'POST',
    headers: { 'x-bridge-secret': SECRET, 'Content-Type': 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(40_000),
  })
  if (res.status === 401) throw new Error('Secret respins de server — verifică BRIDGE_SECRET pe Railway.')
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

log(`Puntea de admin PORNITĂ → ${BASE} (Ctrl+C pentru oprire)`)
log('Mesajele tale de admin din Kelion vor fi răspunse de Claude Code local, pe abonament.')
for (;;) {
  try {
    const job = await pull()
    if (!job) continue // long-poll a expirat fără mesaje — reia
    if (job.kind === 'repair') {
      // Fire-and-forget: confirmă imediat primirea, apoi lucrează în fundal în
      // repo. Nu blochează bucla — următorul mesaj de chat e servit între timp.
      await sendReply(job.id, 'ok')
      log(`CERERE DE REPARAȚIE primită (${job.id.slice(0, 8)}) — pornesc Claude Code în proiect…`)
      runRepair(job.prompt).then((res) => {
        if (res) log(`Reparație terminată (${job.id.slice(0, 8)}):\n${res.slice(0, 600)}`)
        else log(`Reparația (${job.id.slice(0, 8)}) nu a produs rezultat — verifică manual.`)
      })
      continue
    }
    log(`Mesaj primit (${job.id.slice(0, 8)}) — întreb Claude local…`)
    const answer = await askClaude(job.prompt, job.persona === 'public')
    if (answer) {
      await sendReply(job.id, answer)
      log(`Răspuns trimis (${answer.length} caractere).`)
    } else {
      await sendReply(job.id, '')
      log('Claude local nu a răspuns — Kelion folosește creierul normal pentru acest mesaj.')
    }
  } catch (e) {
    log(`Eroare: ${e.message} — reîncerc în 10s`)
    await new Promise((r) => setTimeout(r, 10_000))
  }
}
