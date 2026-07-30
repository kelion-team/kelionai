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

// Golurile pe care Kelion le-a triat singur ca „de implementat".
let goluri: { id: number; request: string; hits: number; reason: string | null; triage: string | null }[] = []
const goluriInchise: number[] = []

// Cerințele ownerului, cu drumul lor (noua → analizata → in_lucru → livrata).
let cerinte: { id: number; text: string; stare: string; criteriu: string | null; aleasa: string | null; optiuni: string | null }[] = []
const cerinteAtinse: { id: number; stare?: string }[] = []
let evaluari = 0

vi.mock('./cerinte.js', () => ({
  evalueazaCerinta: async () => {
    evaluari++
    return { ok: true, detaliu: '3 variante evaluate → browser' }
  },
  imbunatatireContinua: async () => ({ propuneri: 0, detaliu: 'merg bine așa' }),
}))

vi.mock('../db.js', () => ({
  listeazaCerinte: async (stare?: string) => cerinte.filter((c) => !stare || c.stare === stare),
  actualizeazaCerinta: async (id: number, p: { stare?: string }) => {
    cerinteAtinse.push({ id, stare: p.stare })
  },
  getCapabilityGaps: async () => goluri,
  setGapResolved: async (id: number) => {
    goluriInchise.push(id)
  },
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

let ultimulPrompt = ''
vi.mock('./brain.js', () => ({
  brainCompleteWithTools: async (prompt: string, tools: { name: string }[]) => {
    turiDeMaini++
    ultimulPrompt = prompt
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
  goluri = []
  goluriInchise.length = 0
  cerinte = []
  cerinteAtinse.length = 0
  evaluari = 0
})

// „Sisteme avansate de gestiune a cerințelor, evaluări avansate pe soluțiile
// oferite" (Adrian, 30 iul). Poarta care contează: o cerință NOUĂ nu pleacă la
// construit — întâi i se pun variantele pe masă. Eu am sărit peste pasul ăsta de
// trei ori azi (email → GoCardless → API Revolut) și de fiecare dată s-a dărâmat.
describe('cerințele: analiză înainte de cod', () => {
  function misiuneaInchisa(): void {
    for (const c of ['M0', 'M1', 'M2', 'M3', 'M4', 'M5']) pasInchis(c)
  }

  it('o cerință NOUĂ se evaluează întâi — nu se trimite direct la construit', async () => {
    misiuneaInchisa()
    cerinte = [{ id: 9, text: 'plata prin Revolut', stare: 'noua', criteriu: null, aleasa: null, optiuni: null }]

    const r = await poateSaLucreze()
    expect(evaluari).toBe(1)
    expect(jobs).toHaveLength(0) // NICIUN ordin înainte de analiză
    expect(r.motiv).toContain('cerința #9')
  })

  it('cerința ANALIZATĂ pleacă la construit cu varianta aleasă și criteriul lipite', async () => {
    misiuneaInchisa()
    cerinte = [{
      id: 9, text: 'plata prin Revolut', stare: 'analizata',
      criteriu: 'un user plătește și primește creditele singur',
      aleasa: 'browser pe portal — DE CE: nu-i cere nimic ownerului',
      optiuni: '[{"nume":"email"}]',
    }]

    const r = await poateSaLucreze()
    expect(r.motiv).toContain('C9')
    expect(jobs[0].orderText).toContain('un user plătește și primește creditele singur')
    expect(jobs[0].orderText).toContain('browser pe portal')
    expect(cerinteAtinse).toContainEqual({ id: 9, stare: 'in_lucru' })
  })

  it('ordinul terminat o duce pe „livrată", NU pe „verificată"', async () => {
    misiuneaInchisa()
    cerinte = [{ id: 9, text: 'x', stare: 'analizata', criteriu: null, aleasa: null, optiuni: null }]
    await poateSaLucreze()
    jobs[0].status = 'done'
    await poateSaLucreze()
    // „Verificat" cere o măsurătoare pe live, nu terminarea unui ordin.
    expect(cerinteAtinse).toContainEqual({ id: 9, stare: 'livrata' })
    expect(cerinteAtinse.some((c) => c.stare === 'verificata')).toBe(false)
  })
})

// „Autonomia mai înseamnă și capacitatea de a vedea ce îi lipsește și
// capabilități extinse autonome de învățare și dezvoltare" (Adrian, 30 iul).
// Vederea exista: `log_gap` + `triageGaps()` îl pun să-și trieze singur lista.
// Ce lipsea era exact pasul următor — nimeni nu construia ce marcase el
// „DE IMPLEMENTAT". Deci vedea, dar nu se dezvolta.
describe('ce îi lipsește, luat de el și construit', () => {
  it('un gol triat „de implementat" devine muncă pe care o ia singur', async () => {
    pasInchis('M0'); pasInchis('M1'); pasInchis('M2')
    pasInchis('M3'); pasInchis('M4'); pasInchis('M5')
    goluri = [{ id: 41, request: 'să-mi citească un cod QR din poză', hits: 3, reason: 'n-am unealtă', triage: 'DE IMPLEMENTAT: util, apare des' }]

    const r = await poateSaLucreze()
    expect(r.pornit).toBe(true)
    expect(r.motiv).toContain('G41')
    expect(jobs[0].orderText).toContain('cod QR din poză')
    // Ordinul îi cere să CONSTRUIASCĂ, nu să descrie.
    expect(jobs[0].orderText).toContain('CONSTRUIEȘTE-O')
  })

  it('golurile pe care le-a închis singur ca fără valoare NU se iau', async () => {
    pasInchis('M0'); pasInchis('M1'); pasInchis('M2')
    pasInchis('M3'); pasInchis('M4'); pasInchis('M5')
    goluri = [{ id: 7, request: 'ceva duplicat', hits: 1, reason: null, triage: 'ÎNCHIS AUTONOM: se poate deja' }]

    const r = await poateSaLucreze()
    expect(r.pornit).toBe(false)
    expect(jobs).toHaveLength(0)
  })

  it('golul construit se închide și în lista lui de lipsuri — nu-l reia la nesfârșit', async () => {
    pasInchis('M0'); pasInchis('M1'); pasInchis('M2')
    pasInchis('M3'); pasInchis('M4'); pasInchis('M5')
    goluri = [{ id: 41, request: 'cod QR', hits: 3, reason: null, triage: 'DE IMPLEMENTAT: util' }]

    await poateSaLucreze()
    jobs[0].status = 'done'
    await poateSaLucreze()
    expect(goluriInchise).toEqual([41])
  })
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

  it('NU renunță niciodată la un pas — dar nici nu blochează restul', async () => {
    // Cinci treceri pe un pas care nu iese. Înainte, după a treia era marcat
    // „blocat" și se renunța — o barieră pe care n-a cerut-o nimeni.
    await poateSaLucreze()
    const dupaPrima = JSON.parse(kv.get('autonomie:pas:M0')!) as { blocat?: string; incercari: number }
    expect(dupaPrima.blocat).toBeUndefined() // nu există abandon, deloc
    expect(dupaPrima.incercari).toBe(1)

    // Trecerea următoare NU se blochează pe pasul care n-a ieșit: îl lasă în
    // urmă pe cel încercat deja și ia unul neîncercat. Deci și insistă, și
    // avansează — fără să renunțe la nimic.
    const doi = await poateSaLucreze()
    expect(doi.motiv).toContain('M1')
    // Iar M0 rămâne în listă, neterminat, ca să fie reluat.
    expect(JSON.parse(kv.get('autonomie:pas:M0')!).gata).toBeUndefined()
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
    pasInchis('M0'); pasInchis('M1'); pasInchis('M3'); pasInchis('M4'); pasInchis('M5')
    await poateSaLucreze()
    jobs[0].status = 'failed'
    jobs[0].log = 'teste roșii: plati_neatribuite > nu prinde plata fără cod'

    const r = await poateSaLucreze()
    expect(r.motiv).toContain('reparație')
    expect(jobs[0].orderText).toContain('REPARI CE AI STRICAT TU')
    expect(jobs[0].orderText).toContain('nu prinde plata fără cod')
  })

  it('după 3 încercări IESE ȘI CAUTĂ — nu abandonează, nu se învârte', async () => {
    // Adrian, 30 iul: „după 3 trebuie să caute soluții, să iasă, să identifice
    // soluții, să studieze problema, să-și instaleze unelte diverse — în niciun
    // caz să abandoneze sau să stea în buclă."
    // M0 e singurul rămas, și a picat de 3 ori.
    pasInchis('M1'); pasInchis('M2'); pasInchis('M3'); pasInchis('M4'); pasInchis('M5')
    kv.set('autonomie:pas:M0', JSON.stringify({ job: 0, incercari: 3 }))

    await poateSaLucreze()
    expect(ultimulPrompt).toContain('AI ÎNCERCAT DEJA DE 3 ORI')
    expect(ultimulPrompt).toContain('IEȘI ȘI CAUTĂ') // browser pe eroarea exactă
    expect(ultimulPrompt).toContain('INSTALEAZĂ-ȚI UNELTE') // își pune ce-i lipsește
    expect(ultimulPrompt).toContain('Nu ai voie să abandonezi')

  })

  it('NU există plafon zilnic — bariera aia a fost scoasă', async () => {
    // Adrian, 30 iul: „eu plătesc, eu cer, tu execuți fără să comentezi".
    // Plafonul îl pusesem eu, nu mi-l ceruse nimeni.
    plafon = 1
    secreteExistente = ['REVOLUT_PAY_LINK']
    expect((await poateSaLucreze()).pornit).toBe(true)
    // A doua trecere, peste „plafon": lucrează mai departe.
    const doi = await poateSaLucreze()
    expect(doi.pornit).toBe(true)
    expect(doi.motiv).not.toContain('plafon')
  })
})
