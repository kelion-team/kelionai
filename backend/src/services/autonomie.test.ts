// ── THE LOOP THAT MAKES KELION GET TO WORK BY ITSELF ─────────────────────────
//
// Adrian, Jul 30: "make it autonomous" · "let it repair itself" · "its
// autonomy theme will be to do the whole Revolut part" · "it has 1000000%
// freedom to use everything to reach my goal".
//
// WHAT THIS TEST GUARDS, and why every row is here:
//
//   1. **The task lands where the tools EXIST.** This is the bug I almost
//      shipped to production: portal steps were leaving for the CONSTRUCTOR,
//      which has exactly 7 tools (ls/grep/read/write/edit/run/finish) and NO
//      browser. I would have asked an agent without a browser to enter a site
//      — it would have failed three times, on the owner's money, and stopped
//      with "blocked".
//   2. **"Done" is MEASURED, not declared.** A hands step is finished only if
//      the keys REALLY exist. The brain's word is no proof — rule #1.
//   3. **The owner's approval is not its failure.** When the law requires the
//      account holder's tap, the step does NOT consume an attempt: nobody
//      made a mistake.
//   4. The rest of the guards: one thing at a time, the daily ceiling that
//      really stops, three attempts on the same wall and then moving on, with
//      the reason in plain sight.
import { describe, it, expect, vi, beforeEach } from 'vitest'

interface JobFals {
  id: number
  orderText: string
  status: 'queued' | 'running' | 'done' | 'failed'
  log: string | null
  /** WHO started it — "kelion-autonom" = the loop, an email = a human. The
   *  wall only looks at orders STARTED BY IT: human-given failures don't stop
   *  it. */
  orderedBy?: string
}

const kv = new Map<string, string>()
let jobs: JobFals[] = []
let urmatorulId = 1
let plafon = 20

// What the loop "sees" when it asks which secrets exist — the proof of the hands steps.
let secreteExistente: string[] = []
// The RUNNING server's payment link (2 aug): M0's proof reads config, not the
// GitHub secret NAMES — on the real VPS the env has REVOLUT_PAY_LINK while the
// GitHub secret is called REVOLUT_PAY, so the name check could never pass.
let linkPlataRevolut = ''
// What the brain says after it worked with its hands.
let spuseCreierul = 'am pus cheile'
// How many hands turns were started, and with which tools.
let turiDeMaini = 0
let uneltePrimite: string[] = []
// Cheltuiala MĂSURATĂ a constructorului azi (pentru plafonul B8/K15). Configurabil
// din test ca să probăm oprirea la atingere ȘI dezactivarea prin comutator.
let cheltuitAzi = 0

vi.mock('../config.js', () => ({
  config: {
    adminEmail: 'adrianenc11@gmail.com',
    brain: { topDefault: 'model-top' },
    get autonomyDailyMax() {
      return plafon
    },
    revolut: {
      get payLink() {
        return linkPlataRevolut
      },
    },
    enableBanking: { appId: '', privateKeyB64: '' },
  },
}))

// The gaps Kelion triaged by itself as "to be implemented".
let goluri: { id: number; request: string; hits: number; reason: string | null; triage: string | null }[] = []
const goluriInchise: number[] = []

// The owner's requirements, with their path (noua → analizata → in_lucru → livrata).
let cerinte: { id: number; text: string; stare: string; criteriu: string | null; aleasa: string | null; optiuni: string | null; dificultate?: number }[] = []
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
    const j: JobFals = { id: urmatorulId++, orderText: text, status: 'queued', log: null, orderedBy: _by }
    jobs.unshift(j)
    return j.id
  },
  listBuildJobs: async () => jobs,
  loadKv: async (k: string) => kv.get(k) ?? null,
  saveKv: async (k: string, v: string) => {
    kv.set(k, v)
  },
  cheltuitAziConstructor: async () => cheltuitAzi,
  // P10: citirea cu context pentru afișaj — în teste, aceeași cifră, citită.
  cheltuialaAziConstructor: async () => ({ citit: true, usd: cheltuitAzi, joburiAzi: 0, faraCost: 0 }),
}))

let ultimulPrompt = ''
// The model ladder: we give it as a fixed list, so the test can check WHETHER
// a heavy task leaves on the best hand — without touching the network.
let scaraCeruta: string[] | undefined
vi.mock('./brain.js', () => ({
  expertModelLadder: () => ['model-lucru', 'model-top', 'gratuit:free'],
  brainCompleteWithTools: async (
    prompt: string,
    tools: { name: string }[],
    _exec: unknown,
    opts?: { models?: string[] },
  ) => {
    scaraCeruta = opts?.models
    turiDeMaini++
    ultimulPrompt = prompt
    uneltePrimite = tools.map((t) => t.name)
    return spuseCreierul
  },
}))

// The owner's switch. We mock it so we can prove BOTH states.
let opritDeOwner = false
vi.mock('./runbooks.js', () => ({ isOpsPaused: async () => opritDeOwner }))

