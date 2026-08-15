import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

describe('Cerința #36 - Admin bar language switcher and options', () => {
  it('scripts/admin-bar-preview.html exists and contains admin bar language options', () => {
    const previewPath = join(__dirname, '../../scripts/admin-bar-preview.html')
    expect(existsSync(previewPath)).toBe(true)

    const content = readFileSync(previewPath, 'utf8')
    expect(content).toContain('class="admin-bar"')
    expect(content).toContain('class="lang-dropdown-menu"')
    expect(content).toContain('Opțiuni Schimbare Limbă')
    expect(content).toContain('ro-RO')
    expect(content).toContain('en-US')
    expect(content).toContain('fr-FR')
    expect(content).toContain('de-DE')
    expect(content).toContain('es-ES')
    expect(content).toContain('it-IT')
  })
})
