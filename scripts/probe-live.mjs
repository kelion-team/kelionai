#!/usr/bin/env node
// Proba live pe kelionai.app — apelează /api/chat cu x-test-auth, extrage text + unelte chemate.
// Folosire: node scripts/probe-live.mjs "Kelion, <comandă>"
import https from 'node:https'

const TOKEN = process.env.TEST_AUTH_TOKEN
if (!TOKEN) { console.error('Lipsește TEST_AUTH_TOKEN din env'); process.exit(1) }

const prompt = process.argv.slice(2).join(' ')
if (!prompt) { console.error('Lipsește promptul'); process.exit(1) }

const body = JSON.stringify({ messages: [{ role: 'user', content: prompt }] })

const ORIGIN = process.env.PUBLIC_APP_ORIGIN || process.env.FRONTEND_ORIGIN || 'https://kelionai.app' // hardcod-permis: fallback implicit pentru proba live producție când env nu setează originea
const req = https.request(`${ORIGIN}/api/chat`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-test-auth': TOKEN,
    'Content-Length': Buffer.byteLength(body),
  },
  timeout: 120000,
}, (res) => {
  let buf = ''
  res.on('data', (chunk) => { buf += chunk.toString() })
  res.on('end', () => {
    console.log(`STATUS: ${res.statusCode}`)
    // Extrage textul din SSE (linii "data: ...")
    const lines = buf.split('\n').filter(l => l.startsWith('data: '))
    let text = ''
    let tools = []
    let doc = null
    let errors = []
    for (const line of lines) {
      const raw = line.slice(6).trim()
      // JSON împachetat în \x1f...\x1f
      const m = raw.match(/\x1f(.+?)\x1f/)
      if (m) {
        try {
          const j = JSON.parse(m[1])
          if (j.tool) tools.push(j.tool)
          if (j.toolName) tools.push(j.toolName)
          if (j.doc) doc = j.doc
          if (j.error) errors.push(j.error)
          if (j.ignored) errors.push(`ignored: ${j.reason}`)
        } catch {}
      } else if (raw && !raw.startsWith('{')) {
        text += raw
      }
    }
    console.log('TEXT:', text.slice(0, 500))
    if (tools.length) console.log('UNELTE:', [...new Set(tools)].join(', '))
    if (doc) console.log('DOC:', JSON.stringify(doc).slice(0, 300))
    if (errors.length) console.log('ERORI:', errors.join('; '))
    console.log('RAW_LEN:', buf.length)
  })
})
req.on('error', (e) => { console.error('EROARE:', e.message); process.exit(1) })
req.on('timeout', () => { console.error('TIMEOUT'); req.destroy(); process.exit(1) })
req.write(body)
req.end()
