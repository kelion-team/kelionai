#!/usr/bin/env node
// TLS PENTRU LIVEKIT SELF-HOSTED — certificat VALID automat, fără domeniu
// cumpărat, fără DNS de atins de Adrian (12 iul: „de unde rezolvăm domeniu
// certificat? — nu știu — vezi și tu").
//
// PROBLEMA: browserul cere wss:// cu certificat VALID. LIVEKIT_URL era
// wss://164.68.120.87:7880 — IP simplu, fără certificat → browserul refuză
// conexiunea. DNS-ul lui kelionai.app e la Cloudflare, dar NU-l atingem deloc.
//
// SOLUȚIA (zero acțiune de la Adrian): un hostname care mapează DIRECT IP-ul
// VPS-ului — 164-68-120-87.sslip.io (nume DNS real, rezolvă la IP-ul nostru).
// Caddy (docker) obține AUTOMAT un certificat Let's Encrypt valid pentru acel
// hostname, termină TLS pe :443 și proxy-ază semnalizarea wss → LiveKit :7880.
// Media WebRTC (UDP 7882) merge DIRECT la IP, criptată DTLS-SRTP (nu are nevoie
// de certificatul de domeniu). LiveKit rulează cu use_external_ip=true ca să
// anunțe candidații ICE cu IP-ul public real (altfel, din container, ar anunța
// IP-ul intern 172.x și media ar pica).
//
// Rulare: pe VPS, ca root, din repo:  node bridge/kelion-livekit-tls.mjs
// Depinde de: docker (pe VPS) și RAILWAY_TOKEN în /root/kelion/claude.env.
//
// Chei: se REUTILIZEAZĂ cheile existente din Railway (idempotent — nu se
// schimbă la fiecare rulare). Doar dacă lipsesc, se generează. Secretul NU apare
// niciodată în log (se afișează doar primele 8 caractere ale API key-ului).
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { networkInterfaces } from 'node:os'

const CLAUDE_ENV = '/root/kelion/claude.env'
const LIVEKIT_IMAGE = 'livekit/livekit-server:latest'
const LIVEKIT_CONTAINER = 'kelion-livekit'
const CADDY_IMAGE = 'caddy:2'
const CADDY_CONTAINER = 'kelion-caddy'
const LIVEKIT_LOCAL = 'localhost:7880'
const CONFIG_DIR = '/root/kelion-livekit'
const CONFIG_PATH = `${CONFIG_DIR}/config.yaml`
const RAILWAY_GQL = 'https://backboard.railway.com/graphql/v2'

function log(...args) {
  console.log(`[livekit-tls ${new Date().toISOString()}]`, ...args)
}
function fail(msg) {
  console.error(`[livekit-tls EROARE] ${msg}`)
  process.exit(1)
}

function loadEnvFile(path) {
  const out = {}
  if (!existsSync(path)) return out
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([^#=\s]+)\s*=\s*(.*?)\s*$/)
    if (!m) continue
    let v = m[2]
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1)
    }
    out[m[1]] = v
  }
  return out
}

const ENV = { ...process.env, ...loadEnvFile(CLAUDE_ENV) }
const RAILWAY_TOKEN = ENV.RAILWAY_TOKEN?.trim()
if (!RAILWAY_TOKEN) fail(`RAILWAY_TOKEN lipsește din ${CLAUDE_ENV}`)

function publicIp() {
  const custom = ENV.LIVEKIT_HOST_IP?.trim()
  if (custom) return custom
  const nics = networkInterfaces()
  for (const [, addrs] of Object.entries(nics)) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('127.')) {
        return a.address
      }
    }
  }
  return '127.0.0.1'
}

// sslip.io: <a-b-c-d>.sslip.io rezolvă la a.b.c.d. Nume DNS real → Let's Encrypt
// emite certificat valid pentru el. Zero DNS de configurat.
function hostnameForIp(ip) {
  return `${ip.replace(/\./g, '-')}.sslip.io`
}

