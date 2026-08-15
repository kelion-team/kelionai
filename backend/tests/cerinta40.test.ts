import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { LANG_OPTIONS } from '../../frontend/src/lib/langList'
import { LANGS } from '../../frontend/src/lib/languages'

describe('Cerința #40 — Opțiuni schimbare limbă în bara de admin și preview monitor', () => {
  it('scripts/admin-bar-preview.html conține structura completă a barei de admin cu opțiunile de limbă expandate', () => {
    const previewPath = join(__dirname, '../../scripts/admin-bar-preview.html')
    expect(existsSync(previewPath)).toBe(true)

    const content = readFileSync(previewPath, 'utf8')
    expect(content).toContain('class="admin-bar"')
    expect(content).toContain('class="lang-dropdown-menu"')
    expect(content).toContain('Română')
    expect(content).toContain('English')
    expect(content).toContain('Français')
    expect(content).toContain('Deutsch')
    expect(content).toContain('Español')
    expect(content).toContain('Italiano')
    expect(content).toContain('Português')
  })

  it('LANG_OPTIONS și LANGS expun corect lista de limbi disponibile pentru interfață și vorbire', () => {
    expect(LANG_OPTIONS.length).toBeGreaterThan(10)
    expect(LANGS.length).toBeGreaterThan(10)

    const optCodes = LANG_OPTIONS.map((o) => o.code)
    expect(optCodes).toContain('ro')
    expect(optCodes).toContain('en')
    expect(optCodes).toContain('fr')
    expect(optCodes).toContain('de')
    expect(optCodes).toContain('es')
  })
})
