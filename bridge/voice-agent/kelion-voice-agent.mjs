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
// STARE: MILESTONE 2 — bucla audio↔audio completă (STT→creier→TTS) cu barge-in,
// pe lângă testul de conexiune din milestone 1. Prima iterație: se reglează fin
// (praguri VAD, ecou) pe testele cu microfonul lui Adrian, cu LiveKit-ul local
// pornit pe VPS.
//
// Rulare:
//   node kelion-voice-agent.mjs --test [--room voice-...]   # test conexiune, iese
//   node kelion-voice-agent.mjs --room voice-xyz            # intră și ține bucla vocii
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

// ── MILESTONE 2: bucla audio↔audio (STT→creier→TTS) cu barge-in ──────────────
// Un singur sample rate peste tot (48 kHz mono): pista de captură LiveKit, TTS-ul
// și AudioSource-ul de redare — sample-urile intră 1:1, fără reeșantionare.
const SAMPLE_RATE = 48000
const CHANNELS = 1
// Praguri VAD (energie RMS pe Int16). Se reglează pe testele cu microfonul.
const RMS_SPEECH = 380 // peste = vorbire; sub = liniște/zgomot de fond (reglat 13 iul: 600 prindea prea puțin)
const SILENCE_MS = 800 // liniște după vorbire → sfârșit de frază (endpoint)
const MIN_SPEECH_MS = 300 // sub atât = pocnet/tuse, se ignoră
const MAX_UTTERANCE_MS = 15000 // plasă de siguranță: golește oricum
const BARGE_FRAMES = 2 // cadre consecutive vorbite cât agentul vorbește → barge-in

function rms(int16) {
  let s = 0
  for (let i = 0; i < int16.length; i++) s += int16[i] * int16[i]
  return Math.sqrt(s / Math.max(1, int16.length))
}

// TTS LINEAR16 vine ca WAV (antet RIFF). Sărim peste antet până la sub-chunk-ul
// „data" și întoarcem PCM-ul brut ca Int16Array (LE, cum îl vrea AudioFrame).
function pcmFromWav(buf) {
  let off = 44 // antet WAV standard
  const idx = buf.indexOf('data', 12, 'ascii')
  if (idx !== -1) off = idx + 8
  if (off % 2) off++ // aliniere Int16
  const len = (buf.length - off) >> 1
  return new Int16Array(buf.buffer, buf.byteOffset + off, len)
}

