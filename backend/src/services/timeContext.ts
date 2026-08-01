// The formatting of the device's REAL time (nowIso + timezone) into a
// human-readable text — used IDENTICALLY by chat.ts and realtime.ts for the
// time anchor (the "good evening in the morning" fix, §3). SINGLE source, so
// the two don't diverge (the permanent principle: unique, no duplicates).
// Returns null if nowIso is missing or invalid — the caller skips the time
// block. The instruction text around it stays with each route (English in
// chat, Romanian in voice); HERE is only the shared formatting, which used
// to be copied in both.
export function formatDeviceTime(nowIso: unknown, tz: unknown): { human: string; tzName: string } | null {
  if (typeof nowIso !== 'string' || Number.isNaN(Date.parse(nowIso))) return null
  const tzName = typeof tz === 'string' && tz ? tz : 'UTC'
  let human: string
  try {
    human = new Date(nowIso).toLocaleString('en-GB', {
      timeZone: tzName,
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    human = new Date(nowIso).toUTCString()
  }
  return { human, tzName }
}
