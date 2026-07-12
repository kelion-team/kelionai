#!/usr/bin/env node
// UNEALTA DE CAPABILITATE A LUI KELION — „stie de ce are nevoie, isi instaleaza
// dependintele constient" (Adrian, 12 iul). Determinist, fara LLM: Kelion ALEGE
// numele capabilitatii (rationament), ASTA o executa fix din registru.
//
// Subcomenzi:
//   node kelion-capability.mjs probe            → FAPTELE reale (ochii lui): ce
//        binare/servicii/containere exista, disc, retea. Le pune in context ca
//        sa decida din realitate, nu din memorie.
//   node kelion-capability.mjs list             → ce rete cunoaste.
//   node kelion-capability.mjs need <nume>      → detect→install→verify pentru o
//        reteta din registru SAU generic: apt:<pachet>, npm:<pachet> (in backend).
//        Iese 0 doar daca verificarea da dovada reala. Fara dovada, fara succes.
//
// Reteta noua invatata = o adaugi in bridge/kelion-capabilities.json.
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const REGISTRY = join(HERE, 'kelion-capabilities.json')
// Doar litere/cifre/punct/minus — Kelion nu poate injecta comenzi prin nume.
const SAFE_NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/i

function loadRegistry() {
  try {
    return JSON.parse(readFileSync(REGISTRY, 'utf8')).recipes || {}
  } catch (e) {
    console.error(`[capability] nu pot citi registrul (${REGISTRY}): ${e}`)
    return {}
  }
}

function sh(cmd, timeoutMs = 180_000) {
  return new Promise((resolve) => {
    const c = spawn('bash', ['-lc', cmd], { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    const t = setTimeout(() => c.kill('SIGKILL'), timeoutMs)
    c.stdout.on('data', (d) => (out += d))
    c.stderr.on('data', (d) => (err += d))
    c.on('close', (code) => {
      clearTimeout(t)
      resolve({ code, out: out.trim(), err: err.trim() })
    })
    c.on('error', (e) => {
      clearTimeout(t)
      resolve({ code: -1, out: out.trim(), err: String(e) })
    })
  })
}

async function probe() {
  console.log('=== SONDA DE CAPABILITATE (faptele reale) ===')
  const bins = ['node', 'npm', 'docker', 'caddy', 'ffmpeg', 'python3', 'git', 'curl', 'sshpass', 'ufw']
  const found = []
  for (const b of bins) {
    const r = await sh(`command -v ${b} >/dev/null 2>&1 && ${b} --version 2>&1 | head -1 || echo LIPSA`)
    console.log(`  ${b.padEnd(9)} : ${r.out || 'LIPSA'}`)
    if (!/LIPSA/.test(r.out)) found.push(b)
  }
  console.log('--- servicii systemd ---')
  const svc = await sh(`for s in kelion-builder kelion-bridge kelion-paznic kelion-deployer docker; do printf '  %-16s ' "$s"; systemctl is-active "$s" 2>/dev/null || echo '?'; done`)
  console.log(svc.out)
  console.log('--- containere docker ---')
  const dk = await sh(`docker ps --format '  {{.Names}} {{.Status}} {{.Ports}}' 2>/dev/null | head -10 || echo '  (docker indisponibil)'`)
  console.log(dk.out || '  (niciunul)')
  console.log('--- disc & incarcare ---')
  const sys = await sh(`echo -n '  '; df -h / | tail -1; echo -n '  '; uptime`)
  console.log(sys.out)
  console.log(`=== rezumat: prezente = ${found.join(', ')} ===`)
}

function list() {
  const reg = loadRegistry()
  console.log('=== RETE CUNOSCUTE ===')
  for (const [name, r] of Object.entries(reg)) {
    console.log(`  ${name.padEnd(16)} — ${r.descriere || ''}`)
    if (r.necesita?.length) console.log(`  ${''.padEnd(16)}   (necesita: ${r.necesita.join(', ')})`)
  }
  console.log('  generic: apt:<pachet>, npm:<pachet>')
}

// Rezolva o capabilitate. Intoarce true doar cu dovada reala (verify).
async function need(name, seen = new Set()) {
  if (!SAFE_NAME.test(name.replace(/^(apt|npm):/, ''))) {
    console.error(`[capability] nume invalid: ${name}`)
    return false
  }
  if (seen.has(name)) return true // ciclu de dependente — deja tratat
  seen.add(name)

  // Generic apt:<pachet>
  if (name.startsWith('apt:')) {
    const pkg = name.slice(4)
    return runRecipe(name, {
      detect: `dpkg -s ${pkg} >/dev/null 2>&1`,
      install: `apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y ${pkg}`,
      verify: `dpkg -s ${pkg} 2>/dev/null | grep -i '^Status: install ok installed' && echo '${pkg} instalat'`,
    })
  }
  // Generic npm:<pachet> (in backend)
  if (name.startsWith('npm:')) {
    const pkg = name.slice(4)
    const repo = ['/root/kelion/repo', '/root/kelion', '/root/Kelionai'].find((d) => existsSync(`${d}/backend/package.json`)) || '.'
    return runRecipe(name, {
      detect: `test -d ${repo}/backend/node_modules/${pkg}`,
      install: `cd ${repo}/backend && npm install ${pkg}`,
      verify: `test -d ${repo}/backend/node_modules/${pkg} && echo '${pkg} in node_modules'`,
    })
  }

  const reg = loadRegistry()
  const r = reg[name]
  if (!r) {
    console.error(`[capability] reteta necunoscuta: ${name}. Ruleaza „list" sau foloseste apt:/npm:.`)
    return false
  }
  // Dependentele intai (ex: tls-pentru-ip necesita docker + caddy).
  for (const dep of r.necesita || []) {
    if (!(await need(dep, seen))) {
      console.error(`[capability] dependenta „${dep}" a lui „${name}" a esuat`)
      return false
    }
  }
  return runRecipe(name, r)
}

async function runRecipe(name, r) {
  console.log(`\n=== NECESIT: ${name} ===`)
  const d = await sh(r.detect)
  if (d.code === 0) {
    console.log(`  deja prezent (detect OK). Verific dovada...`)
    const v0 = await sh(r.verify)
    if (v0.code === 0) {
      console.log(`  🟢 200 — ${name} deja functional: ${v0.out.split('\n')[0]}`)
      return true
    }
    console.log(`  detectat dar verificarea nu confirma — reinstalez`)
  } else {
    console.log(`  lipseste (detect a picat) — instalez`)
  }
  const i = await sh(r.install, 300_000)
  if (i.code !== 0) {
    console.error(`  🔴 instalarea a esuat (cod ${i.code}): ${(i.err || i.out).slice(0, 300)}`)
    return false
  }
  const v = await sh(r.verify)
  if (v.code === 0) {
    console.log(`  🟢 200 — ${name} instalat si VERIFICAT: ${v.out.split('\n')[0]}`)
    return true
  }
  console.error(`  🔴 fara dovada dupa instalare — ${name} NU e confirmat: ${(v.err || v.out).slice(0, 200)}`)
  return false
}

async function main() {
  const [cmd, arg] = process.argv.slice(2)
  if (cmd === 'probe') return probe()
  if (cmd === 'list') return list()
  if (cmd === 'need' && arg) {
    const ok = await need(arg)
    process.exit(ok ? 0 : 1)
  }
  console.log('Utilizare: kelion-capability.mjs <probe | list | need <nume>>')
  console.log('  need accepta: nume din registru, apt:<pachet>, npm:<pachet>')
  process.exit(2)
}

main().catch((e) => {
  console.error(`[capability] eroare: ${e}`)
  process.exit(1)
})
