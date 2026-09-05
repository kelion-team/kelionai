import { describe, expect, it } from 'vitest'
import {
  classifyConstructorFailure,
  type ConstructorCauseCode,
} from './services/constructorIncident.js'

describe('constructor incident — clasificare deterministă', () => {
  const cases: Array<[ConstructorCauseCode, string, string]> = [
    ['semantic_non_code', 'ordin_respins: cerere non-code', 'diagnosing'],
    ['provider_auth', 'worker_failure:provider_auth', 'blocked'],
    ['provider_credit', 'worker_failure:provider_credit', 'blocked'],
    ['ci_failure', 'GitHub Actions CI failed on clean runner', 'diagnosing'],
    ['test_failure', 'vitest failed: AssertionError', 'diagnosing'],
    ['build_failure', 'tsc error: build failed with exit code 2', 'diagnosing'],
    ['no_changes', 'working tree clean; no changes', 'diagnosing'],
    ['timeout', 'abandoned: 3 attempts exhausted', 'diagnosing'],
    ['brain_unavailable', 'connect ECONNREFUSED 127.0.0.1:24080', 'diagnosing'],
  ]

  it.each(cases)('%s este recunoscut din dovadă și primește o acțiune', (cause, log, state) => {
    const result = classifyConstructorFailure(log)
    expect(result.causeCode).toBe(cause)
    expect(result.state).toBe(state)
    expect(result.responsible).toBe('kelion')
    expect(result.nextAction.length).toBeGreaterThan(20)
  })

  it('păstrează cauza unknown când dovada nu permite o concluzie', () => {
    const result = classifyConstructorFailure('executorul s-a oprit fără alte date')
    expect(result.causeCode).toBe('unknown')
    expect(result.causeSummary).toContain('nu poate fi stabilită sigur')
    expect(result.nextAction).toContain('testează ipoteze')
  })

  it('citește codurile cloud numai ca dovezi legacy, nu din texte arbitrare', () => {
    for (const obsoleteMessage of [
      '401 invalid x-api-key authentication_error',
      'Your credit balance is too low',
    ]) {
      const result = classifyConstructorFailure(obsoleteMessage)
      expect(result.causeCode).toBe('unknown')
      expect(result.state).toBe('diagnosing')
    }

    expect(classifyConstructorFailure('worker_failure:provider_auth').causeSummary).toContain('legacy')
    expect(classifyConstructorFailure('worker_failure:provider_credit').nextAction).toContain('fără fallback plătit')
  })

  it('cere dovezile motorului rulării fără să inventeze modelul indisponibil', () => {
    const result = classifyConstructorFailure('worker_failure:brain_unavailable')
    expect(result.stage).toBe('local_inference')
    expect(result.causeSummary).toContain('trebuie verificate')
    expect(result.nextAction).toContain('configurația validată')
    expect(result.nextAction).toContain('fără fallback plătit')
    expect(result.nextAction).not.toMatch(/llama|Qwen|private-ai-llm/)
  })

  it('păstrează eșecul generic OpenCode necunoscut până există dovadă privată', () => {
    for (const code of ['worker_internal_failure', 'codex_exec_failed']) {
      const result = classifyConstructorFailure(`worker_failure:${code}`)
      expect(result.causeCode).toBe('unknown')
      expect(result.stage).toBe('local_executor')
      expect(result.nextAction).toContain('OpenCode')
      expect(result.nextAction).toContain('motorului folosit de acea rulare')
    }
  })

  it('clasifică prefixul bounded unresolved fără să citească text liber din worker', () => {
    const fast = classifyConstructorFailure('worker_unresolved:no_changes;profile=fast')
    expect(fast).toMatchObject({
      causeCode: 'no_changes', stage: 'implementation',
    })
    expect(fast.nextAction).toMatch(/comanda explicită Reia/i)
    expect(classifyConstructorFailure('worker_unresolved:test_failure;profile=fast')).toMatchObject({
      causeCode: 'test_failure',
    })
    const powerful = classifyConstructorFailure('worker_unresolved:quality_gate_failure;profile=powerful')
    expect(powerful).toMatchObject({
      causeCode: 'build_failure',
    })
    expect(powerful.nextAction).toMatch(/comanda explicită Reia/i)
  })

  it('outcome-ul tehnic canonic nu recomandă alt model sau Reia', () => {
    for (const code of ['execution_timeout', 'brain_unavailable', 'worker_internal_failure']) {
      const result = classifyConstructorFailure(`worker_failure:${code};profile=fast`)
      expect(result.nextAction).toMatch(/nu recomandă.*model.*Reia/i)
      expect(result.nextAction).not.toMatch(/POWERFUL|folosește.*Reia/i)
    }
  })

  it('nu tratează un prefix model incomplet drept outcome bounded', () => {
    const result = classifyConstructorFailure('worker_unresolved:no_changes')
    expect(result.causeCode).toBe('unknown')
    expect(result.nextAction).not.toMatch(/POWERFUL|Reia/i)
  })
})
