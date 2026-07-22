export interface User {
  email: string
  name: string
  picture: string
  role: 'admin' | 'customer'
  locale: string
  // True once the user has granted the heavy Google scopes via "Connect Google"
  // (Gmail, Calendar, Drive, Tasks, Contacts). Login alone no longer grants them.
  googleConnected?: boolean
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

// "Connect Google services": incremental consent for the heavy scopes (Gmail,
// Calendar, Drive, Tasks, Contacts). Only meaningful for a signed-in user; the
// backend redirects to the login page otherwise.
export function startGoogleConnect(): void {
  window.location.href = '/auth/google/connect'
}


export async function logout(): Promise<void> {
  await fetch('/auth/logout', { method: 'POST', credentials: 'include' })
  window.location.href = '/'
}