function run(cmd, args = [], opts = {}) {
  return new Promise((resolve) => {
    const c = spawn(cmd, args, { env: ENV, stdio: ['ignore', 'pipe', 'pipe'], ...opts })
    let out = ''
    let err = ''
    c.stdout?.on('data', (d) => (out += d))
    c.stderr?.on('data', (d) => (err += d))
    c.on('close', (code) => resolve({ code, out, err }))
    c.on('error', (e) => resolve({ code: -1, out, err: err || String(e) }))
  })
}

async function ensureDocker() {
  const r = await run('docker', ['--version'])
  if (r.code !== 0) fail('docker nu e disponibil pe VPS — rulează întâi vps-livekit-install')
  log('docker OK')
}

async function gql(query, variables) {
  const body = JSON.stringify({ query, variables })
  const r = await run('curl', [
    '-sS', '--max-time', '30',
    '-H', `Authorization: Bearer ${RAILWAY_TOKEN}`,
    '-H', 'Content-Type: application/json',
    '-d', body,
    RAILWAY_GQL,
  ])
  if (r.code !== 0) fail(`GraphQL request failed: ${r.err || r.out}`)
  try {
    return JSON.parse(r.out)
  } catch {
    fail(`GraphQL response invalid JSON: ${r.out}`)
  }
}

async function railwayTarget() {
  const resp = await gql('query{projects{edges{node{id name environments{edges{node{id name}}} services{edges{node{id name}}}}}}}')
  const projects = resp?.data?.projects?.edges?.map((e) => e.node) || []
  const match = projects.find((p) => /kelion/i.test(p.name))
  if (!match) fail('nu am găsit proiectul Railway care conține „kelion"')
  const env = match.environments?.edges?.map((e) => e.node)?.find((e) => e.name === 'production')
    || match.environments?.edges?.[0]?.node
  const svc = match.services?.edges?.map((e) => e.node)?.find((s) => s.name === 'web')
    || match.services?.edges?.[0]?.node
  if (!env || !svc) fail('nu am găsit environment/serviciu Railway')
  return { projectId: match.id, environmentId: env.id, serviceId: svc.id }
}

// Reutilizează cheile existente din Railway (idempotent). Le citim, NU le
// afișăm. Dacă lipsesc, generăm o pereche nouă cu imaginea oficială LiveKit.
async function resolveKeys(target) {
  const resp = await gql(
    'query($p:String!,$e:String!,$s:String!){variables(projectId:$p,environmentId:$e,serviceId:$s)}',
    { p: target.projectId, e: target.environmentId, s: target.serviceId },
  )
  const vars = resp?.data?.variables || {}
  const apiKey = (vars.LIVEKIT_API_KEY || '').trim()
  const apiSecret = (vars.LIVEKIT_API_SECRET || '').trim()
  if (apiKey && apiSecret) {
    log('chei LiveKit reutilizate din Railway (stabile):', apiKey.slice(0, 8) + '...')
    return { apiKey, apiSecret, generated: false }
  }
  log('cheile lipsesc din Railway — generez o pereche nouă...')
  const r = await run('docker', ['run', '--rm', LIVEKIT_IMAGE, 'generate-keys'])
  if (r.code !== 0) fail(`generate-keys a eșuat: ${r.err || r.out}`)
  const km = r.out.match(/API key:\s*(\S+)/i)
  const sm = r.out.match(/API secret:\s*(\S+)/i)
  if (!km || !sm) fail(`nu am putut parseze cheile din:\n${r.out}`)
  log('chei noi generate:', km[1].slice(0, 8) + '...')
  return { apiKey: km[1], apiSecret: sm[1], generated: true }
}

// Scrie config.yaml LiveKit cu use_external_ip=true (media WebRTC corectă din
// spatele Docker) și porturile fixe. Fișierul stă doar pe VPS (nu în log).
function writeLiveKitConfig(apiKey, apiSecret) {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true })
  // Fără bind_addresses: LiveKit leagă implicit toate interfețele (ce vrem).
  const yaml =
    `port: 7880\n` +
    `rtc:\n` +
    `  tcp_port: 7881\n` +
    `  udp_port: 7882\n` +
    `  use_external_ip: true\n` +
    `keys:\n  ${apiKey}: ${apiSecret}\n`
  writeFileSync(CONFIG_PATH, yaml, { mode: 0o600 })
  log('config.yaml LiveKit scris (use_external_ip=true, porturi 7880/7881/7882)')
}

