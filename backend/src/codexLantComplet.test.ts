import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const aici = dirname(fileURLToPath(import.meta.url))
const cod = (rel: string): string => readFileSync(join(aici, rel), 'utf8')

describe('lanțul unic Admin → Codex worker → gates → master → live', () => {
  it('web-ul doar pune ordinul validat în DB și întoarce același jobId', () => {
    const route = cod('routes/constructor.ts')
    expect(route).toMatch(/evalueazaOrdin\(order\)[\s\S]{0,1000}createBuildJob\(user\.email, orderCuPlan\)/)
    expect(route).toContain("jobId: String(id)")
    expect(route).not.toContain('/api/constructor/tool')
  })

  it('workerul are HMAC fix cu replay durabil, fără shell/repo/credentiale Codex', () => {
    const worker = cod('services/codexWorker.ts')
    const auth = cod('services/constructorServiceAuth.ts')
    const pipeline = cod('services/constructorPipeline.ts')
    expect(auth).toContain("createHmac('sha256'")
    expect(auth).toContain("headerPrefix: 'x-codex'")
    expect(auth).toContain("'constructor-publisher'")
    expect(auth).toContain("'constructor-release'")
    expect(pipeline).toContain('constructor_service_nonces')
    expect(pipeline).toContain('ON CONFLICT DO NOTHING')
    expect(auth).not.toContain('seenNonces')
    expect(worker).not.toMatch(/from ['"]node:child_process['"]|\bexecFile\s*\(|\bspawn\s*\(/)
    expect(worker).not.toMatch(/GITHUB_TOKEN|OPENAI_ADMIN_KEY/)
  })

  it('claim și lifecycle sunt legate de jobId + taskId', () => {
    const route = cod('routes/constructor.ts')
    const db = cod('db.ts')
    expect(route).toContain("'/api/internal/codex/jobs/claim'")
    expect(route).toContain("'/api/internal/codex/jobs/:id/event'")
    expect(db).toContain('claimNextBuildJob(codexTaskId')
    expect(db).toContain('advanceCodexBuildJob')
    expect(db).toMatch(/codex_task_id=\$2/)
  })

  it('worker, publisher și release au tranziții și identități separate', () => {
    const pipeline = cod('services/constructorPipeline.ts')
    const route = cod('routes/constructor.ts')
    const workerEvent = route.slice(
      route.indexOf("'/api/internal/codex/jobs/:id/event'"),
      route.indexOf("'/api/internal/constructor-publisher/jobs/claim'"),
    )
    expect(workerEvent).not.toMatch(/event === 'pr_opened'|event === 'merged'|event === 'deployed'/)
    expect(pipeline).toMatch(/constructor_stage !== 'gates_passed'/)
    expect(pipeline).toMatch(/constructor_stage !== 'pr_opened'/)
    expect(pipeline).toMatch(/constructor_stage !== 'merged'/)
    expect(route).toContain('verifyPublisherRequest')
    expect(route).toContain('verifyReleaseRequest')
    expect(route).toMatch(/event === 'deployed'[\s\S]{0,700}liveVersion/)
  })

  it('rezultatul păstrează jobId, status, commit și liveVersion până în chat/panou', () => {
    const route = cod('routes/constructor.ts')
    const chat = cod('routes/chat.ts')
    expect(route).toMatch(/jobId: String\(job\.id\), status: job\.status, stage: job\.constructorStage, commit: job\.commit, liveVersion: job\.liveVersion/)
    expect(chat).toMatch(/jobId[\s\S]{0,400}status[\s\S]{0,400}commit[\s\S]{0,400}liveVersion/)
  })

  it('procesul web nu pornește autonomie din documente sau agenți de repo', () => {
    const index = cod('index.ts')
    expect(index).not.toContain('startAutonomie')
    expect(index).not.toMatch(/runSelfHeal|pornesteIscoadele|pornestePietarul|ruleazaSantinelaPR/)
  })
})
