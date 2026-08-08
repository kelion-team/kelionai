// Focused live re-test of wikipedia_lookup after the fix, via a minted session.
import jwt from 'jsonwebtoken'
const SECRET = process.env.SESSION_SECRET
if (!SECRET) { console.log('NO_SESSION_SECRET'); process.exit(1) }
const cookie = `kelionai_session=${jwt.sign({ email: 'adrianenc11@gmail.com', name: 'Adrian', picture: '', role: 'admin', locale: 'ro' }, SECRET, { expiresIn: '1h' })}`
const CTRL = String.fromCharCode(31)

async function ask(label, content) {
  const res = await fetch('https://kelionai.app/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ messages: [{ role: 'user', content }] }) })
  if (!res.ok) { console.log(`${label}: HTTP ${res.status}`); return }
  const text = (await res.text()).split(CTRL).filter((_, i) => i % 2 === 0).join('')
  console.log(`${label}: ${text.replace(/\s+/g, ' ').trim().slice(0, 220)}`)
}
await ask('wiki(Turnul Eiffel)', 'Caută Turnul Eiffel pe Wikipedia și spune-mi înălțimea.')
await ask('wiki(Zidul Chinezesc)', 'Caută pe Wikipedia Marele Zid Chinezesc și spune-mi un fapt.')
