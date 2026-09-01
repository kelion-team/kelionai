import test from 'node:test'
import assert from 'node:assert/strict'
import { analizeazaLinie, esteIPv4Public } from './verifica-hardcodari.mjs'
import { furnizoriRetrasiInLinie } from './verifica-creier-unic.mjs'

const reguli = (cale, linie) => analizeazaLinie(cale, linie).map((gasit) => gasit.regula)

test('clasifică numai IPv4 public operațional', () => {
  assert.equal(esteIPv4Public('164.68.120.87'), true)
  assert.equal(esteIPv4Public('127.0.0.1'), false)
  assert.equal(esteIPv4Public('10.20.30.40'), false)
  assert.equal(esteIPv4Public('192.0.2.10'), false)
  assert.equal(esteIPv4Public('999.1.1.1'), false)
})

test('respinge identitatea admin, locatorul și IP-ul copiate în cod', () => {
  assert.ok(reguli('scripts/probe.mjs', "const admin = process.env.ADMIN_EMAIL || 'owner@firma.ro'").some((r) => r.startsWith('R3')))
  assert.ok(reguli('deploy/check.sh', 'curl https://kelionai.app/health').some((r) => r.startsWith('R5')))
  assert.ok(reguli('.github/workflows/check.yml', 'VPS_HOST: 164.68.120.87').some((r) => r.startsWith('R4')))
})

test('respinge politica financiară duplicată și endpointul direct', () => {
  assert.ok(reguli('frontend/src/Wallet.tsx', "const label = '25% Kelion margin'").some((r) => r.startsWith('R6')))
  assert.ok(reguli('backend/src/x.ts', "await fetch('https://api.example.com/v1/jobs')").some((r) => r.startsWith('R7')))
})

test('acceptă config central, loopback și constante tehnice explicate', () => {
  assert.deepEqual(reguli('config/product.json', '"publicOrigin": "https://kelionai.app"'), [])
  assert.deepEqual(reguli('backend/src/x.ts', "const local = '127.0.0.1'"), [])
  assert.deepEqual(
    reguli('backend/src/x.ts', "const OAUTH = 'https://accounts.example.com/oauth' // hardcod-permis: endpoint oficial versionat al protocolului"),
    [],
  )
})

test('marcajul fără motiv nu devine portiță', () => {
  assert.ok(reguli('backend/src/x.ts', "fetch('https://api.example.com') // hardcod-permis: ok").some((r) => r.startsWith('R0')))
})

test('poarta obligatorie recunoaște căile de autentificare personală și backend privat', () => {
  const authPath = ['.', 'codex', 'auth.json'].join('/')
  const privateBackend = `https://${['chat', 'gpt.com'].join('')}/${['backend', 'api'].join('-')}/codex`
  const accountHeader = `${['Chat', 'GPT'].join('')}-${['Account', 'ID'].join('-')}`
  assert.equal(furnizoriRetrasiInLinie(`readFileSync('~/${authPath}')`).length, 1)
  assert.equal(furnizoriRetrasiInLinie(`fetch('${privateBackend}')`).length, 1)
  assert.equal(furnizoriRetrasiInLinie(`'${accountHeader}': accountId`).length, 1)
})
