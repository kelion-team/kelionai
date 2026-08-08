// ── BACK TO THE PREVIOUS PAGE ─────────────────────────────────────────────
//
// Adrian, Jul 30: "the panels must have a back button to the previous page".
// Until now, once on /login or /credite, the only way out was the logo (which
// always goes to the start page, not where you came from) or the browser
// button — which on the installed app, in a chromeless window, doesn't even exist.
//
// A single component for all pages (the permanent principle: unique, no
// duplicates). It goes back EXACTLY where you came from if this tab has
// history; otherwise it falls back to the start page, so it never leads nowhere.
// The label follows the UI language (audit Aug 2: it was a hardcoded English
// 'Back' on every screen; the dead `label` prop that nobody ever passed is gone).
import React from 'react'
import { uiStrings } from '../lib/i18n'

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
    // history.length > 1 = we got here from another page in this tab.
    // Opened directly from a link/bookmark → there is no "back", we go home.
    if (window.history.length > 1) window.history.back()
    else window.location.href = '/'
  }
  return (
    <button type="button" className="back-link" onClick={inapoi} aria-label={label}>
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M19 12H5M12 19l-7-7 7-7" />
      </svg>
      <span>{label}</span>
    </button>
  )
}
