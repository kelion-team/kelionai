/** Browser OAuth must always finish inside the app.  Keep this deliberately
 * small and route-based: an OAuth `next` is navigation data, never a URL to
 * follow. */
const SAFE_RETURN_PATHS = new Set(['/', '/manual', '/credite', '/credits'])

export function safeReturnPath(raw: unknown): string {
  if (typeof raw !== 'string') return '/'
  const value = raw.trim()
  return SAFE_RETURN_PATHS.has(value) ? value : '/'
}

export function oauthSuccessRedirect(frontendOrigin: string, returnTo: unknown): string {
  return new URL(safeReturnPath(returnTo), frontendOrigin).toString()
}

export function oauthFailureRedirect(frontendOrigin: string, reason: string): string {
  const target = new URL('/login', frontendOrigin)
  // Do not reflect provider text into the app. This is a fixed diagnostic code
  // that the login page can turn into a recoverable, visible message.
  target.searchParams.set('error', 'oauth_failed')
  target.searchParams.set('reason', reason)
  return target.toString()
}
