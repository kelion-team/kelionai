import test from 'node:test'
import assert from 'node:assert/strict'
import { analizeazaSursa, normalizeazaAdresa, verificaContracte } from './verifica-butoane.mjs'

test('AST-ul separă rutele Fastify de apelurile Map.get și de clienți', () => {
  const server = analizeazaSursa(`
    const valoare = harta.get('/api/fals')
    app.get<{ Params: { id: string } }>('/api/lucru/:id', async () => ({}))
  `, 'backend/src/routes/lucru.ts')
  assert.deepEqual(server.declaratii.map((ruta) => ruta.adresa), ['/api/lucru/:id'])
  assert.equal(server.referinte.some((ref) => ref.adresa === '/api/lucru/:id'), false)

  const client = analizeazaSursa('fetch(`/api/lucru/${id}?detalii=1`)', 'frontend/src/lucru.ts')
  assert.deepEqual(client.referinte.map((ref) => ref.adresa), ['/api/lucru/:p'])
})

test('contractul prinde apeluri rupte, rute orfane și dubluri metodă+adresă', () => {
  const rezultat = verificaContracte([
    { fisier: 'server-a.ts', declaratii: [{ metoda: 'GET', adresa: '/api/a', linie: 1 }], referinte: [] },
    { fisier: 'server-b.ts', declaratii: [{ metoda: 'GET', adresa: '/api/a', linie: 2 }], referinte: [] },
    { fisier: 'server-c.ts', declaratii: [{ metoda: 'POST', adresa: '/api/orfana', linie: 3 }], referinte: [] },
    { fisier: 'client.ts', declaratii: [], referinte: [
      { adresa: '/api/a', linie: 1 },
      { adresa: '/api/lipsa', linie: 2 },
    ] },
  ])
  assert.equal(rezultat.apeluriFaraRuta.length, 1)
  assert.equal(rezultat.ruteFaraConsumator.length, 1)
  assert.equal(rezultat.ruteDuplicate.length, 1)
})

test('normalizarea păstrează segmentele dinamice și elimină query/hash', () => {
  assert.equal(normalizeazaAdresa('/api/x/${id}?q=1#sus'), '/api/x/:p')
  assert.equal(normalizeazaAdresa('https://kelionai.app/api/x/1?q=2'), '/api/x/1')
  assert.equal(normalizeazaAdresa('https://www.googleapis.com/auth/drive.file'), '')
})

test('recunoaște pluginurile Fastify nested și URL-urile providerului extern fără a ascunde first-party', () => {
  const rezultat = analizeazaSursa(`
    function merchantUrl(path) {
      const url = new URL(config.revolutMerchant.apiBaseUrl)
      url.pathname = path
      return url
    }
    function firstPartyUrl(path) {
      const url = new URL(config.publicOrigin)
      url.pathname = path
      return url
    }
    app.register(async (webhookApp) => {
      webhookApp.post('/api/billing/revolut/webhook', async () => ({}))
    })
    fetch(merchantUrl('/api/orders'))
    fetch(merchantUrl(\`/api/orders/\${orderId}\`))
    fetch(firstPartyUrl('/api/ruta-first-party-lipsa'))
  `, 'backend/src/payment.ts')

  assert.deepEqual(
    rezultat.declaratii.map((ruta) => `${ruta.metoda} ${ruta.adresa}`),
    ['POST /api/billing/revolut/webhook'],
  )
  assert.equal(rezultat.referinte.some((ref) => ref.adresa === '/api/orders'), false)
  assert.equal(rezultat.referinte.some((ref) => ref.adresa === '/api/orders/:p'), false)
  assert.equal(rezultat.referinte.some((ref) => ref.adresa === '/api/ruta-first-party-lipsa'), true)
})
