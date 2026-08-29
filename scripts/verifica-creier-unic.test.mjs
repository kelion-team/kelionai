import test from 'node:test'
import assert from 'node:assert/strict'
import { furnizoriRetrasiInLinie } from './verifica-creier-unic.mjs'

test('prinde configurări și adaptoare ale furnizorilor retrași', () => {
  assert.deepEqual(furnizoriRetrasiInLinie('const key = process.env.GEMINI_API_KEY'), ['gemini'])
  assert.deepEqual(furnizoriRetrasiInLinie("provider: 'openrouter'"), ['openrouter'])
  assert.deepEqual(furnizoriRetrasiInLinie('type Legacy = AnthropicTool'), ['anthropic'])
  assert.deepEqual(furnizoriRetrasiInLinie('const OLLAMA_API_BASE = env()'), ['ollama'])
  assert.deepEqual(furnizoriRetrasiInLinie("fetch('http://127.0.0.1:11434/api/tags')"), ['ollama-transport'])
  assert.deepEqual(furnizoriRetrasiInLinie("fetch('http://localhost:19000/api/generate')"), ['ollama-transport'])
  assert.deepEqual(furnizoriRetrasiInLinie("fetch('http://localhost:19000/api/chat')"), ['ollama-transport'])
  assert.deepEqual(furnizoriRetrasiInLinie("fetch('http://host.docker.internal:19000/api/version')"), ['ollama-transport'])
  assert.deepEqual(furnizoriRetrasiInLinie("model: 'veo-3.1-generate'"), ['veo'])
  assert.deepEqual(furnizoriRetrasiInLinie('const CHIRP_MODEL = env()'), ['chirp'])
  assert.deepEqual(furnizoriRetrasiInLinie('COQUI_URL=http://speech:5100'), ['coqui-server'])
  assert.deepEqual(furnizoriRetrasiInLinie("fetch('/api/voce/sintetizeaza')"), ['coqui-server'])
})

test('nu confundă modelele locale și cuvintele naturale cu furnizori online', () => {
  assert.deepEqual(furnizoriRetrasiInLinie("model: 'gemma-2-9b-it-q4f16_1-MLC'"), [])
  assert.deepEqual(furnizoriRetrasiInLinie('Google Calendar and Gmail tools'), [])
  assert.deepEqual(furnizoriRetrasiInLinie('we work together; yo veo la pantalla'), [])
  assert.deepEqual(furnizoriRetrasiInLinie('Whisper runs locally offline'), [])
  assert.deepEqual(furnizoriRetrasiInLinie("fetch('/api/chat')"), [])
})
