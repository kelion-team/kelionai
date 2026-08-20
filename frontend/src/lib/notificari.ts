// ── NOTIFICĂRI LOCALE (mod companion, faza 4) ───────────────────────────────
// Owner (faza 4): la revenirea semnalului + rezolvarea cererilor amânate, anunțăm
// pe telefon, ca omul să știe că Kelion i-a răspuns chiar dacă app-ul e în fundal.
// Notificare LOCALĂ (nu push de server) — merge fără abonament/backend.
//
// Android (Chrome PWA): merge complet, prin `registration.showNotification`.
// iOS/iPad: limitat — doar PWA instalat pe iOS 16.4+, și mai restrictiv în fundal.
// De aceea totul e GUARDED și best-effort: dacă nu se poate, nu blocăm nimic.
//
// NU cerem permisiunea AICI (fluxul de reconectare n-are gest de user, iar unele
// browsere ignoră cererea fără gest). Arătăm DOAR dacă permisiunea e deja dată
// (prin poarta „🔔 Pe telefon" sau promptul browserului). Fără permisiune →
// rămâne anunțul de pe monitor; nimic inventat, nimic forțat (regula #1).

/** Poate arăta notificări ACUM? (API prezent + permisiune dată.) Măsurat. */
function poateNotifica(): boolean {
  return typeof Notification !== 'undefined' && Notification.permission === 'granted'
}

/** Arată o notificare locală, best-effort. No-op tăcut dacă nu se poate. */
export async function anuntaPeTelefon(titlu: string, corp: string): Promise<void> {
  try {
    if (!poateNotifica()) return
    const optiuni: NotificationOptions = { body: corp.slice(0, 240), tag: 'kelion-offline' }
    const reg =
      'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null
    if (reg && typeof reg.showNotification === 'function') await reg.showNotification(titlu, optiuni)
    else new Notification(titlu, optiuni)
  } catch {
    /* notificarea e un plus — nu blocăm niciodată reconectarea pe ea */
  }
}
