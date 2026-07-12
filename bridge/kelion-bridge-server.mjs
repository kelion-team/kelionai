#!/usr/bin/env node
// PUNTEA KELION — worker SOLID (rulează pe serverul Contabo, systemd: kelion-bridge).
// Instalat cu INSTALEAZA-PUNTEA-NOUA.cmd de pe desktopul lui Adrian.
//
// Ce o face solidă:
//   1. Trage joburi ÎN PARALEL cu execuția — nu mai orbește cât timp răspunde
//      (cauza vechiului „puntea căzută" fals).
//   2. Primește ORICE fișier de la Adrian prin chat: poze, texte, arhive,
//      video — le scrie pe disc și Claude le citește (vocea vine deja
//      transcrisă în text de urechea lui Kelion).
//   3. Creier: Fable 5, cu rezervă automată Opus 4.8 dacă primul cade.
//   4. Imună la crash: orice eroare e prinsă, bucla nu moare niciodată;
//      systemd (repornire eternă) + paznicul la 1 minut o reînvie dacă totuși
//      pică sau se blochează procesul.
//
// Mediu (din /root/kelion/claude.env prin systemd): BRIDGE_SECRET,
// CLAUDE_CODE_OAUTH_TOKEN (abonamentul — NU cheia API plătită).
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'

const BASE = process.env.KELION_BASE || 'https://kelionai.app'
// Secretul vine din mediu SAU din fișierul de pe server (ca workerul vechi) —
// serviciul încarcă doar tokenul în env, secretul stă în bridge-secret.txt.
let SECRET = (process.env.BRIDGE_SECRET || '').trim()
if (!SECRET) {
  for (const p of ['/root/kelion/bridge-secret.txt', '/root/kelion/BRIDGE_SECRET']) {
    try {
      SECRET = readFileSync(p, 'utf8').trim()
      if (SECRET) break
    } catch {
      /* încearcă următoarea cale */
    }
  }
}
if (!SECRET) {
  console.error('BRIDGE_SECRET lipsă (nici în env, nici în bridge-secret.txt) — puntea nu poate porni')
  process.exit(1)
}
const MODELS = [
  process.env.KELION_FAST_MODEL || 'claude-fable-5',
  process.env.KELION_TOP_MODEL || 'claude-opus-4-8',
]
const JOBS_DIR = '/tmp/kelion-jobs'
const MAX_PARALLEL = 3

let context = ''
try {
  context = readFileSync('/root/kelion/context.md', 'utf8')
} catch {
  /* briefing absent — mergem fără el */
}

const HEADERS = { 'content-type': 'application/json', 'x-bridge-secret': SECRET }

async function api(pathname, body) {
  // Timeout OBLIGATORIU: un fetch fără limită rămânea agățat pentru totdeauna
  // la un sughiț de rețea și bucla murea „vie" — puntea părea căzută și
  // mesajele lui Adrian se pierdeau (4 iul). Long-poll-ul serverului ține 25s,
  // deci 40s acoperă orice răspuns legitim.
  const res = await fetch(BASE + pathname, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(40_000),
  })
  if (!res.ok) throw new Error(`${pathname} -> HTTP ${res.status}`)
  return res.json()
}

// Fișierele lui Adrian: base64 → disc, cu nume igienizate. Claude le citește.
function saveFiles(job) {
  const files = Array.isArray(job.files) ? job.files : []
  if (files.length === 0) return []
  const dir = path.join(JOBS_DIR, job.id)
  mkdirSync(dir, { recursive: true })
  const out = []
  for (const f of files) {
    try {
      const name =
        String(f.name || 'fisier')
          .replace(/[^\w.\- ăâîșțĂÂÎȘȚ]+/g, '_')
          .slice(0, 100) || 'fisier'
      const p = path.join(dir, name)
      writeFileSync(p, Buffer.from(String(f.data || ''), 'base64'))
      out.push(p)
    } catch (e) {
      console.error('fișier eșuat:', e.message)
    }
  }
  return out
}

