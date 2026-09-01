import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  authNoticeForAuthenticatedUser,
  readAuthNavigation,
  safeAuthReturnPath,
} from './lib/api'

const appSource = readFileSync(fileURLToPath(new URL('./App.tsx', import.meta.url)), 'utf8')
const loginSource = readFileSync(fileURLToPath(new URL('./pages/Login.tsx', import.meta.url)), 'utf8')
const creditsSource = readFileSync(fileURLToPath(new URL('./pages/Credits.tsx', import.meta.url)), 'utf8')

describe('OAuth callback navigation', () => {
  it('preserves the approved credits destination through Login and Google OAuth', () => {
    expect(readAuthNavigation('?next=%2Fcredite').returnTo).toBe('/credite')
    expect(safeAuthReturnPath('https://attacker.example')).toBe('/')
    expect(loginSource).toContain('startGoogleLogin(authNavigation.returnTo)')
    expect(creditsSource.match(/\/login\?next=\/credite/g)?.length).toBe(2)
  })

  it('surfaces incremental-connect failures for an authenticated session', () => {
    const navigation = readAuthNavigation('?error=oauth_failed&reason=token_store')
    expect(authNoticeForAuthenticatedUser(navigation, true)).toContain('could not save')
    expect(authNoticeForAuthenticatedUser(navigation, false)).toBeNull()
    expect(appSource).toContain('authNoticeForAuthenticatedUser(navigation, authenticated)')
    expect(appSource).toContain('role="alert"')
  })

  it('maps closed and blocked to final, actionable outcomes', () => {
    expect(readAuthNavigation('?error=closed').message).toContain('does not have access')
    expect(readAuthNavigation('?error=blocked').message).toContain('retrying will not restore access')
    expect(readAuthNavigation('?error=oauth_failed&reason=blocked').message).toContain(
      'retrying will not restore access',
    )
  })

  it('keeps the captured error after history cleanup while lazy Login mounts', () => {
    const captured = readAuthNavigation('?error=oauth_failed&reason=bad_state')
    expect(readAuthNavigation('').message).toBeNull()
    expect(captured.message).toContain('security check')
    expect(appSource).toContain('readAuthNavigation(window.location.search)')
    expect(appSource).toContain('initialAuthNavigation={initialAuthNavigation}')
    expect(loginSource).toContain('initialAuthNavigation ?? readAuthNavigation(window.location.search)')
  })
})
