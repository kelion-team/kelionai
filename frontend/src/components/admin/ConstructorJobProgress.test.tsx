import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ConstructorJobProgress } from './ConstructorJobProgress'
import type { BuildJobRow } from '../../lib/adminConstructorContract'

const job: BuildJobRow = {
  id: 7, status: 'running', constructorStage: 'working', deletable: false, retryable: false,
  orderText: 'Build a verified change', branch: null, prUrl: null, tokens: 0, brain: null,
  updatedAt: '2026-09-05T05:00:00.000Z', progress: 'Validating output', pct: 37,
  continuity: {
    state: 'running', checkpoint: 'working', message: 'Running', nextAction: null,
    retry: { mode: 'automatic', attempts: 1 },
    finalProof: { complete: false, commit: null, liveVersion: null }, modelOutcome: null,
    progress: { percent: 50, completed: 1, total: 2, currentStage: 'Testare', resolved: false, source: 'constructor_activity_events' },
    activity: [], eventCount: 2,
  },
}

function workingSnapshot(completedTools: number, at: string): BuildJobRow {
  return {
    ...job, updatedAt: at, progress: `Comandă executată; ${completedTools} unelte terminate și confirmate`,
    continuity: {
      ...job.continuity!,
      progress: { ...job.continuity!.progress, percent: 37, completed: 3, total: 8, currentStage: 'Constructorul execută cererea' },
      activity: [{ id: String(completedTools), eventKey: 'progress', stage: 'working', label: 'Progres raportat de executor', state: 'current', at, percent: 37 }],
    },
  }
}

