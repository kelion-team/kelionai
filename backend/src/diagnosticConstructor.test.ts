import { describe, it, expect } from 'vitest'
import {
  diagnosticConstructor,
  ordinFreeNoEdit,
  culegeDiagnosticConstructor,
  type MasuratoriConstructor,
  type OrdinRecentMasurat,
} from './services/diagnosticConstructor.js'

// owner, 19 aug: „nu poate ca nu are autonomie si nu l-ai construit corect sa faca
// asta" — diagnosticul trebuie să spună MĂSURAT de ce (nu) repară constructorul.

const ordin = (o: Partial<OrdinRecentMasurat>): OrdinRecentMasurat => ({
  status: 'done', brain: 'free_local', logTail: 'PR deschis', ageSec: 60, ...o,
})
const sanatoase = (): MasuratoriConstructor => ({
  lucratorViu: true,
  lucratorAgeSec: 30,
  aiderOk: true,
  ollamaOk: true,
  ordine: [ordin({}), ordin({}), ordin({})],
})

describe('diagnosticConstructor — de ce (nu) repară', () => {
  it('tot sus, free editează → SĂNĂTOS', () => {
    const d = diagnosticConstructor(sanatoase())
    expect(d.sanatos).toBe(true)
    expect(d.probleme).toHaveLength(0)
    expect(d.verdict).toMatch(/sănătos/i)
  })

  it('lucrătorul mort → CRITIC (ordinele stau în coadă)', () => {
    const d = diagnosticConstructor({ ...sanatoase(), lucratorViu: false, lucratorAgeSec: 20 * 60 })
    expect(d.sanatos).toBe(false)
    expect(d.probleme.find((p) => p.cod === 'lucrator_mort')?.severitate).toBe('critic')
    expect(d.verdict).toMatch(/NU repar/i)
  })

  it('creierul LOCAL jos → CRITIC „free nu repară"', () => {
    const d = diagnosticConstructor({ ...sanatoase(), ollamaOk: false })
    const p = d.probleme.find((x) => x.cod === 'ollama_jos')
    expect(p?.severitate).toBe('critic')
    expect(p?.ce).toMatch(/FREE nu repar/i)
    expect(d.sanatos).toBe(false)
  })

  it('motorul Aider jos → CRITIC (nici free nici plătit)', () => {
    const d = diagnosticConstructor({ ...sanatoase(), aiderOk: false })
    expect(d.probleme.find((p) => p.cod === 'aider_jos')?.severitate).toBe('critic')
  })

  it('free NU editează (tot escaladat pe plătit) deși motor+creier sus → ATENȚIE măsurată', () => {
    const d = diagnosticConstructor({
      ...sanatoase(),
      ordine: [
        ordin({ status: 'done', brain: 'paid_cloud', logTail: 'escaladat (no_change). brain=paid_cloud' }),
        ordin({ status: 'done', brain: 'paid_cloud', logTail: 'aider n-a modificat nimic [no_edit]' }),
        ordin({ status: 'done', brain: 'paid_cloud', logTail: 'escaladat (no_change)' }),
      ],
    })
    const p = d.probleme.find((x) => x.cod === 'free_nu_editeaza')
    expect(p).toBeTruthy()
    expect(p?.severitate).toBe('atentie')
    expect(d.masuratori.freeNoEdit).toBe(3)
    expect(d.masuratori.escaladatePaid).toBe(3)
    // atenționare, nu critic → „funcționează, dar…"
    expect(d.sanatos).toBe(true)
  })

  it('coadă blocată de un ordin agățat (>30 min running) → ATENȚIE', () => {
    const d = diagnosticConstructor({
      ...sanatoase(),
      ordine: [ordin({ status: 'running', ageSec: 40 * 60 }), ordin({ status: 'queued', ageSec: 35 * 60 })],
    })
    expect(d.probleme.find((p) => p.cod === 'coada_blocata')).toBeTruthy()
    expect(d.masuratori.inLucru).toBe(1)
    expect(d.masuratori.inCoada).toBe(1)
  })

  it('mai multe probleme critice → verdictul o dă pe prima (motor)', () => {
    const d = diagnosticConstructor({ ...sanatoase(), aiderOk: false, ollamaOk: false, lucratorViu: false })
    expect(d.probleme.filter((p) => p.severitate === 'critic').length).toBe(3)
    expect(d.verdict).toMatch(/Aider/i)
  })
})