// Comutatorul-master al motoarelor autonome (9 aug): OFF by default în producție.
// În teste îl ținem PORNIT (autonomOprit=false) ca testele de comportament să
// ruleze; un test dedicat îl trece pe OFF ca să probeze că bucla nu cheltuie.
let autonomOprit = false
vi.mock('./autonomActiv.js', () => ({ autonomActiv: async () => !autonomOprit }))

vi.mock('./secrete.js', () => ({
  listeazaSecrete: async () => JSON.stringify({ secrete: secreteExistente.map((n) => ({ nume: n })) }),
}))

// Where every requested tool landed — this guards "fully equipped".
const cerute: string[] = []
vi.mock('./adminTools.js', async (importOriginal) => {
  // The tool SETS are the REAL ones: a literal copy here had gone stale (it
  // was missing the guest-voice tools), so the test would have passed even
  // with a hardcoded production list. Only the EXECUTION is faked.
  const real = await importOriginal<typeof import('./adminTools.js')>()
  return {
    SHARED_ADMIN_TOOLS: real.SHARED_ADMIN_TOOLS,
    USER_SCOPED_TOOLS: real.USER_SCOPED_TOOLS,
    execSharedAdminTool: async (n: string) => {
      cerute.push(`admin:${n}`)
      return '{}'
    },
    execUserScopedTool: async (n: string) => {
      cerute.push(`user:${n}`)
      return '{}'
    },
  }
})
vi.mock('./browser.js', () => ({
  browserOpen: async () => { cerute.push('browser:open'); return {} },
  browserClick: async () => ({}), browserType: async () => ({}),
  browserRead: async () => ({}), browserBack: async () => ({}), browserScroll: async () => ({}),
  browserKey: async () => ({}), browserClickAt: async () => ({}), browserClose: async () => {},
}))

// The owner's list is not read from disk: here we care about the MISSION.
vi.mock('node:fs/promises', () => ({ readFile: async () => '' }))

const {
  poateSaLucreze,
  uneltele,
  urmatoareaPauzaMs,
  PAUZA_A_LUCRAT_MS,
  PAUZA_ORDIN_IN_LUCRU_MS,
  PAUZA_NIMIC_MS,
} = await import('./autonomie.js')
// The voice window is REAL here (adminLock is not mocked): that way the very
// gate the owner asked for is proven, not an imitation of it.
const { marcheazaVoce, uitaVocea, marcheazaFata, uitaFata } = await import('./adminLock.js')

/** Closes a step, so we reach the next one without playing it from scratch. */
function pasInchis(cod: string): void {
  kv.set(`autonomie:pas:${cod}`, JSON.stringify({ job: 0, incercari: 1, gata: true }))
}

beforeEach(() => {
  kv.clear()
  jobs = []
  urmatorulId = 1
  plafon = 20
  secreteExistente = []
  linkPlataRevolut = ''
  spuseCreierul = 'am pus cheile'
  turiDeMaini = 0
  uneltePrimite = []
  cerute.length = 0
  goluri = []
  goluriInchise.length = 0
  cerinte = []
  cerinteAtinse.length = 0
  evaluari = 0
  cheltuitAzi = 0
  scaraCeruta = undefined
  // The voice window is global per process: if it stays open from one test to
  // another, the card step would leak into tests that have nothing to do with
  // it.
  uitaVocea('adrianenc11@gmail.com')
  uitaFata('adrianenc11@gmail.com')
  opritDeOwner = false
  autonomOprit = false
})

describe('executorul bridge poate crea ordine reale de build', () => {
  it('build_software validează și pune ordinul în coada constructorului', async () => {
    const order = 'Repară workerul de auto-publicare și adaugă teste pentru retry.'
    const rezultat = JSON.parse(await uneltele('build_software', { order }))
    expect(rezultat).toEqual({ ok: true, job: 1 })
    expect(jobs).toContainEqual(expect.objectContaining({
      id: 1,
      orderText: order,
      orderedBy: 'adrianenc11@gmail.com',
      status: 'queued',
    }))
  })

  it('build_software respinge ordinul vag fără să creeze job', async () => {
    const rezultat = JSON.parse(await uneltele('build_software', { order: 'repară' }))
    expect(rezultat.error).toBe('ordin_respins')
    expect(rezultat.motiv).toContain('prea scurt')
    expect(jobs).toHaveLength(0)
  })
})

