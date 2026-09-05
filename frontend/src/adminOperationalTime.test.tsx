import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DoctorSnapshot } from '../../backend/src/shared/doctor'
import { DoctorReport } from './components/admin/AdminDoctor'
import { AgentRegistryList } from './components/admin/AdminAgentRegistry'

afterEach(() => vi.unstubAllEnvs())

describe('admin operational timestamps preserve server instants in Europe/London', () => {
  it.each([
    ['2026-09-05T07:20:00.000Z', '2026-09-05 08:20 BST (London)'],
    ['2026-01-05T07:20:00.000Z', '2026-01-05 07:20 GMT (London)'],
  ])('renders Doctor evidence and registry read time independently of the browser zone: %s', (at, label) => {
    vi.stubEnv('TZ', 'Pacific/Honolulu')
    const sha = 'a'.repeat(40)
    const symptom = { code: 'public_health' as const, checkedAt: at, result: 'healthy' as const, reason: 'contract_verified', httpStatus: 200, releaseSha: sha }
    const snapshot: DoctorSnapshot = {
      state: 'ready', checkedAt: at, error: null,
      grant: { active: true, scope: 'measured-code-repair', expiresAt: at, windowHours: 24, windowResetsAt: at, maxJobs: 5, jobsCreated: 1, revocable: true },
      limits: { maxDurationHours: 24, maxJobs: 5, maxWindowHours: 24 },
      incidents: [{
        id: 'resolved-case', code: 'public_health', status: 'resolved', summary: 'Measured repair',
        detectedAt: at, checkedAt: at, jobId: 7, evidence: symptom,
        closure: { verifiedAt: at, liveSha: sha, symptom },
      }],
    }
    const doctor = renderToStaticMarkup(<DoctorReport snapshot={snapshot} jobs={null} />)
    expect(doctor.split(label)).toHaveLength(6)
    expect(doctor).not.toContain('HST')
    const registry = renderToStaticMarkup(<AgentRegistryList snapshot={{ checkedAt: at, agents: [] }} />)
    expect(registry).toContain(`Registru citit la ${label}`)
    expect(registry).not.toContain('HST')
  })
})
