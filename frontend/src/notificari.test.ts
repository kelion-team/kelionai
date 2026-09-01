import { describe, it, expect, vi } from 'vitest'
import { anuntaPeTelefon } from './lib/notificari'

// ── NOTIFICĂRI (faza 4) — best-effort, niciodată blocantă ───────────────────
// Nu putem proba o notificare reală în node, dar CONTRACTUL contează: dacă API-ul
// lipsește sau permisiunea nu e dată, funcția NU aruncă și NU forțează nimic
// (iOS/Android fără permisiune → rămâne doar anunțul de pe monitor).

describe('anuntaPeTelefon — guarded, no-op tăcut fără API/permisiune', () => {
  it('fără Notification (ca în node) → nu aruncă, doar iese', async () => {
    // typeof Notification === 'undefined' în node
    await expect(anuntaPeTelefon('Kelion', 'gata')).resolves.toBeUndefined()
  })

  it('cu permisiune REFUZATĂ → nu încearcă să notifice (nu aruncă)', async () => {
    vi.stubGlobal('Notification', function () {} as unknown)
    ;(globalThis as unknown as { Notification: { permission: string } }).Notification.permission = 'denied'
    await expect(anuntaPeTelefon('Kelion', 'gata')).resolves.toBeUndefined()
    vi.unstubAllGlobals()
  })
})
