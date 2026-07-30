// ── BUCLA CARE ÎL PUNE PE KELION SĂ SE APUCE SINGUR ──────────────────────────
//
// Adrian, 30 iul: „fă-l autonom" · „dă-i liber să se repare singur" · „tema
// autonomiei lui va fi să facă partea totală cu Revolut".
//
// Ce apără testul ăsta, rând cu rând, sunt exact lucrurile care se strică
// TĂCUT într-o buclă automată — și care, când se strică, ori nu face nimic
// (și pare autonom), ori face de zece ori (și costă bani):
//
//   1. se apucă singur, fără să-i ceară nimeni, și începe cu MISIUNEA Revolut;
//   2. cât timp are ceva în lucru, NU mai ia altceva (altfel ordinele se adună
//      peste el și nu termină niciunul);
//   3. dacă ordinul lui a picat, și-l ia ÎNAPOI cu jurnalul eșecului — asta e
//      „să se repare singur", și trebuie să fie o reparație, nu o repornire;
//   4. dar nu la nesfârșit pe același zid: după 3 încercări pasul e blocat și
//      se trece mai departe, cu motivul vizibil;
//   5. când un pas iese bine, trece la următorul;
//   6. plafonul zilnic chiar oprește — `AUTONOMY_DAILY_MAX` a stat luni de zile
//      în configurare fără ca nimeni să-l citească: o limită declarată și
//      neconectată e mai rea decât niciuna, fiindcă liniștește degeaba.
import { describe, it, expect, vi, beforeEach } from 'vitest'

interface JobFals {
  id: number
  orderText: string
  status: 'queued' | 'running' | 'done' | 'failed'
  log: string | null
}

const kv = new Map<string, string>()
let jobs: JobFals[] = []
let urmatorulId = 1
let plafon = 20

vi.mock('../config.js', () => ({
  config: {
    get autonomyDailyMax() {
      return plafon
    },
  },
}))

vi.mock('../db.js', () => ({
  createBuildJob: async (_by: string, text: string) => {
    const j: JobFals = { id: urmatorulId++, orderText: text, status: 'queued', log: null }
    jobs.unshift(j)
    return j.id
  },
  listBuildJobs: async () => jobs,
  loadKv: async (k: string) => kv.get(k) ?? null,
  saveKv: async (k: string, v: string) => {
    kv.set(k, v)
  },
}))

// Lista ownerului nu se citește de pe disc în test: aici ne interesează
// MISIUNEA, iar lista intră în joc abia după ce misiunea e închisă.
vi.mock('node:fs/promises', () => ({ readFile: async () => '' }))

const { poateSaLucreze } = await import('./autonomie.js')

/** Ordinul cel mai proaspăt dat constructorului. */
function ultimulOrdin(): JobFals {
  return jobs[0]
}

beforeEach(() => {
  kv.clear()
  jobs = []
  urmatorulId = 1
  plafon = 20
})

describe('Kelion se apucă singur de treabă', () => {
  it('prima trecere: ia PASUL 1 al misiunii Revolut, fără să-i ceară nimeni', async () => {
    const r = await poateSaLucreze()
    expect(r.pornit).toBe(true)
    expect(r.motiv).toContain('M1')
    expect(jobs).toHaveLength(1)
    // Ordinul chiar e despre veriga lipsă, nu un text generic.
    expect(ultimulOrdin().orderText).toContain('MISIUNE REVOLUT')
    expect(ultimulOrdin().orderText).toContain('plataEmail')
    // Și duce cu el regulile de verificare, cu comenzile EXACTE.
    expect(ultimulOrdin().orderText).toContain('cd frontend && npm run build')
  })

  it('cât timp are un ordin în lucru, nu mai ia altul', async () => {
    await poateSaLucreze()
    jobs[0].status = 'running'
    const r = await poateSaLucreze()
    expect(r.pornit).toBe(false)
    expect(r.motiv).toContain('în lucru')
    expect(jobs).toHaveLength(1)
  })

  it('dacă ordinul lui a picat, și-l ia înapoi CU jurnalul eșecului', async () => {
    await poateSaLucreze()
    jobs[0].status = 'failed'
    jobs[0].log = 'teste roșii: plataEmail.test.ts > nu recunoaște suma cu virgulă'

    const r = await poateSaLucreze()
    expect(r.pornit).toBe(true)
    expect(r.motiv).toContain('reparație')
    // Reparația pornește de la CE A CĂZUT, nu de la zero.
    expect(ultimulOrdin().orderText).toContain('REPARI CE AI STRICAT TU')
    expect(ultimulOrdin().orderText).toContain('nu recunoaște suma cu virgulă')
    // Și rămâne pe aceeași sarcină — nu sare la alta.
    expect(ultimulOrdin().orderText).toContain('plataEmail')
  })

  it('după 3 încercări pe același zid, blochează pasul și trece mai departe', async () => {
    for (let i = 0; i < 3; i++) {
      const r = await poateSaLucreze()
      expect(r.motiv).toContain('M1')
      jobs[0].status = 'failed'
      jobs[0].log = `încercarea ${i + 1} a căzut`
    }
    const r = await poateSaLucreze()
    expect(r.pornit).toBe(true)
    expect(r.motiv).toContain('M2') // a trecut la pasul următor
    expect(JSON.parse(kv.get('autonomie:pas:M1')!).blocat).toContain('3 încercări')
  })

  it('când un pas iese bine, trece la următorul', async () => {
    await poateSaLucreze()
    jobs[0].status = 'done'
    const r = await poateSaLucreze()
    expect(r.pornit).toBe(true)
    expect(r.motiv).toContain('M2')
    expect(JSON.parse(kv.get('autonomie:pas:M1')!).gata).toBe(true)
  })

  it('plafonul zilnic chiar oprește — nu mai e o limită doar declarată', async () => {
    plafon = 1
    const unu = await poateSaLucreze()
    expect(unu.pornit).toBe(true)
    jobs[0].status = 'done'

    const doi = await poateSaLucreze()
    expect(doi.pornit).toBe(false)
    expect(doi.motiv).toContain('plafon zilnic atins (1/1)')
    expect(jobs).toHaveLength(1) // nimic nou nu s-a trimis
  })
})
