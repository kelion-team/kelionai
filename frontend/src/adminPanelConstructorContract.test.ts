import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  adminMutationAcknowledged,
  adminReleaseActionAcknowledged,
  parseAdminArchiveAcknowledgement,
  parseAdminBuildArchive,
  parseAdminConstructorDiagnostic,
  parseAdminConstructorIntake,
  parseAdminConstructorSnapshot,
  parseAdminReleaseSnapshot,
  parseAdminRestoreAcknowledgement,
} from './lib/adminConstructorContract'

const observedAt = '2026-08-26T12:00:00.000Z'
const sha = 'a'.repeat(40)
const progress = {
  percent: 0,
  completed: 0,
  total: 1,
  currentStage: 'queued',
  resolved: false,
  source: 'constructor_activity_events',
} as const
const continuity = {
  state: 'queued',
  checkpoint: 'queued',
  message: 'Ordinul a fost persistat.',
  nextAction: null,
  retry: { mode: 'automatic', attempts: 0 },
  finalProof: { complete: false, commit: null, liveVersion: null },
  progress,
  activity: [],
  eventCount: 0,
  modelOutcome: null,
} as const
const workCard = {
  id: 'constructor:7',
  canonicalLink: '#constructor-work-card-7',
  objective: 'Livrează schimbarea verificată.',
  acceptanceCriteria: ['Testele trec.'],
  contextLinks: ['/admin#constructor'],
  owner: null,
  actor: 'OpenCode + Qwen local (llama.cpp)',
  plan: [{ key: 'queued', label: 'În coadă', state: 'current' }],
  currentStep: 'queued',
  status: 'queued',
  progress,
  heartbeatAt: null,
  activity: [],
  decisions: [],
  approvals: [],
  risks: [],
  dependencies: [],
  escalationCondition: 'Escaladează când lanțul este indisponibil.',
  finalResult: null,
  evidence: { eventCount: 0, prUrl: null, ci: null, commit: null, liveVersion: null },
  closure: { resolved: false, closedAt: null },
} as const
const job = {
  id: 7,
  status: 'queued',
  constructorStage: 'queued',
  deletable: false,
  retryable: false,
  orderText: 'Construiește fluxul verificat.',
  nume: 'fluxul verificat',
  branch: null,
  prUrl: null,
  tokens: 0,
  brain: 'OpenCode + Qwen local (llama.cpp)',
  updatedAt: observedAt,
  progress: null,
  pct: 0,
  continuity,
  workCard,
} as const
const chain = {
  acceptingWork: true,
  workerCanStartNow: true,
  constructor: {
    cine: 'constructor_pipeline',
    state: 'ready',
    motiv: 'Lanț verificat.',
    lastHeartbeat: observedAt,
  },
} as const

