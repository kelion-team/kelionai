import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DoctorSnapshot } from '../../backend/src/shared/doctor'
const { request } = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('./lib/transport', () => ({ apiFetch: request }))
import { checkDoctorNow, fetchDoctor, parseDoctorSnapshot, setDoctorGrant } from './lib/doctor'

const checkedAt = '2026-09-05T07:00:00.000Z'
const liveSha = 'a'.repeat(40)
const snapshot: DoctorSnapshot = {
  checkedAt, error: null, state: 'disabled', grant: null, incidents: [], limits: { maxDurationHours: 24, maxJobs: 5, maxWindowHours: 24 },
}

describe('Doctor evidence is parsed fail-closed', () => {
  it('accepts explicit disabled state but never invents a running Doctor from missing data', () => {
    expect(parseDoctorSnapshot(snapshot)).toEqual(snapshot)
    for (const invalid of [null, {}, { ...snapshot, state: 'running' }, { ...snapshot, incidents: null }, { ...snapshot, limits: { maxDurationHours: 0, maxJobs: 5 } }]) {
      expect(parseDoctorSnapshot(invalid)).toBeNull()
    }
  })
  it('requires an explicit active revocable grant for ready/running', () => {
    const grant = { active: true, scope: 'measured-code-repair' as const, expiresAt: checkedAt, windowHours: 24, windowResetsAt: checkedAt, maxJobs: 3, jobsCreated: 1, revocable: true as const }
    expect(parseDoctorSnapshot({ ...snapshot, state: 'running', grant })).not.toBeNull()
    expect(parseDoctorSnapshot({ ...snapshot, state: 'ready', grant: { ...grant, active: false } })).toBeNull()
    expect(parseDoctorSnapshot({ ...snapshot, grant: { ...grant, revocable: false } })).toBeNull()
  })
  it('accepts permanent revocable consent and an exhausted window without inventing revocation', () => {
    const grant = { active: true, scope: 'measured-code-repair' as const, expiresAt: null, windowHours: 12, windowResetsAt: checkedAt, maxJobs: 3, jobsCreated: 3, revocable: true as const }
    const paused = { ...snapshot, state: 'blocked', error: 'doctor_window_budget_exhausted', grant }
    expect(parseDoctorSnapshot(paused)).toEqual(paused)
    expect(parseDoctorSnapshot({ ...paused, grant: { ...grant, windowHours: 0 } })).toBeNull()
    expect(parseDoctorSnapshot({ ...paused, grant: { ...grant, windowResetsAt: null } })).toBeNull()
    expect(parseDoctorSnapshot({ ...paused, error: undefined })).toBeNull()
  })
  it('accepts incident closure only with an exact live SHA and a healthy recheck of the same symptom', () => {
    const evidence = { code: 'public_health' as const, checkedAt, result: 'healthy' as const, reason: 'HTTP verified', httpStatus: 200, releaseSha: liveSha }
    const incident = { id: 'case-1', code: 'public_health', status: 'resolved', summary: 'Public health', detectedAt: checkedAt, checkedAt, jobId: 7, evidence,
      closure: { verifiedAt: checkedAt, liveSha, symptom: evidence } }
    expect(parseDoctorSnapshot({ ...snapshot, incidents: [incident] })).not.toBeNull()
    expect(parseDoctorSnapshot({ ...snapshot, incidents: [{ ...incident, closure: null }] })).toBeNull()
    expect(parseDoctorSnapshot({ ...snapshot, incidents: [{ ...incident, closure: { ...incident.closure, liveSha: 'b'.repeat(40) } }] })).toBeNull()
    expect(parseDoctorSnapshot({ ...snapshot, incidents: [{ ...incident, closure: { ...incident.closure, symptom: { ...evidence, result: 'unverified' } } }] })).toBeNull()
    expect(parseDoctorSnapshot({ ...snapshot, incidents: [incident, incident] })).toBeNull()
  })
})

describe('Doctor client keeps reads, consent and revocation distinct', () => {
  beforeEach(() => request.mockReset())
  it('reads without arming or sending an incident', async () => {
    request.mockResolvedValue(new Response(JSON.stringify(snapshot)))
    await expect(fetchDoctor()).resolves.toEqual(snapshot)
    expect(request).toHaveBeenCalledExactlyOnceWith('/api/admin/doctor', { credentials: 'include', signal: undefined })
  })
  it('sends only the explicit bounded grant, while revoke is a separate DELETE without a body', async () => {
    request.mockImplementation(async () => new Response(JSON.stringify(snapshot)))
    const grant = { scope: 'measured-code-repair' as const, durationHours: null, maxJobs: 2, windowHours: 12 }
    await setDoctorGrant(grant)
    expect(request).toHaveBeenLastCalledWith('/api/admin/doctor/grant', {
      credentials: 'include', method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(grant),
    })
    await setDoctorGrant(null)
    expect(request).toHaveBeenLastCalledWith('/api/admin/doctor/grant', { credentials: 'include', method: 'DELETE' })
    await checkDoctorNow()
    expect(request).toHaveBeenLastCalledWith('/api/admin/doctor/tick', {
      credentials: 'include', method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    })
  })
  it('does not turn a failed request or malformed success into an active snapshot', async () => {
    for (const response of [new Response('{}'), new Response(JSON.stringify(snapshot), { status: 503 }), new Response('invalid')]) {
      request.mockResolvedValueOnce(response)
      await expect(fetchDoctor()).resolves.toBeNull()
    }
    request.mockRejectedValueOnce(new Error('network unavailable'))
    await expect(setDoctorGrant(null)).resolves.toBeNull()
  })
})
