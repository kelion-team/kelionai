import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { activityForJob as evaluateActivity, parseMonitorView, type MonitorConnection } from './lib/constructorMonitorView'
import { ConstructorJobActivity } from './components/admin/ConstructorJobActivity'
import { ConstructorJobProgress } from './components/admin/ConstructorJobProgress'
import { parseAdminRestoreAcknowledgement, type BuildJobRow } from './lib/adminConstructorContract'
import { classifyConstructorMonitor, constructorMonitorThresholds } from '../../backend/src/services/constructorMonitorPolicy'

const now = Date.parse('2026-09-05T12:00:00.000Z')
const activityForJob = (connection: MonitorConnection, jobId: number, cycle: number | undefined) =>
  evaluateActivity(connection, jobId, cycle, 'running')
const at = (offset: number) => new Date(now + offset).toISOString()
const limits = constructorMonitorThresholds({})
const host = { schema: 1 as const, measuredAt: at(0), worker: { timer: 'active' as const, service: 'active' as const, mainPid: 123 }, intentionalPause: false, deployGate: false }
const backendJob = { jobId: 666, cycle: 1, attempts: 1, status: 'running', stage: 'working', createdAt: at(-600_000), lastActivity: at(-1000), lastRealProgress: at(-1000), heartbeatAt: at(-1000), completedReceipt: false }
const external = { jobId: 666, cycle: 1, coordinator: 'root VPS', executionId: '11111111-1111-4111-8111-111111111111', kind: 'test', state: 'working', summary: 'Regresie încheiată', nextAction: 'Verifică rezultatul.', lastEvidenceAt: at(-1000), evidenceDigest: 'a'.repeat(64), sourceRef: 'deploy/lib/constructor-pause.test.mjs', activeExternalRemediation: true, activeUntil: at(59_000) }
function rawSnapshot() {
  return { servedAt: at(0), checkedAt: at(0), lastSuccessfulCheck: at(0), error: null as string | null, state: 'observing', thresholds: limits,
    activeExecution: true, cases: [classifyConstructorMonitor(backendJob, host, now, limits)], externalRemediations: [structuredClone(external)] }
}
function connection(raw: unknown = rawSnapshot(), elapsedMs = 0, connected = true): MonitorConnection {
  const snapshot = parseMonitorView(raw)
  expect(snapshot).not.toBeNull()
  return { snapshot, elapsedMs, connected }
}
const job: BuildJobRow = {
  id: 666, executionCycle: 1, status: 'running', constructorStage: 'working', deletable: false, retryable: false,
  orderText: 'Repară parserul', branch: null, prUrl: null, tokens: 0, brain: null, updatedAt: at(0), progress: 'Etapă verificată', pct: 91,
  continuity: { state: 'running', checkpoint: 'working', message: 'Running', nextAction: null, retry: { mode: 'manual', attempts: 1 },
    finalProof: { complete: false, commit: null, liveVersion: null }, modelOutcome: null,
    progress: { percent: 37, completed: 3, total: 8, currentStage: 'Constructorul execută cererea', resolved: false, source: 'constructor_activity_events' }, activity: [], eventCount: 3 },
}
function render(status: BuildJobRow['status'], snapshot: MonitorConnection) {
  const props = { jobId: job.id, cycle: job.executionCycle, status, connection: snapshot }
  return renderToStaticMarkup(<><ConstructorJobActivity {...props} /><ConstructorJobProgress job={{ ...job, status }} /></>)
}

