import { nativeChannelTicket } from './nativeAuth'

declare global {
  interface Window {
    __KELION_API_ORIGIN__?: string
  }
}

function validOrigin(raw: string | null | undefined): string | null {
  if (!raw) return null
  try {
    const u = new URL(raw)
    if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.username || u.password) return null
    return u.origin
  } catch {
    return null
  }
}

function runtimeOrigin(): string | null {
  if (typeof window === 'undefined') return null
  const globalOrigin = validOrigin(window.__KELION_API_ORIGIN__)
  if (globalOrigin) return globalOrigin
  return validOrigin(document.querySelector<HTMLMetaElement>('meta[name="kelion-api-origin"]')?.content)
}

export function apiUrl(path: string, origin = runtimeOrigin()): string {
  if (/^https?:\/\//i.test(path)) {
    const target = new URL(path)
    const allowed = origin ?? (typeof location !== 'undefined' ? location.origin : null)
    const allowedOrigin = validOrigin(allowed)
    if (target.username || target.password || !allowedOrigin || target.origin !== allowedOrigin) {
      throw new Error('API URL origin is not allowed')
    }
    return target.toString()
  }
  if (!path.startsWith('/') || path.startsWith('//')) throw new Error('API path must be absolute')
  // URL tratează și backslash-ul ca separator de host în unele cazuri. Îl
  // rezolvăm întâi pe un origin santinelă și refuzăm orice ieșire de pe el.
  const santinela = new URL('https://kelion.invalid')
  const relativ = new URL(path, santinela)
  if (relativ.origin !== santinela.origin) throw new Error('API path origin is not allowed')
  const caleNormalizata = `${relativ.pathname}${relativ.search}${relativ.hash}`
  if (!origin) return caleNormalizata
  const allowedOrigin = validOrigin(origin)
  if (!allowedOrigin) throw new Error('API origin is invalid')
  return new URL(caleNormalizata, allowedOrigin).toString()
}

export function authUrl(path: string, origin = runtimeOrigin()): string {
  return apiUrl(path, origin)
}

export function wsUrl(path: string, origin = runtimeOrigin()): string {
  const base = origin ?? (typeof location !== 'undefined' ? location.origin : null)
  if (/^wss?:\/\//i.test(path)) {
    const target = new URL(path)
    const allowedOrigin = validOrigin(base)
    if (!allowedOrigin || target.username || target.password) {
      throw new Error('WebSocket URL origin is not allowed')
    }
    const allowed = new URL(allowedOrigin)
    const protocol = allowed.protocol === 'https:' ? 'wss:' : 'ws:'
    if (target.protocol !== protocol || target.host !== allowed.host) {
      throw new Error('WebSocket URL origin is not allowed')
    }
    return target.toString()
  }
  const httpUrl = apiUrl(path, base)
  if (!base) return httpUrl
  const u = new URL(httpUrl)
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:'
  return u.toString()
}

export function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(apiUrl(path), { credentials: 'include', ...init })
}

export async function openApiWebSocket(path: string, audience: 'vocal-live' | 'apel'): Promise<WebSocket> {
  const ticket = await nativeChannelTicket(audience)
  return ticket
    ? new WebSocket(wsUrl(path), ['kelion-native', `kelion-ticket.${ticket}`])
    : new WebSocket(wsUrl(path))
}

export async function consumeApiEventStream(
  path: string,
  onMessage: (data: string) => void,
  signal: AbortSignal,
): Promise<void> {
  const response = await apiFetch(path, { headers: { accept: 'text/event-stream' }, signal })
  if (!response.ok || !response.body) throw new Error(`event_stream_${response.status}`)
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let pending = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      pending += decoder.decode(value, { stream: !done }).replaceAll('\r\n', '\n')
      let boundary = pending.indexOf('\n\n')
      while (boundary >= 0) {
        const event = pending.slice(0, boundary)
        pending = pending.slice(boundary + 2)
        const data = event.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n')
        if (data) onMessage(data)
        boundary = pending.indexOf('\n\n')
      }
      if (done) break
    }
  } finally {
    reader.releaseLock()
  }
}
