import React, { useEffect, useState, useRef } from 'react'
import { PUBLIC_TEXT as T } from '../lib/publicText'
import { startCheckout, fetchBalance, fetchHistory, CREDITS_PER_POUND, creditsForPounds, type CheckoutStart, type PurchaseRecord, type WalletStatus } from '../lib/billing'
import { raporteazaPagina } from '../lib/vizita'
import BackLink from '../components/BackLink'

export default function Credits(): React.JSX.Element {
  const [signedIn, setSignedIn] = useState<boolean | null>(null)
  const [balance, setBalance] = useState<WalletStatus | null>(null)
  const [history, setHistory] = useState<PurchaseRecord[] | null>(null)
  const [err, setErr] = useState('')
  const [successMsg, setSuccessMsg] = useState('')
  const [busy, setBusy] = useState(0)

  // Custom amount state
  const [customInput, setCustomInput] = useState('')

  // Auto-topup settings
  const [ar, setAr] = useState<{ enabled: boolean; threshold: number; topupAmount: number } | null>(null)
  const [arSaved, setArSaved] = useState(false)

  // Payment code state
  const [payCode, setPayCode] = useState<CheckoutStart | null>(null)
  const [codeCopied, setCodeCopied] = useState(false)

  // Meniul de prețuri al extra-serviciilor — viu de pe server (/api/tarife),
  // aceeași sursă care și taxează. null = necitit/picat → secțiunea nu apare.
  const [tarife, setTarife] = useState<{ cheie: string; eticheta: string; credite: number; lire: number | null }[] | null>(null)
  // LEGEA ANTI-HARDCODARE (16 aug): pragurile alimentării vin din ACELAȘI
  // răspuns — cifra afișată e cifra care validează pe server, nu una de mână.
  const [praguri, setPraguri] = useState<{ primaAlimentare: number; minim: number; pas: number } | null>(null)
  useEffect(() => {
    void fetch('/api/tarife')
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { tarife?: { cheie: string; eticheta: string; credite: number; lire: number | null }[]; praguri?: { primaAlimentare: number; minim: number; pas: number } } | null) => {
        if (Array.isArray(j?.tarife)) setTarife(j.tarife)
        if (j?.praguri && Number.isFinite(j.praguri.pas) && j.praguri.pas > 0) setPraguri(j.praguri)
      })
      .catch(() => {})
  }, [])

  const prevCreditsRef = useRef<number | null>(null)

  // „ce au vizitat" (owner, 13 aug): secțiunea „credite" în raportul de vizite.
  useEffect(() => raporteazaPagina('credite'), [])

  const loadUserData = async (): Promise<void> => {
    const [b, h] = await Promise.all([fetchBalance(), fetchHistory()])
    if (b) {
      if (prevCreditsRef.current !== null && b.credits > prevCreditsRef.current) {
        setPayCode(null)
        setSuccessMsg('Payment received! Your credits have been added to your account.')
      }
      prevCreditsRef.current = b.credits
      setBalance(b)
    }
    if (h) setHistory(h)
  }

  useEffect(() => {
    void fetch('/auth/me', { credentials: 'include' })
      .then((r) => {
        setSignedIn(r.ok)
        if (r.ok) {
          void loadUserData()
          void fetch('/api/billing/autorecharge', { credentials: 'include' })
            .then((x) => (x.ok ? x.json() : null))
            .then((a) => {
              if (a) setAr({ enabled: !!a.enabled, threshold: Number(a.threshold ?? 20), topupAmount: Number(a.topupAmount ?? 10) })
            })
            .catch(() => {})
        }
      })
      .catch(() => setSignedIn(false))
  }, [])

  // Fast poll while waiting for payment code confirmation
  useEffect(() => {
    if (!payCode) return
    const interval = window.setInterval(() => {
      void loadUserData()
    }, 3000)
    return () => clearInterval(interval)
  }, [payCode])

  const firstTopUp = balance ? (balance.firstTopUp ?? true) : true
  // LEGEA ANTI-HARDCODARE (16 aug): pragurile și pachetele se DERIVĂ din
  // cifrele serverului (cu pragurile de azi 20/5/5 ies exact 20/30/50 și
  // 10/20/50); necitite încă = validarea locală tace și decide serverul
  // (răspunsul lui numit ajunge oricum înapoi) — nu se inventează cifre.
  const minAmount = praguri ? (firstTopUp ? praguri.primaAlimentare : praguri.minim) : null
  const PACKS = praguri
    ? firstTopUp
      ? [praguri.primaAlimentare, praguri.primaAlimentare + 2 * praguri.pas, praguri.primaAlimentare + 6 * praguri.pas]
      : [2 * praguri.pas, 4 * praguri.pas, 10 * praguri.pas]
    : []

  const customVal = Number(customInput)
  const isCustomFilled = customInput.trim() !== ''
  let customErr = ''
  if (isCustomFilled) {
    if (!Number.isFinite(customVal) || customVal <= 0) {
      customErr = 'Enter a valid amount.'
    } else if (praguri && customVal % praguri.pas !== 0) {
      customErr = `The amount must be a multiple of £${praguri.pas}.`
    } else if (praguri && minAmount !== null && customVal < minAmount) {
      customErr = firstTopUp ? `Your first top-up must be at least £${minAmount}.` : `The minimum amount is £${minAmount}.`
    }
  }
  const isCustomValid = isCustomFilled && !customErr

  const saveAr = (patch: Partial<{ enabled: boolean; topupAmount: number }>): void => {
    if (!ar) return
    const inainte = ar // pentru revenire dacă serverul refuză
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
        } else {
          // Serverul N-a salvat → NU lăsăm comutatorul să mintă că e aplicat.
          // Revenim la starea de dinainte (audit fake, 20 aug — ca la CustomerSettings).
          setAr(inainte)
        }
      })
      .catch(() => setAr(inainte))
  }

  const buy = async (amount: number): Promise<void> => {
    if (!signedIn) {
      window.location.href = '/login'
      return
    }
    setBusy(amount)
    setErr('')
    setSuccessMsg('')
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

        {balance !== null && (
          <div className="login-note" style={{ marginBottom: 16 }}>
            Current balance: <strong>{balance.credits} credits</strong>
          </div>
        )}

        {/* MENIUL DE PREȚURI (owner, 14 aug: „când userul optează pentru o
            funcție i se arată și prețul, și se încasează… cu profit cu tot").
            Vine VIU de pe server (/api/tarife) — aceeași sursă care taxează;
            citirea picată nu inventează un meniu, secțiunea doar nu apare. */}
        {tarife && tarife.length > 0 && (
          <div className="custom-amount-box" style={{ marginBottom: 16, padding: '12px', border: '1px solid var(--border-color, #e0e0e0)', borderRadius: 8 }}>
            <label style={{ display: 'block', fontSize: 14, fontWeight: 600, marginBottom: 6 }}>
              Extra-service prices (deducted from credits when used)
            </label>
            {tarife.map((t) => (
              <div key={t.cheie} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, padding: '2px 0' }}>
                <span>{t.eticheta}</span>
                <strong>
                  {t.credite} {t.credite === 1 ? 'credit' : 'credits'}
                  {t.lire != null ? ` (£${t.lire.toFixed(2)})` : ''}
                </strong>
              </div>
            ))}
          </div>
        )}

        {/* PRESET PACKS */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
          {PACKS.map((p) => (
            <button key={p} type="button" className="credits-pack" disabled={busy === p} onClick={() => void buy(p)}>
              <span className="credits-pack-n">{T.creditsUnit(creditsForPounds(p))}</span>
              <span className="credits-pack-price">£{p}</span>
            </button>
          ))}
        </div>

        {/* CUSTOM AMOUNT / SUMĂ LIBERĂ */}
        <div className="custom-amount-box" style={{ marginBottom: 16, padding: '12px', border: '1px solid var(--border-color, #e0e0e0)', borderRadius: 8 }}>
          <label style={{ display: 'block', fontSize: 14, fontWeight: 600, marginBottom: 6 }}>
            Custom amount
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="number"
              placeholder={praguri && minAmount !== null ? `£${minAmount}+ (multiplu de £${praguri.pas})` : '£…'}
              value={customInput}
              min={minAmount ?? undefined}
              step={praguri?.pas ?? undefined}
              onChange={(e) => setCustomInput(e.target.value)}
              style={{ flex: 1, padding: '8px 12px', borderRadius: 6, border: '1px solid #ccc' }}
            />
            <button
              type="button"
              className="credits-pack"
              style={{ width: 'auto', padding: '8px 16px', margin: 0 }}
              disabled={!isCustomValid || busy > 0}
              onClick={() => void buy(customVal)}
            >
              Buy £{isCustomValid ? customVal : ''}
            </button>
          </div>
          {customErr && <div className="login-note" style={{ color: '#d32f2f', marginTop: 6 }}>{customErr}</div>}
          {!customErr && praguri && minAmount !== null && (
            <div className="login-note" style={{ fontSize: 12, marginTop: 4 }}>
              * Minimum £{minAmount}, multiples of £{praguri.pas} ({Math.floor(minAmount * CREDITS_PER_POUND)} credits = £{minAmount}).
            </div>
          )}
        </div>

        {/* SUCCESS MESSAGE */}
        {successMsg && <div className="login-note" style={{ color: '#2e7d32', fontWeight: 600, marginBottom: 12 }}>✓ {successMsg}</div>}

        {/* THE REVOLUT CODE DISPLAY & WAITING FOR PAYMENT */}
        {payCode && (
          <div className="pay-code-panel">
            <h3 style={{ margin: '10px 0 4px' }}>{T.payCodeTitle}</h3>
            <div className="pay-code-big">{payCode.code}</div>
            <p className="login-note" style={{ fontWeight: 600, color: '#000' }}>{T.payCodeHint}</p>
            <div className="pay-code-actions">
              <button
                type="button"
                className="credits-pack"
                onClick={() => {
                  // „Copiat" DOAR pe succes (audit fake, 20 aug).
                  const p = navigator.clipboard?.writeText(payCode.code)
                  if (p) void p.then(() => setCodeCopied(true)).catch(() => {})
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

        {/* AUTO TOP-UP */}
        {signedIn === true && ar && (
          <div className="credits-autopay" style={{ marginTop: 16 }}>
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

        {/* TRANSACTION HISTORY */}
        {signedIn === true && history && history.length > 0 && (
          <div style={{ marginTop: 24, textAlign: 'left' }}>
            <h3 style={{ fontSize: 16, marginBottom: 8 }}>Transaction history</h3>
            <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid #eee', borderRadius: 6, fontSize: 13 }}>
              {history.map((h) => (
                <div key={h.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', borderBottom: '1px solid #eee' }}>
                  <div>
                    <div><strong>£{h.amount}</strong> ({h.credits} credits)</div>
                    <div style={{ fontSize: 11, color: '#666' }}>{new Date(h.created_at).toLocaleString('en-GB')} {h.code ? `• ${h.code}` : ''}</div>
                  </div>
                  {/* B2 (marea verificare): DB-ul scrie 'paid' și 'admin_grant' —
                      'completed' nu se scria niciodată, deci plata REUȘITĂ apărea
                      cu tokenul brut, în portocaliul de neterminat. */}
                  {/* + statusurile MOȘTENITE din era Stripe (re-verificatorul B2):
                      tabela n-a fost golită, deci 'succeeded' (plată REUȘITĂ!),
                      'refunded' și 'failed' pot fi vii pe rânduri vechi. */}
                  <div style={{ alignSelf: 'center', fontWeight: 600, color: h.status === 'paid' || h.status === 'admin_grant' || h.status === 'succeeded' ? '#2e7d32' : h.status === 'failed' ? '#d32f2f' : '#f57c00' }}>
                    {h.status === 'paid' || h.status === 'succeeded' ? 'Completed' : h.status === 'admin_grant' ? 'Credit granted' : h.status === 'refunded' ? 'Refunded' : h.status === 'failed' ? 'Failed' : h.status}
                  </div>
                </div>
              ))}
            </div>
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
