import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// LACĂT AEC (owner 15–16 aug): pe DESKTOP AEC ON (anti-ecou); pe MOBIL AEC OFF
// (păstrează A2DP Bluetooth). Half-duplex pe calea live când Kelion e audibil.
const aici = dirname(fileURLToPath(import.meta.url))
const vocal = readFileSync(join(aici, 'lib/vocalLive.ts'), 'utf8')
const mic = readFileSync(join(aici, 'lib/micStream.ts'), 'utf8')

describe('voce: AEC desktop ON / mobil OFF + half-duplex anti-ecou', () => {
  it('getUserMedia pe calea live: echoCancellation: !eMobil', () => {
    expect(vocal).toMatch(/echoCancellation:\s*!eMobil/)
    expect(vocal).toMatch(/Android\|iPhone\|iPad\|Mobile/)
  })

  it('half-duplex: kelionAudibil taie microfonul cât Kelion vorbește', () => {
    expect(vocal).toMatch(/const kelionAudibil/)
    expect(vocal).toMatch(/COADA_ECOU_S\s*=\s*0\.6/)
    expect(vocal).toMatch(/const poarta = kelionAudibil\(\)/)
  })

  it('barge-in pe micStream există (întrerupere pe voce susținută cât e muted)', () => {
    expect(mic).toMatch(/onBargeIn/)
    expect(mic).toMatch(/BARGE_/)
  })
})
