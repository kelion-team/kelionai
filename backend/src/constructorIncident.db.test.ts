import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runConstructorStrategistStep } from './services/constructorStrategistLoop.js'
import type { ConstructorStrategy } from './services/constructorStrategist.js'

interface JobRow {
  id: number
  ordered_by: string
  order_text: string
  status: string
  attempts: number
  branch: string | null
  pr_url: string | null
  tokens: number
  log: string | null
  progress: string | null
  ci: string | null
  brain: string | null
  cost_usd: number | null
  created_at: Date
  updated_at: Date
}

interface IncidentRow {
  id: number
  job_id: number
  fingerprint: string
  state: string
  stage: string
  cause_code: string
  cause_summary: string
  evidence: string
  responsible: string
  next_action: string
  verification: string | null
  lesson: string | null
  recurrence_count: number
  strategy: ConstructorStrategy | null
  strategy_action_fingerprint: string | null
  strategy_evidence_fingerprint: string | null
  strategy_decision_count: number
  strategy_pending: boolean
  opened_at: Date
  updated_at: Date
  closed_at: Date | null
}

const fake = vi.hoisted(() => ({
  jobs: new Map<number, JobRow>(),
  incidents: new Map<number, IncidentRow>(),
  nextIncidentId: 1,
  queries: [] as string[],
  unreadableKnowledge: false,
  // Când e true, INSERT-ul de incident ARUNCĂ (schemă/constrângere stricată) —
  // ca să probăm că un incident picat NU mai avortează abandonarea + preluarea.
  incidentInsertThrows: false,
}))

