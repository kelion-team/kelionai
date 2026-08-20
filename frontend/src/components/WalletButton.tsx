import { useEffect, useRef, useState } from 'react'
import { fetchBalance, startCheckout, creditsForPounds, type CheckoutStart } from '../lib/billing'
import { loadLocalLang } from '../lib/prefs'
import { strings, resolveLang } from '../lib/i18n'
import { aduPragurile, pragurileServerului, type Praguri } from '../lib/praguri'

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
const creditsFor = (pounds: number): number => creditsForPounds(pounds)
// LEGEA ANTI-HARDCODARE (16 aug, ownerul: „m-ai umplut de hardcodate, scoate
// tot"): pachetele se DERIVĂ din pragurile serverului (prima/minim/pas), nu se
// scriu de mână — cu pragurile de azi (20/5/5) ies exact 20/30/50 și 10/20/50.
const pachete = (p: Praguri, primaAlimentare: boolean): number[] =>
  primaAlimentare
    ? [p.primaAlimentare, p.primaAlimentare + 2 * p.pas, p.primaAlimentare + 6 * p.pas]
    : [2 * p.pas, 4 * p.pas, 10 * p.pas]

// NOTE (dead-code audit, Aug 2): the old `isAdmin` prop and its branches are
// gone — the only render site (Stage.tsx) is guarded by `user.role !== 'admin'`
// and always passed `isAdmin={false}`, so every admin branch in here was
// unreachable by construction. The admin's settings live in the Admin panel.
export function WalletButton({
  onOpenSettings,
  googleConnected,
  onConnectGoogle,
}: {
  readonly onOpenSettings: () => void
  readonly googleConnected?: boolean
  readonly onConnectGoogle?: () => void
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
  // AUTO TOP-UP, prepared by the server (the checkbox in Settings): when the
  // credit drops under the user's threshold, the payment is already prepared
  // (unique code + link) and this button completes it with ONE tap.
  const [autoPay, setAutoPay] = useState<{ amount: number; url: string; code: string; currency: string } | null>(null)
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

  // THE PAYMENT CODE PANEL (M4, Aug 2): matching depends on the person writing
  // the unique code in the transfer reference — and this button used to
  // navigate away without showing it. Now the code comes FIRST, big, with a
  // copy button; Revolut opens in a new tab; the panel closes ITSELF when the
  // balance grows (the same read that fires the "credits added" toast).
  const [payCode, setPayCode] = useState<CheckoutStart | null>(null)
  const [codeCopied, setCodeCopied] = useState(false)

  // LEGEA ANTI-HARDCODARE (16 aug): cifrele pragurilor vin DOAR de la server
  // (aceeași sursă care validează). Necitite încă = text FĂRĂ cifre — nu se
  // inventează un „£20" care poate minți când ownerul schimbă pragul din env.
  const errText = (code: string): string => {
    const p = pragurileServerului()
    if (code === 'must_be_multiple_of_5')
      return p ? (ro ? `Suma trebuie să fie multiplu de £${p.pas}.` : `Amount must be a multiple of £${p.pas}.`) : ro ? 'Suma nu e multiplul cerut de server.' : 'Amount is not the multiple the server requires.'
    if (code === 'first_topup_min_20')
      return p ? (ro ? `Prima alimentare: minim £${p.primaAlimentare}.` : `First top-up: £${p.primaAlimentare} minimum.`) : ro ? 'Suma e sub pragul primei alimentări.' : 'Amount is below the first top-up minimum.'
    if (code === 'min_5')
      return p ? (ro ? `Minim £${p.minim}.` : `Minimum £${p.minim}.`) : ro ? 'Suma e sub minimul serverului.' : 'Amount is below the server minimum.'
    if (code === 'revolut_link_lipsa') return ro ? 'Plățile nu sunt configurate pe server.' : 'Payments are not configured on the server.'
    if (code === 'offline') return ro ? 'Fără conexiune — încearcă din nou.' : 'No connection — try again.'
    return (ro ? 'Plata nu a pornit: ' : 'Payment failed to start: ') + code
  }
  const pay = (amount: number): void => {
    if (payBusy) return // anti-dublu-click cât se deschide plata
    setPayErr('')
    setPayBusy(true)
    void startCheckout(amount).then((r) => {
      setPayBusy(false)
      if (!r.ok) {
        setPayErr(errText(r.error))
        console.error('checkout failed:', r.error) // ajunge și la Kelion (F12 → server)
        return
      }
      // The CODE first (M4): the person sees and copies it BEFORE paying —
      // Revolut opens in a new tab from the panel's button.
      setCodeCopied(false)
      setPayCode(r.pay)
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
        // The payment LANDED — the code panel's job is done; it closes itself
        // („aștept plata" care se închide singură — M4).
        setPayCode(null)
        if (addedTimerRef.current != null) clearTimeout(addedTimerRef.current)
        addedTimerRef.current = window.setTimeout(() => setAddedCredits(null), 8000)
      }
      prevCreditsRef.current = b.credits
      setCredits(b.credits)
      setPercent(b.percent)
      setFirstTopUp(!!b.firstTopUp)
      // The CODE is kept (M4): the one-tap button used to drop it, sending the
      // person to pay with no way to reference the payment back to them.
      setAutoPay(
        b.autoTopUp
          ? { amount: b.autoTopUp.amount, url: b.autoTopUp.url, code: b.autoTopUp.code, currency: b.autoTopUp.currency }
          : null,
      )
      // Owner scutit: sold istoric negativ NU e paywall (server deja scutește debitul).
      // Customer: la 0 credite rămâne paywalled.
      setPaywalled(!b.scutit && b.credits <= 0)
    }
  }

  // Pragurile vin de la server (o singură citire pe sesiune); necitite încă =
  // pachetele nu se afișează cu cifre inventate — apar când sosește adevărul.
  const [praguri, setPraguri] = useState<Praguri | null>(pragurileServerului())
  useEffect(() => {
    void aduPragurile().then((p) => {
      if (p) setPraguri(p)
    })
  }, [])
  const presets = praguri ? pachete(praguri, firstTopUp) : []
  const customValid = (): number | null => {
    // fără praguri citite, validarea locală tace — serverul validează oricum
    // și răspunde pe nume (errText); nu inventăm cifre în locul lui.
    if (!praguri) return null
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

  // Fast polling while waiting for payment code confirmation
  useEffect(() => {
    if (!payCode) return
    const interval = window.setInterval(() => void refresh(), 3000)
    return () => clearInterval(interval)
  }, [payCode])

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
      {/* The pill = the CURRENT BALANCE (the credits you HAVE), not „buy X”.
      Adrian, Jul 24: „the communication is wrong — do I have 150 credits or
      am I buying 150?”. Wallet icon + number = clear balance; adding is in
      the menu. */}
      <button
        type="button"
        className={`ghost wallet-badge ${critical ? 'blink-red' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title={ro ? 'Creditele tale disponibile — apasă pentru a adăuga' : 'Your available credits — click to add more'}
      >
        <span aria-hidden style={{ marginRight: 5 }}>💳</span>
        {credits === null ? '…' : `${credits.toLocaleString()} ${t.credits}`}
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
      {/* AUTO TOP-UP, ONE TAP (Adrian, Aug 1): the server prepared the payment
      (the user's checkbox is on and his credit dropped under his threshold) —
      this button completes it instantly. It replaces the generic "running low"
      nudge: an action beats a warning. */}
      {autoPay && !paywalled && !open && (
        <button
          type="button"
          className="wallet-toast urgent"
          onClick={() => {
            // The CODE first (M4): the panel with the code opens here, Revolut
            // in a new tab — navigating away used to lose the code forever.
            setCodeCopied(false)
            setPayCode({ url: autoPay.url, code: autoPay.code, amount: autoPay.amount, currency: autoPay.currency })
            setOpen(true)
            window.open(autoPay.url, '_blank', 'noopener')
          }}
        >
          ⚡ {ro ? `Reîncarcă £${autoPay.amount} — o apăsare` : `Top up £${autoPay.amount} — one tap`}
        </button>
      )}
      {toast && !autoPay && !paywalled && !open && (
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
          {/* CURRENT balance, clearly separated from the add action. */}
          <span className="wallet-menu-balance">
            {ro ? 'Ai acum' : 'You have'} <strong>{credits === null ? '…' : credits.toLocaleString()}</strong> {t.credits}
          </span>
          {/* THE PAYMENT CODE (M4): shown BEFORE the person leaves for Revolut.
          It closes itself when the balance grows — „aștept plata" real, not a
          promise. */}
          {payCode && (
            <div className="pay-code-panel">
              <span className="wallet-menu-title">{t.payCodeTitle}</span>
              <div className="pay-code-big">{payCode.code}</div>
              <span className="wallet-menu-note">{t.payCodeHint}</span>
              <div className="pay-code-actions">
                <button
                  type="button"
                  className="ghost"
                  onClick={() => {
                    // „Copiat" DOAR dacă scrierea în clipboard a reușit (audit fake, 20 aug).
                    const p = navigator.clipboard?.writeText(payCode.code)
                    if (p) void p.then(() => setCodeCopied(true)).catch(() => {})
                  }}
                >
                  {codeCopied ? t.payCodeCopied : t.payCodeCopy}
                </button>
                <button type="button" className="ghost" onClick={() => window.open(payCode.url, '_blank', 'noopener')}>
                  {t.payCodeOpen}
                </button>
              </div>
              <span className="wallet-menu-note">⏳ {t.payCodeWaiting}</span>
            </div>
          )}
          {/* THE CREDITS PANEL, FOR EVERYONE (Adrian's order: the header
          „Add credits" button opens the EXISTING credits panel for regular
          users too — the 75/150/375 packs + a custom multiple of £5). Before,
          this menu sold only at admin and sent users to the /credite page;
          the panel was already here, tested, and wired to the same checkout,
          so the dead end is gone. */}
          <>
            <span className="wallet-menu-title">{ro ? 'Adaugă credite' : 'Add credits'}</span>
            {firstTopUp && praguri && (
              <span className="wallet-menu-note">
                {ro
                  ? `Prima alimentare: £${praguri.primaAlimentare} minim (pornește creierul), apoi multipli de £${praguri.pas}.`
                  : `First top-up: £${praguri.primaAlimentare} minimum (starts the brain), then multiples of £${praguri.pas}.`}
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
                min={praguri ? (firstTopUp ? praguri.primaAlimentare : praguri.minim) : undefined}
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
                  ? `${creditsFor(customValid() as number)} ${t.credits}`
                  : ro ? 'Alimentează' : 'Top up'}
              </button>
            </div>
            {payErr && <span className="wallet-menu-note" style={{ color: '#ff8d8d' }}>{payErr}</span>}
          </>
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