describe('contractele runtime ale Constructorului în AdminPanel', () => {
  it('acceptă snapshotul complet și respinge joburi, dovezi sau chain contradictorii', () => {
    expect(parseAdminConstructorSnapshot({ ...chain, jobs: [job] })?.jobs).toHaveLength(1)
    expect(parseAdminConstructorSnapshot({ ...chain, jobs: [{}] })).toBeNull()
    expect(parseAdminConstructorSnapshot({ ...chain, jobs: [{ ...job, pct: 101 }] })).toBeNull()
    expect(parseAdminConstructorSnapshot({ ...chain, jobs: [{ ...job, prUrl: 'javascript:alert(1)' }] })).toBeNull()
    expect(parseAdminConstructorSnapshot({ ...chain, workerCanStartNow: false, jobs: [job] })).toBeNull()
    expect(parseAdminConstructorSnapshot({
      ...chain,
      jobs: [{
        ...job,
        continuity: { ...continuity, finalProof: { complete: true, commit: null, liveVersion: null } },
      }],
    })).toBeNull()
    expect(parseAdminConstructorSnapshot({ ...chain, jobs: [{ ...job, workCard: { ...workCard, canonicalLink: '#wrong' } }] })).toBeNull()
  })

  it('cere ACK-ul și chain-ul complet pentru intake', () => {
    expect(parseAdminConstructorIntake({ ...chain, ok: true, id: 7, deduplicated: false })?.id).toBe(7)
    expect(parseAdminConstructorIntake({ ...chain, id: 7, deduplicated: false })).toBeNull()
    expect(parseAdminConstructorIntake({ ...chain, ok: true, id: 7 })).toBeNull()
  })

  it('separă diagnosticul complet de payloadurile absente sau malformate', () => {
    const diagnostic = {
      sanatos: true,
      verdict: 'Lanț măsurat.',
      probleme: [],
      masuratori: {
        workerConectat: true,
        workerStatus: 'ready',
        publisherConectat: true,
        releaseConectat: true,
        inCoada: 0,
        inLucru: 0,
        esuate: 0,
        oldestQueuedSec: null,
        runningSec: null,
        inBackoff: 0,
      },
    }
    expect(parseAdminConstructorDiagnostic(diagnostic)?.sanatos).toBe(true)
    expect(parseAdminConstructorDiagnostic({ ...diagnostic, probleme: undefined })).toBeNull()
    expect(parseAdminConstructorDiagnostic({ ...diagnostic, masuratori: { ...diagnostic.masuratori, inCoada: -1 } })).toBeNull()
  })

  it('validează profund pagina arhivei și cursorul obligatoriu', () => {
    const archivedJob: Record<string, unknown> = { ...job }
    delete archivedJob.nume
    delete archivedJob.pct
    delete archivedJob.continuity
    delete archivedJob.workCard
    expect(parseAdminBuildArchive({ jobs: [archivedJob], nextCursor: null })?.jobs).toHaveLength(1)
    expect(parseAdminBuildArchive({ jobs: [archivedJob] })).toBeNull()
    expect(parseAdminBuildArchive({ jobs: [{}], nextCursor: null })).toBeNull()
    expect(parseAdminBuildArchive({ jobs: [archivedJob], nextCursor: { updatedAt: 'invalid', id: 7 } })).toBeNull()
  })

  it('validează toate câmpurile snapshotului release', () => {
    const release = {
      jobId: 7,
      integration: 'ready',
      setupInstructions: null,
      pr: {
        number: 12,
        title: 'Constructor change',
        url: 'https://github.com/acme/project/pull/12',
        state: 'open',
        merged: false,
        headSha: sha,
        baseRef: 'master',
      },
      checks: 'passed',
      approval: 'required',
      merge: 'blocked',
      nextAction: 'Aprobă schimbarea.',
    }
    expect(parseAdminReleaseSnapshot(release)?.pr?.headSha).toBe(sha)
    expect(parseAdminReleaseSnapshot({ ...release, pr: { ...release.pr, headSha: 'abc' } })).toBeNull()
    expect(parseAdminReleaseSnapshot({ ...release, nextAction: undefined })).toBeNull()
    const releaseDetails: Record<string, unknown> = { ...release }
    delete releaseDetails.jobId
    expect(adminReleaseActionAcknowledged({ ok: true, release: releaseDetails })).toBe(true)
    expect(adminReleaseActionAcknowledged({ ok: true })).toBe(false)
  })

  it('nu transformă un 2xx fără ACK strict în succes', () => {
    expect(adminMutationAcknowledged({ ok: true })).toBe(true)
    expect(adminMutationAcknowledged({})).toBe(false)
    expect(adminMutationAcknowledged({ ok: false })).toBe(false)
    expect(parseAdminArchiveAcknowledgement({ ok: true, arhivate: 0 })).toBe(0)
    expect(parseAdminArchiveAcknowledgement({ ok: true })).toBeNull()
    expect(parseAdminArchiveAcknowledgement({ ok: true, arhivate: -1 })).toBeNull()
    expect(parseAdminRestoreAcknowledgement({ ok: true, job })?.id).toBe(7)
    expect(parseAdminRestoreAcknowledgement({ ok: true })).toBeNull()
  })

  it('ține Gestures single-flight și derivă displayul Constructor fail-closed', () => {
    const gestures = fs.readFileSync(new URL('./components/admin/AdminUtilizatori.tsx', import.meta.url), 'utf8')
    const constructor = fs.readFileSync(new URL('./components/admin/AdminProductie.tsx', import.meta.url), 'utf8')
    expect(gestures).toContain('gestSavePendingRef.current')
    expect(gestures).toContain('saveDisabledGesturesCanonical(next)')
    expect(gestures).toContain('setGestOff(await fetchDisabledGestures())')
    expect(gestures).toContain('disabled={!gestOffData || gestSaving}')
    expect(gestures).not.toContain('const inainte = gestOff')
    expect(constructor).toContain('constructorWorkerCanStartNow === true')
    expect(constructor).toContain('constructorAcceptingWork === true')
    expect(constructor).not.toContain("constructorId.state === 'ready'")
    expect(constructor).not.toContain("constructorId.state === 'busy'")
    expect(constructor).toContain('parseAdminBuildArchive')
    expect(constructor).toContain('parseAdminArchiveAcknowledgement')
  })
})
