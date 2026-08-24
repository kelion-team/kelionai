import { replaceControlCharacters } from './textSanitization.js'

const URL_PATTERN = /https?:\/\/[^\s<>"']+/gi

export function sanitizeDiagnosticUrl(raw: string): string {
  try {
    const url = new URL(raw)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return '[url-redacted]'
    return `${url.origin}${url.pathname}`.slice(0, 400)
  } catch {
    return ''
  }
}

/** One redaction contract for browser and server diagnostics. */
export function redactDiagnostic(raw: unknown, maxChars = 800): string {
  let value = replaceControlCharacters(String(raw ?? ''), ' ', true)
  value = value
    .replace(/data:[^;,\s]+;base64,[A-Za-z0-9+/=_-]{16,}/gi, '[data-url-redacted]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]{8,}/gi, 'Bearer [redacted]')
    .replace(/\bsk-(?:proj-|admin-)?[A-Za-z0-9_-]{8,}/gi, '[api-key-redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[jwt-redacted]')
    .replace(/\b(password|passwd|secret|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|token|authorization)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .replace(/[A-Z]:\\Users\\[^\\\s]+/gi, '[user-home]')
    .replace(/\b[^\s@]+@[^\s@]+\.[A-Za-z]{2,}\b/g, '[email-redacted]')
    .replace(/\b(?:\d[ -]*?){13,19}\b/g, '[long-number-redacted]')
    .replace(URL_PATTERN, (candidate) => sanitizeDiagnosticUrl(candidate.replace(/[),.;]+$/, '')) || '[url-redacted]')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[ip-redacted]')
    .replace(/\b(?:[A-F0-9]{1,4}:){2,7}[A-F0-9]{0,4}\b/gi, '[ip-redacted]')
    .replace(/\s+/g, ' ')
    .trim()
  return value.slice(0, Math.max(1, Math.min(2_000, maxChars)))
}