// THE SWITCH (Adrian, Jul 31, after seeing $27.84 burned in 3½ hours and
// asking "first it must be verified that autonomy is on stop"). It wasn't:
// the button wrote to the database, the panel showed "STOPPED", and the loop
// kept working. A switch that doesn't switch is worse than none — you think
// you stopped it, so you stop watching. This test doesn't let it break
// silently again.
describe('întrerupătorul ownerului chiar întrerupe', () => {
  it('pe STOP: nicio tură de creier, niciun ordin, zero cheltuit', async () => {
    opritDeOwner = true
    secreteExistente = []
    const r = await poateSaLucreze()
    expect(r.pornit).toBe(false)
    expect(r.motiv).toContain('oprit de tine')
    // The proof it cost nothing: the brain was not called at all.
    expect(turiDeMaini).toBe(0)
    expect(jobs.length).toBe(0)
  })

  it('pe PORNIT: lucrează ca înainte — butonul nu e o frână permanentă', async () => {
    opritDeOwner = false
    const r = await poateSaLucreze()
    expect(r.motiv).not.toContain('oprit de tine')
  })

  // OFF BY DEFAULT (Adrian, 9 aug: „nu am folosit 1 sec… clar altceva arde" +
  // „off default, dacă nu trebuie nu se autoactivează"). Comutatorul-master al
  // motoarelor autonome e OPRIT implicit; bucla nu cheltuie nimic până e pornit.
  it('cu autonomia OPRITĂ (implicit): nicio tură de creier, niciun ordin', async () => {
    autonomOprit = true
    const r = await poateSaLucreze()
    expect(r.pornit).toBe(false)
    expect(r.motiv).toContain('autonomie OPRITĂ')
    expect(turiDeMaini).toBe(0)
    expect(jobs.length).toBe(0)
  })
})

// "By difficulty level set automatically per requirement" — and for its HANDS
// too, not just for the constructor. M1 (the portal) is difficulty 5: if it
// leaves on the usual model, it finds out it can't only after wasting the
// turns.
describe('mâinile lui pornesc pe mâna potrivită dificultății', () => {
  it('o sarcină grea (M1) cere TOP-ul în capul scării', async () => {
    kv.set('autonomie:pas:M0', JSON.stringify({ job: 0, incercari: 1, gata: true }))
    await poateSaLucreze()
    expect(scaraCeruta?.[0]).toBe('model-top')
  })
})

