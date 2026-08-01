import { useEffect, useRef, useState } from 'react'
import { fetchBalance, startCheckout } from '../lib/billing'
import { loadLocalLang } from '../lib/prefs'
import { strings, resolveLang } from '../lib/i18n'

// Credit visible for ANY logged-in user (Adrian, Jul 24: "once logged in with
// Google you must be able to buy credit, I don't see how to top up"). It shows ONE
// SINGLE value — the available credits — with an obvious "＋" and the
// top-up menu. From the same menu you reach Settings and the
// Gmail/Calendar connection — the bar no longer has a separate ⚙ cog, nor the "Connect
// Google" button that looked like a re-login. All texts in the user's language.
//
// VALORI PRESETATE (Adrian, 24 iul): PRIMA alimentare = £20 minim (activarea
// of the brain), then any MULTIPLE of £5. The rule is validated on the server too.
//
// WE SELL CREDITS, NOT POUNDS (Adrian, Jul 24: "you must be able to sell X
// credits for money"): the displayed product is the CREDIT pack, with the price next to it.
// Conversion: the user gets 75% of the payment as credit, 1 credit = £0.10 →
// £ × 7.5 credits. The presets are chosen to give WHOLE credit numbers.
const CREDITS_PER_POUND = 7.5
const creditsFor = (pounds: number): number => Math.floor(pounds * CREDITS_PER_POUND)
const AMOUNTS_FIRST = [20, 30, 50] // 150 / 225 / 375 credite
const AMOUNTS_NEXT = [10, 20, 50] // 75 / 150 / 375 credite

