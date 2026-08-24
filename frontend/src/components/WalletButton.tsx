import { useCallback, useEffect, useRef, useState } from 'react'
import {
  fetchBalance,
  startCheckout,
  newCheckoutIdempotencyKey,
  creditsForPounds,
  getCreditePeLira,
  majorToMinor,
  formatMinorMoney,
  type CheckoutStart,
} from '../lib/billing'
import { loadLocalLang } from '../lib/prefs'
import { strings, resolveLang } from '../lib/i18n'
import { aduPragurile, pragurileServerului, type Praguri } from '../lib/praguri'

// Creditul și dreptul de cumpărare vin din contractul de facturare al serverului.
const creditsFor = (pounds: number): number | null => creditsForPounds(pounds)
// Pachetele se derivă din pragurile serverului, fără valori monetare locale.
const pachete = (p: Praguri, primaAlimentare: boolean): number[] =>
  primaAlimentare
    ? [
        p.primaAlimentare,
        p.primaAlimentare + 2 * p.pas,
        p.primaAlimentare + 6 * p.pas,
      ]
    : [2 * p.pas, 4 * p.pas, 10 * p.pas]

export function WalletButton({
  onOpenSettings,
}: {
  readonly onOpenSettings: () => void
}): React.JSX.Element {
  // Default ENGLISH until language identification (not the browser language).
  const langKey = resolveLang(loadLocalLang() ?? 'en')
  const t = strings(langKey)
  const ro = langKey.slice(0, 2).toLowerCase() === 'ro'
  const [credits, setCredits] = useState<number | null>(null)
  const [percent, setPercent] = useState(100)
  const [open, setOpen] = useState(false)
  const [toast, setToast] = useState(false)
  const [paywalled, setPaywalled] = useState(false)
  const [exempt, setExempt] = useState<boolean | null>(null)
  const [billingChecked, setBillingChecked] = useState(false)
  const [billingMinorUnit, setBillingMinorUnit] = useState<number | null>(null)
  const [exemptDebit, setExemptDebit] = useState<string | null>(null)
  const [exemptCreditsUsed, setExemptCreditsUsed] = useState<number | null>(
    null,
  )
  // This is only a low-credit signal. It opens the wallet; it never creates,
  // opens or confirms a payment on the user's behalf.
  const [paymentPrompt, setPaymentPrompt] = useState(false)
  const [firstTopUp, setFirstTopUp] = useState(false)
  const [custom, setCustom] = useState('')
  // The checkout error DISPLAYED, not swallowed ("I press and nothing runs").
  const [payErr, setPayErr] = useState('')

  // payment page takes time — without a signal, the button looked dead and the user pressed again.
  const [payBusy, setPayBusy] = useState(false)

  // for users, the rest automatically behind the scenes to me"): when the balance GROWS between
  // two reads (the admin sold/credited), the user sees only the message — no
  // payment mechanics up front.
  const [addedCredits, setAddedCredits] = useState<number | null>(null)
  const prevCreditsRef = useRef<number | null>(null)
  const addedTimerRef = useRef<number | null>(null)

  const [checkout, setCheckout] = useState<CheckoutStart | null>(null)
  const checkoutAttemptRef = useRef<{
    amountMinor: number
    idempotencyKey: string
  } | null>(null)

  // (aceeași sursă care validează). Necitite încă = text FĂRĂ cifre — nu se

  const errText = (code: string): string => {
    const p = pragurileServerului()
    if (code === 'bad_topup_increment')
      return p
        ? ro
          ? `Suma trebuie să fie multiplu de £${p.pas}.`
          : `Amount must be a multiple of £${p.pas}.`
        : ro
          ? 'Suma nu e multiplul cerut de server.'
          : 'Amount is not the multiple the server requires.'
    if (code === 'first_topup_minimum')
      return p
        ? ro
          ? `Prima alimentare: minim £${p.primaAlimentare}.`
          : `First top-up: £${p.primaAlimentare} minimum.`
        : ro
          ? 'Suma e sub pragul primei alimentări.'
          : 'Amount is below the first top-up minimum.'
    if (code === 'bad_amount')
      return ro ? 'Suma nu este validă.' : 'The amount is invalid.'
    if (code === 'payment_setup_required')
      return ro
        ? 'Plățile nu sunt configurate pe server.'
        : 'Payments are not configured on the server.'
    if (code === 'payment_indeterminate')
      return ro
        ? 'Furnizorul nu a confirmat încă sesiunea. Nu s-a creditat nimic; încearcă din nou pentru reconciliere.'
        : 'The provider has not confirmed the session yet. Nothing was credited; try again to reconcile it.'
    if (code === 'ledger_unavailable' || code === 'checkout_persistence_unavailable')
      return ro
        ? 'Registrul de plată nu este disponibil. Nu s-a creditat nimic.'
        : 'The payment ledger is unavailable. Nothing was credited.'
    if (code === 'idempotency_conflict' || code === 'payment_order_closed')
      return ro
        ? 'Această încercare nu mai poate fi folosită. Apasă din nou pentru o sesiune nouă.'
        : 'This attempt can no longer be used. Click again for a new session.'
    if (code === 'offline')
      return ro
        ? 'Fără conexiune — încearcă din nou.'
        : 'No connection — try again.'
    return (ro ? 'Plata nu a pornit: ' : 'Payment failed to start: ') + code
  }
  const pay = (amount: number): void => {
    if (
      payBusy ||
      exempt !== false ||
      !praguri ||
      getCreditePeLira() === null ||
      billingMinorUnit === null
    )
      return
    const amountMinor = majorToMinor(amount, billingMinorUnit)
    if (amountMinor === null || amountMinor <= 0) {
      setPayErr(errText('bad_amount'))
      return
    }
    const previousAttempt = checkoutAttemptRef.current
    const idempotencyKey =
      previousAttempt?.amountMinor === amountMinor
        ? previousAttempt.idempotencyKey
        : newCheckoutIdempotencyKey()
    if (!idempotencyKey) {
      setPayErr(errText('secure_random_unavailable'))
      return
    }
    checkoutAttemptRef.current = { amountMinor, idempotencyKey }
    setPayErr('')
    setPayBusy(true)
    void startCheckout(amountMinor, idempotencyKey).then((r) => {
      setPayBusy(false)
      if (!r.ok && 'error' in r) {
        if (
          r.error === 'payment_order_closed' ||
          r.error === 'idempotency_conflict' ||
          r.error === 'bad_amount' ||
          r.error === 'bad_topup_increment' ||
          r.error === 'first_topup_minimum' ||
          r.error === 'idempotency_key_invalid' ||
          /^revolut_http_4\d\d$/.test(r.error)
        ) checkoutAttemptRef.current = null
        setPayErr(errText(r.error))
        console.error('checkout failed:', r.error) // ajunge și la Kelion (F12 → server)
        return
      }
      checkoutAttemptRef.current = null
      setCheckout(r.pay)
    })
  }

  const refresh = useCallback(async (): Promise<void> => {
    const b = await fetchBalance()
    setBillingChecked(true)
    if (!b) {
      setExempt(null)
      setExemptDebit(null)
      setExemptCreditsUsed(null)
      setPaywalled(false)
      setBillingMinorUnit(null)
      return
    }
    if (b) {
      // The balance GREW → the "credit added" message (that's all the user sees; the sale
      // and payment stay behind the admin). 8s, then it fades by itself.
      const prev = prevCreditsRef.current
      if (prev !== null && b.credits > prev) {
        setAddedCredits(b.credits - prev)
        // The payment LANDED — the code panel's job is done; it closes itself
        // („aștept plata" care se închide singură — M4).
        setCheckout(null)
        if (addedTimerRef.current != null) clearTimeout(addedTimerRef.current)
        addedTimerRef.current = window.setTimeout(
          () => setAddedCredits(null),
          8000,
        )
      }
      prevCreditsRef.current = b.credits
      setCredits(b.credits)
      setBillingMinorUnit(
        Number.isInteger(b.minorUnit) && (b.minorUnit as number) >= 0
          ? (b.minorUnit as number)
          : null,
      )
      setPercent(b.percent)
      setFirstTopUp(!!b.firstTopUp)
      // The CODE is kept (M4): the one-tap button used to drop it, sending the
      // person to pay with no way to reference the payment back to them.
      setPaymentPrompt(Boolean(b.lowCreditPaymentPrompt))
      setExempt(Boolean(b.scutit))
      setExemptDebit(
        b.scutit && b.debitMinor === 0 && typeof b.minorUnit === 'number'
          ? formatMinorMoney(
              b.debitMinor,
              b.currency,
              b.minorUnit,
              ro ? 'ro-RO' : 'en-GB',
            )
          : null,
      )
      setExemptCreditsUsed(
        b.scutit &&
          Number.isInteger(b.creditsUsed) &&
          (b.creditsUsed as number) >= 0
          ? (b.creditsUsed as number)
          : null,
      )

      setPaywalled(!b.scutit && b.credits <= 0)
    }
  }, [ro])

  const [praguri, setPraguri] = useState<Praguri | null>(pragurileServerului())
  useEffect(() => {
    void aduPragurile().then((p) => {
      if (p) setPraguri(p)
    })
  }, [])
  const presets = praguri ? pachete(praguri, firstTopUp) : []
  const pricingReady =
    praguri !== null &&
    getCreditePeLira() !== null &&
    billingMinorUnit !== null
  const customValid = (): number | null => {
    // fără praguri citite, validarea locală tace — serverul validează oricum
    // și răspunde pe nume (errText); nu inventăm cifre în locul lui.
    if (!pricingReady || !praguri) return null
    const minim = firstTopUp ? praguri.primaAlimentare : praguri.minim
    const n = Number(custom)
    return Number.isFinite(n) && n >= minim && n % praguri.pas === 0 ? n : null
  }

  useEffect(() => {
    void refresh()
    const onPaywall = (): void => {
      setPaywalled(true)
      setOpen(true)
      void refresh()
    }
    window.addEventListener('kelion:paywall', onPaywall)

    const onWalletOpen = (): void => {
      setOpen(true)
      void refresh()
    }
    window.addEventListener('kelion:wallet-open', onWalletOpen)

    const onChanged = (): void => void refresh()
    window.addEventListener('kelion:credits-changed', onChanged)
    const onVisible = (): void => {
      if (!document.hidden) void refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onChanged)
    // Returned from a successful top-up — refresh and clean the URL.
    if (
      new URLSearchParams(window.location.search).get('payment') === 'return'
    ) {
      window.history.replaceState({}, '', window.location.pathname)
      setTimeout(() => void refresh(), 1500)
    }
    const poll = window.setInterval(() => void refresh(), 15_000) // sold LIVE
    return () => {
      window.removeEventListener('kelion:paywall', onPaywall)
      window.removeEventListener('kelion:credits-changed', onChanged)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onChanged)
      clearInterval(poll)
    }
  }, [refresh])

  // Fast polling while the signed webhook is settling the hosted checkout.
  useEffect(() => {
    if (!checkout) return
    const interval = window.setInterval(() => void refresh(), 3000)
    return () => clearInterval(interval)
  }, [checkout, refresh])

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

  const critical = exempt === false && percent <= 5
  return (
    <div className="wallet">
      <button
        type="button"
        className={`ghost wallet-badge ${critical ? 'blink-red' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title={
          exempt === true
            ? exemptDebit && exemptCreditsUsed !== null
              ? ro
                ? `Cost Kelion: ${exemptDebit} · ${exemptCreditsUsed.toLocaleString()} credite consumate`
                : `Kelion cost: ${exemptDebit} · ${exemptCreditsUsed.toLocaleString()} credits used`
              : ro
                ? 'Starea facturării admin nu poate fi citită'
                : 'Admin billing status unavailable'
            : exempt === false
              ? ro
                ? 'Creditele tale disponibile — apasă pentru a adăuga'
                : 'Your available credits — click to add more'
              : ro
                ? 'Starea facturării nu este disponibilă'
                : 'Billing status unavailable'
        }
      >
        <span aria-hidden style={{ marginRight: 5 }}>
          💳
        </span>
        {exempt === true
          ? exemptDebit && exemptCreditsUsed !== null
            ? ro
              ? `Cost Kelion: ${exemptDebit} · ${exemptCreditsUsed.toLocaleString()} credite consumate`
              : `Kelion cost: ${exemptDebit} · ${exemptCreditsUsed.toLocaleString()} credits used`
            : ro
              ? 'Facturare indisponibilă'
              : 'Billing unavailable'
          : exempt === false
            ? credits === null
              ? '…'
              : `${credits.toLocaleString()} ${t.credits}`
            : billingChecked
              ? ro
                ? 'Facturare indisponibilă'
                : 'Billing unavailable'
              : '…'}
      </button>

      {exempt === false && paywalled && !open && (
        <button
          type="button"
          className="wallet-toast wallet-toast-inline urgent"
          onClick={() => setOpen(true)}
        >
          {t.topUp}
        </button>
      )}
      {/* Reminder only: opens the wallet; no payment is started automatically. */}
      {exempt === false && paymentPrompt && !paywalled && !open && (
        <button
          type="button"
          className="wallet-toast urgent"
          onClick={() => {
            setOpen(true)
          }}
        >
          ⚠{' '}
          {ro
            ? 'Credit scăzut — verifică opțiunile de plată'
            : 'Low credit — review payment options'}
        </button>
      )}
      {exempt === false && toast && !paymentPrompt && !paywalled && !open && (
        <button
          type="button"
          className={`wallet-toast ${critical ? 'urgent' : ''}`}
          onClick={() => setOpen(true)}
        >
          {t.lowCredit}
        </button>
      )}
      {/* „CREDIT ADĂUGAT” — the only message the user sees on a sale. */}
      {addedCredits !== null && (
        <span className="wallet-toast">
          ✅{' '}
          {ro
            ? `${addedCredits.toLocaleString()} credite adăugate`
            : `${addedCredits.toLocaleString()} credits added`}
        </span>
      )}
      {open && (
        <div className="wallet-menu">
          {/* CURRENT balance, clearly separated from the add action. */}
          <span className="wallet-menu-balance">
            {ro ? 'Ai acum' : 'You have'}{' '}
            <strong>{credits === null ? '…' : credits.toLocaleString()}</strong>{' '}
            {t.credits}
          </span>
          {/* Provider-hosted checkout; only the signed webhook credits it. */}
          {checkout && (
            <div className="pay-code-panel">
              <span className="wallet-menu-title">{t.checkoutTitle}</span>
              <div className="pay-code-big">
                {formatMinorMoney(
                  checkout.amountMinor,
                  checkout.currency,
                  checkout.minorUnit,
                  ro ? 'ro-RO' : 'en-GB',
                )}
              </div>
              <span className="wallet-menu-note">{t.checkoutHint}</span>
              <div className="pay-code-actions">
                <button
                  type="button"
                  className="ghost"
                  onClick={() => window.open(checkout.url, '_blank', 'noopener')}
                >
                  {t.checkoutOpen}
                </button>
              </div>
              <span className="wallet-menu-note">⏳ {t.checkoutWaiting}</span>
            </div>
          )}

          {exempt === false && (
            <>
              <span className="wallet-menu-title">
                {ro ? 'Adaugă credite' : 'Add credits'}
              </span>
              {firstTopUp && praguri && (
                <span className="wallet-menu-note">
                  {ro
                    ? `Prima alimentare: £${praguri.primaAlimentare} minim (pornește creierul), apoi multipli de £${praguri.pas}.`
                    : `First top-up: £${praguri.primaAlimentare} minimum (starts the brain), then multiples of £${praguri.pas}.`}
                </span>
              )}
              {!pricingReady && (
                <span className="wallet-menu-note" style={{ color: '#ff8d8d' }}>
                  {ro
                    ? 'Configurația de preț nu a putut fi citită. Plata este dezactivată; nu afișăm valori implicite.'
                    : 'Pricing configuration could not be read. Payment is disabled; no fallback values are shown.'}
                </span>
              )}
              <div className="wallet-amounts">
                {presets.map((a) => (
                  <button
                    key={a}
                    type="button"
                    className="ghost wallet-pack"
                    disabled={payBusy || !pricingReady}
                    onClick={() => pay(a)}
                  >
                    <strong>{creditsFor(a) ?? '—'}</strong> {t.credits} — £{a}
                  </button>
                ))}
              </div>
              {payBusy && (
                <span className="wallet-menu-note">
                  {ro ? 'Se deschide plata…' : 'Opening payment…'}
                </span>
              )}
              <div className="wallet-custom">
                <span aria-hidden>£</span>
                <input
                  type="number"
                  min={
                    praguri
                      ? firstTopUp
                        ? praguri.primaAlimentare
                        : praguri.minim
                      : undefined
                  }
                  step={praguri?.pas ?? undefined}
                  inputMode="numeric"
                  placeholder={
                    praguri
                      ? ro
                        ? `altă sumă (×${praguri.pas}, min ${firstTopUp ? praguri.primaAlimentare : praguri.minim})`
                        : `other (×${praguri.pas}, min ${firstTopUp ? praguri.primaAlimentare : praguri.minim})`
                      : '£…'
                  }
                  value={custom}
                  onChange={(e) => setCustom(e.target.value)}
                />
                <button
                  type="button"
                  className="ghost"
                  disabled={customValid() === null || payBusy}
                  onClick={() => {
                    const n = customValid()
                    if (n !== null) pay(n)
                  }}
                >
                  {customValid() !== null
                    ? `${creditsFor(customValid() as number) ?? '—'} ${t.credits}`
                    : ro
                      ? 'Alimentează'
                      : 'Top up'}
                </button>
              </div>
              {payErr && (
                <span className="wallet-menu-note" style={{ color: '#ff8d8d' }}>
                  {payErr}
                </span>
              )}
            </>
          )}
          <div className="wallet-menu-sep" />
          <button
            type="button"
            className="ghost"
            onClick={() => {
              setOpen(false)
              onOpenSettings()
            }}
          >
            ⚙ {ro ? 'Setări' : 'Settings'}
          </button>
        </div>
      )}
    </div>
  )
}
