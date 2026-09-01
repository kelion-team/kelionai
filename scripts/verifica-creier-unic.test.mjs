import test from 'node:test'
import assert from 'node:assert/strict'
import { furnizoriRetrasiInLinie } from './verifica-creier-unic.mjs'

test('prinde configurări și adaptoare ale furnizorilor retrași', () => {
  assert.deepEqual(furnizoriRetrasiInLinie('const key = process.env.GEMINI_API_KEY'), ['gemini'])
  assert.deepEqual(furnizoriRetrasiInLinie("provider: 'openrouter'"), ['openrouter'])
  assert.deepEqual(furnizoriRetrasiInLinie('type Legacy = AnthropicTool'), ['anthropic'])
  assert.deepEqual(furnizoriRetrasiInLinie("model: 'veo-3.1-generate'"), ['veo'])
  assert.deepEqual(furnizoriRetrasiInLinie('const CHIRP_MODEL = env()'), ['chirp'])
  assert.deepEqual(furnizoriRetrasiInLinie('COQUI_URL=http://speech:5100'), ['coqui-server'])
  assert.deepEqual(furnizoriRetrasiInLinie("fetch('/api/voce/sintetizeaza')"), ['coqui-server'])
  assert.deepEqual(furnizoriRetrasiInLinie("readFileSync('~/.codex/auth.json')"), ['codex-personal-auth'])
  assert.deepEqual(furnizoriRetrasiInLinie("fetch('https://chatgpt.com/backend-api/codex')"), ['chatgpt-private-backend'])
  assert.deepEqual(furnizoriRetrasiInLinie("'ChatGPT-Account-ID': accountId"), ['chatgpt-account-header'])
})

test('nu confundă modelele locale și cuvintele naturale cu furnizori online', () => {
  assert.deepEqual(furnizoriRetrasiInLinie("model: 'gemma-2-9b-it-q4f16_1-MLC'"), [])
  assert.deepEqual(furnizoriRetrasiInLinie('Google Calendar and Gmail tools'), [])
  assert.deepEqual(furnizoriRetrasiInLinie('we work together; yo veo la pantalla'), [])
  assert.deepEqual(furnizoriRetrasiInLinie('Whisper runs locally offline'), [])
})