vi.mock('pg', () => {
  const result = <T>(rows: T[], rowCount = rows.length) => ({ rows, rowCount })
  const query = async (sqlRaw: string, params: unknown[] = []) => {
    const sql = String(sqlRaw).replace(/\s+/g, ' ').trim()
    fake.queries.push(sql)
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return result([])
    // Savepoint-urile (izolarea per-incident) sunt no-op în mock — modelăm doar
    // efectul: ROLLBACK TO SAVEPOINT nu atinge starea deja scrisă (abandonarea).
    if (/^(SAVEPOINT|RELEASE SAVEPOINT|ROLLBACK TO SAVEPOINT)\b/.test(sql)) return result([])

    if (sql.startsWith('UPDATE build_jobs SET status=$2')) {
      const job = fake.jobs.get(Number(params[0]))
      if (!job) return result([])
      job.status = String(params[1])
      job.branch = (params[2] as string | null) ?? job.branch
      job.pr_url = (params[3] as string | null) ?? job.pr_url
      job.tokens += Number(params[4] ?? 0)
      job.log = (params[5] as string | null) ?? null
      job.ci = (params[6] as string | null) ?? job.ci
      job.brain = (params[7] as string | null) ?? job.brain
      job.cost_usd = (params[8] as number | null) ?? job.cost_usd
      job.updated_at = new Date()
      return result([job])
    }

    if (sql.startsWith('SELECT fingerprint FROM constructor_incidents WHERE job_id=$1')) {
      const row = [...fake.incidents.values()].find((item) => item.job_id === Number(params[0]))
      return result(row ? [{ fingerprint: row.fingerprint }] : [])
    }

    if (sql.startsWith('INSERT INTO constructor_incidents')) {
      if (fake.incidentInsertThrows) throw new Error('simulated: constructor_incidents constraint violation')
      const [jobId, fingerprint, state, stage, causeCode, causeSummary, evidence, responsible, nextAction] = params
      const existing = [...fake.incidents.values()].find((row) => row.fingerprint === fingerprint)
      const now = new Date()
      if (existing) {
        const recurrence = existing.job_id === Number(jobId) ? 0 : 1
        if (recurrence) {
          existing.strategy = null
          existing.strategy_action_fingerprint = null
          existing.strategy_evidence_fingerprint = null
          existing.strategy_pending = false
        }
        existing.job_id = Number(jobId)
        existing.state = String(state)
        existing.stage = String(stage)
        existing.cause_code = String(causeCode)
        existing.cause_summary = String(causeSummary)
        existing.evidence = String(evidence)
        existing.responsible = String(responsible)
        existing.next_action = String(nextAction)
        existing.verification = null
        existing.closed_at = null
        existing.recurrence_count += recurrence
        existing.updated_at = now
        return result([existing])
      }
      const row: IncidentRow = {
        id: fake.nextIncidentId++,
        job_id: Number(jobId),
        fingerprint: String(fingerprint),
        state: String(state),
        stage: String(stage),
        cause_code: String(causeCode),
        cause_summary: String(causeSummary),
        evidence: String(evidence),
        responsible: String(responsible),
        next_action: String(nextAction),
        verification: null,
        lesson: null,
        recurrence_count: 1,
        strategy: null,
        strategy_action_fingerprint: null,
        strategy_evidence_fingerprint: null,
        strategy_decision_count: 0,
        strategy_pending: false,
        opened_at: now,
        updated_at: now,
        closed_at: null,
      }
      fake.incidents.set(row.id, row)
      return result([row])
    }

    if (sql.startsWith("SELECT * FROM constructor_incidents WHERE job_id=$1 AND state <> 'closed'")) {
      const row = [...fake.incidents.values()].find(
        (item) => item.job_id === Number(params[0]) && item.state !== 'closed',
      )
      return result(row ? [row] : [])
    }

    if (sql.startsWith("UPDATE constructor_incidents SET state='verifying'")) {
      const row = fake.incidents.get(Number(params[0]))
      if (row) {
        row.state = 'verifying'
        row.next_action = 'Obține verdict CI verde pe o mașină curată; done fără CI verde nu închide incidentul.'
        row.updated_at = new Date()
      }
      return result([], row ? 1 : 0)
    }

    if (sql.startsWith("UPDATE constructor_incidents SET state='closed'")) {
      const row = fake.incidents.get(Number(params[0]))
      if (row) {
        row.state = 'closed'
        row.verification = String(params[1])
        row.lesson = String(params[2])
        row.next_action = 'Monitorizează reapariția aceleiași amprente; redeschide cazul la recurență.'
        row.closed_at = new Date()
        row.updated_at = new Date()
      }
      return result([], row ? 1 : 0)
    }

    if (sql.startsWith('UPDATE constructor_incidents SET state=$2')) {
      const row = fake.incidents.get(Number(params[0]))
      if (!row || row.state === 'closed') return result([])
      row.state = String(params[1])
      row.stage = String(params[2] || row.stage)
      row.cause_code = String(params[3] || row.cause_code)
      row.cause_summary = String(params[4] || row.cause_summary)
      row.evidence = String(params[5])
      row.next_action = String(params[6])
      row.lesson = String(params[7] || row.lesson || '') || null
      if (params[8]) {
        row.strategy = JSON.parse(String(params[8])) as ConstructorStrategy
        row.strategy_decision_count += 1
      }
      row.strategy_action_fingerprint = String(params[9] || row.strategy_action_fingerprint || '') || null
      row.strategy_evidence_fingerprint = String(params[10] || row.strategy_evidence_fingerprint || '') || null
      if (params[11] !== null && params[11] !== undefined) row.strategy_pending = Boolean(params[11])
      row.updated_at = new Date()
      return result([row])
    }

    if (sql.startsWith("SELECT * FROM constructor_incidents WHERE state <> 'closed'")) {
      if (fake.unreadableKnowledge) throw new Error('incident registry unavailable')
      const rows = [...fake.incidents.values()]
        .filter((row) => row.state !== 'closed')
        .sort((a, b) => a.updated_at.getTime() - b.updated_at.getTime())
        .slice(0, Number(params[0]))
      return result(rows)
    }

    if (sql.startsWith('SELECT lesson FROM constructor_incidents')) {
      if (fake.unreadableKnowledge) throw new Error('incident registry unavailable')
      return result(
        [...fake.incidents.values()]
          .filter((row) => row.state === 'closed' && row.lesson)
          .map((row) => ({ lesson: row.lesson as string })),
      )
    }

    if (sql.startsWith("UPDATE build_jobs SET status='queued'")) {
      const job = fake.jobs.get(Number(params[0]))
      if (!job) return result([])
      const openIncident = [...fake.incidents.values()].find(
        (row) => row.job_id === job.id && row.state !== 'closed',
      )
      if (job.status === 'failed' && openIncident && !['repairing', 'verifying'].includes(openIncident.state)) {
        return result([])
      }
      job.status = 'queued'
      job.attempts = 0
      if (String(params[1] ?? '').trim()) job.order_text = String(params[1])
      job.updated_at = new Date()
      return result([job])
    }

    if (sql.startsWith("UPDATE build_jobs SET status='cancelled'")) {
      const job = fake.jobs.get(Number(params[0]))
      if (!job || !['queued', 'running'].includes(job.status)) return result([], 0)
      job.status = 'cancelled'
      job.log = `${job.log ?? ''}\n[anulat de owner]`
      job.updated_at = new Date()
      return result([], 1)
    }

    if (sql.startsWith("UPDATE build_jobs SET status='failed'")) {
      const abandoned = [...fake.jobs.values()].filter((job) => job.status === 'running' && job.attempts >= 3)
      for (const job of abandoned) {
        job.status = 'failed'
        job.log = `${job.log ?? ''}\n[abandoned: 3 attempts exhausted]`
        job.updated_at = new Date()
      }
      return result(abandoned)
    }

    if (sql.startsWith("UPDATE build_jobs SET status='running'")) return result([])

    throw new Error(`Unhandled SQL in constructor incident test: ${sql}`)
  }

  class Pool {
    query = query
    async connect() {
      return { query, release: () => undefined }
    }
  }
  return { default: { Pool } }
})

