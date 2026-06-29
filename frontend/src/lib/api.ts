export interface User {
  email: string
  name: string
  picture: string
  role: 'admin' | 'customer'
  locale: string
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

export async function logout(): Promise<void> {
  await fetch('/auth/logout', { method: 'POST', credentials: 'include' })
  window.location.href = '/'
}
