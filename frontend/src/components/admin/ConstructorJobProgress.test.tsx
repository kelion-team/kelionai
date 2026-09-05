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
})
