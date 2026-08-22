import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// audioIO (tras de guraOffline) citește localStorage la încărcare — în Node
// nu există; îl mockăm ca la coadaOffline.test.ts.
const stocare = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => stocare.get(k) ?? null,
  setItem: (k: string, v: string) => void stocare.set(k, v),
  removeItem: (k: string) => void stocare.delete(k),
})

const { ferestreRms, voceaPentru } = await import('./lib/guraOffline')
const { wavBase64LaFloat32 } = await import('./lib/urecheaOffline')

// ── LACĂTUL KITULUI OFFLINE (ordinul din 22 aug: „auto download invizibil cu
// toate") — părțile PURE se probează executabil; cablajul, pe cod viu. ───────
const aici = dirname(fileURLToPath(import.meta.url))
function codViu(rel: string): string {
  return readFileSync(join(aici, rel), 'utf8')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
}

describe('gura Piper — părțile pure', () => {
  it('vocea RO e Mihai (verificată pe HF); restul limbilor cad pe rezerva EN masculină', () => {
    expect(voceaPentru('ro')).toBe('ro_RO-mihai-medium')
    expect(voceaPentru('en')).toBe('en_US-ryan-medium')
    expect(voceaPentru('de')).toBe('en_US-ryan-medium')
  })

  it('ferestreRms: tăcerea = 0, tonul plin deschide gura, plafonat la 1', () => {
    const rata = 16000
    const tacere = new Float32Array(rata) // 1s de zero
    expect(Math.max(...ferestreRms(tacere, rata))).toBe(0)
    const ton = new Float32Array(rata).fill(0.5)
    const niveluri = ferestreRms(ton, rata)
    expect(Math.min(...niveluri)).toBeGreaterThan(0.9)
    expect(Math.max(...niveluri)).toBeLessThanOrEqual(1)
    // fereastra de 30ms la 16kHz = 480 mostre → ~34 ferestre pe secundă
    expect(niveluri.length).toBeGreaterThan(30)
    expect(niveluri.length).toBeLessThan(40)
  })
})

describe('urechea Whisper — părțile pure', () => {
  it('wavBase64LaFloat32 decodează WAV 16-bit mono (header 44B) la [-1..1]', () => {
    // WAV minimal: 44 de octeți header (conținut irelevant aici) + 4 mostre
    // Int16 LE: 0, 16384 (0.5), -16384 (-0.5), 32767 (~1).
    const octeti = new Uint8Array(44 + 8)
    const dv = new DataView(octeti.buffer)
    dv.setInt16(44, 0, true)
    dv.setInt16(46, 16384, true)
    dv.setInt16(48, -16384, true)
    dv.setInt16(50, 32767, true)
    const b64 = btoa(String.fromCharCode(...octeti))
    const f = wavBase64LaFloat32(b64)
    expect(f.length).toBe(4)
    expect(f[0]).toBe(0)
    expect(f[1]).toBeCloseTo(0.5, 3)
    expect(f[2]).toBeCloseTo(-0.5, 3)
    expect(f[3]).toBeCloseTo(1, 2)
  })
})

describe('cablajul kitului — cod viu', () => {
  it('cache-urile modelelor sunt PROTEJATE de ștergerea la update (webllm/* + transformers-cache)', () => {
    const sw = readFileSync(join(aici, '../public/sw.js'), 'utf8')
    expect(sw).toMatch(/k\.startsWith\('webllm\/'\) \|\| k === 'transformers-cache'/)
    const upd = codViu('lib/updateCheck.ts')
    expect(upd).toMatch(/!k\.startsWith\('webllm\/'\) && k !== 'transformers-cache'/)
  })

  it('runtime-urile WASM se servesc DE LA NOI (lecția ONNX din 21 aug), nu de pe CDN-uri', () => {
    const gura = codViu('lib/guraOffline.ts')
    expect(gura).toMatch(/onnxWasm: '\/ort\/'/)
    expect(gura).toMatch(/piperWasm: '\/piper\/piper_phonemize\.wasm'/)
    // ...iar copierea lor din node_modules e ÎN build (pică tare dacă lipsesc):
    const pkg = readFileSync(join(aici, '../package.json'), 'utf8')
    expect(pkg).toMatch(/"prebuild": "node scripts\/copiaza-active-offline\.mjs"/)
  })

  it('kitul se sincronizează DOAR online, sub aceeași lege ca creierul (autoDescarcareaPermisa)', () => {
    const kit = codViu('lib/kitOffline.ts')
    expect(kit).toMatch(/if \(!esteConectat\(\)\) return/)
    expect(kit).toMatch(/if \(!autoDescarcareaPermisa\(\)\) return/)
  })

  it('gura offline: întâi Piper, apoi vocea browserului (ultima redută)', () => {
    const gura = codViu('lib/guraOffline.ts')
    expect(gura).toMatch(/if \(await vorbestePiper\(text, lang\)\) return\s*\n\s*vorbesteLocal\(text, lang\)/)
  })

  it('urechea locală intră pe drumul tastării (send), nu pe vreun canal nou', () => {
    const chat = codViu('components/ChatPanel.tsx')
    expect(chat).toMatch(/transcrieOffline\(wavBase64LaFloat32\(audio\), speechLangRef\.current\)\.then\(\(text\) => \{\s*if \(text && !esteConectat\(\)\) void send\(text\)/)
  })
})
