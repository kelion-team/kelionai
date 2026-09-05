import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { DoctorSnapshot } from '../../../../backend/src/shared/doctor'
import type { BuildJobRow } from '../../lib/adminConstructorContract'
import { DoctorReport } from './AdminDoctor'

const checkedAt = '2026-09-05T07:00:00.000Z'
const snapshot: DoctorSnapshot = {
  checkedAt: null, error: null, state: 'disabled', grant: null, incidents: [], limits: { maxDurationHours: 24, maxJobs: 5, maxWindowHours: 24 },
}
const incident: DoctorSnapshot['incidents'][number] = {
  id: 'case-1', code: 'public_health', status: 'repairing', summary: 'Health route failed', detectedAt: checkedAt, checkedAt, jobId: 7,
  evidence: { code: 'public_health', checkedAt, result: 'defect', reason: 'HTTP failure', httpStatus: 503, releaseSha: 'a'.repeat(40) }, closure: null,
}
const job: BuildJobRow = {
  id: 7, status: 'running', constructorStage: 'working', deletable: false, retryable: false,
  orderText: 'Repair verified health route', branch: null, prUrl: 'https://github.com/kelion-team/kelionai/pull/123', tokens: 0,
  brain: null, updatedAt: checkedAt, progress: 'Comandă executată; 2 unelte terminate și confirmate', pct: 37,
}

describe('one Doctor report projects only server and Constructor evidence', () => {
  it('requires consent once without adding per-PR manual approvals or claiming an executor from consent', () => {
    const source = readFileSync(new URL('./AdminDoctor.tsx', import.meta.url), 'utf8')
    expect(source).toContain('fără aprobare manuală pentru fiecare PR')
    expect(source).toContain('autorizarea singură nu dovedește că executorul este pregătit')
    expect(source).not.toContain('/release/action')
    expect(source).not.toContain('aprobările existente')
    expect(source).toContain('Revocă autorizarea')
  })
  it('does not offer replacing an active grant, and explains the explicit revocation boundary', () => {
    const source = readFileSync(new URL('./AdminDoctor.tsx', import.meta.url), 'utf8')
    expect(source).toContain('const grantLocked = busy || current?.grant?.active === true')
    expect(source).toContain('current !== null && !current.grant?.active')
    expect(source).toContain('revoc-o explicit înainte de o autorizare nouă')
  })
  it('keeps unmeasured or empty state distinct from all functions being healthy', () => {
    const html = renderToStaticMarkup(<DoctorReport snapshot={snapshot} jobs={null} />)
    expect(html).toContain('Reparații automate neautorizate')
    expect(html).toContain('neefectuată; funcționarea nu este încă probată')
    expect(html).toContain('nu dovedește că toate funcțiile')
    expect(html).not.toContain('PORNITĂ PERMANENT')
    expect(html).not.toContain('<progress')
  })
  it('shows permanent consent, the current rolling window and the server blocker separately', () => {
    const html = renderToStaticMarkup(<DoctorReport snapshot={{ ...snapshot, state: 'blocked', error: 'doctor_window_budget_exhausted', grant: {
      active: true, scope: 'measured-code-repair', expiresAt: null, windowHours: 24, windowResetsAt: checkedAt,
      maxJobs: 3, jobsCreated: 3, revocable: true,
    } }} jobs={null} />)
    expect(html).toContain('permanentă, revocabilă')
    expect(html).toContain('3/3 ordine în fereastra de 24 ore')
    expect(html).toContain('doctor_window_budget_exhausted')
    expect(html).not.toContain('Invalid Date')
    expect(html).not.toContain('în această autorizare')
  })
  it('reuses Constructor progress and actual PR links without the old 37% or fake completion', () => {
    const html = renderToStaticMarkup(<DoctorReport snapshot={{ ...snapshot, incidents: [incident] }} jobs={[job]} />)
    expect(html).toContain('constructor-progress-7')
    expect(html).toContain('progres nemăsurat')
    expect(html).toContain('2 unelte terminate și confirmate')
    expect(html).toContain(job.prUrl!)
    expect(html).not.toContain('value="37"')
    expect(html).not.toContain('value="100"')
  })
  it('says when a linked order is unavailable instead of inventing progress', () => {
    const html = renderToStaticMarkup(<DoctorReport snapshot={{ ...snapshot, incidents: [incident] }} jobs={null} />)
    expect(html).toContain('Progresul canonic al ordinului nu este disponibil')
    expect(html).not.toContain('<progress')
  })
  it('shows the immutable closure SHA and recheck, without making job progress up', () => {
    const liveSha = 'b'.repeat(40)
    const closed = { ...incident, status: 'resolved' as const, closure: {
      verifiedAt: checkedAt, liveSha, symptom: { ...incident.evidence, result: 'healthy' as const, httpStatus: 200, releaseSha: liveSha },
    } }
    const html = renderToStaticMarkup(<DoctorReport snapshot={{ ...snapshot, incidents: [closed] }} jobs={null} />)
    expect(html).toContain(liveSha)
    expect(html).toContain('simptom reprobat sănătos')
    expect(html).not.toContain('value="100"')
  })
})
