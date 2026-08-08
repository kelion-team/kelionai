// Live test: ask Kelion about traffic and confirm it opens a Waze livemap on the
// monitor (not a google.com page that refuses to embed).
import jwt from 'jsonwebtoken'
const SECRET = process.env.SESSION_SECRET
const cookie = `kelionai_session=${jwt.sign({ email: 'adrianenc11@gmail.com', name: 'Adrian', picture: '', role: 'admin', locale: 'ro' }, SECRET, { expiresIn: '1h' })}`
const CTRL = String.fromCharCode(31)
const res = await fetch('https://kelionai.app/api/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Cookie: cookie },
  body: JSON.stringify({ messages: [{ role: 'user', content: 'Cum e traficul acum? Arată-mi pe ecran.' }], coords: { lat: 44.4268, lon: 26.1025 } }),
})
const text = await res.text()
const frames = []
let buf = text
for (;;) {
  const i = buf.indexOf(CTRL)
  if (i === -1) break
  const j = buf.indexOf(CTRL, i + 1)
  if (j === -1) break
  try { frames.push(JSON.parse(buf.slice(i + 1, j))) } catch {}
  buf = buf.slice(j + 1)
}
const monitor = frames.map((f) => f.monitor?.url).filter(Boolean)
console.log('reply:', text.split(CTRL).filter((_, i) => i % 2 === 0).join('').replace(/\s+/g, ' ').trim().slice(0, 160))
console.log('monitor URL:', monitor.join(' | ') || '(none)')
console.log(monitor.some((u) => u.includes('waze.com')) ? 'WAZE_OK ✅' : monitor.some((u) => u.includes('google.com')) ? 'STILL_GOOGLE ❌' : 'no-map')
