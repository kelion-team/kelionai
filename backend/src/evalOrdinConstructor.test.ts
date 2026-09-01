import { describe, expect, it } from 'vitest'
import { AI_CONSTRUCTORI, evalueazaOrdin } from './services/evalOrdinConstructor.js'

describe('Constructor OpenCode + Qwen local preflight', () => {
  it('rejects short, vague and direct-interface orders', () => {
    expect(evalueazaOrdin('fă').trece).toBe(false)
    expect(evalueazaOrdin('ceva frumos acolo').trece).toBe(false)
    expect(evalueazaOrdin('deschide browserul și dă click').trece).toBe(false)
  })

  it('accepts concrete repository work and selects only the separate worker', () => {
    const result = evalueazaOrdin('repară endpointul de login din backend și adaugă teste')
    expect(result.trece).toBe(true)
    expect(result.aiRecomandat).toBe('opencode_qwen_local')
    expect(result.capacitatiNecesare).toEqual(expect.arrayContaining(['cod', 'repo', 'backend', 'teste']))
    expect(result.clasament.map((entry) => entry.cheie)).toEqual(['opencode_qwen_local'])
    expect(AI_CONSTRUCTORI.map((entry) => entry.cheie)).toEqual(['opencode_qwen_local'])
    expect(result.clasament[0]).toMatchObject({ nume: 'OpenCode + Qwen local (llama.cpp)' })
    expect(result.clasament[0]?.descriere).toMatch(/OpenCode 1\.18\.25.*Qwen.*llama\.cpp.*build_jobs/i)
  })

  it('classifies the explicit user request, not technical boilerplate around it', () => {
    const wrapped = evalueazaOrdin(
      'PLAN INTERN: modifică fișiere și rulează teste.\n' +
      'CE A CERUT: fă un screenshot proaspăt la monitor\n' +
      'Execută toate porțile.',
    )
    expect(wrapped.trece).toBe(false)
  })
})
