import { describe, expect, it } from 'vitest'
import {
  parseDeployStatusPayload,
  transitionDeployProgress,
  type DeployProgressSnapshot,
} from './lib/deployProgress'

const state = {
  status: 'running',
  jobId: '42',
  step: 'gates_passed',
  stepIndex: 5,
  totalSteps: 8,
  percent: 57,
  message: 'Porțile au trecut',
  startedAt: '2026-08-24T10:00:00.000Z',
  updatedAt: '2026-08-24T10:01:00.000Z',
  error: null,
  commit: 'abc123',
  liveVersion: null,
} as const

describe('deploy progress transport contract', () => {
  it('unwraps the identical `{ok,state}` payload used by polling and SSE', () => {
    expect(parseDeployStatusPayload({ ok: true, state })).toEqual({ kind: 'state', state })
  })

  it('distinge explicit indisponibilitatea de payloadurile invalide', () => {
    expect(parseDeployStatusPayload({ ok: false, error: 'deploy_state_unavailable' })).toEqual({ kind: 'unavailable' })
    expect(parseDeployStatusPayload(state)).toEqual({ kind: 'invalid' })
    expect(parseDeployStatusPayload({ ok: false, error: 'unauthorized' })).toEqual({ kind: 'invalid' })
    expect(parseDeployStatusPayload('<html>bad gateway</html>')).toEqual({ kind: 'invalid' })
  })

  it('fails closed on an incomplete state', () => {
    expect(parseDeployStatusPayload({ ok: true, state: { status: 'running', percent: 10 } })).toEqual({ kind: 'invalid' })
  })

  it('înlocuiește starea veche cu unavailable și revine automat pe următoarea stare validă', () => {
    const initial: DeployProgressSnapshot = { state: { ...state }, unavailable: false }
    const unavailable = transitionDeployProgress(initial, { kind: 'unavailable' })
    expect(unavailable).toEqual({ state, unavailable: true })

    const recoveredState = { ...state, status: 'success' as const, percent: 100 }
    const recovered = transitionDeployProgress(unavailable, { kind: 'state', state: recoveredState })
    expect(recovered).toEqual({ state: recoveredState, unavailable: false })

    expect(transitionDeployProgress(recovered, { kind: 'invalid' })).toBe(recovered)
  })
})
