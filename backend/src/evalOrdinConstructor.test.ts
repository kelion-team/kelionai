import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { evalueazaOrdin, AI_CONSTRUCTORI } from './services/evalOrdinConstructor.js'

function sursa(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

// Poarta de calitate + clasamentul pe capacitate (owner, 13 aug). Probele stau la
// capete: ordin gol/vag/în-afară RESPINS; cod în repo → constructorul local; mare
// izolat → Jules; analiză pură → creierul 2; creditul roșu coboară AI-ul.

describe('poarta de calitate — NU orice ordin trece', () => {
  it('ordin prea scurt e respins, cu motiv', () => {
    const e = evalueazaOrdin('fă')
    expect(e.trece).toBe(false)
    expect(e.motiv).toMatch(/scurt/i)
    expect(e.aiRecomandat).toBeNull()
  })

  it('cerință vagă (temă fără acțiune și fără țintă) e respinsă', () => {
    const e = evalueazaOrdin('ceva frumos acolo')
    expect(e.trece).toBe(false)
    expect(e.motiv).toMatch(/vag/i)
  })

  it('cerere din afara scopului (lumea reală) e respinsă cinstit', () => {
    const e = evalueazaOrdin('sună-l pe furnizor și comandă mâncare')
    expect(e.trece).toBe(false)
    expect(e.motiv).toMatch(/în afara|in afara/i)
  })

  it('ordin clar de cod trece și cere capacități', () => {
    const e = evalueazaOrdin('repară butonul din bara de sus și adaugă un test')
    expect(e.trece).toBe(true)
    expect(e.capacitatiNecesare.length).toBeGreaterThan(0)
    expect(e.aiRecomandat).not.toBeNull()
  })
})

describe('clasamentul pe capacitate + credit', () => {
  it('reparație de cod în repo → constructorul local sus', () => {
    const e = evalueazaOrdin('repară eroarea din endpoint-ul de login și rulează testele')
    expect(e.aiRecomandat).toBe('constructor')
    expect(e.clasament[0]?.cheie).toBe('constructor')
  })

  it('sarcină mare, izolată, în fundal → Jules urcă în față', () => {
    const e = evalueazaOrdin('refac complet tot modulul, o sarcină mare care poate rula în fundal peste noapte')
    expect(e.aiRecomandat).toBe('jules')
  })

  it('cerință de analiză/planificare fără cod → creierul 2', () => {
    const e = evalueazaOrdin('analizează de ce se împotmolește și planifică pașii')
    expect(e.aiRecomandat).toBe('creier2')
  })

  it('creditul ROȘU coboară AI-ul recomandat (nu-l trimitem fără cu ce lucra)', () => {
    const ordin = 'repară butonul și rulează testele'
    const faraCredit = evalueazaOrdin(ordin)
    expect(faraCredit.aiRecomandat).toBe('constructor')
    // constructorul local pe roșu → nu mai e recomandat primul
    const cuRosu = evalueazaOrdin(ordin, { 'creierul constructorului': 'rosu' })
    expect(cuRosu.aiRecomandat).not.toBe('constructor')
    // becul e purtat în clasament, ca panoul să-l poată arăta
    const randConstructor = cuRosu.clasament.find((r) => r.cheie === 'constructor')
    expect(randConstructor?.bec).toBe('rosu')
  })

  it('clasamentul acoperă exact cele trei AI-uri reale', () => {
    const e = evalueazaOrdin('adaugă un endpoint nou în backend')
    expect(e.clasament.map((r) => r.cheie).sort()).toEqual(['constructor', 'creier2', 'jules'])
    expect(AI_CONSTRUCTORI).toHaveLength(3)
  })
})

describe('LACĂT — poarta e ENFORCED la intrarea ordinului (nu doar în panou)', () => {
  const rute = sursa('./routes/constructor.ts')

  it('POST /api/admin/constructor respinge ordinele care nu trec poarta, cu motiv', () => {
    // Dacă cineva scoate poarta din rută, un ordin gol/vag ar intra iar în coadă
    // și ar arde credit — exact ce a interzis ownerul („să treacă orice ordin?").
    expect(/evalueazaOrdin\(order\)/.test(rute)).toBe(true)
    expect(/if \(!ev\.trece\) return reply\.code\(400\)\.send\(\{ error: 'ordin_respins', motiv: ev\.motiv \}\)/.test(rute)).toBe(true)
  })

  it('endpointul de evaluare există și dă AI-urile + creditul live', () => {
    expect(/\/api\/admin\/constructor\/evalueaza/.test(rute)).toBe(true)
    expect(/hartaCreditConstructor\(\)/.test(rute)).toBe(true)
  })
})
