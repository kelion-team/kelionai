import { describe, expect, it } from 'vitest'
import { oauthFailureRedirect, oauthSuccessRedirect, safeReturnPath } from './authNavigation.js'

describe('browser OAuth callback navigation', () => {
  const app = 'https://kelionai.app'

  it('returns a successful login only to an approved in-app route', () => {
    expect(oauthSuccessRedirect(app, '/credite')).toBe('https://kelionai.app/credite')
    expect(oauthSuccessRedirect(app, 'https://attacker.example')).toBe('https://kelionai.app/')
    expect(oauthSuccessRedirect(app, '//attacker.example')).toBe('https://kelionai.app/')
    expect(safeReturnPath('/auth/google/callback')).toBe('/')
  })

  it('sends callback failures to a visible login-and-retry page, never a blank callback route', () => {
    expect(oauthFailureRedirect(app, 'bad_state')).toBe(
      'https://kelionai.app/login?error=oauth_failed&reason=bad_state',
    )
  })
})