// ── DEVIN E CONSTRUCTORUL (cheia pusă): verdictul se dă pe DEVIN, nu pe lanțul
// vechi — altfel „aider_jos"/„lucrator_mort" ar fi alarme FALSE când ordinele
// pleacă de fapt la Devin. ────────────────────────────────────────
describe('diagnosticConstructor — cu Devin constructor (cheia pusă)', () => {
  it('Devin activ + proba API trece → SĂNĂTOS, chiar cu lanțul vechi „jos" (nu mai e calea ordinelor)', () => {
    const d = diagnosticConstructor({
      ...sanatoase(),
      lucratorViu: false, // lucrătorul vechi nu mai cere ordine — NORMAL cu Devin
      aiderOk: false,
      ollamaOk: false,
      devinActiv: true,
      devinOk: true,
    })
    expect(d.sanatos).toBe(true)
    expect(d.probleme).toHaveLength(0) // fără alarme false pe aider/ollama/lucrător
    expect(d.verdict).toMatch(/DEVIN/i)
  })

  it('Devin activ dar API-ul NU răspunde → CRITIC devin_jos, cu motivul măsurat', () => {
    const d = diagnosticConstructor({ ...sanatoase(), devinActiv: true, devinOk: false, devinMotiv: 'devin_proba_esuata: HTTP 401' })
    const p = d.probleme.find((x) => x.cod === 'devin_jos')
    expect(p?.severitate).toBe('critic')
    expect(p?.ce).toContain('HTTP 401')
    expect(d.sanatos).toBe(false)
    expect(d.verdict).toMatch(/NU repar/i)
  })

  it('Devin activ fără probă (devinOk lipsește) → NU inventează verde: tot devin_jos', () => {
    const d = diagnosticConstructor({ ...sanatoase(), devinActiv: true })
    expect(d.probleme.some((p) => p.cod === 'devin_jos')).toBe(true)
  })

  it('coadă blocată și la Devin: un job „în lucru" >30 min cu coadă în spate → ATENȚIE', () => {
    const d = diagnosticConstructor({
      ...sanatoase(),
      devinActiv: true,
      devinOk: true,
      ordine: [ordin({ status: 'running', ageSec: 40 * 60 }), ordin({ status: 'queued', ageSec: 35 * 60 })],
    })
    expect(d.probleme.find((p) => p.cod === 'coada_blocata')).toBeTruthy()
    expect(d.sanatos).toBe(true) // atenționare, nu critic
  })
})

describe('ordinFreeNoEdit — semnătura „free n-a modificat"', () => {
  it('prinde no_edit / no_change / escaladat / paid_cloud', () => {
    expect(ordinFreeNoEdit({ status: 'done', brain: 'free_local', logTail: 'aider [no_edit]', ageSec: 1 })).toBe(true)
    expect(ordinFreeNoEdit({ status: 'done', brain: 'paid_cloud', logTail: 'ok', ageSec: 1 })).toBe(true)
    expect(ordinFreeNoEdit({ status: 'done', brain: 'free_local', logTail: 'PR deschis, 3 fișiere', ageSec: 1 })).toBe(false)
  })
})

describe('culegeDiagnosticConstructor — gatherer server-side (injectat)', () => {
  const baseDeps = (over: Partial<Parameters<typeof culegeDiagnosticConstructor>[0]> = {}) => ({
    loadKv: async () => String(1_000_000 - 30_000), // puls la 30s (dacă now=1_000_000)
    listBuildJobs: async () => [
      { status: 'queued', brain: null, log: null, updatedAt: new Date(1_000_000 - 120_000).toISOString() },
    ],
    probaAider: async () => ({ ok: true }),
    probaOllama: async () => ({ ok: true, modele: ['qwen2.5-coder:32b'] }),
    now: 1_000_000,
    ...over,
  })

  it('coada necitibilă (listBuildJobs → null) → {error}, nu „sănătos" fals', async () => {
    const d = await culegeDiagnosticConstructor(baseDeps({ listBuildJobs: async () => null }))
    expect(d).toEqual({ error: 'coada_necitibila' })
  })

  it('Ollama jos → verdict critic (free nu repară)', async () => {
    const d = await culegeDiagnosticConstructor(baseDeps({ probaOllama: async () => ({ ok: false, modele: [] }) }))
    expect('error' in d).toBe(false)
    if ('error' in d) throw new Error('unexpected error')
    expect(d.sanatos).toBe(false)
    expect(d.probleme.some((p) => p.cod === 'ollama_jos')).toBe(true)
  })

  it('puls vechi în kv → lucrător mort', async () => {
    const d = await culegeDiagnosticConstructor(baseDeps({ loadKv: async () => String(1_000_000 - 20 * 60_000) }))
    if ('error' in d) throw new Error('unexpected error')
    expect(d.probleme.some((p) => p.cod === 'lucrator_mort')).toBe(true)
  })

  it('cu Devin activ: probează Devin, NU mai probează lanțul vechi (Aider/Ollama)', async () => {
    let aiderProbat = false
    let ollamaProbat = false
    const d = await culegeDiagnosticConstructor(
      baseDeps({
        probaAider: async () => { aiderProbat = true; return { ok: true } },
        probaOllama: async () => { ollamaProbat = true; return { ok: true, modele: ['x'] } },
        devinActiv: true,
        probaDevin: async () => ({ ok: true }),
      }),
    )
    if ('error' in d) throw new Error('unexpected error')
    expect(aiderProbat).toBe(false)
    expect(ollamaProbat).toBe(false)
    expect(d.sanatos).toBe(true)
    expect(d.verdict).toMatch(/DEVIN/i)
  })

  it('cu Devin activ dar proba API pică → devin_jos, nu „sănătos" inventat', async () => {
    const d = await culegeDiagnosticConstructor(
      baseDeps({ devinActiv: true, probaDevin: async () => ({ ok: false, motiv: 'devin_proba_retea: ECONNREFUSED' }) }),
    )
    if ('error' in d) throw new Error('unexpected error')
    expect(d.sanatos).toBe(false)
    const p = d.probleme.find((x) => x.cod === 'devin_jos')
    expect(p?.ce).toContain('ECONNREFUSED')
  })
})
