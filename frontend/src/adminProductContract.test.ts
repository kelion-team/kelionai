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
