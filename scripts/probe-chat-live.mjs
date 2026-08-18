#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(path.join(ROOT, 'backend/package.json'))
const jwt = require('jsonwebtoken')
const target = process.env.KELION_LIVE_URL || 'http://127.0.0.1:8080'
const sessionSecret = process.env.SESSION_SECRET || ''
const adminEmail = (process.env.ADMIN_EMAIL || 'adrianenc11@gmail.com').trim()
const output = path.resolve(process.argv[2] || '/root/kelion/audit-results/chat-live-probes.json')
if (!sessionSecret) throw new Error('SESSION_SECRET lipsește din mediul probei')

const token = jwt.sign(
  { email: adminEmail, name: 'Audit live', picture: '', role: 'admin', locale: 'ro' },
  sessionSecret,
  { expiresIn: '20m' },
)
const logPath = execFileSync('docker', ['inspect', 'kelionai-app', '--format', '{{.LogPath}}'], { encoding: 'utf8' }).trim()

const probes = [
  {
    capability: 'get_time',
    prompt: 'PROBĂ TEHNICĂ: apelează obligatoriu unealta get_time acum, exact o dată. După rezultat răspunde scurt și include PROBA_GET_TIME_OK.',
    expectedTool: 'get_time',
  },
  {
    capability: 'get_weather',
    prompt: 'PROBĂ TEHNICĂ: apelează obligatoriu unealta get_weather pentru coordonatele dispozitivului din această tură. După rezultat include PROBA_GET_WEATHER_OK.',
    expectedTool: 'get_weather',
    body: { coords: { lat: 44.4268, lon: 26.1025 } },
  },
  {
    capability: 'show_document',
    prompt: 'PROBĂ TEHNICĂ: apelează obligatoriu show_document cu titlul „Probă audit” și textul „PROBA_DOCUMENT_OK”. Nu chema altă unealtă.',
    expectedTool: 'show_document',
    expectedFrame: 'doc',
    stopAfterFrame: true,
  },
  {
    capability: 'run_web_app',
    prompt: 'PROBĂ TEHNICĂ: apelează obligatoriu run_web_app cu titlul „Probă audit” și HTML-ul „<main>PROBA_WEB_APP_OK</main>”. Nu chema altă unealtă.',
    expectedTool: 'run_web_app',
    expectedFrame: 'app',
    stopAfterFrame: true,
  },
  {
    capability: 'open_app_view',
    prompt: 'PROBĂ TEHNICĂ DETERMINISTĂ: primul și singurul pas trebuie să fie apelul open_app_view cu view „settings”. Un răspuns doar textual este eșec. După apel include PROBA_APP_VIEW_OK.',
    expectedTool: 'open_app_view',
    expectedFrame: 'nav',
    stopAfterFrame: true,
  },
  {
    capability: 'get_location',
    prompt: 'PROBĂ TEHNICĂ NATIVĂ: dacă această tură conține coordonatele dispozitivului, răspunde scurt și include exact PROBA_LOCATION_OK. Nu ghici locația.',
    expectedTool: null,
    expectedMarker: 'PROBA_LOCATION_OK',
    body: { coords: { lat: 44.4268, lon: 26.1025 } },
  },
  {
    capability: 'look',
    prompt: 'PROBĂ TEHNICĂ NATIVĂ: confirmă că ai primit imaginea atașată și include exact PROBA_VISION_OK. Nu inventa detalii care nu se văd.',
    expectedTool: null,
    expectedMarker: 'PROBA_VISION_OK',
    body: { image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nS8AAAAASUVORK5CYII=', imageIsAttachment: true },
  },
  {
    capability: 'get_monitor',
    prompt: 'PROBĂ TEHNICĂ DETERMINISTĂ: primul pas trebuie să fie apelul get_monitor. Un răspuns fără apelul uneltei este eșec. Confirmă titlul „Monitor audit” și include PROBA_MONITOR_OK.',
    expectedTool: 'get_monitor',
    body: { monitorContent: { kind: 'document', title: 'Monitor audit', text: 'conținut sigur de probă' } },
  },
  {
    capability: 'browser_open',
    prompt: 'PROBĂ TEHNICĂ: apelează obligatoriu browser_open cu URL-ul https://tryestera.com și nu interacționa cu pagina. După deschidere include PROBA_BROWSER_OK.',
    expectedTool: 'browser_open',
    expectedFrame: 'monitor',
    stopAfterFrame: true,
  },
  {
    capability: 'get_real_cost',
    prompt: 'PROBĂ TEHNICĂ READ-ONLY: apelează obligatoriu get_real_cost pentru sumarul disponibil și nu executa altă acțiune. După rezultat include PROBA_COST_OK.',
    expectedTool: 'get_real_cost',
  },
  {
    capability: 'list_notes',
    prompt: 'PROBĂ TEHNICĂ READ-ONLY: apelează obligatoriu list_notes. Nu crea, modifica sau șterge nicio notă. După rezultat include PROBA_NOTES_OK.',
    expectedTool: 'list_notes',
  },
  {
    capability: 'list_app_versions',
    prompt: 'PROBĂ TEHNICĂ READ-ONLY: apelează obligatoriu list_app_versions și nu restaura/salva nimic. După rezultat include PROBA_VERSIONS_OK.',
    expectedTool: 'list_app_versions',
  },
  {
    capability: 'set_active_role',
    prompt: 'PROBĂ TEHNICĂ GARDATĂ: apelează obligatoriu set_active_role cu role „__audit_invalid__”. Valoarea este intenționat invalidă; nu schimba rolul și raportează validarea. Include PROBA_ROLE_GUARD_OK.',
    expectedTool: 'set_active_role',
  },
  {
    capability: 'list_source',
    prompt: 'PROBĂ TEHNICĂ READ-ONLY: apelează obligatoriu list_source pentru backend/src/services și nu modifica nimic. După rezultat include PROBA_SOURCE_OK.',
    expectedTool: 'list_source',
  },
  {
    capability: 'db_tables',
    prompt: 'PROBĂ TEHNICĂ READ-ONLY: apelează obligatoriu db_tables și nu executa nicio scriere. După rezultat include PROBA_DB_TABLES_OK.',
    expectedTool: 'db_tables',
  },
  {
    capability: 'lista_tarife',
    prompt: 'PROBĂ TEHNICĂ READ-ONLY: apelează obligatoriu lista_tarife și nu cumpăra/genera nimic. După rezultat include PROBA_TARIFE_OK.',
    expectedTool: 'lista_tarife',
  },
]

function parseSse(raw) {
  const payload = raw
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.replace(/^data:\s?/, ''))
    .join('')
  const parts = payload.split(String.fromCharCode(31))
  const frames = parts.filter((_, index) => index % 2 === 1).map((part) => {
    try { return JSON.parse(part) } catch { return { invalid: true } }
  })
  const visible = parts.filter((_, index) => index % 2 === 0).join('').trim()
  return { frames, visible }
}

