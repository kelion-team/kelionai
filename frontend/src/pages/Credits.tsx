// THE PUBLIC CREDITS PAGE (Adrian, Jul 26: "dedicated page for... buying
// credits... including being able to create and buy"). Visible EVEN without
// an account — transparent prices before registration. "Buy" → if not logged
// in, we take them to /login; if logged in, it starts payment through
// /api/billing/checkout (the same path as the wallet pill in the app —
// Revolut link + unique code).
import React, { useEffect, useState } from 'react'
import { PUBLIC_TEXT as T } from '../lib/publicText'
import BackLink from '../components/BackLink'

const CREDITS_PER_POUND = 7.5
// The first top-up has a £20 minimum on the server — the packs start at £20 so
// no public button should fall on this rule.
const PACKS = [20, 30, 50]

export default function Credits(): React.JSX.Element {
  const [signedIn, setSignedIn] = useState<boolean | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(0)

  useEffect(() => {
    void fetch('/auth/me', { credentials: 'include' })
      .then((r) => setSignedIn(r.ok))
      .catch(() => setSignedIn(false))
  }, [])

  const buy = async (amount: number): Promise<void> => {
    if (!signedIn) {
      window.location.href = '/login'
      return
    }
    setBusy(amount)
    setErr('')
    try {
      const r = await fetch('/api/billing/checkout', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ amount }),
      })
      const j = (await r.json().catch(() => ({}))) as { url?: string; error?: string }
      if (j.url) window.location.href = j.url
      else setErr(j.error ?? T.errPaymentStart)
    } finally {
      setBusy(0)
    }
  }

  return (
    <div className="login-page">
      <div className="login-card credits-card">
        <BackLink />
        <a className="login-brand" href="/">Kelionai</a>
        <h2 className="login-title">{T.creditsTitle}</h2>
        <p className="credits-blurb">
          {T.creditsBlurb} {T.creditsRate(CREDITS_PER_POUND)}
        </p>
        {PACKS.map((p) => (
          <button key={p} type="button" className="credits-pack" disabled={busy === p} onClick={() => void buy(p)}>
            <span className="credits-pack-n">{T.creditsUnit(Math.floor(p * CREDITS_PER_POUND))}</span>
            <span className="credits-pack-price">£{p}</span>
          </button>
        ))}
        {err && <div className="login-note">{err}</div>}
        {signedIn === false && (
          <div className="login-note">{T.creditsSignInFirst}</div>
        )}
        <div className="login-legal">
          <a href="/login">{T.accountLink}</a> · <a href="/privacy">{T.privacyLink}</a> · <a href="/terms">{T.termsLink}</a>
        </div>
      </div>
    </div>
  )
}
