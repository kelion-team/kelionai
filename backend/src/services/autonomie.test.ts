// ── BUCLA CARE ÎL PUNE PE KELION SĂ SE APUCE SINGUR ──────────────────────────
//
// Adrian, 30 iul: „fă-l autonom" · „dă-i liber să se repare singur" · „tema
// autonomiei lui va fi să facă partea totală cu Revolut" · „are liber 1000000%
// să folosească tot ca să obțină scopul meu".
//
// CE APĂRĂ TESTUL ĂSTA, și de ce fiecare rând e aici:
//
//   1. **Sarcina ajunge unde EXISTĂ uneltele.** Ăsta e bugul pe care era să-l
//      trimit în producție: pașii de portal plecau la CONSTRUCTOR, care are
//      exact 7 unelte (ls/grep/read/write/edit/run/finish) și NICIUN browser.
//      I-aș fi cerut unui agent fără browser să intre pe un site — ar fi picat
//      de trei ori, pe banii ownerului, și s-ar fi oprit cu „blocat".
//   2. **„Gata" se MĂSOARĂ, nu se declară.** Un pas de mâini e terminat doar
//      dacă cheile CHIAR există. Cuvântul creierului nu e dovadă — regula #1.
//   3. **Aprobarea ownerului nu e eșecul lui.** Când legea cere apăsarea
//      titularului de cont, pasul NU consumă o încercare: n-a greșit nimeni.
//   4. Restul gărzilor: un lucru odată, plafonul zilnic care chiar oprește,
//      trei încercări pe același zid și apoi mai departe, cu motivul la vedere.
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

// Ce „vede" bucla când întreabă ce secrete există — dovada pașilor de mâini.
let secreteExistente: string[] = []
// Ce spune creierul după ce a lucrat cu mâinile.
let spuseCreierul = 'am pus cheile'
// Câte ture de mâini s-au pornit, și cu ce unelte.
let turiDeMaini = 0
let uneltePrimite: string[] = []

