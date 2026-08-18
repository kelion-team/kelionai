import { describe, expect, it } from 'vitest'
import {
  classifyConstructorFailure,
  constructorIncidentLesson,
  formatConstructorIncidentContext,
  type ConstructorCauseCode,
  type ConstructorIncident,
} from './services/constructorIncident.js'

const incident = (overrides: Partial<ConstructorIncident> = {}): ConstructorIncident => ({
  id: 7,
  jobId: 42,
  fingerprint: 'abc123',
  state: 'diagnosing',
  stage: 'tests',
  causeCode: 'test_failure',
  causeSummary: 'Testul focalizat a picat.',
  evidence: 'AssertionError: expected 200, received 500',
  responsible: 'kelion',
  nextAction: 'Repară ruta și rulează testul focalizat plus suita completă.',
  verification: null,
  lesson: null,
  recurrenceCount: 2,
  openedAt: '2026-08-18T00:00:00.000Z',
  updatedAt: '2026-08-18T01:00:00.000Z',
  closedAt: null,
  ...overrides,
})

describe('constructor incident — clasificare deterministă', () => {
  const cases: Array<[ConstructorCauseCode, string, string]> = [
    ['semantic_non_code', 'ordin_respins: cerere non-code', 'diagnosing'],
    ['provider_auth', '401 invalid x-api-key authentication_error', 'blocked'],
    ['provider_credit', 'Your credit balance is too low', 'blocked'],
    ['ci_failure', 'GitHub Actions CI failed on clean runner', 'diagnosing'],
    ['test_failure', 'vitest failed: AssertionError', 'diagnosing'],
    ['build_failure', 'tsc error: build failed with exit code 2', 'diagnosing'],
    ['no_changes', 'working tree clean; no changes', 'diagnosing'],
    ['timeout', 'abandoned: 3 attempts exhausted', 'diagnosing'],
    ['brain_unavailable', 'brain response unavailable', 'diagnosing'],
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
})

describe('constructor incident — contextul obligatoriu al creierului', () => {
  it('declară registrul necitibil fără să pretindă că sunt zero incidente', () => {
    const context = formatConstructorIncidentContext(null)
    expect(context).toContain('UNREADABLE')
    expect(context).toContain('does NOT mean zero incidents')
    expect(context).toContain('do not claim the constructor is healthy')
  })

  it('nu adaugă zgomot când citirea a reușit și nu există incidente', () => {
    expect(formatConstructorIncidentContext([])).toBe('')
  })

  it('include cazul, dovada, responsabilul, acțiunea și recurența', () => {
    const context = formatConstructorIncidentContext([incident()])
    expect(context).toContain('incident #7 / order #42 [diagnosing]')
    expect(context).toContain('cause=test_failure')
    expect(context).toContain('responsible=kelion')
    expect(context).toContain('next=Repară ruta')
    expect(context).toContain('recurrence=2')
    expect(context).toContain('AssertionError')
    expect(context).toContain('close only after the associated order is done with CI green')
  })

  it('lecția persistentă păstrează cauză, prevenție și verificare', () => {
    const lesson = constructorIncidentLesson(incident(), 'order #42 done; CI verde; PR #99')
    expect(lesson).toContain('Cauză: Testul focalizat a picat.')
    expect(lesson).toContain('Prevenție: Repară ruta')
    expect(lesson).toContain('Verificare: order #42 done; CI verde; PR #99')
  })
})
