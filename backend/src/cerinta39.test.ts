import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { LANG_OPTIONS } from '../../frontend/src/lib/langList'

describe('Cerința #39 — Opțiuni schimbare limbă în bara de admin', () => {
  it('LANG_OPTIONS conține limbile principale suportate', () => {
    expect(LANG_OPTIONS.length).toBeGreaterThan(10)
    const codes = LANG_OPTIONS.map((l) => l.code)
    expect(codes).toContain('ro')
    expect(codes).toContain('en')
    expect(codes).toContain('fr')
    expect(codes).toContain('de')
    expect(codes).toContain('es')
  })

  it('scripts/admin-bar-preview.html există și conține selectorul de limbă cu opțiunile', () => {
    const previewPath = path.resolve(__dirname, '../../scripts/admin-bar-preview.html')
    expect(fs.existsSync(previewPath)).toBe(true)
    const htmlContent = fs.readFileSync(previewPath, 'utf-8')
    expect(htmlContent).toContain('admin-bar')
    expect(htmlContent).toContain('Română')
    expect(htmlContent).toContain('English')
    expect(htmlContent).toContain('Français')
  })
})
