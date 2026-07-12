#!/usr/bin/env node
// AGENTUL DE VOCE FULL-DUPLEX AL LUI KELION (Adrian, 12 iul: „chatul full duplex").
//
// Rulează pe VPS, IZOLAT de backend-ul live (un proces separat — dacă pică, chatul
// HTTP care merge acum NU e afectat). Se conectează la LiveKit-ul LOCAL de pe
// același VPS (ws://localhost:7880, fără TLS intern), intră în camera unui user și
// ține bucla audio↔audio:
//   audio user → STT (Chirp, prin backend) → creierul-punte → TTS (Chirp) →
//   publică audio în cameră, cu BARGE-IN (când userul vorbește, taie vocea).
//
// REUTILIZEAZĂ vocea existentă (STT/TTS Chirp din backend, creierul din punte) —
// nu reinventează nimic. Framework-ul LiveKit Agents NU e folosit intenționat.
//
// STARE: MILESTONE 1 — conectare + intrare în cameră + observarea pistelor
// (verificabil FĂRĂ microfon: agentul apare în ListRooms). Bucla STT→creier→TTS
// se adaugă în milestone 2, testată cu microfonul lui Adrian.
//
// Rulare:
//   node kelion-voice-agent.mjs --test [--room voice-...]   # test conexiune, iese
//   node kelion-voice-agent.mjs                             # worker persistent (viitor)
//
// Config din env: LIVEKIT_URL (implicit ws://localhost:7880), LIVEKIT_API_KEY,
// LIVEKIT_API_SECRET, BACKEND_URL (implicit https://kelionai.app), BRIDGE_SECRET.

import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'

const require = createRequire(import.meta.url)

const CLAUDE_ENV = '/root/kelion/claude.env'
const RAILWAY_GQL = 'https://backboard.railway.com/graphql/v2'

function loadEnvFile(path) {
  const out = {}
  if (!existsSync(path)) return out
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([^#=\s]+)\s*=\s*(.*?)\s*$/)
    if (!m) continue
    let v = m[2]
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    out[m[1]] = v
  }
  return out
}

const CFG = {
  url: process.env.LIVEKIT_URL?.trim() || 'ws://localhost:7880',
  apiKey: process.env.LIVEKIT_API_KEY?.trim() || '',
  apiSecret: process.env.LIVEKIT_API_SECRET?.trim() || '',
  backend: process.env.BACKEND_URL?.trim() || 'https://kelionai.app',
  bridgeSecret: process.env.BRIDGE_SECRET?.trim() || '',
  identity: 'kelion-voice-agent',
}

function log(...a) {
  console.log(`[voice-agent ${new Date().toISOString()}]`, ...a)
}
function fail(msg) {
  console.error(`[voice-agent EROARE] ${msg}`)
  process.exit(1)
}

// Încarcă SDK-urile din node_modules-ul propriu al agentului. createRequire ca să
// meargă și dacă ele nu sunt module ESM curate.
let rtc
let serverSdk
function loadSdks() {
  try {
    rtc = require('@livekit/rtc-node')
  } catch (e) {
    fail(`@livekit/rtc-node lipsește — rulează npm install în bridge/voice-agent (${e})`)
  }
  try {
    serverSdk = require('livekit-server-sdk')
  } catch (e) {
    fail(`livekit-server-sdk lipsește — rulează npm install în bridge/voice-agent (${e})`)
  }
}

// Token de agent (self-minted din cheia/secretul serverului local).
async function agentToken(room) {
  const { AccessToken } = serverSdk
  const at = new AccessToken(CFG.apiKey, CFG.apiSecret, { identity: CFG.identity, name: 'Kelion', ttl: '2h' })
  at.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true })
  return at.toJwt()
}

// Conectează agentul la o cameră, cu handlere pe evenimente. Întoarce obiectul Room.
async function joinRoom(roomName, { onUserAudioTrack } = {}) {
  const { Room, RoomEvent, TrackKind } = rtc
  const room = new Room()

  room.on(RoomEvent.ParticipantConnected, (p) => log('participant intrat:', p.identity))
  room.on(RoomEvent.ParticipantDisconnected, (p) => log('participant ieșit:', p.identity))
  room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
    const kind = track?.kind === TrackKind?.KIND_AUDIO || track?.kind === 'audio' ? 'audio' : String(track?.kind)
    log(`pistă abonată: ${kind} de la ${participant.identity}`)
    // Audio de la un participant real (nu agentul) → intră în bucla STT (milestone 2).
    if (kind === 'audio' && participant.identity !== CFG.identity) {
      onUserAudioTrack?.(track, participant)
    }
  })
  room.on(RoomEvent.Disconnected, () => log('deconectat de la cameră', roomName))

  const token = await agentToken(roomName)
  await room.connect(CFG.url, token, { autoSubscribe: true, dynacast: true })
  log(`CONECTAT în camera „${roomName}" ca „${CFG.identity}" (url ${CFG.url})`)
  return room
}

