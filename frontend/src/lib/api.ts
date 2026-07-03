export interface User {
  email: string
  name: string
  picture: string
  role: 'admin' | 'customer' | 'demo'
  locale: string
  // Free-trial sessions only: epoch-ms when the 3 minutes end (drives the
  // countdown and the conversion overlay).
  demoUntil?: number
}

export interface MeResponse {
  authenticated: boolean
  user?: User
}

export async function fetchMe(): Promise<MeResponse> {
  try {
    const res = await fetch('/auth/me', { credentials: 'include' })
    if (!res.ok) return { authenticated: false }
    return (await res.json()) as MeResponse
  } catch {
    return { authenticated: false }
  }
}

export function startGoogleLogin(): void {
  window.location.href = '/auth/google/login'
}

// Start a free trial. Returns 'ok', or a reason the trial was refused.
// `ref` = document.referrer, so the owner's analytics show which ad brought them.
export async function startDemo(
  fp: string,
  ref = '',
): Promise<'ok' | 'cap_reached' | 'already_used' | 'error'> {
  try {
    const res = await fetch('/api/demo/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ fp, ref }),
    })
    if (res.ok) return 'ok'
    const j = (await res.json().catch(() => ({}))) as { error?: string }
    return j.error === 'cap_reached' ? 'cap_reached' : j.error === 'already_used' ? 'already_used' : 'error'
  } catch {
    return 'error'
  }
}

export async function logout(): Promise<void> {
  await fetch('/auth/logout', { method: 'POST', credentials: 'include' })
  window.location.href = '/'
}