describe('server monitor projection and truthful activity', () => {
  it('adapts the real backend classification without forwarding host details', () => {
    const view = connection().snapshot!
    expect(view.cases[0]).toMatchObject({ code: 'executing', activeExecution: true, cycle: 1 })
    expect(view.cases[0]).not.toHaveProperty('host')
    expect(activityForJob(connection(), 666, 1)).toMatchObject({ active: true, pipelineActive: true, externalActive: true })
  })
  it('renders the external hourglass independently while keeping the milestone bar at 37', () => {
    const raw = rawSnapshot()
    raw.cases = [classifyConstructorMonitor({ ...backendJob, status: 'failed', stage: 'failed' }, host, now, limits)]
    const html = render('failed', connection(raw))
    expect(html).toContain('⌛')
    expect(html).toContain('Remediere în lucru pentru acest ordin')
    expect(html).toContain('Nu declarăm pipelineul în execuție')
    expect(html).toContain('Oprit cu eroare')
    expect(html).toContain('value="37"')
    expect(html.match(/<progress\b/g)).toHaveLength(1)
    expect(html).not.toContain('value="91"')
    expect(html).not.toContain('value="100"')
    expect(html).toContain('BST (Europe/London)')
    expect(html).toContain(`dateTime="${at(-1000)}"`)
  })
  it.each(['done', 'cancelled'] as const)('suppresses a stale monitor hourglass when the displayed job is already %s', (status) => {
    const html = render(status, connection())
    expect(html).not.toContain('⌛')
    expect(html).toContain('value="37"')
    expect(html).not.toContain('Activitate recentă a executorului')
  })
  it('a failed job may have an external repair, never stale pipeline execution', () => {
    const raw = rawSnapshot(); raw.externalRemediations = []
    expect(render('failed', connection(raw))).not.toContain('⌛')
  })
  it.each([20_000, 60_000, Number.NaN, Number.POSITIVE_INFINITY, -1])('does not assert activity with invalid/stale transport age %s', (elapsed) => {
    expect(activityForJob(connection(undefined, elapsed), 666, 1).active).toBe(false)
  })
  it('keeps historical evidence visible offline but removes the hourglass', () => {
    const html = render('running', connection(undefined, 0, false))
    expect(html).not.toContain('⌛')
    expect(html).toContain('istorice')
    expect(html).toContain(external.evidenceDigest)
    expect(html).toContain('value="37"')
  })
  it.each([0, 2, undefined])('never joins evidence across execution cycle %s', (cycle) => {
    expect(activityForJob(connection(), 666, cycle)).toMatchObject({ active: false, current: null, external: null })
  })
  it('does not infer activity from a process and fresh heartbeat without a new milestone', () => {
    const raw = rawSnapshot(); raw.externalRemediations = []
    raw.cases = [classifyConstructorMonitor({ ...backendJob, lastRealProgress: at(-180_001), lastActivity: at(-1), heartbeatAt: at(-1) }, host, now, limits)]
    expect(raw.cases[0].activeExecution).toBe(false)
    expect(activityForJob(connection(raw), 666, 1).active).toBe(false)
    const html = render('running', connection(raw))
    expect(html).not.toContain('⌛')
    expect(html).toContain('value="37"')
  })
  it('expiry cannot be renewed by a new response carrying the same evidence', () => {
    const raw = rawSnapshot(); raw.cases = []
    raw.servedAt = at(60_000)
    expect(activityForJob(connection(raw), 666, 1).active).toBe(false)
  })
  it('failed monitor checks suppress pipeline but do not invent or erase independent external evidence', () => {
    const raw = rawSnapshot(); raw.error = 'constructor_monitor_check_failed'
    expect(activityForJob(connection(raw), 666, 1)).toMatchObject({ pipelineActive: false, externalActive: true })
    raw.externalRemediations = []
    expect(activityForJob(connection(raw), 666, 1).active).toBe(false)
  })
  it('empty/unverified data renders unknown, not synthetic progress or current timestamps', () => {
    const value: MonitorConnection = { snapshot: null, elapsedMs: 0, connected: false }
    const html = render('running', value)
    expect(html).not.toContain('⌛')
    expect(html).toContain('nu este disponibilă')
    expect(html).toContain('value="37"')
  })
  it.each(['lastEvidenceAt', 'evidenceDigest', 'sourceRef', 'activeUntil'] as const)('refuses asserted external activity without %s', (field) => {
    const raw = rawSnapshot(); (raw.externalRemediations[0] as unknown as Record<string, unknown>)[field] = null
    expect(parseMonitorView(raw)).toBeNull()
  })
  it.each([
    (v: ReturnType<typeof rawSnapshot>) => { v.cases[0].cycle = -1 },
    (v: ReturnType<typeof rawSnapshot>) => { v.cases.push(v.cases[0]) },
    (v: ReturnType<typeof rawSnapshot>) => { v.externalRemediations.push(v.externalRemediations[0]) },
    (v: ReturnType<typeof rawSnapshot>) => { v.servedAt = '2026-09-05' },
    (v: ReturnType<typeof rawSnapshot>) => { v.cases[0].lastRealProgress = null },
    (v: ReturnType<typeof rawSnapshot>) => { v.cases[0].code = 'completed' },
    (v: ReturnType<typeof rawSnapshot>) => { v.externalRemediations[0].state = 'completed' },
    (v: ReturnType<typeof rawSnapshot>) => { v.externalRemediations[0].coordinator = 'unsafe\nline' },
  ])('rejects malformed evidence %s', (mutate) => {
    const raw = rawSnapshot(); mutate(raw)
    expect(parseMonitorView(raw)).toBeNull()
  })
  it('a blocked/completed external report remains historical, not job completion', () => {
    for (const state of ['blocked', 'completed']) {
      const raw = rawSnapshot(); raw.cases = []
      Object.assign(raw.externalRemediations[0], { state, activeExternalRemediation: false, activeUntil: null })
      const html = render('failed', connection(raw))
      expect(html).not.toContain('⌛')
      expect(html).not.toContain('value="100"')
      expect(html).toContain(state === 'blocked' ? 'blocată' : 'nu ordin finalizat')
    }
  })
  it('executionCycle is optional for legacy rows but strict when present', () => {
    const { executionCycle: _cycle, continuity: _continuity, ...legacy } = job
    expect(parseAdminRestoreAcknowledgement({ ok: true, job: legacy })).not.toBeNull()
    expect(parseAdminRestoreAcknowledgement({ ok: true, job: { ...legacy, executionCycle: 0 } })).not.toBeNull()
    for (const executionCycle of [-1, 0.5, '1', null, Number.MAX_SAFE_INTEGER + 1]) {
      expect(parseAdminRestoreAcknowledgement({ ok: true, job: { ...legacy, executionCycle } })).toBeNull()
    }
  })
})
