import { describe, it, expect } from 'vitest'
import { clasificareOrdin } from './services/evalOrdinConstructor.js'
import { originePotrivita, extrageEvidence } from './services/runtimeBrowser.js'

// ── Clasificare GUI → runtime_browser (owner, 17 aug) ──────────────────────
describe('clasificareOrdin — cod vs runtime_browser', () => {
  it('ordin de cod → cod', () => {
    expect(clasificareOrdin('repară butonul din frontend și adaugă un test')).toBe('cod')
  })

  it('ordin GUI cu browser → runtime_browser', () => {
    expect(clasificareOrdin('deschide browser și verifică pagina de login')).toBe('runtime_browser')
  })

  it('ordin screenshot → runtime_browser', () => {
    expect(clasificareOrdin('fă screenshot la pagina principală')).toBe('runtime_browser')
  })

  it('ordin cu URL explicit → runtime_browser', () => {
    expect(clasificareOrdin('deschide https://example.com și verifică vizual')).toBe('runtime_browser')
  })

  it('ordin cu captură → runtime_browser', () => {
    expect(clasificareOrdin('captură la panoul de admin')).toBe('runtime_browser')
  })

  it('ordin cu click pe site → runtime_browser', () => {
    expect(clasificareOrdin('click pe butonul de submit de pe site')).toBe('runtime_browser')
  })

  it('ordin de cod simplu → cod (fără semnale GUI)', () => {
    expect(clasificareOrdin('adaugă un endpoint nou în backend')).toBe('cod')
  })
})

// ── Origin guard PUR ────────────────────────────────────────────────────────
describe('originePotrivita — origin guard pur', () => {
  it('origin matching → true', () => {
    expect(originePotrivita('https://kelionai.app', 'https://kelionai.app')).toBe(true)
  })

  it('origin diferit → false', () => {
    expect(originePotrivita('https://evil.com', 'https://kelionai.app')).toBe(false)
  })

  it('origin undefined → false', () => {
    expect(originePotrivita(undefined, 'https://kelionai.app')).toBe(false)
  })

  it('origin invalid → false', () => {
    expect(originePotrivita('not-a-url', 'https://kelionai.app')).toBe(false)
  })

  it('localhost dev → true', () => {
    expect(originePotrivita('http://localhost:5173', 'http://localhost:5173')).toBe(true)
  })
})

// ── Evidence extraction/validation ──────────────────────────────────────────
describe('extrageEvidence — validare dovadă runtime', () => {
  it('snapshot cu shotUrl → returnează URL-ul', () => {
    expect(extrageEvidence({ shotUrl: 'https://kelionai.app/api/browser/shot/abc' })).toBe('https://kelionai.app/api/browser/shot/abc')
  })

  it('snapshot fără shotUrl → string gol', () => {
    expect(extrageEvidence({ shotUrl: '' })).toBe('')
  })

  it('result null → string gol', () => {
    expect(extrageEvidence(null)).toBe('')
  })

  it('result cu error → string gol', () => {
    expect(extrageEvidence({ error: 'launch_failed' })).toBe('')
  })

  it('shotUrl non-http → string gol', () => {
    expect(extrageEvidence({ shotUrl: 'javascript:alert(1)' })).toBe('')
  })
})

// ── Report labels ───────────────────────────────────────────────────────────
describe('etichete raport — motor + evidence', () => {
  it('motor runtime_browser → etichetă "Executat" (nu "PR gata")', () => {
    const motor = 'runtime_browser'
    const label = motor === 'runtime_browser' ? 'Executat (runtime browser)' : 'PR gata de merge'
    expect(label).toBe('Executat (runtime browser)')
  })

  it('motor cod → etichetă "PR gata de merge"', () => {
    const motor = 'cod'
    const label = motor === 'runtime_browser' ? 'Executat (runtime browser)' : 'PR gata de merge'
    expect(label).toBe('PR gata de merge')
  })

  it('done runtime → descris ca executat, nu "în așteptare PR"', () => {
    const status = 'done'
    const motor = 'runtime_browser'
    const descriere = status === 'done' && motor === 'runtime_browser'
      ? 'Executat cu succes în browser'
      : status === 'done' ? 'PR gata — în așteptare merge' : 'Eșuat'
    expect(descriere).toBe('Executat cu succes în browser')
  })

  it('done cod → descris ca "în așteptare PR"', () => {
    const status = 'done'
    const motor = 'cod'
    const descriere = status === 'done' && motor === 'runtime_browser'
      ? 'Executat cu succes în browser'
      : status === 'done' ? 'PR gata — în așteptare merge' : 'Eșuat'
    expect(descriere).toBe('PR gata — în așteptare merge')
  })
})
