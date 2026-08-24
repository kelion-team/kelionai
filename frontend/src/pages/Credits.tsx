import React, { useCallback, useEffect, useState, useRef } from 'react'
import { PUBLIC_TEXT as T } from '../lib/publicText'
import {
  startCheckout,
  newCheckoutIdempotencyKey,
  fetchBalance,
  fetchHistory,
  fetchLowCreditReminder,
  saveLowCreditReminder,
  getCreditePeLira,
  setCreditePeLira,
  creditsForPounds,
  pacheteDinPraguri,
  majorToMinor,
  formatMinorMoney,
  paymentStatusPresentation,
  type CheckoutStart,
  type LowCreditReminderConfig,
  type PurchaseRecord,
  type WalletStatus,
} from '../lib/billing'
import { raporteazaPagina } from '../lib/vizita'
import BackLink from '../components/BackLink'
import { apiFetch } from '../lib/transport'

export default function Credits({
  authenticated,
}: {
  readonly authenticated: boolean
}): React.JSX.Element {
  const [balance, setBalance] = useState<WalletStatus | null>(null)
  const [history, setHistory] = useState<PurchaseRecord[] | null | 'loading'>(
    'loading',
  )
  const [err, setErr] = useState('')
  const [successMsg, setSuccessMsg] = useState('')
  const [busy, setBusy] = useState(0)

  // Custom amount state
  const [customInput, setCustomInput] = useState('')

  // Reminder only: never authorizes or performs an automatic debit.
  const [reminder, setReminder] = useState<LowCreditReminderConfig | null>(null)
  const [reminderReadFailed, setReminderReadFailed] = useState(false)
  const [reminderSaved, setReminderSaved] = useState(false)

  const [checkout, setCheckout] = useState<CheckoutStart | null>(null)
  const checkoutAttemptRef = useRef<{
    amountMinor: number
    idempotencyKey: string
  } | null>(null)

  // Meniul de prețuri al extra-serviciilor — viu de pe server (/api/tarife),
  // aceeași sursă care și taxează. null = necitit/picat → secțiunea nu apare.
  const [tarife, setTarife] = useState<
    | {
        cheie: string
        eticheta: string
        credite: number
        lire: number | null
      }[]
    | null
  >(null)

  // răspuns — cifra afișată e cifra care validează pe server, nu una de mână.
  const [praguri, setPraguri] = useState<{
    primaAlimentare: number
    minim: number
    pas: number
  } | null>(null)
  const [pricingState, setPricingState] = useState<
    'idle' | 'loading' | 'ready' | 'error'
  >(authenticated ? 'loading' : 'idle')
  useEffect(() => {
    if (!authenticated) {
      setPricingState('idle')
      setPraguri(null)
      setTarife(null)
      return
    }
    setPricingState('loading')
    void apiFetch('/api/tarife')
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (
          j: {
            tarife?: {
              cheie: string
              eticheta: string
              credite: number
              lire: number | null
            }[]
            praguri?: { primaAlimentare: number; minim: number; pas: number }
            creditePeLira?: number
          } | null,
        ) => {
          const p = j?.praguri
          const rate = j?.creditePeLira
          const valid =
            p &&
            Number.isFinite(p.primaAlimentare) &&
            p.primaAlimentare > 0 &&
            Number.isFinite(p.minim) &&
            p.minim > 0 &&
            Number.isFinite(p.pas) &&
            p.pas > 0 &&
            p.primaAlimentare >= p.minim &&
            typeof rate === 'number' &&
            Number.isFinite(rate) &&
            rate > 0
          if (!valid) {
            setPricingState('error')
            return
          }
          setPraguri(p)
          setCreditePeLira(rate)
          setTarife(Array.isArray(j?.tarife) ? j.tarife : [])
          setPricingState('ready')
        },
      )
      .catch(() => setPricingState('error'))
  }, [authenticated])

  const prevCreditsRef = useRef<number | null>(null)

  useEffect(() => raporteazaPagina('credite'), [])

  const loadUserData = useCallback(async (): Promise<WalletStatus | null> => {
    if (!authenticated) return null
    const b = await fetchBalance()
    setBalance(b)
    if (!b) {
      setHistory(null)
      return null
    }
    if (
      prevCreditsRef.current !== null &&
      b.credits > prevCreditsRef.current
    ) {
      setCheckout(null)
      setSuccessMsg(
        'Payment received! Your credits have been added to your account.',
      )
    }
    prevCreditsRef.current = b.credits
    if (b.scutit) {
      setHistory([])
      return b
    }
    const h = await fetchHistory()
    setHistory(h)
    return b
  }, [authenticated])

  useEffect(() => {
    if (!authenticated) {
      setBalance(null)
      setHistory(null)
      setReminder(null)
      setReminderReadFailed(false)
      setCheckout(null)
      prevCreditsRef.current = null
      return
    }
    setHistory('loading')
    void loadUserData()
      .then(async (b) => {
        if (!b || b.scutit) return
        const config = await fetchLowCreditReminder()
        setReminder(config)
        setReminderReadFailed(config === null)
      })
      .catch(() => {
        setBalance(null)
        setHistory(null)
      })
  }, [authenticated, loadUserData])

  // Fast poll while the signed webhook is settling the hosted checkout.
  useEffect(() => {
    if (!authenticated || !checkout) return
    const interval = window.setInterval(() => {
      void loadUserData()
    }, 3000)
    return () => clearInterval(interval)
  }, [authenticated, checkout, loadUserData])

  const firstTopUp = balance ? (balance.firstTopUp ?? true) : true
  const exempt = balance?.scutit === true
  const customerBilling = balance?.scutit === false
  const exemptCost =
    exempt && balance.debitMinor === 0 && typeof balance.minorUnit === 'number'
      ? formatMinorMoney(
          balance.debitMinor,
          balance.currency,
          balance.minorUnit,
        )
      : null
  const exemptCreditsUsed =
    exempt &&
    Number.isInteger(balance.creditsUsed) &&
    (balance.creditsUsed as number) >= 0
      ? (balance.creditsUsed as number)
      : null

  // cifrele serverului (cu pragurile de azi 20/5/5 ies exact 20/30/50 și
  // 10/20/50); necitite încă = validarea locală tace și decide serverul
  // (răspunsul lui numit ajunge oricum înapoi) — nu se inventează cifre.
  const minAmount = praguri
    ? firstTopUp
      ? praguri.primaAlimentare
      : praguri.minim
    : null
  const PACKS = praguri
    ? firstTopUp
      ? [
          praguri.primaAlimentare,
          praguri.primaAlimentare + 2 * praguri.pas,
          praguri.primaAlimentare + 6 * praguri.pas,
        ]
      : [2 * praguri.pas, 4 * praguri.pas, 10 * praguri.pas]
    : []
  const creditsRate = getCreditePeLira()

  const customVal = Number(customInput)
  const isCustomFilled = customInput.trim() !== ''
  let customErr = ''
  if (isCustomFilled) {
    if (!Number.isFinite(customVal) || customVal <= 0) {
      customErr = 'Enter a valid amount.'
    } else if (praguri && customVal % praguri.pas !== 0) {
      customErr = `The amount must be a multiple of £${praguri.pas}.`
    } else if (praguri && minAmount !== null && customVal < minAmount) {
      customErr = firstTopUp
        ? `Your first top-up must be at least £${minAmount}.`
        : `The minimum amount is £${minAmount}.`
    }
  }
  const isCustomValid = isCustomFilled && !customErr

  const saveReminder = (
    patch: Partial<
      Pick<LowCreditReminderConfig, 'enabled' | 'suggestedTopupMinor'>
    >,
  ): void => {
    if (!reminder) return
    const before = reminder
    const next = { ...reminder, ...patch }
    setReminder(next)
    void saveLowCreditReminder(next).then((saved) => {
      if (!saved) {
        setReminder(before)
        setReminderReadFailed(true)
        return
      }
      setReminder(saved)
      setReminderReadFailed(false)
      setReminderSaved(true)
      window.setTimeout(() => setReminderSaved(false), 1500)
    })
  }

  const buy = async (amount: number): Promise<void> => {
    if (!authenticated) {
      window.location.href = '/login'
      return
    }
    const minorUnit = balance?.minorUnit
    if (
      !customerBilling ||
      pricingState !== 'ready' ||
      typeof minorUnit !== 'number' ||
      !Number.isInteger(minorUnit)
    ) return
    const amountMinor = majorToMinor(amount, minorUnit)
    if (amountMinor === null || amountMinor <= 0) {
      setErr(T.errPaymentStart)
      return
    }
    const previousAttempt = checkoutAttemptRef.current
    const idempotencyKey =
      previousAttempt?.amountMinor === amountMinor
        ? previousAttempt.idempotencyKey
        : newCheckoutIdempotencyKey()
    if (!idempotencyKey) {
      setErr(T.errPaymentStart)
      return
    }
    checkoutAttemptRef.current = { amountMinor, idempotencyKey }
    setBusy(amount)
    setErr('')
    setSuccessMsg('')
    try {
      const r = await startCheckout(amountMinor, idempotencyKey)
      if (r.ok) {
        checkoutAttemptRef.current = null
        setCheckout(r.pay)
      } else if ('error' in r) {
        if (
          r.error === 'payment_order_closed' ||
          r.error === 'idempotency_conflict' ||
          r.error === 'bad_amount' ||
          r.error === 'bad_topup_increment' ||
          r.error === 'first_topup_minimum' ||
          r.error === 'idempotency_key_invalid' ||
          /^revolut_http_4\d\d$/.test(r.error)
        ) checkoutAttemptRef.current = null
        setErr(
          r.error === 'offline' || r.error.startsWith('checkout_http')
            ? T.errPaymentStart
            : r.error,
        )
      }
    } finally {
      setBusy(0)
    }
  }

  if (!authenticated) {
    return (
      <div className="login-page">
        <div className="login-card credits-card">
          <BackLink />
          <a className="login-brand" href="/">
            Kelionai
          </a>
          <h2 className="login-title">{T.creditsTitle}</h2>
          <p className="credits-blurb">{T.creditsBlurb}</p>
          <p className="login-note" role="status">
            {T.creditsSignInFirst}
          </p>
          <a className="credits-pack" href="/login">
            {T.accountLink}
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="login-page">
      <div className="login-card credits-card">
        <BackLink />
        <a className="login-brand" href="/">
          Kelionai
        </a>
        <h2 className="login-title">{T.creditsTitle}</h2>
        <p className="credits-blurb">{T.creditsBlurb}</p>

        {exempt ? (
          <div className="login-note" style={{ marginBottom: 16 }}>
            <strong>
              {exemptCost && exemptCreditsUsed !== null
                ? `Kelion cost: ${exemptCost} · ${exemptCreditsUsed.toLocaleString()} credits used`
                : 'Admin billing status unavailable'}
            </strong>
            . Internal OpenAI cost is visible only in Admin → Finance.
          </div>
        ) : customerBilling ? (
          <div className="login-note" style={{ marginBottom: 16 }}>
            Current balance: <strong>{balance.credits} credits</strong>
          </div>
        ) : (
          <div className="login-note" style={{ marginBottom: 16 }}>
            Billing status unavailable.
          </div>
        )}

        {pricingState === 'error' && customerBilling && (
          <div
            className="login-note"
            style={{ color: '#d32f2f', marginBottom: 16 }}
          >
            Pricing configuration could not be read. Purchases are disabled; no
            fallback prices are being shown.
          </div>
        )}

        {customerBilling && tarife && tarife.length > 0 && (
          <div
            className="custom-amount-box"
            style={{
              marginBottom: 16,
              padding: '12px',
              border: '1px solid var(--border-color, #e0e0e0)',
              borderRadius: 8,
            }}
          >
            <label
              style={{
                display: 'block',
                fontSize: 14,
                fontWeight: 600,
                marginBottom: 6,
              }}
            >
              Extra-service prices (deducted from credits when used)
            </label>
            {tarife.map((t) => (
              <div
                key={t.cheie}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: 14,
                  padding: '2px 0',
                }}
              >
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
        {customerBilling && pricingState === 'ready' && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              marginBottom: 16,
            }}
          >
            {PACKS.map((p) => (
              <button
                key={p}
                type="button"
                className="credits-pack"
                disabled={busy === p}
                onClick={() => void buy(p)}
              >
                <span className="credits-pack-n">
                  {T.creditsUnit(creditsForPounds(p) as number)}
                </span>
                <span className="credits-pack-price">£{p}</span>
              </button>
            ))}
          </div>
        )}

        {/* CUSTOM AMOUNT / SUMĂ LIBERĂ */}
        {customerBilling && pricingState === 'ready' && (
          <div
            className="custom-amount-box"
            style={{
              marginBottom: 16,
              padding: '12px',
              border: '1px solid var(--border-color, #e0e0e0)',
              borderRadius: 8,
            }}
          >
            <label
              style={{
                display: 'block',
                fontSize: 14,
                fontWeight: 600,
                marginBottom: 6,
              }}
            >
              Custom amount
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="number"
                placeholder={
                  praguri && minAmount !== null
                    ? `£${minAmount}+ (multiplu de £${praguri.pas})`
                    : '£…'
                }
                value={customInput}
                min={minAmount ?? undefined}
                step={praguri?.pas ?? undefined}
                onChange={(e) => setCustomInput(e.target.value)}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  borderRadius: 6,
                  border: '1px solid #ccc',
                }}
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
            {customErr && (
              <div
                className="login-note"
                style={{ color: '#d32f2f', marginTop: 6 }}
              >
                {customErr}
              </div>
            )}
            {!customErr &&
              praguri &&
              minAmount !== null &&
              creditsRate !== null && (
                <div
                  className="login-note"
                  style={{ fontSize: 12, marginTop: 4 }}
                >
                  * Minimum £{minAmount}, multiples of £{praguri.pas} (
                  {Math.floor(minAmount * creditsRate)} credits = £{minAmount}).
                </div>
              )}
          </div>
        )}

        {/* SUCCESS MESSAGE */}
        {successMsg && (
          <div
            className="login-note"
            style={{ color: '#2e7d32', fontWeight: 600, marginBottom: 12 }}
          >
            ✓ {successMsg}
          </div>
        )}

        {/* Provider-hosted checkout; credit lands only after the signed webhook. */}
        {customerBilling && checkout && (
          <div className="pay-code-panel">
            <h3 style={{ margin: '10px 0 4px' }}>{T.checkoutTitle}</h3>
            <div className="pay-code-big">
              {formatMinorMoney(
                checkout.amountMinor,
                checkout.currency,
                checkout.minorUnit,
              )}
            </div>
            <p
              className="login-note"
              style={{ fontWeight: 600, color: '#000' }}
            >
              {T.checkoutHint}
            </p>
            <div className="pay-code-actions">
              <button
                type="button"
                className="credits-pack"
                onClick={() => window.open(checkout.url, '_blank', 'noopener')}
              >
                {T.checkoutOpen}
              </button>
            </div>
            <p className="login-note">⏳ {T.checkoutWaiting}</p>
          </div>
        )}

        {/* Reminder only; Revolut never debits without explicit confirmation. */}
        {customerBilling &&
          reminder &&
          pricingState === 'ready' && (
            <div className="credits-autopay" style={{ marginTop: 16 }}>
              <label
                style={{
                  display: 'flex',
                  gap: 8,
                  alignItems: 'center',
                  textAlign: 'left',
                  fontSize: 14,
                }}
              >
                <input
                  type="checkbox"
                  checked={reminder.enabled}
                  onChange={(e) => saveReminder({ enabled: e.target.checked })}
                />
                <span>{T.lowCreditReminderLabel}</span>
              </label>
              {reminder.enabled && (
                <label
                  style={{
                    display: 'flex',
                    gap: 8,
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginTop: 8,
                    fontSize: 14,
                  }}
                >
                  <span>{T.lowCreditReminderAmount}</span>
                  <select
                    value={reminder.suggestedTopupMinor}
                    onChange={(e) =>
                      saveReminder({
                        suggestedTopupMinor: Number(e.target.value),
                      })
                    }
                  >
                    {Array.from(
                      new Set([
                        reminder.suggestedTopupMinor,
                        ...pacheteDinPraguri(
                          praguri as NonNullable<typeof praguri>,
                        )
                          .map((p) => majorToMinor(p, reminder.minorUnit))
                          .filter((p): p is number => p !== null),
                      ]),
                    )
                      .sort((a, b) => a - b)
                      .map((minor) => {
                        const major = minor / 10 ** reminder.minorUnit
                        return (
                          <option key={minor} value={minor}>
                            {T.creditsUnit(creditsForPounds(major) as number)} —{' '}
                            {formatMinorMoney(
                              minor,
                              reminder.currency,
                              reminder.minorUnit,
                            ) ?? '—'}
                          </option>
                        )
                      })}
                  </select>
                </label>
              )}
              {reminderSaved && (
                <div className="login-note">{T.lowCreditReminderSaved}</div>
              )}
            </div>
          )}
        {customerBilling && reminderReadFailed && (
          <div
            className="login-note"
            style={{ color: '#d32f2f', marginTop: 16 }}
          >
            Low-credit reminder settings could not be read. The control is
            disabled and no default was assumed.
          </div>
        )}

        {customerBilling && (
          <div style={{ marginTop: 24, textAlign: 'left' }}>
            <h3 style={{ fontSize: 16, marginBottom: 8 }}>
              Transaction history
            </h3>
            {history === 'loading' ? (
              <div className="login-note">Reading payment history…</div>
            ) : history === null ? (
              <div className="login-note" style={{ color: '#d32f2f' }}>
                Payment history is unavailable. Try again later.
              </div>
            ) : history.length === 0 ? (
              <div className="login-note">No payments yet.</div>
            ) : (
              <div
                style={{
                  maxHeight: 200,
                  overflowY: 'auto',
                  border: '1px solid #eee',
                  borderRadius: 6,
                  fontSize: 13,
                }}
              >
                {history.map((h) => {
                  const status = paymentStatusPresentation(h.status, 'en')
                  const statusColor =
                    status.tone === 'success'
                      ? '#2e7d32'
                      : status.tone === 'danger'
                        ? '#d32f2f'
                        : '#f57c00'
                  return (
                    <div
                      key={h.id}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        padding: '8px 12px',
                        borderBottom: '1px solid #eee',
                      }}
                    >
                      <div>
                        <div>
                          <strong>
                            {formatMinorMoney(
                              h.amountMinor,
                              h.currency,
                              h.minorUnit,
                            ) ?? 'Unavailable'}
                          </strong>{' '}
                          ({h.credits.toLocaleString()} credits)
                        </div>
                        <div style={{ fontSize: 11, color: '#666' }}>
                          {new Date(h.createdAt).toLocaleString('en-GB')}
                        </div>
                      </div>
                      <div
                        style={{
                          alignSelf: 'center',
                          fontWeight: 600,
                          color: statusColor,
                        }}
                      >
                        {status.label}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {err && <div className="login-note">{err}</div>}
        <div className="login-legal">
          <a href="/privacy">{T.privacyLink}</a> ·{' '}
          <a href="/terms">{T.termsLink}</a>
        </div>
      </div>
    </div>
  )
}
