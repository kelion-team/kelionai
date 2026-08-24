// ID aleator strict per tab pentru deduplicarea trimiterii voluntare de lead.
// Nu conține semnale de dispozitiv și nu supraviețuiește închiderii sesiunii
// browserului.
const KEY = 'kelion:lead-submission-session'

function randomUuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const h = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

export function submissionSessionId(): string {
  try {
    const existent = sessionStorage.getItem(KEY)
    if (existent) return existent
    const creat = randomUuid()
    sessionStorage.setItem(KEY, creat)
    return creat
  } catch {
    return randomUuid()
  }
}
