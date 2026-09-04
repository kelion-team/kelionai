import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ADMIN_TABS, isAdminTab } from './lib/admin'

const here = dirname(fileURLToPath(import.meta.url))
const source = (path: string): string => readFileSync(join(here, path), 'utf8')

describe('admin product contract', () => {
  it('keeps every implemented section reachable from one canonical tab registry', () => {
    expect(ADMIN_TABS).toEqual([
      'finance',
      'users',
      'share',
      'stores',
      'inbox',
      'gesturi',
      'tokenuri',
      'constructor',
      'recuperare',
      'sistem',
      'erori',
      'notificari',
      'creier',
    ])
    expect(isAdminTab('notificari')).toBe(true)
    expect(isAdminTab('unknown')).toBe(false)
    expect(source('components/AdminPanel.tsx')).toContain('ADMIN_TABS.map((tabId)')
    expect(source('pages/Stage.tsx')).toContain('if (isAdminTab(sec)) setAdminTab(sec)')
  })

  it('presents the Constructor as OpenCode plus local Qwen on build_jobs', () => {
    const admin = source('components/admin/AdminProductie.tsx')
    expect(admin).toContain('Constructor — OpenCode + Qwen local (llama.cpp)')
    expect(admin).toContain("constructorWorker.queue ?? 'build_jobs'")
    expect(admin).not.toMatch(/codex login|openai-project-key|Conectează Codex|connectUrl|Codex.*OAuth|chatgpt\.com\/codex/i)
    expect(admin).not.toMatch(/ai\.bec|credit necunoscut/)
    expect(admin).toContain("adminBilling.creditsUsed")
    expect(admin).not.toMatch(/·\s*0\s+credite consumate/i)
  })

  it('keeps Constructor model selection explicit, manual and fail-closed', () => {
    const admin = source('components/admin/AdminProductie.tsx')
    const api = source('lib/admin.ts')
    const contract = source('lib/adminConstructorContract.ts')
    expect(admin).toContain('A.constructorModelManualHint')
    expect(admin).toContain("(['fast', 'powerful'] as const)")
    expect(admin).toContain('onClick={() => selectConstructorModel(profile.id)}')
    expect(admin).toContain('aria-pressed={active}')
    expect(admin).toContain("constructorModelSnapshot.state === 'switching'")
    const handlerGuard = admin.slice(
      admin.indexOf('const selectConstructorModel ='),
      admin.indexOf('setConstructorModelBusy(true)'),
    )
    expect(handlerGuard).toContain("constructorModel.state !== 'ready'")
    const buttonGuard = admin.slice(
      admin.indexOf('const disabled = constructorModelBusy'),
      admin.indexOf('return (', admin.indexOf('const disabled = constructorModelBusy')),
    )
    expect(buttonGuard).toContain("constructorModelSnapshot.state !== 'ready'")
    expect(api).toContain("apiFetch('/api/admin/constructor/model'")
    expect(api).toContain('body: JSON.stringify({ profile })')
    expect(contract).toContain("value.mode !== 'manual'")
    expect(contract).toContain("value.defaultProfile !== 'fast'")
    expect(admin.match(/switchConstructorModelAdmin/g)).toHaveLength(2)
  })

  it('recomandă powerful numai din verdictul explicit fast-unresolved, fără acțiune automată', () => {
    const admin = source('components/admin/AdminProductie.tsx')
    const outcomeStart = admin.indexOf('j.continuity?.modelOutcome')
    const outcomeEnd = admin.indexOf('{j.workCard &&', outcomeStart)
    const outcomeUi = admin.slice(outcomeStart, outcomeEnd)
    expect(outcomeStart).toBeGreaterThan(0)
    expect(outcomeEnd).toBeGreaterThan(outcomeStart)
    expect(outcomeUi).toContain("outcome.result === 'technical_failure'")
    expect(outcomeUi).toContain('outcome.manualRecommendation')
    expect(outcomeUi).toContain('A.constructorOutcomeManualRecommendation')
    expect(outcomeUi).toContain('A.constructorOutcomeTechnicalNoModelAdvice')
    expect(outcomeUi).toContain('A.constructorOutcomeNoOtherModel')
    expect(outcomeUi).toContain('href="#constructor-model-control-title"')
    expect(outcomeUi).not.toMatch(/selectConstructorModel|switchConstructorModelAdmin|retryBuildOrder|apiFetch/)
    const text = source('lib/adminText.ts')
    expect(text).toContain('comută manual la ${profile}, apoi folosește explicit Reia')
    expect(text).toContain('ciclu POWERFUL este terminal și nu recomandă Reia sau un model superior')
    expect(text).toContain('verdict tehnic nu recomandă alt model sau Reia')
  })

  it('distinguishes active signed-webhook settlement from fail-closed setup state', () => {
    const admin = source('components/admin/AdminBani.tsx')
    expect(admin).toContain("paymentCollection?.status === 'active'")
    expect(admin).toContain("'setup_required'")
    expect(admin).toContain('creditarea se face automat numai după webhook-ul')
    expect(admin).toContain('nu există credit anticipat sau verificare manuală')
  })

  it('renders both OpenAI provider period bounds in UTC', () => {
    const admin = source('components/admin/AdminBani.tsx')
    expect(admin).toContain("new Date(finance.providerOpenAI.period.start).toLocaleString('ro-RO', { timeZone: 'UTC' })")
    expect(admin).toContain("new Date(finance.providerOpenAI.period.end).toLocaleString('ro-RO', { timeZone: 'UTC' })")
  })

  it('afișează numai scara automată OpenAI, fără ramuri custom retrase', () => {
    const admin = source('components/admin/AdminProductie.tsx')
    const contract = source('lib/admin.ts')
    expect(admin).toContain('Provider: <b>OpenAI</b> · selecție automată')
    expect(admin).toContain('Catalog OpenAI: {creier.catalogEroare}')
    expect(admin).toContain("model.validat ? '✓' : '⚠'")
    expect(`${admin}\n${contract}`).not.toMatch(/modelCustom|isCustom/)
  })
})
