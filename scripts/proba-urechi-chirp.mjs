// PROBA URECHILOR CHIRP — verificare LIVE end-to-end a căii de voce (Adrian,
// Aug 2 — „urechea Chirp nu pornește deloc"). Rulează ÎN containerul de pe VPS:
//
//   docker cp scripts/proba-urechi-chirp.mjs kelionai-app:/app/backend/
//   docker exec -w /app/backend kelionai-app node proba-urechi-chirp.mjs
//   docker exec kelionai-app rm /app/backend/proba-urechi-chirp.mjs
//
// Ce face (fără să afișeze niciun secret):
//   1. sintetizează vorbire reală cu Google TTS (gura — care merge);
//   2. o trimite pe WS-ul REAL /api/asr-stream — direct pe portul aplicației,
//      apoi prin Caddy (wss public) — cu sesiune JWT forjată local, la ritm
//      real de vorbire + tail de zgomot de 3.2s, EXACT patternul browserului;
//   3. raportează speech_begin / FINAL / timpii — sau absența lor.
// Verdict în <30s pe fiecare cale. Proba din 2 aug 2026: ambele căi FUNCȚIONEAZĂ
// (FINAL la ~6.3s) — serverul, credențialul și modelul chirp_3@eu sunt sănătoase.
import jwt from 'jsonwebtoken'
import WebSocket from 'ws'
import { GoogleAuth } from 'google-auth-library'

const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON)
const auth = new GoogleAuth({ credentials: creds, scopes: ['https://www.googleapis.com/auth/cloud-platform'] })
const token = await auth.getAccessToken()
const ttsRes = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify({
    input: { text: 'Bună ziua, azi sunt douăzeci și șapte de grade Celsius afară.' },
    voice: { languageCode: 'ro-RO', name: 'ro-RO-Chirp3-HD-Charon' },
    audioConfig: { audioEncoding: 'LINEAR16', sampleRateHertz: 16000 },
  }),
})
if (!ttsRes.ok) {
  console.log('TTS EȘEC HTTP', ttsRes.status, (await ttsRes.text()).slice(0, 200))
  process.exit(1)
}
const audio = Buffer.from((await ttsRes.json()).audioContent, 'base64')
console.log('TTS OK:', audio.length, 'bytes\n')

const session = jwt.sign(
  { email: process.env.ADMIN_EMAIL || 'admin@kelionai.app', name: 'Proba', picture: '', role: 'admin', locale: 'ro' },
  process.env.SESSION_SECRET,
  { expiresIn: '5m' },
)
const cookie = `kelionai_session=${session}`

function noiseFrame() {
  const b = Buffer.alloc(3200)
  for (let i = 0; i < 1600; i++) b.writeInt16LE(Math.round((Math.random() - 0.5) * 320), i * 2)
  return b
}

function testWs(name, url) {
  return new Promise((resolve) => {
    const t0 = Date.now()
    const el = () => ((Date.now() - t0) / 1000).toFixed(1) + 's'
    let done = false
    const end = (v) => { if (!done) { done = true; console.log(`[${name}] VERDICT @${el()}: ${v}\n`); resolve() } }
    const ws = new WebSocket(url, { headers: { Cookie: cookie }, rejectUnauthorized: false })
    ws.on('open', () => {
      console.log(`[${name}] @${el()} WS deschis — trimit start + audio la ritm real`)
      ws.send(JSON.stringify({ type: 'start', lang: 'ro' }))
      let i = 0
      const speechIv = setInterval(() => {
        if (done || ws.readyState !== WebSocket.OPEN) { clearInterval(speechIv); return }
        if (i >= audio.length) {
          clearInterval(speechIv)
          let t = 0
          const tailIv = setInterval(() => {
            if (done || ws.readyState !== WebSocket.OPEN || ++t > 32) { clearInterval(tailIv); return }
            ws.send(noiseFrame())
          }, 100)
          return
        }
        ws.send(audio.subarray(i, i + 3200))
        i += 3200
      }, 100)
    })
    ws.on('message', (data) => {
      let m
      try { m = JSON.parse(data.toString()) } catch { return }
      if (m.type === 'final') { console.log(`[${name}] @${el()} FINAL: «${m.transcript}»`); end('✓ FUNCȚIONEAZĂ'); try { ws.close() } catch {} }
      else if (m.type === 'partial') console.log(`[${name}] @${el()} parțial: «${m.transcript}»`)
      else console.log(`[${name}] @${el()} mesaj: ${JSON.stringify(m).slice(0, 160)}`)
    })
    ws.on('close', (code, reason) => end(`WS închis code=${code} reason=${reason}`))
    ws.on('error', (e) => end(`EROARE WS: ${String(e.message).slice(0, 150)}`))
    setTimeout(() => { try { ws.close() } catch {}; end('TIMEOUT 30s — NICIUN transcript') }, 30000)
  })
}

const PORT = process.env.PORT || '3000'
await testWs('DIRECT :' + PORT, `ws://127.0.0.1:${PORT}/api/asr-stream`)
await testWs('PRIN CADDY', 'wss://kelionai.app/api/asr-stream')
process.exit(0)
