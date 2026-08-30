import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const constructorClient = readFileSync(new URL('./ConstructorDesktopApp.tsx', import.meta.url), 'utf8')
const constructorPanel = readFileSync(new URL('./components/admin/AdminProductie.tsx', import.meta.url), 'utf8')
  .split('// ── CREIER tab')[0]
const constructorRoute = readFileSync(new URL('../../backend/src/routes/constructor.ts', import.meta.url), 'utf8')
const constructorDb = readFileSync(new URL('../../backend/src/db.ts', import.meta.url), 'utf8')

describe('Kelion Constructor desktop contract', () => {
  it('reuses the canonical Kelion queue UI and authenticated API', () => {
    expect(constructorClient).toContain('AdminConstructor dedicatedClient')
    expect(constructorPanel).toContain("apiFetch('/api/admin/constructor'")
    expect(constructorPanel).toContain("method: 'POST'")
    expect(constructorPanel).toContain("apiFetch('/api/admin/constructor/diagnostic'")
    expect(constructorRoute).toContain("app.post<{ Body: { order?: string } }>('/api/admin/constructor'")
    expect(constructorRoute).toContain('createBuildJob(user.email, orderCuPlan)')
    expect(constructorRoute).toContain("'/api/internal/codex/jobs/claim'")
    expect(constructorRoute).toContain('claimNextBuildJob(taskId)')
    expect(constructorDb).toContain('INSERT INTO build_jobs (ordered_by, order_text)')
    expect(constructorDb).toContain("UPDATE build_jobs SET status='running'")
    expect(constructorPanel).toContain('Worker privat: OpenCode + Qwen local (llama.cpp)')
    expect(constructorPanel).toContain('coada canonică <b>build_jobs</b>')
  })

  it('does not create an SSH, VPS or separate OpenCode-web path', () => {
    expect(`${constructorClient}\n${constructorPanel}`).not.toMatch(/ssh|24096|opencode\s+web|vps/i)
  })
})