async function restartLiveKit() {
  log('repornesc LiveKit cu config.yaml (media WebRTC corectă)...')
  await run('docker', ['rm', '-f', LIVEKIT_CONTAINER])
  const r = await run('docker', [
    'run', '-d', '--name', LIVEKIT_CONTAINER, '--restart', 'always',
    '-p', '7880:7880',
    '-p', '7881:7881',
    '-p', '7882:7882/udp',
    '-v', `${CONFIG_PATH}:/etc/livekit.yaml`,
    LIVEKIT_IMAGE,
    '--config', '/etc/livekit.yaml',
  ])
  if (r.code !== 0) fail(`pornire LiveKit a eșuat: ${r.err || r.out}`)
  log('container LiveKit pornit:', r.out.trim())
}

async function waitForLiveKit() {
  log('aștept ca LiveKit să răspundă local pe 7880...')
  for (let i = 0; i < 40; i++) {
    const r = await run('curl', ['-sS', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '2', 'http://localhost:7880/'])
    const code = r.out.trim()
    if (code && code !== '000') {
      log(`LiveKit răspunde local (HTTP ${code})`)
      return
    }
    await new Promise((res) => setTimeout(res, 1000))
  }
  const logs = await run('docker', ['logs', '--tail', '40', LIVEKIT_CONTAINER])
  fail(`LiveKit nu a răspuns local în 40s. Loguri:\n${logs.out}\n${logs.err}`)
}

async function ensureFirewall() {
  const r = await run('bash', ['-lc', 'command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | head -1 || echo no-ufw'])
  if (/Status:\s*active/i.test(r.out)) {
    for (const p of ['80/tcp', '443/tcp', '7881/tcp', '7882/udp']) {
      await run('ufw', ['allow', p])
    }
    log('ufw activ — porturi 80,443,7881/tcp,7882/udp deschise')
  } else {
    log('ufw inactiv/absent — porturile sunt deschise implicit')
  }
}

async function startCaddy(hostname) {
  log(`pornesc Caddy (auto-TLS Let's Encrypt pentru ${hostname} → ${LIVEKIT_LOCAL})...`)
  await run('docker', ['rm', '-f', CADDY_CONTAINER])
  // --network host: Caddy leagă 80/443 pe interfața publică ȘI ajunge la
  // localhost:7880 (portul mapat al LiveKit). `caddy reverse-proxy --from
  // <hostname>` (fără schemă/port) activează AUTOMAT HTTPS pe 443 + provocarea
  // ACME pe 80. Reverse-proxy-ul lui Caddy transmite transparent upgrade-ul
  // WebSocket, deci semnalizarea wss trece intactă spre LiveKit.
  const r = await run('docker', [
    'run', '-d', '--name', CADDY_CONTAINER, '--restart', 'always',
    '--network', 'host',
    '-v', '/root/kelion-caddy/data:/data',
    '-v', '/root/kelion-caddy/config:/config',
    CADDY_IMAGE,
    'caddy', 'reverse-proxy',
    '--from', hostname,
    '--to', LIVEKIT_LOCAL,
  ])
  if (r.code !== 0) fail(`pornire Caddy a eșuat: ${r.err || r.out}`)
  log('container Caddy pornit:', r.out.trim())
}

async function waitForCert(hostname) {
  log("aștept certificatul Let's Encrypt (poate dura ~20-60s)...")
  for (let i = 0; i < 60; i++) {
    // FĂRĂ -k: un succes dovedește certificat VALID (curl respinge self-signed).
    const r = await run('curl', ['-sS', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '5', `https://${hostname}/`])
    const code = r.out.trim()
    const bad = /curl|certificate|SSL|verify/i.test(r.err)
    if (code && code !== '000' && !bad) {
      log(`✅ HTTPS VALID pe https://${hostname}/ (HTTP ${code}) — certificat Let's Encrypt emis și funcțional`)
      return
    }
    await new Promise((res) => setTimeout(res, 2000))
  }
  const logs = await run('docker', ['logs', '--tail', '50', CADDY_CONTAINER])
  fail(`certificatul nu a fost emis în 120s (verifică portul 80 deschis spre internet). Loguri Caddy:\n${logs.out}\n${logs.err}`)
}

