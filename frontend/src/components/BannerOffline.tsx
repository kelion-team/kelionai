import { useConectat } from '../lib/conexiune'
import { uiStrings } from '../lib/i18n'

// ── BANNER OFFLINE (mod companion, faza 0) ──────────────────────────────────
// Apare DOAR când chiar nu ajungem la serverul lui Kelion (ping real la /health,
// vezi retea.ts — nu pe minciuna lui navigator.onLine). Strat PUR de afișaj,
// deasupra tuturor; nu atinge nimic din calea online. Textul e multilingv
// (uiStrings().offlineCompanion), cinstit: offline = companion, nu „e stricat".
export function BannerOffline() {
  const online = useConectat()
  if (online) return null
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 100000,
        background: '#7a3b00',
        color: '#fff',
        textAlign: 'center',
        padding: '6px 12px',
        fontSize: 13,
        fontWeight: 600,
        boxShadow: '0 1px 6px rgba(0,0,0,0.35)',
      }}
    >
      ⚑ {uiStrings().offlineCompanion}
    </div>
  )
}
