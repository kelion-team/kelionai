import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

describe('Google OAuth Scopes (D3)', () => {
  it('includes YouTube Personal scopes and Google Photos Picker scope in FULL_SCOPES', () => {
    const authPath = join(__dirname, 'auth.ts')
    const content = readFileSync(authPath, 'utf-8')

    expect(content).toContain('https://www.googleapis.com/auth/youtube')
    expect(content).toContain('https://www.googleapis.com/auth/youtube.upload')
    expect(content).toContain('https://www.googleapis.com/auth/photospicker.mediaitems.readonly')
  })
})
