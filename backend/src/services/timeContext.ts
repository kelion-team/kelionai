// Formatarea OREI reale a dispozitivului (nowIso + fus orar) într-un text uman
// citibil — folosită IDENTIC de chat.ts și realtime.ts pentru ancora de timp
// (fix „bună seara" dimineața, §3). Sursă UNICĂ, ca cele două să nu diveargă
// (principiul permanent: unic, fără duplicate). Întoarce null dacă nowIso lipsește
// sau e invalid — apelantul sare peste blocul de timp. Textul de instrucțiuni din
// jur rămâne al fiecărei rute (engleză la chat, română la voce); AICI e doar
// formatarea comună, care era copiată în ambele.
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