// ── MILESTONE 1: test de conexiune (fără microfon) ───────────────────────────
// Intră în cameră, așteaptă, raportează cine e acolo, iese. Dovada că agentul
// se instalează, se conectează la LiveKit-ul local și poate intra într-o cameră.
async function runConnectionTest(roomName) {
  log('START test conexiune — mă conectez la LiveKit local și intru în cameră')
  if (!CFG.apiKey || !CFG.apiSecret) fail('LIVEKIT_API_KEY/SECRET lipsesc din env')
  const room = await joinRoom(roomName, {
    onUserAudioTrack: (_t, p) => log(`(milestone 2) aș porni STT pe audio-ul lui ${p.identity}`),
  })
  await new Promise((r) => setTimeout(r, 6000))
  const participants = [...(room.remoteParticipants?.values?.() ?? [])].map((p) => p.identity)
  log('participanți în cameră (fără agent):', participants.length ? participants.join(', ') : '(niciunul — normal fără client)')
  log('✅ DOVADĂ: agentul s-a conectat la LiveKit local și a intrat în cameră fără eroare')
  await room.disconnect()
  try {
    await rtc.dispose?.()
  } catch {
    /* dispose best-effort */
  }
  log('gata — test conexiune reușit')
  process.exit(0)
}

// Cheile LiveKit: din env dacă există, altfel din Railway (RAILWAY_TOKEN din
// claude.env — același mecanism ca bridge/kelion-livekit-tls.mjs). NU luăm
// LIVEKIT_URL din Railway (ăla e wss-ul extern) — agentul merge pe LiveKit-ul
// LOCAL (ws://localhost:7880), fără TLS intern.
async function railwayGql(token, query, variables) {
  const r = await fetch(RAILWAY_GQL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  })
  return r.json()
}
async function resolveKeysFromRailway() {
  if (CFG.apiKey && CFG.apiSecret) return
  const env = loadEnvFile(CLAUDE_ENV)
  const token = env.RAILWAY_TOKEN?.trim() || process.env.RAILWAY_TOKEN?.trim()
  if (!token) return
  try {
    const proj = await railwayGql(
      token,
      'query{projects{edges{node{id name environments{edges{node{id name}}} services{edges{node{id name}}}}}}}',
    )
    const projects = proj?.data?.projects?.edges?.map((e) => e.node) || []
    const match = projects.find((p) => /kelion/i.test(p.name))
    if (!match) return
    const environmentId = (
      match.environments?.edges?.map((e) => e.node)?.find((e) => e.name === 'production') ||
      match.environments?.edges?.[0]?.node
    )?.id
    const serviceId = (
      match.services?.edges?.map((e) => e.node)?.find((s) => s.name === 'web') ||
      match.services?.edges?.[0]?.node
    )?.id
    if (!environmentId || !serviceId) return
    const varsResp = await railwayGql(
      token,
      'query($p:String!,$e:String!,$s:String!){variables(projectId:$p,environmentId:$e,serviceId:$s)}',
      { p: match.id, e: environmentId, s: serviceId },
    )
    const vars = varsResp?.data?.variables || {}
    if (!CFG.apiKey) CFG.apiKey = (vars.LIVEKIT_API_KEY || '').trim()
    if (!CFG.apiSecret) CFG.apiSecret = (vars.LIVEKIT_API_SECRET || '').trim()
    if (!CFG.bridgeSecret) CFG.bridgeSecret = (vars.BRIDGE_SECRET || '').trim()
    if (CFG.apiKey) log('chei LiveKit reutilizate din Railway:', CFG.apiKey.slice(0, 8) + '...')
  } catch (e) {
    log('nu am putut lua cheile din Railway (folosesc env):', String(e).slice(0, 80))
  }
}

async function main() {
  loadSdks()
  await resolveKeysFromRailway()
  const args = process.argv.slice(2)
  const roomIdx = args.indexOf('--room')
  const roomName = roomIdx !== -1 && args[roomIdx + 1] ? args[roomIdx + 1] : 'voice-agent-test'
  if (args.includes('--test')) return runConnectionTest(roomName)
  // Worker persistent (milestone 2+): va urmări camerele active și va intra în ele
  // cu bucla STT→creier→TTS. Pentru acum, fără --test, doar explică.
  log('Mod worker persistent încă neimplementat (milestone 2). Folosește --test pentru verificarea conexiunii.')
  process.exit(0)
}

main().catch((e) => fail(String(e?.stack || e)))
