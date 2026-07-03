import { useEffect, useState } from 'react'
import { fetchBalance, startCheckout } from '../lib/billing'
import { loadLocalLang } from '../lib/prefs'
import { strings, resolveLang } from '../lib/i18n'

// Customer-facing credit. Shows ONE value — available CREDITS — and a top-up
// menu. Low-credit reminders escalate discreetly (a brief pill, more often as it
// drops; the badge blinks red at ≤5%). All text is in the user's own language.
const AMOUNTS = [5, 10, 20, 50]

export function WalletButton(): React.JSX.Element {
  const t = strings(resolveLang(loadLocalLang() ?? navigator.language))
  const [credits, setCredits] = useState<number | null>(null)
  const [percent, setPercent] = useState(100)
  const [open, setOpen] = useState(false)
  const [toast, setToast] = useState(false)
  const [paywalled, setPaywalled] = useState(false)

  const refresh = async (): Promise<void> => {
    const b = await fetchBalance()
    if (b) {
      setCredits(b.credits)
      setPercent(b.percent)
      if (b.credits > 0) setPaywalled(false)
    }
  }

  useEffect(() => {
    void refresh()
    const onPaywall = (): void => {
      setPaywalled(true)
      setOpen(true)
      void refresh()
    }
    window.addEventListener('kelion:paywall', onPaywall)
    // Returned from a successful top-up — refresh and clean the URL.
    if (new URLSearchParams(window.location.search).get('topup') === 'success') {
      window.history.replaceState({}, '', window.location.pathname)
      setTimeout(() => void refresh(), 1500)
    }
    const poll = window.setInterval(() => void refresh(), 60_000) // keep % fresh
    return () => {
      window.removeEventListener('kelion:paywall', onPaywall)
      clearInterval(poll)
    }
  }, [])

  // Discreet, escalating low-credit reminder: a small pill that appears briefly,
  // more often the lower the credit gets (30% → rare, 10% → frequent). Never a
  // blocking popup.
  useEffect(() => {
    if (credits === null || percent > 30) {
      setToast(false)
      return
    }
    const everyMs = percent <= 10 ? 60_000 : percent <= 20 ? 120_000 : 180_000
    let hide = 0
    const show = (): void => {
      setToast(true)
      hide = window.setTimeout(() => setToast(false), 6000)
    }
    show()
    const id = window.setInterval(show, everyMs)
    return () => {
      clearInterval(id)
      clearTimeout(hide)
      setToast(false)
    }
  }, [percent, credits])

  const critical = percent <= 5 // stays blinking red at the very end
  return (
    <div className="wallet">
      <button
        type="button"
        className={`ghost wallet-badge ${critical ? 'blink-red' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title={t.buyCredit}
      >
        {credits === null ? '…' : `${credits.toLocaleString()} ${t.credits}`}
      </button>
      {(toast || paywalled) && !open && (
        <button type="button" className={`wallet-toast ${critical || paywalled ? 'urgent' : ''}`} onClick={() => setOpen(true)}>
          {paywalled ? t.topUp : t.lowCredit}
        </button>
      )}
      {open && (
        <div className="wallet-menu">
          <span className="wallet-menu-title">{paywalled ? t.topUp : t.buyCredit}</span>
          {AMOUNTS.map((a) => (
            <button key={a} type="button" className="ghost" onClick={() => void startCheckout(a)}>
              £{a}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