vi.mock('./config.js', () => ({ config: { databaseUrl: 'postgres://incident-test' } }))

const {
  cancelBuildJob,
  claimNextBuildJob,
  getConstructorIncidentKnowledge,
  reportBuildJob,
  retryBuildJob,
  updateConstructorIncident,
} = await import('./db.js')

const job = (id: number, orderText = 'Repair checkout route'): JobRow => ({
  id,
  ordered_by: 'admin@test.local',
  order_text: orderText,
  status: 'running',
  attempts: 1,
  branch: null,
  pr_url: null,
  tokens: 0,
  log: null,
  progress: 'tests',
  ci: null,
  brain: null,
  cost_usd: null,
  created_at: new Date('2026-08-18T00:00:00.000Z'),
  updated_at: new Date('2026-08-18T00:00:00.000Z'),
})

beforeEach(() => {
  fake.jobs.clear()
  fake.incidents.clear()
  fake.nextIncidentId = 1
  fake.queries.length = 0
  fake.unreadableKnowledge = false
  fake.incidentInsertThrows = false
})

describe('constructor incident — bucla DB închisă', () => {
  it('creează atomic un incident pentru failure și nu dublează aceeași raportare', async () => {
    fake.jobs.set(1, job(1))

    await reportBuildJob(1, { status: 'failed', log: 'vitest failed: AssertionError expected 200' })
    await reportBuildJob(1, { status: 'failed', log: 'vitest failed: AssertionError expected 200' })

    expect(fake.jobs.get(1)?.status).toBe('failed')
    expect(fake.incidents).toHaveLength(1)
    const created = [...fake.incidents.values()][0]
    expect(created?.cause_code).toBe('test_failure')
    expect(created?.responsible).toBe('kelion')
    expect(created?.recurrence_count).toBe(1)
    expect(fake.queries).toContain('BEGIN')
    expect(fake.queries).toContain('COMMIT')
  })

  it('redeschide aceeași amprentă pentru alt job și crește recurența', async () => {
    fake.jobs.set(1, job(1, 'Repair checkout route'))
    fake.jobs.set(2, job(2, '  repair   CHECKOUT route  '))
    await reportBuildJob(1, { status: 'failed', log: 'build failed with exit code 1' })
    const first = [...fake.incidents.values()][0]
    if (!first) throw new Error('incident missing')
    first.state = 'closed'
    first.closed_at = new Date()

    await reportBuildJob(2, { status: 'failed', log: 'build failed with exit code 1' })

    expect(fake.incidents).toHaveLength(1)
    expect(first.job_id).toBe(2)
    expect(first.state).toBe('diagnosing')
    expect(first.closed_at).toBeNull()
    expect(first.recurrence_count).toBe(2)
  })

  it('blochează retry-ul orb și îl permite numai după dovadă + repairing', async () => {
    fake.jobs.set(3, job(3))
    await reportBuildJob(3, { status: 'failed', log: 'tsc build failed with exit code 2' })
    const current = [...fake.incidents.values()][0]
    if (!current) throw new Error('incident missing')

    expect(await retryBuildJob(3)).toBeNull()
    expect(await updateConstructorIncident(current.id, {
      state: 'repairing',
      evidence: 'src/routes/checkout.ts:88 returns the wrong HTTP code',
      nextAction: 'Patch the status mapping and rerun focused plus full tests.',
    })).toMatchObject({ ok: true })
    expect((await retryBuildJob(3))?.status).toBe('queued')
  })

  it('refuză progresul fără dovadă și acțiune suficientă', async () => {
    expect(await updateConstructorIncident(99, {
      state: 'diagnosing',
      evidence: 'scurt',
      nextAction: 'văd',
    })).toEqual({ ok: false, error: 'evidence_and_next_action_required' })
  })

  it('done fără CI verde rămâne verifying; numai CI verde închide și salvează lecția', async () => {
    fake.jobs.set(4, job(4))
    await reportBuildJob(4, { status: 'failed', log: 'CI failed on clean runner' })

    await reportBuildJob(4, { status: 'done', ci: 'roșu', branch: 'fix/checkout' })
    const current = [...fake.incidents.values()][0]
    expect(current?.state).toBe('verifying')
    expect(current?.closed_at).toBeNull()

    await reportBuildJob(4, { status: 'done', ci: 'verde', branch: 'fix/checkout', prUrl: 'https://example.test/pr/4' })
    expect(current?.state).toBe('closed')
    expect(current?.verification).toContain('CI verde')
    expect(current?.lesson).toContain('Cauză:')
    expect(current?.lesson).toContain('Prevenție:')
    expect(current?.lesson).toContain('Verificare:')

    const knowledge = await getConstructorIncidentKnowledge()
    expect(knowledge?.open).toEqual([])
    expect(knowledge?.lessons[0]).toContain('CI verde')
  })

  it('raportează null când registrul nu poate fi citit', async () => {
    fake.unreadableKnowledge = true
    expect(await getConstructorIncidentKnowledge()).toBeNull()
  })

  it('transformă stale + 3 încercări în failure și incident (bookkeeping izolat de preluare)', async () => {
    const stale = job(5, 'Repair stale worker heartbeat')
    stale.attempts = 3
    fake.jobs.set(5, stale)

    expect(await claimNextBuildJob()).toBeNull()
    expect(fake.jobs.get(5)?.status).toBe('failed')
    expect([...fake.incidents.values()][0]?.cause_code).toBe('timeout')
  })

  // ── owner, 19 aug: „are ordine in coada dar nu se apuca aider… de ce?" ───────
  // CAUZA MĂSURATĂ: abandonarea + upsertConstructorIncident rulau în ACEEAȘI
  // tranzacție cu preluarea. În Postgres orice query care aruncă avortează toată
  // tranzacția → un singur incident stricat rostogolea claim-ul → `null` la FIECARE
  // tur → coada rămânea neatinsă la nesfârșit. Acum bookkeeping-ul e izolat: un
  // incident care ARUNCĂ nu mai împiedică nici abandonarea, nici preluarea.
  it('un incident care ARUNCĂ nu mai blochează preluarea (coada nu mai e înfometată)', async () => {
    const stale = job(7, 'Repair stale worker heartbeat')
    stale.attempts = 3
    fake.jobs.set(7, stale)
    fake.incidentInsertThrows = true

    // NU aruncă — se rezolvă curat (null: nu există job queued în acest mock).
    await expect(claimNextBuildJob()).resolves.toBeNull()
    // Abandonarea a persistat, în ciuda incidentului picat.
    expect(fake.jobs.get(7)?.status).toBe('failed')
    // Izolarea a intrat în funcțiune (savepoint rollback), nu un ROLLBACK global.
    expect(fake.queries).toContain('ROLLBACK TO SAVEPOINT incident')
    fake.incidentInsertThrows = false
  })

  it('anularea ownerului este cancelled, nu failed și nu creează incident fals', async () => {
    fake.jobs.set(6, job(6))
    expect(await cancelBuildJob(6)).toBe(true)
    expect(fake.jobs.get(6)?.status).toBe('cancelled')
    expect(fake.incidents).toHaveLength(0)
  })

  it('INTEGRARE: failure → strateg → retry → CI roșu deschis → CI verde closed + lesson', async () => {
    fake.jobs.set(22, job(22, 'Repair authenticated Git push in constructor worker'))
    await reportBuildJob(22, {
      status: 'failed',
      log: "git push failed: fatal: could not read Username for 'https://github.com'",
    })

    const afterFailure = await getConstructorIncidentKnowledge()
    expect(afterFailure).not.toBeNull()
    expect(afterFailure?.open).toHaveLength(1)
    const opened = afterFailure?.open[0]
    if (!opened) throw new Error('incident was not opened')
    expect(fake.jobs.get(22)?.status).toBe('failed')
    expect(opened.evidence).toContain('could not read Username')

    const strategy: ConstructorStrategy = {
      protocol: 'kelion.strategy/v1',
      incidentId: opened.id,
      objective: 'Restore authenticated Git publication for constructor results.',
      acceptanceCriteria: [
        'The retried order reaches done.',
        'Independent CI reports verde.',
      ],
      facts: [
        "The implementation and build completed before git push failed.",
        "Git reported that it could not read a username for the HTTPS remote.",
      ],
      unknowns: ['Whether the worker propagates its existing askpass environment to git push.'],
      hypotheses: [{
        statement: 'The worker does not propagate usable askpass credentials to the push subprocess.',
        evidenceFor: ["The terminal failure is Git's HTTPS username prompt."],
        evidenceAgainst: [],
        confidence: 0.9,
      }],
      options: [
        {
          id: 'propagate_askpass',
          action: 'Repair the worker Git environment and retry the same controlled order.',
          successProbability: 0.9,
          cost: 'low',
          risk: 'low',
          requires: ['Existing secret remains hidden and is passed only through GIT_ASKPASS.'],
        },
        {
          id: 'manual_push',
          action: 'Leave the incident blocked and require a human to push the branch.',
          successProbability: 0.5,
          cost: 'medium',
          risk: 'medium',
          requires: ['Human intervention.'],
        },
      ],
      missingCapability: {
        name: 'Authenticated non-interactive Git push',
        reason: 'The worker completed code verification but could not publish the branch.',
        canBuildSafely: true,
        buildAction: 'Propagate scoped GIT_ASKPASS to the git push subprocess without logging the token.',
      },
      decision: {
        optionId: 'propagate_askpass',
        rationale: 'It repairs the measured terminal stage with the least cost and risk.',
        phase: 'repair',
        executor: 'constructor',
        action: 'Retry only after applying the authenticated askpass path and require CI verde.',
        reformulatedOrder: 'Repair authenticated non-interactive Git push in the constructor worker, preserve secret redaction, run backend tests and build, then publish the branch and require CI green.',
        expectedEvidence: [
          'Git push exits zero without an interactive prompt.',
          'The build order is done.',
          'CI verdict is verde.',
        ],
      },
      stopConditions: ['Stop if credentials are absent; never print or invent a token.'],
      replanWhen: ['Replan if push still fails or CI is not verde.'],
    }
    let thinkCalls = 0
    const strategicStep = await runConstructorStrategistStep(afterFailure!, {
      think: async (prompt) => {
        thinkCalls += 1
        expect(prompt).toContain(`INCIDENT #${opened.id}`)
        expect(prompt).toContain('could not read Username')
        return JSON.stringify(strategy)
      },
      executeBrainAction: async () => {
        throw new Error('constructor strategy must not execute through brain_tools')
      },
      retryJob: retryBuildJob,
      updateIncident: updateConstructorIncident,
      capabilityInventory: 'TOOLS: constructor retry, repo repair, CI evidence.',
      constructorBusy: false,
    })

    expect(thinkCalls).toBe(1)
    expect(strategicStep).toMatchObject({ started: true })
    expect(fake.jobs.get(22)?.status).toBe('queued')
    expect(fake.jobs.get(22)?.order_text).toBe(strategy.decision.reformulatedOrder)
    const afterStrategy = [...fake.incidents.values()][0]
    expect(afterStrategy?.state).toBe('repairing')
    expect(afterStrategy?.strategy?.decision.optionId).toBe('propagate_askpass')
    expect(afterStrategy?.strategy_decision_count).toBe(1)
    expect(afterStrategy?.strategy_pending).toBe(false)
    expect(afterStrategy?.evidence).toContain('Strategul a autorizat retry-ul')

    await reportBuildJob(22, { status: 'done', ci: 'roșu', branch: 'fix/git-push' })
    expect(afterStrategy?.state).toBe('verifying')
    expect(afterStrategy?.closed_at).toBeNull()

    await reportBuildJob(22, {
      status: 'done',
      ci: 'verde',
      branch: 'fix/git-push',
      prUrl: 'https://example.test/pr/22',
    })
    expect(afterStrategy?.state).toBe('closed')
    expect(afterStrategy?.verification).toContain('order #22 done; CI verde')
    expect(afterStrategy?.lesson).toContain('Cauză:')
    expect(afterStrategy?.lesson).toContain('Prevenție:')
    expect(afterStrategy?.lesson).toContain('Verificare:')

    const closedKnowledge = await getConstructorIncidentKnowledge()
    expect(closedKnowledge?.open).toEqual([])
    expect(closedKnowledge?.lessons[0]).toContain('CI verde')
  })
})
