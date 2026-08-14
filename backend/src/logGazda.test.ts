import { describe, it, expect, afterEach } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { coadaLogGazda, semnaturiEroare, FISIERE_GAZDA } from './services/logGazda.js'

// ── OCHII PE LOGURILE GAZDEI (owner, 14 aug: „cine monitorizează toate
// logurile? nimeni" → de-acum: logGazda + self-heal). Testele țin cele două
// promisiuni: (1) fișier absent = motiv cinstit, NU text inventat (regula #1);
// (2) semnăturile prind erorile reale și NU iau „0 failed"/„TRECE" drept boală.

describe('logGazda — coada fișierului, cinstit', () => {
  let dir: string | null = null
  afterEach(async () => {
    delete process.env.HOST_KELION_DIR
    if (dir) await rm(dir, { recursive: true, force: true })
    dir = null
  })

  it('fișier absent (montarea n-a ajuns) → ok:false cu motiv, nu invenție', async () => {
    process.env.HOST_KELION_DIR = '/nu/exista/sigur'
    const r = await coadaLogGazda('constructor.log')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.motiv).toContain('nu pot citi')
  })

  it('fișier prezent → întoarce COADA (ultimii octeți), nu tot fișierul', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'loggazda-'))
    process.env.HOST_KELION_DIR = dir
    await writeFile(path.join(dir, 'constructor.log'), 'A'.repeat(100) + '\nFINAL')
    const r = await coadaLogGazda('constructor.log', 20)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.text.length).toBeLessThanOrEqual(20)
      expect(r.text).toContain('FINAL')
    }
  })

  it('lista fișierelor urmărite e cea din deploy (constructor + publicare)', () => {
    expect([...FISIERE_GAZDA]).toEqual(['constructor.log', 'auto-publicare.log'])
  })
})

describe('logGazda — semnăturile de eroare', () => {
  it('prinde liniile de eroare și le deduplică pe formă (nu pe timp/numere)', () => {
    const text = [
      '2026-08-14T10:00:01 totul bine',
      '2026-08-14T10:00:02 EROARE: creier 2 502: creier_esec gemini(429 cerere 12345)',
      '2026-08-14T10:05:09 EROARE: creier 2 502: creier_esec gemini(429 cerere 99887)', // aceeași boală, alt minut/id
      'llm încercarea 3/4 a picat pe creierul prin app',
    ].join('\n')
    const s = semnaturiEroare(text)
    // cele două „creier 2 502" sunt UNA (diferă doar ora + numerele variabile)
    expect(s.length).toBe(2)
    expect(s[0]).toContain('creier_esec')
  })

  it('NU ia verdictele bune drept boală („0 failed", „TRECE") și ignoră serviciile pensionate (RunPod/DeepInfra)', () => {
    const text = [
      'Tests: 0 failed, 1321 passed',
      'VERDICT: TRECE',
      'build ok',
      '2/6 a picat pe DeepInfra/Qwen/Qwen2.5-72B-Instruct (RunPod 402: {"error":{"message":"You need positive balance to do inference. Please add bal) — reîncerc în 16s',
    ].join('\n')
    expect(semnaturiEroare(text)).toEqual([])
  })

  it('text gol → nimic, nu invenție', () => {
    expect(semnaturiEroare('')).toEqual([])
  })
})