export function WalletButton({
  onOpenSettings,
  googleConnected,
  onConnectGoogle,
  isAdmin,
}: {
  readonly onOpenSettings: () => void
  readonly googleConnected?: boolean
  readonly onConnectGoogle?: () => void
  // The admin (owner) doesn't pay credits — sees the wallet and CAN test
  // topping up, but without the "Please top up" nag (never blocked).
  readonly isAdmin?: boolean
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
  const [firstTopUp, setFirstTopUp] = useState(false)
  const [custom, setCustom] = useState('')
  // The checkout error DISPLAYED, not swallowed ("I press and nothing runs").
  const [payErr, setPayErr] = useState('')
  // VISIBLE BUSY (fluidity audit Jul 27, defect 10): the road to the
  // payment page takes time — without a signal, the button looked dead and the user pressed again.
  const [payBusy, setPayBusy] = useState(false)
  // "CREDIT ADDED" (Adrian, Jul 24: "the 'credit added' message is enough
  // for users, the rest automatically behind the scenes to me"): when the balance GROWS between
  // two reads (the admin sold/credited), the user sees only the message — no
  // payment mechanics up front.
  const [addedCredits, setAddedCredits] = useState<number | null>(null)
  const prevCreditsRef = useRef<number | null>(null)
  const addedTimerRef = useRef<number | null>(null)

  const errText = (code: string): string => {
    if (code === 'must_be_multiple_of_5') return ro ? 'Suma trebuie să fie multiplu de £5.' : 'Amount must be a multiple of £5.'
    if (code === 'first_topup_min_20') return ro ? 'Prima alimentare: minim £20.' : 'First top-up: £20 minimum.'
    if (code === 'min_5') return ro ? 'Minim £5.' : 'Minimum £5.'
    if (code === 'revolut_link_lipsa') return ro ? 'Plățile nu sunt configurate pe server.' : 'Payments are not configured on the server.'
    if (code === 'offline') return ro ? 'Fără conexiune — încearcă din nou.' : 'No connection — try again.'
    return (ro ? 'Plata nu a pornit: ' : 'Payment failed to start: ') + code
  }
  const pay = (amount: number): void => {
    if (payBusy) return // anti-dublu-click cât se deschide plata
    setPayErr('')
    setPayBusy(true)
    void startCheckout(amount).then((err) => {
      if (err) {
        setPayBusy(false)
        setPayErr(errText(err))
        console.error('checkout failed:', err) // ajunge și la Kelion (F12 → server)
      }
      // success → the page navigates to the payment link; the state dies with it.
    })
  }

  const refresh = async (): Promise<void> => {
    const b = await fetchBalance()
    if (b) {
      // The balance GREW → the "credit added" message (that's all the user sees; the sale
      // and payment stay behind the admin). 8s, then it fades by itself.
      const prev = prevCreditsRef.current
      if (prev !== null && b.credits > prev) {
        setAddedCredits(b.credits - prev)
        if (addedTimerRef.current != null) clearTimeout(addedTimerRef.current)
        addedTimerRef.current = window.setTimeout(() => setAddedCredits(null), 8000)
      }
      prevCreditsRef.current = b.credits
      setCredits(b.credits)
      setPercent(b.percent)
      setFirstTopUp(!!b.firstTopUp)
      // reflects reality: at balance 0 it stays paywalled, otherwise it exits — otherwise
      // a refresh with credits=0 left the top-up menu stuck open forever.
      // The admin is NEVER blocked → no paywall pill for him.
      setPaywalled(!isAdmin && b.credits <= 0)
    }
  }

  const minAmount = firstTopUp ? 20 : 5
  const presets = firstTopUp ? AMOUNTS_FIRST : AMOUNTS_NEXT
  const customValid = (): number | null => {
    const n = Number(custom)
    return Number.isFinite(n) && n >= minAmount && n % 5 === 0 ? n : null
  }

  useEffect(() => {
    void refresh()
    const onPaywall = (): void => {
      setPaywalled(true)
      setOpen(true)
      void refresh()
    }
    window.addEventListener('kelion:paywall', onPaywall)
    // Kelion deschide portofelul prin voce (unealta open_app_view → Stage →
    // this event). We open it and refresh the balance.
    const onWalletOpen = (): void => {
      setOpen(true)
      void refresh()
    }
    window.addEventListener('kelion:wallet-open', onWalletOpen)
    // REAL-TIME CREDIT (Adrian, Jul 24: "all credits are displayed in real
    // time, the real value"): we refresh every 15s, as soon as the window
    // becomes active again (you return to the tab) AND on any signal that credit was consumed/added.
    const onChanged = (): void => void refresh()
    window.addEventListener('kelion:credits-changed', onChanged)
    const onVisible = (): void => { if (!document.hidden) void refresh() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onChanged)
    // Returned from a successful top-up — refresh and clean the URL.
    if (new URLSearchParams(window.location.search).get('topup') === 'success') {
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
  }, [])

  // Discreet, escalating low-credit reminder: a small pill that appears briefly,
  // more often the lower the credit gets (30% → rare, 10% → frequent). Never a
  // blocking popup.
  useEffect(() => {
    // The owner doesn't buy credits → NEVER gets "you're running low on
    // credit" (Adrian, Jul 26: "display credits correctly for the admin").
    if (isAdmin || credits === null || percent > 30) {
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

  const critical = !isAdmin && percent <= 5 // stays blinking red at the very end
  return (
    <div className="wallet">
      {/* The pill = the CURRENT BALANCE (the credits you HAVE), not „buy X”.
      Adrian, Jul 24: „the communication is wrong — do I have 150 credits or
      am I buying 150?”. Wallet icon + number = clear balance; adding is in
      the menu. ADMIN (Adrian, Jul 26: „show the credits correctly at admin”):
      the owner doesn't buy credits, so his ledger balance goes NEGATIVE as he
      consumes — a red „-324 credits” is false as a message (he owes nothing).
      At admin the pill shows „nelimitat”; the REAL consumption, by component,
      stays in Admin → Money. The ledgers are NOT touched. */}
      <button
        type="button"
        className={`ghost wallet-badge ${critical ? 'blink-red' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title={
          isAdmin
            ? ro
              ? 'Setări și conectare Gmail · consumul real e în Admin → Bani'
              : 'Settings and Gmail connection · real usage is in Admin → Money'
            : ro
              ? 'Creditele tale disponibile — apasă pentru a adăuga'
              : 'Your available credits — click to add more'
        }
      >
        {/* AT ADMIN NO FIGURE SHOWS ANYMORE (Adrian, Jul 30). „nelimitat” said
        nothing, and his real balance — the one in Revolut Pro — CANNOT be read
        by the app: the accounts API is Revolut-Business-only. So here we show
        either a measured figure or none. The button stays, because behind it
        sit the Settings and the Gmail connection — without it, the path to
        them disappears. At the user's it stays exactly as it was: his balance,
        refreshed on an interval, on tab return and on every credit change. */}
        <span aria-hidden style={{ marginRight: 5 }}>{isAdmin ? '⚙' : '💳'}</span>
        {isAdmin
          ? ro
            ? 'Setări'
            : 'Settings'
          : credits === null
            ? '…'
            : `${credits.toLocaleString()} ${t.credits}`}
      </button>
      {/* PERMANENT paywall = a pill IN the bar (in flow, not absolute) — the
      absolute one covered the monitor tab's title (Adrian, Jul 24: „images
      and buttons overlap”). The passing reminder (6s) stays floating — it
      disappears by itself. */}
      {paywalled && !open && (
        <button type="button" className="wallet-toast wallet-toast-inline urgent" onClick={() => setOpen(true)}>
          {t.topUp}
        </button>
      )}
      {toast && !paywalled && !open && (
        <button type="button" className={`wallet-toast ${critical ? 'urgent' : ''}`} onClick={() => setOpen(true)}>
          {t.lowCredit}
        </button>
      )}
      {/* „CREDIT ADĂUGAT” — the only message the user sees on a sale. */}
      {addedCredits !== null && (
        <span className="wallet-toast">
          ✅ {ro ? `${addedCredits.toLocaleString()} credite adăugate` : `${addedCredits.toLocaleString()} credits added`}
        </span>
      )}
      {open && (
        <div className="wallet-menu">
          {/* CURRENT balance, clearly separated from the add action. At ADMIN it
          is not shown: his ledger balance goes negative as he consumes (he
          doesn't buy credits), so the figure would be false as a message. */}
          {!isAdmin && (
            <span className="wallet-menu-balance">
              {ro ? 'Ai acum' : 'You have'} <strong>{credits === null ? '…' : credits.toLocaleString()}</strong> {t.credits}
            </span>
          )}
          {/* THE SALE IS AT ADMIN (Adrian, Jul 24, confirmed YES: „the credits
          button is only at admin; the others only display”). Regular users see
          ONLY the balance; credits are bought through the payment link received
          from the administrator. The admin keeps the menu (testing). */}
          {isAdmin ? (
            <>
              <span className="wallet-menu-title">{ro ? 'Adaugă credite' : 'Add credits'}</span>
              {firstTopUp && (
                <span className="wallet-menu-note">
                  {ro
                    ? 'Prima alimentare: £20 minim (pornește creierul), apoi multipli de £5.'
                    : 'First top-up: £20 minimum (starts the brain), then multiples of £5.'}
                </span>
              )}
              <div className="wallet-amounts">
                {presets.map((a) => (
                  <button key={a} type="button" className="ghost wallet-pack" disabled={payBusy} onClick={() => pay(a)}>
                    <strong>{creditsFor(a)}</strong> {t.credits} — £{a}
                  </button>
                ))}
              </div>
              {payBusy && (
                <span className="wallet-menu-note">{ro ? 'Se deschide plata…' : 'Opening payment…'}</span>
              )}
              <div className="wallet-custom">
                <span aria-hidden>£</span>
                <input
                  type="number"
                  min={minAmount}
                  step={5}
                  inputMode="numeric"
                  placeholder={ro ? `altă sumă (×5, min ${minAmount})` : `other (×5, min ${minAmount})`}
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
                    ? `${creditsFor(customValid() as number)} ${t.credits}`
                    : ro ? 'Alimentează' : 'Top up'}
                </button>
              </div>
              {payErr && <span className="wallet-menu-note" style={{ color: '#ff8d8d' }}>{payErr}</span>}
            </>
          ) : (
            /* THE PATH TO PURCHASE, for the regular user (Adrian, Aug 1: "the
            whole chain, from login to buying credits"). The pill's menu does
            not sell (the Jul 24 rule: the sale is the admin's) — but at 0
            credits the user must not hit a dead end: the dedicated /credite
            page sells to any signed-in user. Without this link the paywall
            said "top up" and showed no way to do it. */
            <a className="ghost wallet-pack" href="/credite" style={{ textAlign: 'center', textDecoration: 'none' }}>
              {ro ? 'Cumpără credite →' : 'Buy credits →'}
            </a>
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
          {onConnectGoogle && !googleConnected && (
            <button
              type="button"
              className="ghost"
              onClick={() => {
                setOpen(false)
                onConnectGoogle()
              }}
              title={ro ? 'Dă acces la Gmail, Calendar și Drive' : 'Grant Gmail, Calendar & Drive access'}
            >
              {ro ? 'Conectează Gmail & Calendar' : 'Connect Gmail & Calendar'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