// REGULA DE LIVRARE (Adrian, 4 iul): în chat ajunge DOAR mesajul FINAL al
// turei. Notele de lucru dintre apelurile de unelte („I found the bug, let me
// fix it…") sunt interne — au scăpat o dată în chat, în engleză, peste regula
// română-exclusiv. De aceea citim fluxul stream-json și păstrăm EXCLUSIV
// evenimentul `result` (răspunsul final), nu tot ce scrie modelul pe drum.
function runClaude(prompt, model, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(
      'claude',
      ['-p', prompt, '--model', model, '--allowedTools', 'Read', '--output-format', 'stream-json', '--verbose'],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: process.env,
      },
    )
    let raw = ''
    let err = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      resolve({ ok: false, text: '', err: 'timeout' })
    }, timeoutMs)
    child.stdout.on('data', (d) => {
      raw += d
    })
    child.stderr.on('data', (d) => {
      err += d
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      let text = ''
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue
        try {
          const ev = JSON.parse(line)
          if (ev.type === 'result' && typeof ev.result === 'string') text = ev.result.trim()
        } catch {
          /* linie non-JSON (zgomot) — o ignorăm, nu ajunge nimic intern în chat */
        }
      }
      resolve({ ok: code === 0 && text.length > 0, text, err: err.slice(0, 400) })
    })
    child.on('error', (e) => {
      clearTimeout(timer)
      resolve({ ok: false, text: '', err: e.message })
    })
  })
}

async function handle(job) {
  const t0 = Date.now()
  let text = ''
  // AICI SE RUPEA (unde se rupe, 5 iul): serverul așteaptă primul semn în 30s
  // (BRIDGE_STALL), dar workerul nu trimitea NIMIC până la răspunsul final —
  // orice răspuns la care Claude lucra 30–110s era tăiat, apoi ARUNCAT la
  // sosire (waiter-ul dispărut), iar retry-urile porneau rulări pentru nimeni.
  // Pulsul de viață (reply-chunk keepalive) ține tura vie cât modelul lucrează.
  const pulse =
    job.kind === 'chat'
      ? setInterval(() => {
          void api('/api/bridge/reply-chunk', { id: job.id, keepalive: true }).catch(() => {})
        }, 10_000)
      : null
  try {
    // PUBLIC (ordin Adrian, 10 iul): jobul unui VIZITATOR nu primește NICIODATĂ
    // context.md (privat) și nici personajul de admin — personaj neutru, atât.
    const isPublic = job.persona === 'public'
    const paths = isPublic ? [] : saveFiles(job)
    const filesNote =
      paths.length > 0
        ? `\n\nFIȘIERE ATAȘATE de Adrian (citește-le cu Read ÎNAINTE să răspunzi): ${paths.join(', ')}`
        : ''
    const prompt = isPublic
      ? 'You are Kelion — a refined, courteous personal AI assistant. The conversation below is with a VISITOR (not your owner). Answer their LAST message directly, briefly, in the language the instructions specify. Plain spoken sentences — no markdown, no asterisks (read aloud). Never mention your owner, his project, or any internal detail.\n\n' +
        job.prompt
      : (context ? `${context}\n\n` : '') +
        'Ești Kelion — vocea lui Claude pentru Adrian (adminul și singurul tău interlocutor aici). ' +
        'NU REFUZA NICIODATĂ: dacă ceva nu se poate chiar acum, spui „mă ocup" și zici pasul următor. ' +
        'Răspunde scurt și natural, fără markdown (e citit cu voce tare).\n\n' +
        job.prompt +
        filesNote
    // Fable 5 întâi; dacă pică, rezerva Opus — în bugetul de timp al punții.
    for (const model of MODELS) {
      const left = 145_000 - (Date.now() - t0)
      if (left < 20_000) break
      const r = await runClaude(prompt, model, Math.min(left, 110_000))
      if (r.ok) {
        text = r.text
        break
      }
      console.error(`${model} a eșuat: ${r.err}`)
    }
  } catch (e) {
    console.error('handle:', e.message)
  } finally {
    if (pulse) clearInterval(pulse)
    try {
      rmSync(path.join(JOBS_DIR, job.id), { recursive: true, force: true })
    } catch {
      /* curățenia nu blochează răspunsul */
    }
  }
  if (job.kind === 'chat') {
    try {
      await api('/api/bridge/reply', { id: job.id, text })
    } catch (e) {
      console.error('reply:', e.message)
    }
  }
}

let running = 0
async function main() {
  console.log('Puntea Kelion (solidă) pornită →', BASE)
  for (;;) {
    try {
      if (running >= MAX_PARALLEL) {
        await new Promise((r) => setTimeout(r, 1000))
        continue
      }
      const { job } = await api('/api/bridge/pull')
      if (job) {
        // Confirmare de primire: serverul știe că jobul A AJUNS. Fără ack, un
        // job servit pe o conexiune moartă era pierdut definitiv — serverul îl
        // relivrează acum dacă nu vede confirmarea în 15s.
        void api('/api/bridge/ack', { id: job.id }).catch(() => {})
        running++
        void handle(job).finally(() => {
          running--
        })
      }
    } catch (e) {
      console.error('pull:', e.message)
      await new Promise((r) => setTimeout(r, 5000))
    }
  }
}
void main()
