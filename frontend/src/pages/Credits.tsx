// THE PUBLIC CREDITS PAGE (Adrian, Jul 26: "dedicated page for... buying
// credits... including being able to create and buy"). Visible EVEN without
// an account — transparent prices before registration. "Buy" → if not logged
// in, we take them to /login; if logged in, it starts payment through
// /api/billing/checkout (the same path as the wallet pill in the app —
// Revolut link + unique code).
import React, { useEffect, useState } from 'react'
import { PUBLIC_TEXT as T } from '../lib/publicText'
import { startCheckout, type CheckoutStart } from '../lib/billing'
import BackLink from '../components/BackLink'

const CREDITS_PER_POUND = 7.5
// The first top-up has a £20 minimum on the server — the packs start at £20 so
// no public button should fall on this rule.
const PACKS = [20, 30, 50]

export default function Credits(): React.JSX.Element {
  const [signedIn, setSignedIn] = useState<boolean | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(0)
  // AUTO TOP-UP at payment time (Adrian, Aug 1: "auto-pay selectable with a
  // checkbox when the user pays — can he also set the payment value?"). The
  // same preference as in Settings; saved through the same route.
  const [ar, setAr] = useState<{ enabled: boolean; threshold: number; topupAmount: number } | null>(null)
  const [arSaved, setArSaved] = useState(false)

  useEffect(() => {
    void fetch('/auth/me', { credentials: 'include' })
      .then((r) => {
        setSignedIn(r.ok)
        if (r.ok)
          void fetch('/api/billing/autorecharge', { credentials: 'include' })
            .then((x) => (x.ok ? x.json() : null))
            .then((a) => {
              if (a) setAr({ enabled: !!a.enabled, threshold: Number(a.threshold ?? 20), topupAmount: Number(a.topupAmount ?? 10) })
            })
            .catch(() => {})
      })
      .catch(() => setSignedIn(false))
  }, [])

  const saveAr = (patch: Partial<{ enabled: boolean; topupAmount: number }>): void => {
    if (!ar) return
    const next = { ...ar, ...patch }
    setAr(next)
    void fetch('/api/billing/autorecharge', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(next),
    })
      .then((r) => {
        if (r.ok) {
          setArSaved(true)
          window.setTimeout(() => setArSaved(false), 1500)
        }
      })
      .catch(() => {})
  }

  // THE PAYMENT CODE, SHOWN (M4, Aug 2): this page used to navigate straight
  // to Revolut and throw away the code the whole matching depends on — a
  // payment made that way could never be tied back to the account.
  const [payCode, setPayCode] = useState<CheckoutStart | null>(null)
  const [codeCopied, setCodeCopied] = useState(false)

  const buy = async (amount: number): Promise<void> => {
    if (!signedIn) {
      window.location.href = '/login'
      return
    }
    setBusy(amount)
    setErr('')
    try {
      const r = await startCheckout(amount)
      if (r.ok) {
        setCodeCopied(false)
        setPayCode(r.pay)
      } else {
        setErr(r.error === 'offline' || r.error.startsWith('checkout_http') ? T.errPaymentStart : r.error)
      }
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
        {/* THE CODE, before the money leaves (M4). */}
        {payCode && (
          <div className="pay-code-panel">
            <h3 style={{ margin: '10px 0 4px' }}>{T.payCodeTitle}</h3>
            <div className="pay-code-big">{payCode.code}</div>
            <p className="login-note">{T.payCodeHint}</p>
            <div className="pay-code-actions">
              <button
                type="button"
                className="credits-pack"
                onClick={() => {
                  void navigator.clipboard?.writeText(payCode.code)
                  setCodeCopied(true)
                }}
              >
                {codeCopied ? T.payCodeCopied : T.payCodeCopy}
              </button>
              <button type="button" className="credits-pack" onClick={() => window.open(payCode.url, '_blank', 'noopener')}>
                {T.payCodeOpen}
              </button>
            </div>
            <p className="login-note">⏳ {T.payCodeWaiting}</p>
          </div>
        )}
        {/* AUTO TOP-UP, chosen at payment time: the checkbox + the refill
        value. Only for signed-in users (the preference is per account). */}
        {signedIn === true && ar && (
          <div className="credits-autopay">
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', textAlign: 'left', fontSize: 14 }}>
              <input type="checkbox" checked={ar.enabled} onChange={(e) => saveAr({ enabled: e.target.checked })} />
              <span>{T.autoTopUpLabel}</span>
            </label>
            {ar.enabled && (
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'center', marginTop: 8, fontSize: 14 }}>
                <span>{T.autoTopUpAmount}</span>
                <select value={ar.topupAmount} onChange={(e) => saveAr({ topupAmount: Number(e.target.value) })}>
                  {[5, 10, 20, 50].map((p) => (
                    <option key={p} value={p}>
                      {T.creditsUnit(Math.floor(p * CREDITS_PER_POUND))} — £{p}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {arSaved && <div className="login-note">{T.autoTopUpSaved}</div>}
          </div>
        )}
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