describe('Constructor measured milestone bar', () => {
  it('uses canonical milestone evidence, not the legacy pct field', () => {
    const html = renderToStaticMarkup(<ConstructorJobProgress job={job} />)
    expect(html).toContain('value="50"')
    expect(html).toContain('1/2 etape confirmate')
    expect(html).not.toContain('37%')
  })
  it('renders unknown running progress indeterminate, without fake percentages', () => {
    const html = renderToStaticMarkup(<ConstructorJobProgress job={{ ...job, continuity: undefined }} />)
    expect(html).toContain('progres nemăsurat')
    expect(html).not.toContain('value=')
  })
  it('does not show 100 without exact deployment proof', () => {
    const progress = { ...job.continuity!.progress, percent: 100 }
    const unverified = { ...job, continuity: { ...job.continuity!, progress } }
    expect(renderToStaticMarkup(<ConstructorJobProgress job={unverified} />)).not.toContain('value="100"')
    const commit = 'a'.repeat(40)
    const verified: BuildJobRow = { ...unverified, status: 'done', continuity: {
      ...unverified.continuity!, state: 'completed', finalProof: { complete: true, commit, liveVersion: commit },
    } }
    expect(renderToStaticMarkup(<ConstructorJobProgress job={verified} />)).toContain('value="100"')
  })
  it('keeps failure and cancellation visibly terminal', () => {
    expect(renderToStaticMarkup(<ConstructorJobProgress job={{ ...job, status: 'failed' }} />)).toContain('Oprit cu eroare')
    expect(renderToStaticMarkup(<ConstructorJobProgress job={{ ...job, status: 'cancelled' }} />)).toContain('Anulat explicit')
  })
  it('rerenders newer reported actions and exact timestamps while the same job remains at 3/8 milestones', () => {
    let previousCount: number | undefined
    let previousAt: string | undefined
    for (const [count, at] of [[19, '2026-09-05T11:10:00.123Z'], [40, '2026-09-05T11:10:10.456Z'], [42, '2026-09-05T11:10:20.789Z']] as const) {
      const html = renderToStaticMarkup(<ConstructorJobProgress job={workingSnapshot(count, at)} />)
      expect(html).toContain('value="37"')
      expect(html).toContain('3/8 etape confirmate')
      expect(html).toContain('Ultimul raport al executorului')
      expect(html).toContain('Status raportat: în lucru.')
      expect(html).toContain(`Comandă executată; ${count} unelte terminate și confirmate`)
      expect(html).toContain(`dateTime="${at}"`)
      expect(html).toContain(`title="${at}"`)
      expect(html).toContain(`${at.slice(14, 23)} BST (Europe/London)</time>`)
      expect(html).toContain('Execuția AI: procent necunoscut')
      expect(html).toContain('aria-live="polite"')
      expect(html.match(/<progress\b/g)).toHaveLength(1)
      if (previousCount) expect(html).not.toContain(`${previousCount} unelte`)
      if (previousAt) expect(html).not.toContain(previousAt)
      previousCount = count; previousAt = at
    }
  })
  it('advances the bar only with a new confirmed milestone, not an increased tool count', () => {
    const working = workingSnapshot(42, '2026-09-05T11:10:20.789Z')
    const next: BuildJobRow = { ...working, constructorStage: 'handoff', progress: 'Handoff publicat; porțile locale sunt verificate', continuity: {
      ...working.continuity!, progress: { ...working.continuity!.progress, percent: 50, completed: 4, currentStage: 'Handoff confirmat' },
    } }
    const html = renderToStaticMarkup(<ConstructorJobProgress job={next} />)
    expect(html).toContain('value="50"')
    expect(html).toContain('4/8 etape confirmate')
    expect(html).toContain('Handoff confirmat')
    expect(html).toContain(next.progress!)
    expect(html).not.toContain('42 unelte')
    expect(html).not.toContain('Execuția AI: procent necunoscut')
    expect(html).not.toContain('value="100"')
  })
  it.each(['failed', 'cancelled'] as const)('removes live activity when the same job becomes %s without reusing an old success label', (status) => {
    const working = workingSnapshot(42, '2026-09-05T11:10:20.789Z')
    expect(renderToStaticMarkup(<ConstructorJobProgress job={working} />)).toContain('Status raportat: în lucru.')
    const stopped: BuildJobRow = { ...working, status, progress: 'Execuția s-a oprit; nu există dovadă de deploy' }
    const html = renderToStaticMarkup(<ConstructorJobProgress job={stopped} />)
    expect(html).toContain(status === 'failed' ? 'Oprit cu eroare' : 'Anulat explicit')
    expect(html).toContain(stopped.progress!)
    expect(html).toContain('value="37"')
    expect(html).not.toContain('ACTIVITATE LIVE')
    expect(html).not.toContain('Status raportat: în lucru.')
    expect(html).not.toContain('42 unelte')
    expect(html).not.toContain('Deploy live verificat')
    expect(html).not.toContain('value="100"')
  })
  it('advances heartbeat independently while the canonical event, tool count and milestones remain unchanged, in explicit winter GMT', () => {
    const oldAt = '2026-01-05T11:10:20.000Z'
    const heartbeatAt = '2026-01-05T11:10:30.456Z'
    const running = workingSnapshot(42, oldAt)
    const withCard: BuildJobRow = { ...running, updatedAt: '2026-01-05T11:10:31.000Z', workCard: {
      id: 'constructor:7', canonicalLink: '#constructor-work-card-7', objective: job.orderText,
      acceptanceCriteria: [], contextLinks: [], owner: null, actor: null, plan: [], currentStep: 'working', status: 'running',
      progress: running.continuity!.progress, heartbeatAt, activity: running.continuity!.activity,
      decisions: [], approvals: [], risks: [], dependencies: [], escalationCondition: '', finalResult: null,
      evidence: { eventCount: 42, prUrl: null, ci: null, commit: null, liveVersion: null }, closure: { resolved: false, closedAt: null },
    } }
    const html = renderToStaticMarkup(<ConstructorJobProgress job={withCard} />)
    expect(html).toContain(`dateTime="${heartbeatAt}"`)
    expect(html).toContain('11:10:30.456 GMT (Europe/London)')
    expect(html).toContain(`Ultimul eveniment canonic: Progres raportat de executor · <time dateTime="${oldAt}"`)
    expect(html).toContain(`Semnal raportat la <time dateTime="${heartbeatAt}"`)
    expect(html).not.toContain(withCard.updatedAt)
    expect(html).not.toContain('ACTIVITATE LIVE')
    const nextHeartbeat = '2026-01-05T11:11:15.456Z'
    const next = renderToStaticMarkup(<ConstructorJobProgress job={{ ...withCard, workCard: { ...withCard.workCard!, heartbeatAt: nextHeartbeat } }} />)
    expect(next).toContain(`Semnal raportat la <time dateTime="${nextHeartbeat}"`)
    expect(next).toContain(`Ultimul eveniment canonic: Progres raportat de executor · <time dateTime="${oldAt}"`)
    expect(next).toContain('42 unelte terminate și confirmate')
    expect(next).toContain('value="37"')
    expect(next).toContain('3/8 etape confirmate')
    expect(next).toContain('Un semnal nou nu dovedește o acțiune nouă.')
    expect(next).not.toContain(heartbeatAt)
    expect(next).not.toContain('Ultima activitate confirmată')
  })
  it('shows missing activity and unknown timestamp without inventing tool counts or refreshing the snapshot clock', () => {
    const empty: BuildJobRow = { ...job, progress: null, updatedAt: '2026-09-05T11:10:31.000Z' }
    const html = renderToStaticMarkup(<ConstructorJobProgress job={empty} />)
    expect(html).toContain('Nicio activitate detaliată publicată.')
    expect(html).toContain('Momentul ultimului eveniment canonic nu este disponibil.')
    expect(html).toContain('Ora actualizării raportului nu este disponibilă.')
    expect(html).not.toContain('<time')
    expect(html).not.toContain('ACTIVITATE LIVE')
    expect(html).not.toContain('0 unelte')
    expect(html).not.toContain(empty.updatedAt)
    const invalid = renderToStaticMarkup(<ConstructorJobProgress job={{ ...job, updatedAt: 'invalid' }} />)
    expect(invalid).toContain('Ora actualizării raportului nu este disponibilă.')
    expect(invalid).not.toContain('Invalid Date')
  })
})
