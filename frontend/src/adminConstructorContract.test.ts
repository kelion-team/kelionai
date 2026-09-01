import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import {
  adminMutationAcknowledged,
  parseAdminArchiveAcknowledgement,
  parseAdminBuildArchive,
  parseAdminConstructorDiagnostic,
  parseAdminConstructorIntake,
  parseAdminConstructorSnapshot,
  parseAdminReleaseSnapshot,
} from './lib/adminConstructorContract'

const continuity = {
  state: 'waiting_manual', checkpoint: 'failed', message: 'needs review', nextAction: null,
  retry: { mode: 'manual', attempts: 1 },
  finalProof: { complete: false, commit: null, liveVersion: null },
  progress: { percent: null, completed: 1, total: 7, currentStage: 'Failed', resolved: false, source: 'constructor_activity_events' },
  activity: [], eventCount: 1, modelOutcome: null,
}

const job = {
  id: 7, status: 'failed', constructorStage: 'failed', deletable: true, retryable: true,
  orderText: 'Fix the complete Constructor flow', nume: 'Fix flow', branch: null, prUrl: null,
  tokens: 0, brain: 'OpenCode + Qwen local (llama.cpp)', updatedAt: '2026-08-26T12:00:00.000Z', progress: 'failed',
  pct: null, continuity, workCard: null,
}

const readyChain = {
  acceptingWork: true,
  workerCanStartNow: true,
  constructor: { cine: 'constructor_pipeline', state: 'ready', motiv: 'ready', lastHeartbeat: null },
}

describe('Admin Constructor contracts fail closed', () => {
  it('accepts only a complete, internally consistent queue/intake envelope', () => {
    expect(parseAdminConstructorSnapshot({ ...readyChain, jobs: [job] })?.jobs).toHaveLength(1)
    expect(parseAdminConstructorSnapshot({ ...readyChain, jobs: [{}] })).toBeNull()
    expect(parseAdminConstructorSnapshot({ ...readyChain, jobs: [{ ...job, continuity: {} }] })).toBeNull()
    expect(parseAdminConstructorSnapshot({ ...readyChain, acceptingWork: false, jobs: [] })).toBeNull()
    expect(parseAdminConstructorIntake({ ...readyChain, ok: true, id: 9, deduplicated: false })?.id).toBe(9)
    expect(parseAdminConstructorIntake({ ...readyChain, id: 9, deduplicated: false })).toBeNull()
  })

  it('acceptă recomandarea manuală explicită numai pe un job failed', () => {
    const modelOutcome = {
      profile: 'fast',
      result: 'unresolved',
      reasonCode: 'no_changes',
      reason: 'Profilul rapid nu a produs o schimbare publicabilă.',
      manualRecommendation: {
        profile: 'powerful',
        reasonCode: 'fast_result_not_publishable',
        reason: 'Profilul puternic poate fi ales manual pentru o încercare separată.',
      },
    }
    expect(parseAdminConstructorSnapshot({
      ...readyChain,
      jobs: [{ ...job, continuity: { ...continuity, modelOutcome } }],
    })?.jobs[0].continuity?.modelOutcome).toEqual(modelOutcome)
    expect(parseAdminConstructorSnapshot({
      ...readyChain,
      jobs: [{ ...job, status: 'done', continuity: { ...continuity, modelOutcome } }],
    })).toBeNull()
  })

  it('rejects malformed diagnostics, archives and release snapshots', () => {
    const diagnostic = {
      sanatos: true, verdict: 'ok', probleme: [],
      masuratori: {
        workerConectat: true, workerStatus: 'ready', publisherConectat: true, releaseConectat: true,
        inCoada: 0, inLucru: 0, esuate: 0, oldestQueuedSec: null, runningSec: null, inBackoff: 0,
      },
    }
    expect(parseAdminConstructorDiagnostic(diagnostic)).not.toBeNull()
    expect(parseAdminConstructorDiagnostic({ ...diagnostic, probleme: [{}] })).toBeNull()
    expect(parseAdminConstructorDiagnostic({ ...diagnostic, masuratori: {} })).toBeNull()

    expect(parseAdminBuildArchive({ jobs: [job], nextCursor: null })?.jobs).toHaveLength(1)
    expect(parseAdminBuildArchive({ jobs: [{}], nextCursor: null })).toBeNull()
    expect(parseAdminBuildArchive({ jobs: [] })).toBeNull()

    const release = {
      jobId: null, integration: 'ready', setupInstructions: null, pr: null,
      checks: 'unknown', approval: 'unknown', merge: 'unknown', nextAction: 'wait',
    }
    expect(parseAdminReleaseSnapshot(release)).not.toBeNull()
    expect(parseAdminReleaseSnapshot({ ...release, checks: 'passed', nextAction: null })).toBeNull()
  })

  it('requires canonical mutation acknowledgements and archive counts', () => {
    expect(adminMutationAcknowledged({ ok: true })).toBe(true)
    expect(adminMutationAcknowledged({})).toBe(false)
    expect(adminMutationAcknowledged({ ok: false })).toBe(false)
    expect(parseAdminArchiveAcknowledgement({ ok: true, arhivate: 0 })).toBe(0)
    expect(parseAdminArchiveAcknowledgement({ ok: true })).toBeNull()
    expect(parseAdminArchiveAcknowledgement({ ok: true, arhivate: -1 })).toBeNull()
  })

  it('wires strict parsers into every previously false-positive UI branch', () => {
    const panel = fs.readFileSync(new URL('./components/admin/AdminProductie.tsx', import.meta.url), 'utf8')
    expect(panel).toContain('parseAdminConstructorSnapshot(await response.json())')
    expect(panel).toContain('parseAdminConstructorDiagnostic(await response.json())')
    expect(panel).toContain('parseAdminReleaseSnapshot(await response.json())')
    expect(panel).toContain('parseAdminBuildArchive(await response.json().catch(() => null))')
    expect(panel).toContain('response.ok && adminReleaseActionAcknowledged(body)')
    expect(panel).toContain('httpOk && adminMutationAcknowledged(body)')
    expect(panel).toContain('parseAdminArchiveAcknowledgement(body)')
  })
})