// O tură completă la backend: PCM brut → { transcript, reply, wav }.
async function voiceTurn(pcmBase64, visitor) {
  try {
    const r = await fetch(`${CFG.backend}/api/bridge/voice-turn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-bridge-secret': CFG.bridgeSecret },
      body: JSON.stringify({ pcm: pcmBase64, sampleRate: SAMPLE_RATE, lang: '', visitor }),
    })
    if (!r.ok) {
      log(`voice-turn ${r.status}`)
      return null
    }
    return await r.json()
  } catch (e) {
    log('voice-turn a eșuat:', String(e).slice(0, 100))
    return null
  }
}

// Publică pista de voce a agentului (AudioSource permanent) în cameră.
async function publishAgentTrack(room) {
  const { AudioSource, LocalAudioTrack, TrackPublishOptions, TrackSource } = rtc
  const source = new AudioSource(SAMPLE_RATE, CHANNELS)
  const track = LocalAudioTrack.createAudioTrack('kelion-voice', source)
  const opts = new TrackPublishOptions()
  opts.source = TrackSource.SOURCE_MICROPHONE
  await room.localParticipant.publishTrack(track, opts)
  log('pistă de voce publicată în cameră')
  return source
}

// Redă PCM în cameră, cadru cu cadru (10 ms). Se oprește imediat dacă tura a
// fost înlocuită (barge-in): captureFrame-urile rămase nu se mai trimit.
async function playPcm(state, myTurn, pcm) {
  const frameSamples = Math.floor(SAMPLE_RATE / 100) // 10 ms
  for (let o = 0; o < pcm.length; o += frameSamples) {
    if (state.turn !== myTurn) return // barge-in / tură nouă → tai vocea
    const slice = pcm.subarray(o, Math.min(o + frameSamples, pcm.length))
    const frame = new rtc.AudioFrame(slice, SAMPLE_RATE, CHANNELS, slice.length)
    await state.source.captureFrame(frame)
  }
}

// Procesează o frază: STT+creier+TTS la backend, apoi redă răspunsul. Rulează
// NEblocant față de bucla de captură (ca barge-in-ul să fie detectat în timp ce
// agentul „gândește"/vorbește). `myTurn` marchează tura; dacă e depășită între
// timp (barge-in), abandonează fără să vorbească peste user.
async function handleUtterance(state, myTurn, pcm) {
  const buf = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength)
  const res = await voiceTurn(buf.toString('base64'), state.visitor)
  if (state.turn !== myTurn) return // userul a luat cuvântul între timp
  if (!res || res.skip) {
    if (res?.skip) log('(liniște / fără transcriere — sar peste)')
    state.speaking = false
    return
  }
  log(`user: „${(res.transcript || '').slice(0, 120)}"`)
  log(`kelion: „${(res.reply || '').slice(0, 120)}"`)
  if (!res.wav) {
    log('TTS a eșuat sau gol:', res.ttsError || '(fără wav)')
    state.speaking = false
    return
  }
  const wavBuf = Buffer.from(res.wav, 'base64')
  const pcmOut = pcmFromWav(wavBuf)
  log(`redau: wav ${wavBuf.length}o → ${pcmOut.length} sample-uri @${res.sampleRate || SAMPLE_RATE}Hz`)
  try {
    await playPcm(state, myTurn, pcmOut)
    log('redare terminată')
  } catch (e) {
    log('redare a eșuat:', String(e).slice(0, 150))
  }
  if (state.turn === myTurn) state.speaking = false
}

// Ascultă pista audio a unui user: VAD pe energie → acumulează fraza → la
// liniște o trimite. Barge-in: dacă userul vorbește cât agentul vorbește, taie
// vocea agentului și începe fraza nouă.
async function listenToUser(state, track, identity) {
  const { AudioStream } = rtc
  const stream = new AudioStream(track, { sampleRate: SAMPLE_RATE, numChannels: CHANNELS, frameSizeMs: 100 })
  log(`ascult microfonul lui ${identity}`)
  let inSpeech = false
  let speechMs = 0
  let silenceMs = 0
  let collectedMs = 0
  let bargeFrames = 0
  let chunks = []

  const reset = () => {
    inSpeech = false
    speechMs = 0
    silenceMs = 0
    collectedMs = 0
    chunks = []
  }
  const flush = () => {
    if (speechMs < MIN_SPEECH_MS || chunks.length === 0) {
      reset()
      return
    }
    const total = chunks.reduce((n, c) => n + c.length, 0)
    const pcm = new Int16Array(total)
    let off = 0
    for (const c of chunks) {
      pcm.set(c, off)
      off += c.length
    }
    reset()
    const myTurn = ++state.turn
    state.speaking = true
    void handleUtterance(state, myTurn, pcm)
  }

  for await (const frame of stream) {
    const data = frame.data
    const frameMs = (frame.samplesPerChannel / SAMPLE_RATE) * 1000
    const voiced = rms(data) > RMS_SPEECH

    if (state.speaking) {
      // Agentul vorbește/gândește → urmăresc DOAR barge-in (user care insistă).
      if (voiced) {
        if (++bargeFrames >= BARGE_FRAMES) {
          state.turn++ // invalidează redarea curentă
          try {
            state.source.clearQueue()
          } catch {
            /* best-effort */
          }
          state.speaking = false
          bargeFrames = 0
          // fraza nouă începe cu acest cadru
          inSpeech = true
          speechMs = frameMs
          silenceMs = 0
          collectedMs = frameMs
          chunks = [new Int16Array(data)]
        }
      } else {
        bargeFrames = 0
      }
      continue
    }

    if (voiced) {
      inSpeech = true
      silenceMs = 0
      speechMs += frameMs
      chunks.push(new Int16Array(data))
      collectedMs += frameMs
    } else if (inSpeech) {
      chunks.push(new Int16Array(data))
      collectedMs += frameMs
      silenceMs += frameMs
      if (silenceMs >= SILENCE_MS) flush()
    }
    if (inSpeech && collectedMs >= MAX_UTTERANCE_MS) flush()
  }
}

// Intră într-o cameră, publică vocea agentului și pornește ascultarea userului.
// Întoarce un mâner cu close(). Reutilizat de bucla pentru o singură cameră
// (--room) ȘI de workerul persistent (auto-join pe camerele active).
async function attachToRoom(roomName) {
  const state = { turn: 0, speaking: false, source: null, visitor: '' }
  const room = await joinRoom(roomName, {
    onUserAudioTrack: (track, participant) => {
      if (!state.visitor) state.visitor = participant.identity || 'voice'
      void listenToUser(state, track, participant.identity).catch((e) =>
        log('bucla de ascultare a picat:', String(e?.stack || e).slice(0, 200)),
      )
    },
  })
  state.source = await publishAgentTrack(room)
  return {
    room,
    state,
    async close() {
      state.turn++ // taie orice redare în curs
      try {
        await room.disconnect()
      } catch {
        /* best-effort */
      }
    },
  }
}

async function runVoiceLoop(roomName) {
  log('START buclă voce full-duplex — cameră:', roomName)
  if (!CFG.apiKey || !CFG.apiSecret) fail('LIVEKIT_API_KEY/SECRET lipsesc din env')
  if (!CFG.bridgeSecret) fail('BRIDGE_SECRET lipsește — agentul nu poate chema /api/bridge/voice-turn')
  const h = await attachToRoom(roomName)
  log('✅ Buclă vocii activă — vorbește; STT→creier→TTS cu barge-in. Ctrl-C pentru oprire.')
  await new Promise((resolve) => {
    h.room.on(rtc.RoomEvent.Disconnected, resolve)
    process.on('SIGINT', resolve)
    process.on('SIGTERM', resolve)
  })
  await h.close()
  try {
    await rtc.dispose?.()
  } catch {
    /* best-effort */
  }
  log('buclă voce oprită')
  process.exit(0)
}

// ── WORKER PERSISTENT (Adrian: „el trebuie să facă tot") ─────────────────────
// Fără --room: agentul se descurcă SINGUR. Interoghează serverul LiveKit local,
// intră în ORICE cameră „voice-*" cu un user înăuntru și ține bucla; când userul
// pleacă (camera rămâne goală), iese. Zero intervenție manuală — Kelion pornește
// vocea de îndată ce cineva deschide microfonul pe kelionai.app.
function httpHost(wsUrl) {
  return wsUrl.replace(/^ws:/, 'http:').replace(/^wss:/, 'https:')
}
async function runWorker() {
  log('START worker persistent voce — urmăresc camerele „voice-*" și intru singur')
  if (!CFG.apiKey || !CFG.apiSecret) fail('LIVEKIT_API_KEY/SECRET lipsesc din env')
  if (!CFG.bridgeSecret) fail('BRIDGE_SECRET lipsește — agentul nu poate chema /api/bridge/voice-turn')
  const { RoomServiceClient } = serverSdk
  const client = new RoomServiceClient(httpHost(CFG.url), CFG.apiKey, CFG.apiSecret)
  const joined = new Map() // roomName → { handle, emptyPolls }
  let stop = false
  process.on('SIGINT', () => (stop = true))
  process.on('SIGTERM', () => (stop = true))

  while (!stop) {
    try {
      const rooms = await client.listRooms()
      const active = new Set()
      for (const r of rooms) {
        if (!/^voice-/.test(r.name)) continue
        active.add(r.name)
        const has = joined.get(r.name)
        // numParticipants include agentul odată intrat — un user real = >0 fără noi.
        const others = r.numParticipants - (has ? 1 : 0)
        if (!has && others >= 1) {
          try {
            const handle = await attachToRoom(r.name)
            joined.set(r.name, { handle, emptyPolls: 0 })
            log(`intrat automat în „${r.name}" (${others} user)`)
          } catch (e) {
            log(`nu am putut intra în „${r.name}":`, String(e).slice(0, 120))
          }
        } else if (has) {
          // Doar agentul rămas → userul a plecat; după 2 polluri goale, ies.
          if (others <= 0) {
            has.emptyPolls++
            if (has.emptyPolls >= 2) {
              await has.handle.close()
              joined.delete(r.name)
              log(`am ieșit din „${r.name}" (goală)`)
            }
          } else {
            has.emptyPolls = 0
          }
        }
      }
      // Camere dispărute din listă (închise) → curăț.
      for (const [name, has] of joined) {
        if (!active.has(name)) {
          await has.handle.close()
          joined.delete(name)
          log(`am ieșit din „${name}" (închisă)`)
        }
      }
    } catch (e) {
      log('poll listRooms a eșuat:', String(e).slice(0, 120))
    }
    await new Promise((r) => setTimeout(r, 4000))
  }
  for (const [, has] of joined) await has.handle.close()
  try {
    await rtc.dispose?.()
  } catch {
    /* best-effort */
  }
  log('worker voce oprit')
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
  // Cameră dată explicit → intră DOAR în ea și ține bucla (test dirijat).
  if (roomIdx !== -1) return runVoiceLoop(roomName)
  // Implicit: worker persistent — urmărește SINGUR camerele „voice-*" și intră în
  // ele când un user deschide microfonul (Kelion face tot, fără room manual).
  return runWorker()
}

main().catch((e) => fail(String(e?.stack || e)))
