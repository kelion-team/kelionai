// Verify MarkItDown ingestion end-to-end on the live server: POST real documents
// to /api/ingest with a minted admin session and print the Markdown returned.
//   railway run node backend/scripts/ingest-test.mjs
import jwt from 'jsonwebtoken'
import { readFileSync } from 'node:fs'

const SECRET = process.env.SESSION_SECRET
if (!SECRET) { console.log('NO_SESSION_SECRET'); process.exit(1) }
const cookie = `kelionai_session=${jwt.sign(
  { email: 'adrianenc11@gmail.com', name: 'Adrian', picture: '', role: 'admin', locale: 'ro' },
  SECRET, { expiresIn: '1h' },
)}`
const BASE = process.env.AUDIT_BASE || 'https://kelionai.app'

async function ingest(path, filename) {
  const data = readFileSync(path).toString('base64')
  const res = await fetch(`${BASE}/api/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ filename, data }),
  })
  if (!res.ok) { console.log(`❌ ${filename} — HTTP ${res.status} ${(await res.text()).slice(0, 120)}`); return }
  const j = await res.json()
  const md = (j.markdown || '').replace(/\s+/g, ' ').trim()
  console.log(`✅ ${filename} → ${md.slice(0, 140)}`)
}

await ingest('C:/tmp/test.csv', 'test.csv')
await ingest('C:/tmp/test.html', 'test.html')
await ingest('C:/tmp/test.xlsx', 'test.xlsx')
console.log('--- ingest test done ---')
