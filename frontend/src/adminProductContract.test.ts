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

  it('keeps Codex login in the private worker and never renders server setup secrets', () => {
    const admin = source('components/admin/AdminProductie.tsx')
    expect(admin).toContain('codex login --with-api-key')
    expect(admin).toContain('openai-project-key')
    expect(admin).not.toContain('{codex.setupInstructions}')
    expect(admin).not.toMatch(/Conectează Codex|connectUrl|Codex.*OAuth/i)
    expect(admin).toContain('Aceeași cheie OpenAI project-scoped')
    expect(admin).toContain('cheia admin de control-plane nu este folosită aici')
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
