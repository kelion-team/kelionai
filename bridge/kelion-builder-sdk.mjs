#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════
// CONSTRUCTORUL pe AGENT SDK (Adrian, 5 iul) — maximul: coordonator care deleagă
// la DEVELOPER + TESTER ca subagenți NATIVI, pe ABONAMENT (zero cheie API plătită).
// Înlocuiește spawn('claude') + parsare manuală de stream-json cu biblioteca
// oficială @anthropic-ai/claude-agent-sdk (aceeași putere, cod curat).
//
// DOVEDIT că merge pe abonament: `apiKeySource: none` (rulat 5 iul).
//
// Rulează pe VPS ca serviciu (systemd), cu mediul:
//   CLAUDE_CODE_OAUTH_TOKEN = tokenul de abonament (din /root/kelion/claude.env)
//   ȘI FĂRĂ ANTHROPIC_API_KEY (altfel SDK-ul ar folosi cheia plătită).
//
// Integrare identică cu vechiul builder: polează /api/bridge/workorders, un
// worktree git izolat per job, streamează pașii pe monitor, comite pe vps-<id>,
// cere publicarea la poartă (ready-deploy). Poarta umană rămâne (deploy la „da").
// ══════════════════════════════════════════════════════════════════════════
import { query } from '@anthropic-ai/claude-agent-sdk'
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'

const BASE = process.env.KELION_BASE || 'https://kelionai.app'
const SECRET = readFileSync('/root/kelion/bridge-secret.txt', 'utf8').trim()
const REPO = '/root/kelion/repo'
const CAP = 2 // coordonatori în paralel (fiecare mai poate spawna subagenți) — VPS la ~limită

