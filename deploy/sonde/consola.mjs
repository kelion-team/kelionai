// Sondă CONSOLĂ Enterprise — câți agenți sunt în consola Gemini + jurnalul cotei.
// Rulare (pe VPS, fără base64): docker cp .../consola.mjs kelionai-app:/tmp/s.mjs
//   && docker exec -w /app/backend kelionai-app node /tmp/s.mjs
// Citește GOOGLE_SERVICE_ACCOUNT_JSON + DATABASE_URL din env. Zero secrete în fișier.
import crypto from 'node:crypto'
import pg from 'pg'
// Consolă: număr + LISTA numelor de agenți (JWT RS256, cont de serviciu).
try {
  const sa = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON)
  const now = Math.floor(Date.now() / 1000)
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const uns = b64({ alg: 'RS256', typ: 'JWT' }) + '.' + b64({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/cloud-platform', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })
  const sg = crypto.createSign('RSA-SHA256'); sg.update(uns)
  const jwt = uns + '.' + sg.sign(sa.private_key).toString('base64url')
  const tr = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${jwt}` })
  const tok = (await tr.json()).access_token
  const proj = sa.project_id
  const ag = await fetch(`https://discoveryengine.googleapis.com/v1alpha/projects/${proj}/locations/global/collections/default_collection/engines/kelion-agenti/assistants/default_assistant/agents?pageSize=200`, { headers: { authorization: `Bearer ${tok}` } })
  const lista = (await ag.json()).agents ?? []
  console.log('CONSOLA_HTTP', ag.status)
  console.log('AGENTI_IN_CONSOLA', lista.length)
  for (const a of lista) console.log('AGENT', (a.displayName ?? '?').slice(0, 50))
} catch (e) { console.log('CONSOLA_EXC', String(e).slice(0, 160)) }
// Jurnalul vegherii (persistat) + steagul de creare-în-mers.
try {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL }); await c.connect()
  const q = async (l, s) => { try { console.log(l, JSON.stringify((await c.query(s)).rows)) } catch (e) { console.log(l + '_ERR', String(e).slice(0, 120)) } }
  await q('JURNAL', "SELECT value FROM kv_state WHERE key='enterprise:jurnal-cote'")
  await q('MASURATORI', "SELECT value FROM kv_state WHERE key='enterprise:masuratori-creare'")
  await q('STEAG', "SELECT (continut IS NOT NULL) prezent, actualizat::text FROM memorie_proiect WHERE cheie='enterprise-creare-in-mers'")
  await c.end()
} catch (e) { console.log('DB_EXC', String(e).slice(0, 150)) }