vi.mock('../config.js', () => ({
  config: {
    adminEmail: 'adrianenc11@gmail.com',
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

vi.mock('./brain.js', () => ({
  brainCompleteWithTools: async (_prompt: string, tools: { name: string }[]) => {
    turiDeMaini++
    uneltePrimite = tools.map((t) => t.name)
    return spuseCreierul
  },
}))

vi.mock('./secrete.js', () => ({
  listeazaSecrete: async () => JSON.stringify({ secrete: secreteExistente.map((n) => ({ nume: n })) }),
}))

// Unde a ajuns fiecare unealtă cerută — asta apără „full echipat".
const cerute: string[] = []
vi.mock('./adminTools.js', () => ({
  SHARED_ADMIN_TOOLS: new Set([
    'list_source', 'read_source', 'search_source', 'db_tables', 'db_query', 'system_health',
    'repo_write', 'repo_open_pr', 'repo_merge_pr', 'run_runbook', 'runbook_status',
    'runbook_log', 'request_repair', 'secret_pune', 'secret_lista', 'secret_publica',
  ]),
  execSharedAdminTool: async (n: string) => {
    cerute.push(`admin:${n}`)
    return '{}'
  },
}))
vi.mock('./browser.js', () => ({
  browserOpen: async () => { cerute.push('browser:open'); return {} },
  browserClick: async () => ({}), browserType: async () => ({}),
  browserRead: async () => ({}), browserBack: async () => ({}), browserScroll: async () => ({}),
  browserKey: async () => ({}), browserClickAt: async () => ({}), browserClose: async () => {},
}))

// Lista ownerului nu se citește de pe disc: aici ne interesează MISIUNEA.
vi.mock('node:fs/promises', () => ({ readFile: async () => '' }))

const { poateSaLucreze, uneltele } = await import('./autonomie.js')

/** Închide un pas, ca să ajungem la următorul fără să-l jucăm de la capăt. */
function pasInchis(cod: string): void {
  kv.set(`autonomie:pas:${cod}`, JSON.stringify({ job: 0, incercari: 1, gata: true }))
}

beforeEach(() => {
  kv.clear()
  jobs = []
  urmatorulId = 1
  plafon = 20
  secreteExistente = []
  spuseCreierul = 'am pus cheile'
  turiDeMaini = 0
  uneltePrimite = []
  cerute.length = 0
})

// „Am cerut agenți full echipați și tu i-ai dat doar ciurucuri" (Adrian, 30 iul).
// Dispatch-ul ăsta e SINGURUL — îl folosesc și bucla, și constructorul de pe VPS
// prin `/api/constructor/tool`. Dacă cineva îl subțiază, agenții rămân ciungi și
// se vede abia când un ordin real pică. De-aia are paznic.
describe('uneltele: agentul e echipat la full, nu pe jumătate', () => {
  it('orice unealtă de admin ajunge la dispatch-ul comun', async () => {
    await uneltele('db_query', { sql: 'select 1' })
    await uneltele('run_runbook', { name: 'diagnostic' })
    await uneltele('secret_publica', {})
    expect(cerute).toEqual(['admin:db_query', 'admin:run_runbook', 'admin:secret_publica'])
  })

  it('browserul e real, nu o promisiune', async () => {
    await uneltele('browser_open', { url: 'https://bankaccountdata.gocardless.com/' })
    expect(cerute).toEqual(['browser:open'])
  })

  it('o unealtă inexistentă spune că nu există — nu tace și nu se preface', async () => {
    expect(JSON.parse(await uneltele('zbor_pe_luna', {})).error).toContain('necunoscută')
  })
})

describe('Kelion se apucă singur de treabă', () => {
  it('pasul de setări îl face CU MÂINILE lui, nu prin constructorul fără browser', async () => {
    secreteExistente = ['REVOLUT_PAY_LINK'] // dovada că a reușit
    const r = await poateSaLucreze()

    expect(r.pornit).toBe(true)
    expect(r.motiv).toContain('M0')
    // NIMIC în coada constructorului — el n-are cu ce face pasul ăsta.
    expect(jobs).toHaveLength(0)
    // A pornit o tură de lucru cu uneltele REALE.
    expect(turiDeMaini).toBe(1)
    expect(uneltePrimite).toContain('browser_open')
    expect(uneltePrimite).toContain('secret_pune')
    expect(uneltePrimite).toContain('secret_publica')
  })

  it('„gata" se MĂSOARĂ: fără cheia în secrete, pasul nu e terminat oricât ar spune el', async () => {
    secreteExistente = [] // cheia NU e acolo
    spuseCreierul = 'gata, am configurat tot' // …dar el zice că da
    await poateSaLucreze()

    const st = JSON.parse(kv.get('autonomie:pas:M0')!) as { gata?: boolean; incercari: number }
    expect(st.gata).toBeUndefined()
    expect(st.incercari).toBe(1)
  })

  it('dovedit prin măsurare → pasul se închide și trece la următorul', async () => {
    secreteExistente = ['REVOLUT_PAY_LINK']
    await poateSaLucreze()
    expect(JSON.parse(kv.get('autonomie:pas:M0')!).gata).toBe(true)

    const doi = await poateSaLucreze()
    expect(doi.motiv).toContain('M1')
  })

  it('când legea cere apăsarea ownerului, NU e eșecul lui — nu se arde o încercare', async () => {
    spuseCreierul = 'AȘTEPT APROBAREA: aprobă accesul în aplicația Revolut de pe telefon'
    const r = await poateSaLucreze()

    expect(r.pornit).toBe(true)
    expect(r.motiv).toContain('așteaptă o apăsare de la tine')
    expect(JSON.parse(kv.get('autonomie:pas:M0')!).incercari).toBe(0)
  })

  it('după 3 încercări pe același zid, blochează pasul și trece mai departe', async () => {
    for (let i = 0; i < 3; i++) await poateSaLucreze()
    expect(JSON.parse(kv.get('autonomie:pas:M0')!).blocat).toContain('3 încercări')

    const r = await poateSaLucreze()
    expect(r.motiv).toContain('M1') // a trecut la pasul următor
  })

  it('pasul de COD pleacă la constructor, cu comenzile EXACTE de verificare', async () => {
    pasInchis('M0')
    pasInchis('M1')
    const r = await poateSaLucreze()

    expect(r.pornit).toBe(true)
    expect(r.motiv).toContain('M2')
    expect(jobs).toHaveLength(1)
    expect(jobs[0].orderText).toContain('cd frontend && npm run build')
    expect(turiDeMaini).toBe(0) // n-a folosit mâinile pentru muncă de cod
  })

  it('cât timp constructorul are un ordin în lucru, nu mai ia altul', async () => {
    pasInchis('M0')
    pasInchis('M1')
    await poateSaLucreze()
    jobs[0].status = 'running'

    const r = await poateSaLucreze()
    expect(r.pornit).toBe(false)
    expect(r.motiv).toContain('în lucru')
    expect(jobs).toHaveLength(1)
  })

  it('dacă ordinul constructorului a picat, și-l ia înapoi CU jurnalul eșecului', async () => {
    pasInchis('M0')
    pasInchis('M1')
    await poateSaLucreze()
    jobs[0].status = 'failed'
    jobs[0].log = 'teste roșii: plati_neatribuite > nu prinde plata fără cod'

    const r = await poateSaLucreze()
    expect(r.motiv).toContain('reparație')
    expect(jobs[0].orderText).toContain('REPARI CE AI STRICAT TU')
    expect(jobs[0].orderText).toContain('nu prinde plata fără cod')
  })

  it('plafonul zilnic chiar oprește — nu mai e o limită doar declarată', async () => {
    plafon = 1
    secreteExistente = ['REVOLUT_PAY_LINK']
    const unu = await poateSaLucreze()
    expect(unu.pornit).toBe(true)

    const doi = await poateSaLucreze()
    expect(doi.pornit).toBe(false)
    expect(doi.motiv).toContain('plafon zilnic atins (1/1)')
  })
})
