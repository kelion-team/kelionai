import React from 'react'
import { uiStrings } from '../lib/i18n'
import { ArrowLeft } from 'lucide-react'

export default function BackLink({
  onBack,
}: {
  /** Panels are not pages: "back" means close-me and leave-me where I was.
   *  When given, it decides; otherwise we go back into the page history. */
  onBack?: () => void
}): React.JSX.Element {
  const label = uiStrings().back
  const inapoi = (): void => {
    if (onBack) return onBack()
    if (window.history.length > 1) window.history.back()
    else window.location.href = '/'
  }
  return (
    <button type="button" className="back-link" onClick={inapoi} aria-label={label}>
      <ArrowLeft size={16} aria-hidden="true" />
      <span>{label}</span>
    </button>
  )
}
