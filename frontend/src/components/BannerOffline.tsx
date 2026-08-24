import { useConectat } from '../lib/conexiune'
import { uiStrings } from '../lib/i18n'
import { WifiOff } from 'lucide-react'

export function BannerOffline() {
  const online = useConectat()
  if (online) return null
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={uiStrings().offlineCompanion}
      title={uiStrings().offlineCompanion}
      className="offline-indicator"
    >
      <WifiOff size={26} aria-hidden="true" />
    </div>
  )
}
