// ORDINUL VERBATIM (owner, 15 aug): „ordinele de rezolvat nu au voie sa se
// dubleze nici o data". Ușa unică e createBuildJob: un ordin VIU cu aceeași
// amprentă → al doilea NU se naște (se întoarce id-ul celui viu). Un ordin
// ÎNCHEIAT nu blochează — „reia"-ul deliberat rămâne posibil.
//
// Ca la scutulDatelor: comportamentul care trăiește lângă pool-ul viu se ține
// prin lacăt pe SURSĂ; funcția pură (amprenta) se probează la rulare.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { amprentaOrdin } from './db.js'

const db = readFileSync(fileURLToPath(new URL('./db.ts', import.meta.url)), 'utf8')

describe('amprentaOrdin (proba la rulare)', () => {
  it('aceeași eroare cu ore/contoare diferite = ACELAȘI ordin', () => {
    const a = amprentaOrdin('AUTO-VINDECARE: [13:31:58] llm fatal — creier 502 (count=2, prag=2), încercarea 1')
    const b = amprentaOrdin('AUTO-VINDECARE: [09:05:11] llm fatal — creier 502 (count=7, prag=2), încercarea 3')
    expect(a).toBe(b)
  })

  it('ordine diferite au amprente diferite', () => {
    expect(amprentaOrdin('repară selectorul de limbă')).not.toBe(amprentaOrdin('repară bara de deploy'))
  })
})

describe('lacătul pe sursă: createBuildJob refuză dublurile', () => {
  it('caută ordinele VII (queued/running) înainte de INSERT', () => {
    const corp = db.slice(db.indexOf('export async function createBuildJob'))
    const cautare = corp.indexOf("status IN ('queued','running')")
    const insert = corp.indexOf('INSERT INTO build_jobs')
    expect(cautare).toBeGreaterThan(-1)
    expect(insert).toBeGreaterThan(-1)
    expect(cautare).toBeLessThan(insert) // întâi dublurile, abia apoi nașterea
  })

  it('dublura vie întoarce id-ul ordinului existent, nu creează al doilea', () => {
    const corp = db.slice(db.indexOf('export async function createBuildJob'))
    expect(corp).toContain('amprentaOrdin(orderText)')
    expect(corp).toContain('return Number(dublura.id)')
  })

  it('ordinul verbatim al ownerului stă scris la ușă (să nu-l „optimizeze" nimeni)', () => {
    expect(db).toContain('ordinele de rezolvat nu au voie sa se dubleze nici o data')
  })
})