const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`)

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const c = spawn(cmd, args, { cwd: opts.cwd, env: process.env })
    let out = ''
    let err = ''
    const t = setTimeout(() => {
      c.kill('SIGKILL')
      resolve({ ok: false, out, err: err + ' TIMEOUT' })
    }, opts.timeoutMs ?? 60_000)
    c.stdout.on('data', (d) => (out += d))
    c.stderr.on('data', (d) => (err += d))
    c.on('close', (code) => {
      clearTimeout(t)
      resolve({ ok: code === 0, out, err })
    })
    c.on('error', (e) => {
      clearTimeout(t)
      resolve({ ok: false, out, err: e.message })
    })
  })
}

async function api(p, body) {
  const r = await fetch(BASE + p, {
    method: body ? 'POST' : 'GET',
    headers: { 'x-bridge-secret': SECRET, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!r.ok) throw new Error(`${p} HTTP ${r.status}`)
  return r.json()
}
async function mon(line) {
  await api('/api/bridge/activity', { line }).catch(() => {})
}
async function prog(pct, label, file = '') {
  await api('/api/bridge/progress', { pct, label, file }).catch(() => {})
}

// Personele subagenților: dezvoltatorul scrie, testerul verifică — separare de
// sarcini (cine scrie ≠ cine dă verdictul). Coordonatorul (agentul principal)
// taie sarcina și deleagă.
const DEVELOPER = {
  description: 'Inginer software senior. Modifică REAL codul cerut în directorul de lucru și compilează ce atinge.',
  prompt:
    'Ești developer senior cu 25 de ani experiență, sub coordonator. Execută sarcina primită: ' +
    'analizează codul relevant, modifică ȚINTIT, apoi COMPILEAZĂ ce ai atins ca dovadă ' +
    '(backend: cd backend && npm run build; frontend: cd frontend && npm run build). ' +
    'Nu te împrăștia — minimul corect care rezolvă. Raportează scurt ce ai schimbat.',
  tools: ['Read', 'Write', 'Edit', 'MultiEdit', 'Bash', 'Glob', 'Grep'],
}
const TESTER = {
  description: 'Inginer QA. Verifică independent codul și dă verdict PASS/FAIL cu dovada rulării reale.',
  prompt:
    'Ești tester QA cu 25 de ani experiență, sub coordonator. Verifici INDEPENDENT codul scris de developer: ' +
    'rulezi build-urile și, unde se poate, execuți codul. Dai verdict clar PASS sau FAIL, cu dovada rulării ' +
    '(ieșirea comenzii). Nu repari tu — doar verifici și raportezi.',
  tools: ['Read', 'Bash', 'Glob', 'Grep'],
}

const JOB_TIMEOUT_MS = 20 * 60_000 // plasă de siguranță: un job nu rulează la infinit
const HEARTBEAT_MS = 20_000 // cât timp nu vine niciun eveniment nou, anunț că încă lucrez

// Rulează un job prin Agent SDK: coordonatorul deleagă la developer + tester,
// streamând fiecare pas pe monitorul lui Adrian. Întoarce textul-rezumat final.
async function sdkBuild(dir, orderText, id) {
  const short = (p) => String(p ?? '').replace(/^.*\/repo\//, '').replace(/^.*\/work\/[0-9a-f]+\//, '')
  const seen = new Set()
  let result = ''
  let touched = 0
  const abortController = new AbortController()
  let heartbeatTimer = null
  let timedOut = false
  const armHeartbeat = () => {
    clearTimeout(heartbeatTimer)
    heartbeatTimer = setTimeout(() => {
      mon(`⏳ Coordonator ${id} încă lucrează…`).catch(() => {})
      armHeartbeat()
    }, HEARTBEAT_MS)
  }
  const jobTimeout = setTimeout(() => {
    timedOut = true
    abortController.abort()
  }, JOB_TIMEOUT_MS)
  const prompt =
    'Ești COORDONATORUL constructor al aplicației Kelionai (copia de cod curentă; live pe kelionai.app). ' +
    'Execută REAL DOAR acest ordin al lui Adrian, în directorul de lucru curent:\n\n' +
    'ORDIN: ' + orderText + '\n\n' +
    'Cum lucrezi: 1) deleagă la subagentul "developer" să modifice codul și să compileze ce a atins; ' +
    '2) deleagă la subagentul "tester" să verifice independent (build + rulare) și să dea PASS/FAIL. ' +
    'Dacă testerul dă FAIL, retrimite la developer cu ce a picat, apoi iar la tester (max 2 reluări). ' +
    'NU face deploy. La final scrie pe ULTIMA linie exact: ' +
    'REZUMAT: <ce s-a schimbat> — DOVADĂ: <ce a rulat testerul și rezultatul real, pe scurt: comenzi de build + ieșirea lor> — VERDICT: PASS/FAIL.'
  try {
    const q = query({
      prompt,
      options: {
        cwd: dir,
        permissionMode: 'acceptEdits',
        allowedTools: ['Read', 'Write', 'Edit', 'MultiEdit', 'Bash', 'Glob', 'Grep', 'Agent'],
        agents: { developer: DEVELOPER, tester: TESTER },
        abortController,
        maxTurns: 60,
      },
    })
    armHeartbeat()
    for await (const m of q) {
      armHeartbeat() // eveniment real primit → amân heartbeat-ul, nu spamez în paralel
      if (m.type === 'result' && typeof m.result === 'string') result = m.result
      if (m.type !== 'assistant') continue
      const inSub = !!m.parent_tool_use_id
      for (const b of m.message?.content ?? []) {
        if (b?.type !== 'tool_use') continue
        const n = b.name
        const inp = b.input ?? {}
        if (n === 'Agent' && inp.subagent_type) {
          await mon(`🤝 Coordonator → ${inp.subagent_type}`)
          await prog(35, `Deleg la ${inp.subagent_type}`)
        } else if ((n === 'Write' || n === 'Edit' || n === 'MultiEdit') && inp.file_path) {
          const f = short(inp.file_path)
          const key = `w:${f}`
          if (!seen.has(key)) {
            seen.add(key)
            touched++
            await mon(`${inSub ? '  ' : ''}✏️ ${n === 'Write' ? 'scriu' : 'editez'} ${f}`)
            await prog(Math.min(72, 40 + touched * 4), 'Modific fișiere', f)
          }
        } else if (n === 'Bash' && inp.command) {
          await mon(`${inSub ? '  ' : ''}🔧 rulez: ${String(inp.command).replace(/\s+/g, ' ').slice(0, 70)}`)
        } else if (n === 'Read' && inp.file_path) {
          const f = short(inp.file_path)
          const key = `r:${f}`
          if (!seen.has(key)) {
            seen.add(key)
            await mon(`${inSub ? '  ' : ''}👀 citesc ${f}`)
          }
        }
      }
    }
    // Abort-ul poate încheia iteratorul fără să arunce excepție — verificăm oricum.
    if (timedOut) {
      log(`AGENT ${id} SDK oprit după timeout (${JOB_TIMEOUT_MS / 60_000} min)`)
      await mon(`🔴 Coordonator ${id}: job oprit după depășirea timpului (${JOB_TIMEOUT_MS / 60_000} min) — verifică manual`)
    }
  } catch (e) {
    if (timedOut) {
      log(`AGENT ${id} SDK oprit după timeout (${JOB_TIMEOUT_MS / 60_000} min)`)
      await mon(`🔴 Coordonator ${id}: job oprit după depășirea timpului (${JOB_TIMEOUT_MS / 60_000} min) — verifică manual`)
    } else {
      log(`AGENT ${id} SDK eroare: ${e.message}`)
      await mon(`⚠️ Coordonator ${id}: ${String(e.message).slice(0, 80)}`)
    }
  } finally {
    clearTimeout(jobTimeout)
    clearTimeout(heartbeatTimer)
  }
  return result
}

async function build(order) {
  const id = order.id.slice(0, 8)
  const dir = `/root/kelion/work/${id}`
  const branch = `vps-${id}`
  log(`COORDONATOR ${id}: ${order.text.slice(0, 80)}`)
  await mon(`🧠 Coordonator ${id} pornit: ${order.text.slice(0, 70)}`)
  await prog(15, `Coordonator ${id} pornit`)
  await run('git', ['-C', REPO, 'fetch', 'origin'], { timeoutMs: 60_000 })
  await run('git', ['-C', REPO, 'worktree', 'remove', '--force', dir], { timeoutMs: 20_000 })
  const wt = await run('git', ['-C', REPO, 'worktree', 'add', '-f', '-B', branch, dir, 'origin/master'], {
    timeoutMs: 60_000,
  })
  if (!wt.ok) {
    await mon(`⚠️ Coordonator ${id}: nu am putut pregăti copia de lucru`)
    return
  }
  const out = await sdkBuild(dir, order.text, id)
  await prog(78, 'Compilez și verific')
  const finalLine = (out.match(/REZUMAT:\s*(.+)/) ?? [])[1] ?? out.trim().slice(-200)
  // Separă REZUMAT / DOVADĂ / VERDICT: DOVADA = ieșirea reală a testerului, trimisă
  // ca `proof` la ready-deploy → gata cu „fără dovadă de build atașată" (Adrian).
  const summary = (finalLine.split(/—\s*DOVAD[ĂA]:/i)[0] ?? finalLine).replace(/—\s*VERDICT:.*/i, '').trim().slice(0, 160)
  const proof = ((finalLine.match(/DOVAD[ĂA]:\s*([\s\S]+?)(?:—\s*VERDICT:|$)/i) ?? [])[1] ?? '').trim().slice(0, 280)
  const pass = /VERDICT:\s*PASS/i.test(out)
  await run('git', ['-C', dir, 'add', '-A'], { timeoutMs: 30_000 })
  const c = await run('git', ['-C', dir, 'commit', '-m', `SDK ${id}: ${order.text.slice(0, 50)}`], {
    timeoutMs: 30_000,
  })
  let pushed = false
  if (c.ok) {
    const p = await run('git', ['-C', dir, 'push', '-f', 'origin', branch], { timeoutMs: 60_000 })
    pushed = p.ok
  }
  if (c.ok && pushed) {
    // Poarta la publicare: anunț „gata"; DOAR „da"-ul lui Adrian publică (deployer).
    await prog(90, pass ? 'Gata (tester PASS) — aștept „da"' : 'Gata (tester nesigur) — aștept „da"')
    await api('/api/bridge/ready-deploy', { branch, summary: `${summary.slice(0, 120)}${pass ? ' [PASS]' : ''}`, proof }).catch(() => {})
    await mon(`✅ Coordonator ${id} gata${pass ? ' — tester PASS' : ''} — zi „da" ca să public`)
  } else if (c.ok && !pushed) {
    await mon(`⚠️ Coordonator ${id}: comis local dar push-ul a eșuat`)
  } else {
    await mon(`ℹ️ Coordonator ${id}: fără modificări de cod`)
  }
  await run('git', ['-C', REPO, 'worktree', 'remove', '--force', dir], { timeoutMs: 20_000 })
  log(`COORDONATOR ${id} ÎNCHEIAT`)
}

async function pool(items) {
  const running = new Set()
  for (const it of items) {
    const p = build(it)
      .catch((e) => log(`coordonator eroare: ${e.message}`))
      .finally(() => running.delete(p))
    running.add(p)
    if (running.size >= CAP) await Promise.race(running)
  }
  await Promise.all(running)
}

log('CONSTRUCTORUL pe AGENT SDK pornit — coordonator + developer + tester, pe abonament')
for (;;) {
  try {
    const j = await api('/api/bridge/workorders')
    const orders = j.orders ?? []
    if (orders.length > 0) {
      log(`${orders.length} ordine noi → ${Math.min(orders.length, CAP)} coordonatori în paralel`)
      await pool(orders)
    }
  } catch (e) {
    log(`eroare: ${e.message}`)
  }
  await new Promise((r) => setTimeout(r, 20_000))
}