function toolNamesSince(sinceMs) {
  const rows = fs.readFileSync(logPath, 'utf8').trim().split('\n')
  const names = []
  for (const row of rows) {
    try {
      const parsed = JSON.parse(row)
      if (Date.parse(parsed.time) < sinceMs - 250) continue
      const match = String(parsed.log || '').match(/\[tool\]\s+([a-zA-Z0-9_]+)/)
      if (match) names.push(match[1])
    } catch {
      // O linie JSON Docker incompletă nu invalidează restul jurnalului.
    }
  }
  return [...new Set(names)]
}

async function readProbeResponse(response, probe) {
  if (!probe.stopAfterFrame || !probe.expectedFrame || !response.body) return response.text()
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let raw = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) return raw + decoder.decode()
    raw += decoder.decode(value, { stream: true })
    const { frames } = parseSse(raw)
    if (frames.some((frame) => Object.hasOwn(frame, probe.expectedFrame))) {
      await reader.cancel()
      return raw
    }
  }
}

const only = new Set((process.env.PROBE_CAPABILITIES || '').split(',').map((name) => name.trim()).filter(Boolean))
const selectedProbes = only.size ? probes.filter((probe) => only.has(probe.capability)) : probes
const results = []
for (const probe of selectedProbes) {
  const startedAt = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 180_000)
  let httpStatus = 0
  let raw = ''
  let error = ''
  try {
    const response = await fetch(`${target}/api/chat`, {
      method: 'POST',
      headers: {
        cookie: `kelionai_session=${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: probe.prompt }],
        serverVoiceOff: true,
        now: new Date().toISOString(),
        tz: 'UTC',
        retea: 'bun',
        ...probe.body,
      }),
      signal: controller.signal,
    })
    httpStatus = response.status
    raw = await readProbeResponse(response, probe)
  } catch (cause) {
    error = String(cause instanceof Error ? cause.message : cause)
  } finally {
    clearTimeout(timer)
  }
  await new Promise((resolve) => setTimeout(resolve, 250))
  const latencyMs = Date.now() - startedAt
  const { frames, visible } = parseSse(raw)
  const frameKeys = [...new Set(frames.flatMap((frame) => Object.keys(frame)))]
  const toolTrace = toolNamesSince(startedAt)
  const toolSeen = !probe.expectedTool || toolTrace.includes(probe.expectedTool)
  const frameSeen = !probe.expectedFrame || frameKeys.includes(probe.expectedFrame)
  const markerSeen = !probe.expectedMarker || visible.includes(probe.expectedMarker)
  const responseSeen = visible.length > 0 || (probe.stopAfterFrame && frameSeen)
  const pass = httpStatus === 200 && toolSeen && frameSeen && markerSeen && responseSeen
  results.push({
    capability: probe.capability,
    prompt: probe.prompt,
    path: '/api/chat',
    httpStatus,
    latencyMs,
    toolTrace,
    controlFrameKeys: frameKeys,
    response: {
      nonEmpty: visible.length > 0,
      length: visible.length,
      sha256: crypto.createHash('sha256').update(visible).digest('hex'),
    },
    verifiedEffect: {
      expectedTool: probe.expectedTool,
      toolSeen,
      expectedFrame: probe.expectedFrame || null,
      frameSeen,
      expectedMarker: probe.expectedMarker || null,
      markerSeen,
    },
    status: pass ? 'pass' : 'fail',
    ...(error ? { error } : {}),
  })
  console.log(JSON.stringify({ capability: probe.capability, httpStatus, latencyMs, toolTrace, frameKeys, status: pass ? 'pass' : 'fail' }))
}

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  target,
  summary: {
    total: results.length,
    passed: results.filter((row) => row.status === 'pass').length,
    failed: results.filter((row) => row.status !== 'pass').length,
    allHttp200: results.every((row) => row.httpStatus === 200),
  },
  probes: results,
}
fs.mkdirSync(path.dirname(output), { recursive: true })
fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify({ output, summary: report.summary }, null, 2))
if (report.summary.failed > 0) process.exitCode = 1