// "Advanced requirement-management systems, advanced evaluations of the
// offered solutions" (Adrian, Jul 30). The gate that matters: a NEW
// requirement doesn't leave for building — first its variants are laid on the
// table. I skipped this step three times today (email → GoCardless → Revolut
// API) and every time it collapsed.
describe('cerințele: analiză înainte de cod', () => {
  function misiuneaInchisa(): void {
    for (const c of ['M0', 'M1', 'M2', 'M3', 'M4', 'M5']) pasInchis(c)
  }

  it('o cerință NOUĂ se evaluează întâi — nu se trimite direct la construit', async () => {
    misiuneaInchisa()
    cerinte = [{ id: 9, text: 'plata prin Revolut', stare: 'noua', criteriu: null, aleasa: null, optiuni: null }]

    const r = await poateSaLucreze()
    expect(evaluari).toBe(1)
    expect(jobs).toHaveLength(0) // NO order before the analysis
    expect(r.motiv).toContain('cerința #9')
  })

  // "By difficulty level set automatically per requirement" (Adrian, Jul 30).
  // The mark in the order is the ONLY thing the constructor picks its hand by:
  // if it disappears, a heavy task starts on a small model, burns the turns
  // narrating and fails — exactly what happened until now.
  it('ordinul poartă NIVELUL DE DIFICULTATE, ca mâna să fie aleasă din start', async () => {
    misiuneaInchisa()
    cerinte = [{
      id: 9, text: 'plata prin Revolut', stare: 'analizata', dificultate: 5,
      criteriu: 'userul primește creditele', aleasa: 'browser pe portal', optiuni: null,
    }]
    await poateSaLucreze()
    expect(jobs[0].orderText.startsWith('NIVEL DE DIFICULTATE: 5/5')).toBe(true)
  })

  it('o sarcină care a picat pleacă a doua oară pe o mână mai bună', async () => {
    misiuneaInchisa()
    cerinte = [{
      id: 9, text: 'x', stare: 'analizata', dificultate: 3,
      criteriu: null, aleasa: null, optiuni: null,
    }]
    await poateSaLucreze()
    expect(jobs[0].orderText).toContain('NIVEL DE DIFICULTATE: 3/5')
    jobs[0].status = 'failed'
    jobs[0].log = 'a picat'

    await poateSaLucreze()
    // +1 per attempt: what failed once is harder than it looked.
    expect(jobs[0].orderText).toContain('NIVEL DE DIFICULTATE: 4/5')
  })

  it('acțiunea directă de screenshot nu intră în constructor', async () => {
    misiuneaInchisa()
    cerinte = [{
      id: 57, text: 'fă un screenshot proaspăt la monitor și focalizează pe bara de admin', stare: 'analizata',
      criteriu: 'să se vadă limbile', aleasa: 'deschide browserul și fă captura', optiuni: null,
    }]

    const r = await poateSaLucreze()
    expect(jobs).toHaveLength(0)
    expect(r.motiv).toContain('netrimis constructorului')
    expect(cerinteAtinse).toContainEqual({ id: 57, stare: 'respinsa' })
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

  // MĂSURAT LIVE (3 aug): C1 era „analizata" de la 00:34 și structural nu
  // putea primi ordin NICIODATĂ — lista de dus era doar-misiune până se
  // închidea tot; analiza (tură plătită) fusese deja cheltuită. Analiză cu
  // bani, livrare nicicând.
  it('cerința ANALIZATĂ primește ordin și când misiunea NU e gata — nu așteaptă închiderea ei', async () => {
    // misiunea deschisă, cu pași încercați deja (ca pe viu: M0/M1 la 3 încercări)
    for (const c of ['M0', 'M1', 'M2', 'M3', 'M4', 'M5'])
      kv.set(`autonomie:pas:${c}`, JSON.stringify({ job: 0, incercari: 3 }))
    cerinte = [{
      id: 1, text: 'uneltele constructorului active direct în chat', stare: 'analizata',
      criteriu: 'build_software apare în registrul capabilităților de chat',
      aleasa: 'flag în registru — DE CE: fără cale nouă de cod', optiuni: null,
    }]

    const r = await poateSaLucreze()
    expect(r.motiv).toContain('C1')
    expect(jobs[0].orderText).toContain('build_software apare în registrul')
  })

  it('la încercări EGALE, pasul de misiune are întâietate față de cerință — prioritatea rămâne a misiunii', async () => {
    // toți pașii și cerința pe 0 încercări → sortarea stabilă ține misiunea prima
    cerinte = [{
      id: 1, text: 'orice', stare: 'analizata',
      criteriu: 'x', aleasa: 'y', optiuni: null,
    }]

    const r = await poateSaLucreze()
    expect(r.motiv).not.toContain('C1')
    expect(r.motiv).toMatch(/M\d/)
  })

  it('ce e livrat se PROBEAZĂ pe live, înaintea oricărei munci noi', async () => {
    misiuneaInchisa()
    cerinte = [{ id: 9, text: 'x', stare: 'livrata', criteriu: 'userul primește creditele', aleasa: null, optiuni: null }]
    spuseCreierul = 'VERIFICAT: am intrat pe kelionai.app, am cumpărat credit, a intrat în 4 minute'

    const r = await poateSaLucreze()
    expect(r.motiv).toContain('VERIFICATĂ pe live')
    expect(cerinteAtinse).toContainEqual({ id: 9, stare: 'verificata' })
    expect(jobs).toHaveLength(0) // the proof passes before any new work
  })

  it('dacă proba pică, cerința se ÎNTOARCE la lucru — nu se declară gata', async () => {
    misiuneaInchisa()
    cerinte = [{ id: 9, text: 'x', stare: 'livrata', criteriu: 'userul primește creditele', aleasa: null, optiuni: null }]
    spuseCreierul = 'NU MERGE: butonul de credit dă 503'

    const r = await poateSaLucreze()
    expect(r.motiv).toContain('n-a trecut proba')
    expect(cerinteAtinse).toContainEqual({ id: 9, stare: 'analizata' })
  })

  it('nu poate scrie „verificat" fără măsurătoare — orice altceva înseamnă că n-a trecut', async () => {
    misiuneaInchisa()
    cerinte = [{ id: 9, text: 'x', stare: 'livrata', criteriu: null, aleasa: null, optiuni: null }]
    spuseCreierul = 'cred că merge, arată bine' // no proof → does NOT pass
    await poateSaLucreze()
    expect(cerinteAtinse).toContainEqual({ id: 9, stare: 'analizata' })
  })

  it('ordinul terminat o duce pe „livrată", NU pe „verificată"', async () => {
    misiuneaInchisa()
    cerinte = [{ id: 9, text: 'x', stare: 'analizata', criteriu: null, aleasa: null, optiuni: null }]
    await poateSaLucreze()
    jobs[0].status = 'done'
    await poateSaLucreze()
    // "Verified" requires a live measurement, not an order's completion.
    expect(cerinteAtinse).toContainEqual({ id: 9, stare: 'livrata' })
    expect(cerinteAtinse.some((c) => c.stare === 'verificata')).toBe(false)
  })
})

// "Autonomy also means the capacity to see what it's missing and extended
// autonomous capabilities of learning and development" (Adrian, Jul 30).
// The seeing existed: `log_gap` + `triageGaps()` make it triage its own list.
// What was missing was exactly the next step — nobody built what it marked
// "DE IMPLEMENTAT". So it saw, but didn't develop.
describe('ce îi lipsește, luat de el și construit', () => {
  it('un gol triat „de implementat" devine muncă pe care o ia singur', async () => {
    pasInchis('M0'); pasInchis('M1'); pasInchis('M2')
    pasInchis('M3'); pasInchis('M4'); pasInchis('M5')
    goluri = [{ id: 41, request: 'să-mi citească un cod QR din poză', hits: 3, reason: 'n-am unealtă', triage: 'DE IMPLEMENTAT: util, apare des' }]

    const r = await poateSaLucreze()
    expect(r.pornit).toBe(true)
    expect(r.motiv).toContain('G41')
    expect(jobs[0].orderText).toContain('cod QR din poză')
    // The order asks it to BUILD, not to describe.
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

// "I asked for fully equipped agents and you gave them only crumbs" (Adrian,
// Jul 30). This dispatch is the ONLY one — both the loop and the constructor
// on the VPS use it through `/api/constructor/tool`. If someone thins it, the
// agents stay crippled and it only shows when a real order fails. That's why
// it has a guard.
describe('uneltele: agentul e echipat la full, nu pe jumătate', () => {
  it('orice unealtă de admin ajunge la dispatch-ul comun', async () => {
    await uneltele('db_query', { sql: 'select 1' })
    await uneltele('run_runbook', { name: 'diagnostic' })
    await uneltele('secret_publica', {})
    expect(cerute).toEqual(['admin:db_query', 'admin:run_runbook', 'admin:secret_publica'])
  })

  it('browserul e real, nu o promisiune', async () => {
    await uneltele('browser_open', { url: 'https://enablebanking.com/' })
    expect(cerute).toEqual(['browser:open'])
  })

  it('o unealtă inexistentă spune că nu există — nu tace și nu se preface', async () => {
    expect(JSON.parse(await uneltele('zbor_pe_luna', {})).error).toContain('necunoscută')
  })
})

describe('Kelion se apucă singur de treabă', () => {
  it('pasul de setări îl face CU MÂINILE lui, nu prin constructorul fără browser', async () => {
    secreteExistente = ['REVOLUT_PAY_LINK'] // the proof it succeeded
    const r = await poateSaLucreze()

    expect(r.pornit).toBe(true)
    expect(r.motiv).toContain('M0')
    // NOTHING in the constructor's queue — it has nothing to do this step with.
    expect(jobs).toHaveLength(0)
    // It started a work turn with the REAL tools.
    expect(turiDeMaini).toBe(1)
    expect(uneltePrimite).toContain('browser_open')
    expect(uneltePrimite).toContain('secret_pune')
    expect(uneltePrimite).toContain('secret_publica')
  })

  it('„gata" se MĂSOARĂ: fără cheia în secrete, pasul nu e terminat oricât ar spune el', async () => {
    secreteExistente = [] // the key is NOT there
    spuseCreierul = 'gata, am configurat tot' // …but it says yes
    await poateSaLucreze()

    const st = JSON.parse(kv.get('autonomie:pas:M0')!) as { gata?: boolean; incercari: number }
    expect(st.gata).toBeUndefined()
    expect(st.incercari).toBe(1)
  })

  it('dovedit prin măsurare → pasul se închide și trece la următorul', async () => {
    // The proof is the RUNNING server's config (2 aug), not the secret names.
    linkPlataRevolut = 'https://revolut.me/kelionai'
    await poateSaLucreze()
    expect(JSON.parse(kv.get('autonomie:pas:M0')!).gata).toBe(true)

    const doi = await poateSaLucreze()
    expect(doi.motiv).toContain('M1')
  })

  it('când legea cere apăsarea ownerului: nu arde o încercare ȘI nu reia la 2 min', async () => {
    spuseCreierul = 'AȘTEPT APROBAREA: aprobă accesul în aplicația Revolut de pe telefon'
    const r = await poateSaLucreze()

    // `pornit: false` (auditul de cost, 5 aug): un pas care așteaptă apăsarea
    // ownerului NU e „a lucrat" — altfel relua o tură plătită la 2 min la
    // nesfârșit. Cade pe cadența lungă (1h), iar `incercari` rămâne 0.
    expect(r.pornit).toBe(false)
    expect(urmatoareaPauzaMs(r)).toBe(PAUZA_NIMIC_MS)
    expect(r.motiv).toContain('așteaptă o apăsare de la tine')
    expect(JSON.parse(kv.get('autonomie:pas:M0')!).incercari).toBe(0)
  })

  it('NU renunță niciodată la un pas — dar nici nu blochează restul', async () => {
    // Five passes over a step that won't come out. Before, after the third it
    // was marked "blocked" and given up on — a barrier nobody asked for.
    await poateSaLucreze()
    const dupaPrima = JSON.parse(kv.get('autonomie:pas:M0')!) as { blocat?: string; incercari: number }
    expect(dupaPrima.blocat).toBeUndefined() // there is no abandonment, at all
    expect(dupaPrima.incercari).toBe(1)

    // The next pass does NOT block on the step that didn't come out: it leaves
    // the already-tried one behind and takes an untried one. So it both
    // insists and advances — without giving up anything.
    const doi = await poateSaLucreze()
    expect(doi.motiv).toContain('M1')
    // And M0 stays in the list, unfinished, so it can be retried.
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
    expect(turiDeMaini).toBe(0) // it didn't use its hands for code work
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
    // Adrian, Jul 30: "after 3 it must look for solutions, get out, identify
    // solutions, study the problem, install various tools for itself — under no
    // circumstances abandon or stay in a loop."
    // M0 is the only one left, and it failed 3 times.
    pasInchis('M1'); pasInchis('M2'); pasInchis('M3'); pasInchis('M4'); pasInchis('M5')
    kv.set('autonomie:pas:M0', JSON.stringify({ job: 0, incercari: 3 }))

    await poateSaLucreze()
    expect(ultimulPrompt).toContain('AI ÎNCERCAT DEJA DE 3 ORI')
    expect(ultimulPrompt).toContain('IEȘI ȘI CAUTĂ') // browser on the exact error
    expect(ultimulPrompt).toContain('INSTALEAZĂ-ȚI UNELTE') // it installs what it's missing
    expect(ultimulPrompt).toContain('Nu ai voie să abandonezi')

  })

  // THE CARD STEP (M6) — "automatic payments", with the voice gate.
  //
  // Here was a trap I almost published: M6 is the least tried step, so the
  // loop would have picked it FIRST at every pass, it would have failed on
  // "I didn't recognize your voice", and it would have starved all the rest —
  // the mission, the requirements, the gaps. A step impossible NOW is not a
  // task, it's a loop.
  it('fără vocea ownerului, pasul cardului NU se ia și NU blochează restul', async () => {
    pasInchis('M0'); pasInchis('M1'); pasInchis('M2')
    pasInchis('M3'); pasInchis('M4'); pasInchis('M5')
    const r = await poateSaLucreze()
    // The mission is considered passed (M6 CANNOT be done now) → it moves on
    // to requirements/gaps/list. It doesn't spin on an impossible step.
    expect(r.motiv).not.toContain('M6')
    expect(turiDeMaini).toBe(0)
    expect(JSON.parse(kv.get('autonomie:pas:M6') ?? '{"incercari":0}').incercari).toBe(0)
  })

  it('după ce i-a recunoscut vocea, ia pasul cardului — cu uneltele de card în mână', async () => {
    pasInchis('M0'); pasInchis('M1'); pasInchis('M2')
    pasInchis('M3'); pasInchis('M4'); pasInchis('M5')
    // M6 cere TREI factori: voce ȘI față recunoscute (+ admin). Fără față,
    // bucla îl sare (Adrian, 5 aug: „adaugă verificare față").
    marcheazaVoce('adrianenc11@gmail.com')
    marcheazaFata('adrianenc11@gmail.com')
    const r = await poateSaLucreze()
    expect(r.motiv).toContain('M6')
    expect(uneltePrimite).toContain('card_completeaza')
    expect(uneltePrimite).toContain('card_gata')
    // The goal written in the order is the automated payment, not the filled form.
    expect(ultimulPrompt).toContain('PLĂȚILE AUTOMATE')
    // Difficulty 5 → starts straight on TOP, doesn't find out after wasting turns.
    expect(scaraCeruta?.[0]).toBe('model-top')
  })

  // THE WALL (Adrian, Jul 31: "how does it resume or what happens with the
  // failed ones? what's the logic????" · "it doesn't stop, that's the
  // logic?"). Yes, that was it — and it was half a rule. "It doesn't abandon"
  // doesn't mean "repeat exactly the same thing forever". Ten failed orders
  // in a row, zero finished, and the eleventh left calmly, on his money.
  const zidDe = (n: number, log: string): void => {
    for (let i = 0; i < n; i++) {
      jobs.push({ id: 100 + i, orderText: 'x', status: 'failed', log, orderedBy: 'kelion-autonom' })
    }
  }

  it('5 ordine picate la rând → schimbă ținta: „de ce pică toate", nu al 6-lea ordin', async () => {
    zidDe(5, 'Eroare: modelul nu folosește uneltele si raspunde cu text gol')
    const r = await poateSaLucreze()
    expect(r.motiv).toContain('ZID')
    expect(r.motiv).toContain('5 ordine picate la rând')
    // The diagnostic order leaves for its HANDS — the constructor is the broken one.
    expect(ultimulPrompt).toContain('AFLĂ DE CE PICĂ TOATE')
    expect(ultimulPrompt).toContain('server_logs')
    // And it puts the repeating cause under its nose, measured from the logs.
    expect(ultimulPrompt).toContain('CE SE REPETĂ ÎN JURNALE')
    // It did NOT put a new order in the queue — that was the waste.
    expect(jobs.some((j) => j.status === 'queued')).toBe(false)
  })

  it('un singur succes rupe zidul — seria se numără de la ultimul „gata"', async () => {
    // Orders come newest FIRST (ORDER BY created_at DESC), so a recent success
    // must sit near the top of the list to break the streak.
    zidDe(1, 'Eroare X')
    jobs.push({ id: 90, orderText: 'x', status: 'done', log: null, orderedBy: 'kelion-autonom' })
    zidDe(4, 'Eroare X')
    const r = await poateSaLucreze()
    expect(r.motiv).not.toContain('ZID')
  })

  // CĂDEREA ZIDULUI MUTĂ ȘI GRANIȚA DE NUMĂRARE (impasul măsurat live, 2-3
  // aug): seria istorică de eșecuri nu se schimbă la un sha nou, deci zidul se
  // re-ridica din aceleași 11 ordine vechi la FIECARE schimbare de lume — câte
  // o tură de diagnostic arsă de fiecare dată, și niciun ordin nou, deci nimic
  // nu putea rupe seria vreodată. „Zidul cade și lucrul repornește" cere ca și
  // NUMĂRĂTOAREA să repornească.
  it('lumea schimbată → zidul cade DE TOT: lucrul repornește, nu încă un diagnostic pe seria veche', async () => {
    zidDe(5, 'Eroare X')
    kv.set('autonomie:zid', JSON.stringify({
      cate: 5, cauza: 'Eroare X', cand: '2026-08-02T21:55:03Z',
      semnatura: 'LUME-VECHE|9|0', diagnosticat: true, raport: 'ceva',
    }))
    const r = await poateSaLucreze()
    // Nu s-a oprit pe zid și nu a re-diagnosticat seria veche.
    expect(r.motiv).not.toContain('ZID')
    expect(r.motiv).not.toContain('OPRIT pe zid')
    expect(kv.get('autonomie:zid') ?? '').toBe('')
    // Granița s-a mutat peste ordinele lumii vechi (id-urile 100..104).
    expect(Number(kv.get('autonomie:zid:granita'))).toBeGreaterThanOrEqual(104)
  })

  it('după cădere, seria veche nu mai contează — dar o serie NOUĂ de eșecuri ridică zidul iar', async () => {
    zidDe(5, 'Eroare veche')                 // lumea veche, sub graniță
    kv.set('autonomie:zid:granita', '150')   // zidul a căzut după ordinul 150
    for (let i = 0; i < 3; i++) {
      jobs.push({ id: 200 + i, orderText: 'x', status: 'failed', log: 'Eroare noua', orderedBy: 'kelion-autonom' })
    }
    const r = await poateSaLucreze()
    // Doar cele 3 de după graniță se numără — zid nou, cu cifra lor.
    expect(r.motiv).toContain('ZID')
    expect(r.motiv).toContain('3 ordine picate la rând')
  })

  // RITMUL (măsurat 3 aug, 00:34→01:34): analiza cerinței #1 s-a terminat la
  // 00:34, iar ordinul ei nu putea fi scris decât la trecerea următoare — fixă,
  // peste O ORĂ. Ora de somn după o acțiune REUȘITĂ e o barieră nepusă de
  // owner (30 iul: „eu plătesc, tu execuți"); ea rămâne doar unde trecerea nu
  // costă nimic și n-are ce continua.
  it('ritmul: a lucrat → continuă în minute, nu peste o oră', async () => {
    expect(urmatoareaPauzaMs({ pornit: true, motiv: 'cerința #1: analizată' })).toBe(PAUZA_A_LUCRAT_MS)
    expect(PAUZA_A_LUCRAT_MS).toBeLessThanOrEqual(5 * 60 * 1000)
  })

  it('ritmul: ordin în lucru → verifică des și ieftin (doar DB), nu o dată pe oră', async () => {
    expect(urmatoareaPauzaMs({ pornit: false, motiv: 'are deja un ordin în lucru' })).toBe(
      PAUZA_ORDIN_IN_LUCRU_MS,
    )
    expect(PAUZA_ORDIN_IN_LUCRU_MS).toBeLessThan(PAUZA_NIMIC_MS)
  })

  it('ritmul: zid sau nimic de făcut → ora rămâne (trecerea aia nu consumă nimic)', async () => {
    expect(urmatoareaPauzaMs({ pornit: false, motiv: '⏸ OPRIT pe zid, nu consum nimic: …' })).toBe(
      PAUZA_NIMIC_MS,
    )
    expect(urmatoareaPauzaMs({ pornit: false, motiv: 'baza de date n-a răspuns' })).toBe(PAUZA_NIMIC_MS)
  })

  it('eșecurile cerute de OM nu opresc bucla — numai ale ei', async () => {
    for (let i = 0; i < 6; i++) {
      jobs.push({ id: 200 + i, orderText: 'x', status: 'failed', log: 'Eroare', orderedBy: 'adrianenc11@gmail.com' })
    }
    const r = await poateSaLucreze()
    expect(r.motiv).not.toContain('ZID')
  })

  // THE REQUESTED PROOF (Adrian, Jul 31: "75 capabilities on chat, it must
  // really receive them all, I expect proof"). Not a claim of mine — a COUNT,
  // which falls if someone takes something out of its hand.
  it('mâinile lui primesc TOT ce știe executorul să ruleze — numărat, nu spus', async () => {
    secreteExistente = ['REVOLUT_PAY_LINK']
    await poateSaLucreze()
    // The browser: all 9, not a subset.
    for (const b of ['browser_open', 'browser_click', 'browser_type', 'browser_read',
      'browser_back', 'browser_scroll', 'browser_key', 'browser_click_at', 'browser_close'])
      expect(uneltePrimite, `îi lipsește ${b}`).toContain(b)
    // Its code: so it can read and query itself when it gets stuck.
    for (const c of ['read_source', 'search_source', 'db_query', 'system_health'])
      expect(uneltePrimite, `îi lipsește ${c}`).toContain(c)
    // Its memory: without it it repeats the same mistakes forever.
    for (const m of ['list_memories', 'server_logs', 'get_real_cost'])
      expect(uneltePrimite, `îi lipsește ${m}`).toContain(m)
    // And the card, guarded by voice in the executor.
    expect(uneltePrimite).toContain('card_completeaza')
    // The threshold measured today: if it drops, someone took something out of its hand.
    expect(uneltePrimite.length).toBeGreaterThanOrEqual(31)
  })

  it('PLAFONUL ZILNIC DE ARDERE (aprobat de owner, B8/K15): oprește la atingere, iar butonul îl stinge', async () => {
    // CERINȚA S-A SCHIMBAT față de 30 iul: pe 30 iul pusesem un plafon pe care
    // nimeni nu-l ceruse (scos, corect). ACUM ownerul l-a cerut EXPLICIT, cu buton
    // de oprit. Testul verifică AMBELE — oprirea la atingere ȘI dezactivarea prin
    // comutator (nu doar că „există"; altfel n-ar dovedi nimic).
    secreteExistente = ['REVOLUT_PAY_LINK']
    // Plafon implicit $10; cheltuiala MĂSURATĂ de azi peste el → NU mai pornește,
    // cu motivul scris pe față.
    cheltuitAzi = 999
    const blocat = await poateSaLucreze()
    expect(blocat.pornit).toBe(false)
    expect(blocat.motiv).toContain('plafon')
    // Butonul „oprește limita" (comutatorul '0' în KV) → lucrează din nou, chiar
    // peste plafon: e decizia ownerului, nu o barieră ascunsă.
    kv.set('constructor:plafon_activ', '0')
    expect((await poateSaLucreze()).pornit).toBe(true)
    // Limită repornită, dar cheltuiala sub plafon → lucrează normal.
    kv.set('constructor:plafon_activ', '1')
    cheltuitAzi = 0
    expect((await poateSaLucreze()).pornit).toBe(true)
  })
})

// ── DOVADA 6 NU MAI FLĂMÂNZEȘTE ÎN SPATELE UNEI MISIUNI PARCATE ──────────────
// (owner, 15 aug: „fast-track, finalizeeaza si restul de 2 care nu sunt bifate")
//
// Măsurat pe viu: golurile triate „DE IMPLEMENTAT" intrau la rând DOAR după
// misiune, iar un pas de misiune PARCAT (blocat, cu semnătura lumii curente)
// ținea misiunea „ne-gata" fără ca el însuși să ruleze — deci golul nu primea
// NICIODATĂ ordin și dovada 6 („vede ce îi lipsește și construiește") rămânea
// gri pe vecie. Regula anti-înfometare a buclei se aplică acum și aici.
describe('golurile intră la rând când misiunea nu are niciun pas rulabil', () => {
  /** Semnătura lumii EXACT cum o calculează bucla (versiune|chei|reușite=0) —
   *  parcarea ține doar cât semnătura e cea curentă; cu altă semnătură pasul
   *  s-ar DE-PARCA singur în aceeași tură și testul n-ar proba flămânzirea.
   *  Dacă formula din autonomie.ts se schimbă, testul pică zgomotos — corect:
   *  cine o schimbă decide conștient și despre parcare. */
  function semnaturaAcum(): string {
    const versiune = (process.env.GIT_COMMIT_SHA ?? '').slice(0, 7)
    const chei = Object.keys(process.env).filter((k) => /_KEY$|_SECRET$|_TOKEN$|_URL$|^CARD_/.test(k)).length
    return `${versiune}|${chei}|0`
  }
  function pasParcat(cod: string): void {
    kv.set(`autonomie:pas:${cod}`, JSON.stringify({ job: 0, incercari: 3, blocat: true, semnatura: semnaturaAcum() }))
  }
  const golDeImplementat = { id: 42, request: 'să pot exporta conversațiile', hits: 3, reason: null, triage: 'DE IMPLEMENTAT — cerut des' }

  it('misiune întreagă PARCATĂ → golul „DE IMPLEMENTAT" primește ordin', async () => {
    for (const c of ['M0', 'M1', 'M2', 'M3', 'M4', 'M5']) pasParcat(c)
    goluri = [golDeImplementat]
    const r = await poateSaLucreze()
    expect(jobs.some((j) => j.orderText.includes('CAPABILITATE CARE ÎȚI LIPSEȘTE'))).toBe(true)
    expect(r.pornit).toBe(true)
  })

  it('cu un pas de misiune încă RULABIL, golurile așteaptă — designul din 30 iul rămâne', async () => {
    // M0 rămâne nescris → rulabil; restul parcate. Golul NU are voie să intre.
    for (const c of ['M1', 'M2', 'M3', 'M4', 'M5']) pasParcat(c)
    goluri = [golDeImplementat]
    await poateSaLucreze()
    expect(jobs.some((j) => j.orderText.includes('CAPABILITATE CARE ÎȚI LIPSEȘTE'))).toBe(false)
  })
})
