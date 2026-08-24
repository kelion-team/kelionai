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

/** ANCORA DE TIMP CARE NU LIPSEȘTE NICIODATĂ (Adrian, 4 aug: „Kelion nu e
 *  înfipt în realitatea spațio-temporală"). Dacă browserul trimite ora reală
 *  a dispozitivului, o folosim (cea mai exactă — ora LUI). Dacă NU (drum vocal,
 *  cerere fără `now`), cădem pe ceasul REAL al serverului, cu fusul primit dacă
 *  există, altfel UTC — ca creierul să știe MEREU în ce clipă trăiește, nu să
 *  rămână fără niciun „acum". */
export function formatNowContext(nowIso: unknown, tz: unknown): { human: string; tzName: string } {
  const alClientului = formatDeviceTime(nowIso, tz)
  if (alClientului) return alClientului
  const tzName = typeof tz === 'string' && tz ? tz : 'UTC'
  return formatDeviceTime(new Date().toISOString(), tzName) ?? { human: new Date().toUTCString(), tzName: 'UTC' }
}
