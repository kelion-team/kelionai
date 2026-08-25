import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Constructor monitor source contract', () => {
  it('renders persisted activity and does not retain cosmetic progress thresholds', () => {
    const source = readFileSync(new URL('./pages/Stage.tsx', import.meta.url), 'utf8')
    expect(source).toContain('j.continuity?.activity')
    expect(source).toContain('j.workCard')
    expect(source).toContain('constructor-work-card-${j.id}')
    expect(source).not.toContain('FAZE_BUILD')
    expect(source).not.toContain('Math.max(2, j.pct)')
  })
})