// Test real prin proxy-ul TLS: ListRooms peste HTTPS valid.
async function testThroughTls(hostname, apiKey, apiSecret) {
  const require = (await import('node:module')).createRequire(import.meta.url)
  const repo = ['/root/kelion/repo', '/root/kelion', '/root/Kelionai']
    .find((d) => existsSync(`${d}/backend/node_modules/jsonwebtoken`)) || '/root/kelion/repo'
  let token
  try {
    const jwtMod = require(`${repo}/backend/node_modules/jsonwebtoken`)
    token = jwtMod.sign({ video: { roomList: true }, iss: apiKey, sub: 'kelion-tls-setup' }, apiSecret, { expiresIn: '5m' })
  } catch (e) {
    log('⚠️ nu am putut semna JWT-ul de test (sar peste testul ListRooms):', String(e).slice(0, 80))
    return
  }
  const r = await run('curl', [
    '-sS', '-o', '/dev/null', '-w', '%{http_code}',
    '-H', `Authorization: Bearer ${token}`,
    '-H', 'Content-Type: application/json',
    '-d', '{}',
    `https://${hostname}/twirp/livekit.RoomService/ListRooms`,
  ])
  const code = r.out.trim()
  if (code === '200') log(`✅ ListRooms prin TLS valid a răspuns HTTP 200 (${hostname})`)
  else log(`⚠️ ListRooms prin TLS a răspuns HTTP ${code} (serverul e viu; continui)`)
}

async function writeRailwayVars(target, vars) {
  log('scriu variabilele LiveKit în Railway (mascat)...')
  const input = {
    projectId: target.projectId,
    environmentId: target.environmentId,
    serviceId: target.serviceId,
    variables: vars,
  }
  const resp = await gql(
    'mutation($input: VariableCollectionUpsertInput!){variableCollectionUpsert(input:$input)}',
    { input },
  )
  if (resp?.errors?.length) fail(`variableCollectionUpsert a eșuat: ${JSON.stringify(resp.errors)}`)
  log('✅ variabile scrise în Railway:', Object.keys(vars).join(', '))
}

async function main() {
  log('START — TLS valid pentru LiveKit (sslip.io + Caddy), fără acțiune de la Adrian')
  await ensureDocker()

  const target = await railwayTarget()
  const { apiKey, apiSecret, generated } = await resolveKeys(target)

  writeLiveKitConfig(apiKey, apiSecret)
  await restartLiveKit()
  await waitForLiveKit()

  await ensureFirewall()

  const ip = publicIp()
  const hostname = hostnameForIp(ip)
  log('IP public VPS:', ip, '→ hostname TLS:', hostname)
  await startCaddy(hostname)
  await waitForCert(hostname)
  await testThroughTls(hostname, apiKey, apiSecret)

  const url = `wss://${hostname}`
  const vars = { LIVEKIT_URL: url }
  if (generated) {
    vars.LIVEKIT_API_KEY = apiKey
    vars.LIVEKIT_API_SECRET = apiSecret
  }
  await writeRailwayVars(target, vars)

  log('')
  log('═══════════════════════════════════════════════════════════════')
  log('DOVADĂ: LiveKit cu certificat TLS VALID, gata pentru browser.')
  log('URL (Railway LIVEKIT_URL):', url)
  log('Certificat:                 Let\'s Encrypt (auto, Caddy)')
  log('Semnalizare:                wss :443 → LiveKit :7880 (proxy Caddy)')
  log('Media WebRTC:               UDP 7882 direct la IP (DTLS-SRTP)')
  log('Container LiveKit:          ' + LIVEKIT_CONTAINER + ' (use_external_ip=true)')
  log('Container Caddy:            ' + CADDY_CONTAINER)
  log('Verificare backend:         GET /api/admin/livekit/status')
  log('═══════════════════════════════════════════════════════════════')
}

main().catch((e) => fail(String(e)))
