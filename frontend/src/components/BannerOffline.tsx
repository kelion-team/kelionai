import { useConectat } from '../lib/conexiune'
import { uiStrings } from '../lib/i18n'

// ── SEMNUL OFFLINE (ordinul owner-ului, 22 aug: „la ofline trebuie sa apara
// semn pilpind cu antena lipsa si atit, cind revine dispare") ────────────────
// Nu mai e bandă cu text — DOAR semnul: o antenă tăiată, care clipește cât
// lipsește semnalul, și dispare singură la revenire. Starea vine din pingul
// REAL la /health (conexiune.ts), nu din minciuna lui navigator.onLine.
// Textul cinstit rămâne pentru cititoarele de ecran (aria-label) și la hover
// (title) — invizibil, deci „și atât" e respectat pe ecran.
export function BannerOffline() {
  const online = useConectat()
  if (online) return null
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={uiStrings().offlineCompanion}
      title={uiStrings().offlineCompanion}
      style={{
        position: 'fixed',
        top: 8,
        right: 10,
        zIndex: 100000,
        lineHeight: 0,
        animation: 'kelionOfflineClipire 1.1s ease-in-out infinite',
        filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.45))',
        pointerEvents: 'none',
      }}
    >
      {/* Antena cu semnul tăiat: arcuri de semnal + catargul antenei, peste
          care trece bara de „lipsă". currentColor nu — culoarea e fixă, să se
          vadă pe orice fundal (portocaliu de avertizare). */}
      <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true">
        <g stroke="#ff9d2e" strokeWidth="1.9" fill="none" strokeLinecap="round">
          {/* catargul antenei */}
          <line x1="12" y1="21" x2="12" y2="11" />
          {/* vârful */}
          <circle cx="12" cy="9.4" r="1.4" fill="#ff9d2e" stroke="none" />
          {/* arcurile de semnal, stânga-dreapta */}
          <path d="M8.4 6.2a5.1 5.1 0 0 0 0 6.4" />
          <path d="M15.6 6.2a5.1 5.1 0 0 1 0 6.4" />
          <path d="M5.8 3.6a9 9 0 0 0 0 11.6" />
          <path d="M18.2 3.6a9 9 0 0 1 0 11.6" />
          {/* bara de „antenă lipsă" */}
          <line x1="4" y1="20" x2="20" y2="4" stroke="#ff4d3d" strokeWidth="2.4" />
        </g>
      </svg>
      {/* Clipirea: definită local ca <style>, ca semnul să nu depindă de un
          rând din index.css pe care o curățenie viitoare l-ar putea scoate. */}
      <style>{`@keyframes kelionOfflineClipire { 0%, 100% { opacity: 1 } 50% { opacity: 0.25 } }`}</style>
    </div>
  )
}
