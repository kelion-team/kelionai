import { useEffect, useRef, useState } from 'react'
import { fetchBalance, startCheckout } from '../lib/billing'
import { loadLocalLang } from '../lib/prefs'
import { strings, resolveLang } from '../lib/i18n'

// Credit vizibil pentru ORICE user logat (Adrian, 24 iul: „când te-ai logat cu
// Google trebuie să poți cumpăra credit, nu văd cum se alimentează"). Arată O
// SINGURĂ valoare — creditele disponibile — cu un „＋" evident și meniul de
// reîncărcare. Din același meniu se ajunge la Setări și la conectarea
// Gmail/Calendar — bara nu mai are rotița ⚙ separată, nici butonul „Connect
// Google" care părea o re-logare. Toate textele în limba userului.
//
// VALORI PRESETATE (Adrian, 24 iul): PRIMA alimentare = £20 minim (activarea
// creierului), apoi orice MULTIPLU de £5. Regula e validată și pe server.
//
// SE VÂND CREDITE, NU LIRE (Adrian, 24 iul: „trebuie să se poată vinde X
// credite pe bani"): produsul afișat e pachetul de CREDITE, cu prețul lângă.
// Conversia: userul primește 75% din plată drept credit, 1 credit = £0.10 →
// £ × 7.5 credite. Presetările sunt alese să dea numere ÎNTREGI de credite.
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
  // Adminul (owner) nu plătește credite — vede portofelul și POATE testa
  // alimentarea, dar fără sâcâiala „Te rog reîncarcă" (nu e blocat niciodată).
  readonly isAdmin?: boolean
}): React.JSX.Element {
  // Default ENGLEZĂ până la identificarea limbii (nu limba browserului).
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
  // Eroarea checkout-ului AFIȘATĂ, nu înghițită („apăs și nu se execută").
  const [payErr, setPayErr] = useState('')
  // OCUPAT VIZIBIL (auditul de fluiditate 27 iul, defectul 10): drumul până la
  // Stripe durează — fără semnal, butonul părea mort și userul apăsa iar.
  const [payBusy, setPayBusy] = useState(false)
  // „CREDIT ADĂUGAT" (Adrian, 24 iul: „mesajul «adăugat credit» e suficient
  // pentru useri, restul în spate la mine automat"): când soldul CREȘTE între
  // două citiri (adminul a vândut/creditat), userul vede doar mesajul — nicio
  // mecanică de plată în față.
  const [addedCredits, setAddedCredits] = useState<number | null>(null)
  const prevCreditsRef = useRef<number | null>(null)
  const addedTimerRef = useRef<number | null>(null)

  const errText = (code: string): string => {
    if (code === 'must_be_multiple_of_5') return ro ? 'Suma trebuie să fie multiplu de £5.' : 'Amount must be a multiple of £5.'
    if (code === 'first_topup_min_20') return ro ? 'Prima alimentare: minim £20.' : 'First top-up: £20 minimum.'
    if (code === 'min_5') return ro ? 'Minim £5.' : 'Minimum £5.'
    if (code === 'stripe_not_configured') return ro ? 'Plățile nu sunt configurate pe server.' : 'Payments are not configured on the server.'
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
      // succes → pagina navighează la Stripe; starea moare odată cu ea.
    })
  }

  const refresh = async (): Promise<void> => {
    const b = await fetchBalance()
    if (b) {
      // Soldul a CRESCUT → mesajul „credit adăugat" (atât vede userul; vânzarea
      // și plata rămân în spatele adminului). 8s, apoi dispare singur.
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
      // reflectă realitatea: la sold 0 rămâne paywalled, altfel iese — altfel
      // un refresh cu credits=0 lăsa meniul de top-up blocat deschis pe veci.
      // Adminul nu e blocat NICIODATĂ → fără pastila de paywall pentru el.
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
    // acest eveniment). Îl deschidem și reîmprospătăm soldul.
    const onWalletOpen = (): void => {
      setOpen(true)
      void refresh()
    }
    window.addEventListener('kelion:wallet-open', onWalletOpen)
    // CREDIT ÎN TIMP REAL (Adrian, 24 iul: „toate creditele se afișează în timp
    // real, valoarea reală"): reîmprospătăm la fiecare 15s, imediat ce fereastra
    // redevine activă (revii în tab) ȘI la orice semnal că s-a consumat/creditat.
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
    // Owner-ul nu cumpără credite → nu primește NICIODATĂ „mai ai puțin
    // credit" (Adrian, 26 iul: „afișează corect creditele la admin").
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
      {/* Pastila = SOLDUL curent (creditele pe care le AI), nu „cumpără X".
          Adrian, 24 iul: „e greșită comunicarea — am 150 credite sau cumpăr
          150?". Icon portofel + număr = clar sold; adăugarea e în meniu.
          ADMIN (Adrian, 26 iul: „afișează corect creditele la admin"): owner-ul
          nu cumpără credite, deci soldul lui din registru iese NEGATIV pe
          măsură ce consumă — un „-324 credite" roșu e fals ca mesaj (nu
          datorează nimic). La admin pastila arată „nelimitat"; consumul REAL,
          pe componente, rămâne în Admin → Bani. Registrele NU se ating. */}
      <button
        type="button"
        className={`ghost wallet-badge ${critical ? 'blink-red' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title={
          isAdmin
            ? ro
              ? 'Cont owner — credite nelimitate; consumul real e în Admin → Bani'
              : 'Owner account — unlimited credits; real usage is in Admin → Money'
            : ro
              ? 'Creditele tale disponibile — apasă pentru a adăuga'
              : 'Your available credits — click to add more'
        }
      >
        <span aria-hidden style={{ marginRight: 5 }}>💳</span>
        {isAdmin ? (ro ? 'nelimitat' : 'unlimited') : credits === null ? '…' : `${credits.toLocaleString()} ${t.credits}`}
      </button>
      {/* Paywall PERMANENT = pastilă ÎN bară (în flux, nu absolută) — cea
          absolută acoperea titlul tabului de pe monitor (Adrian, 24 iul:
          „se suprapun imagini și butoane"). Reamintirea trecătoare (6s) rămâne
          plutitoare — dispare singură. */}
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
      {/* „CREDIT ADĂUGAT" — singurul mesaj pe care îl vede userul la o vânzare. */}
      {addedCredits !== null && (
        <span className="wallet-toast">
          ✅ {ro ? `${addedCredits.toLocaleString()} credite adăugate` : `${addedCredits.toLocaleString()} credits added`}
        </span>
      )}
      {open && (
        <div className="wallet-menu">
          {/* SOLD curent, clar separat de acțiunea de adăugare. */}
          <span className="wallet-menu-balance">
            {ro ? 'Ai acum' : 'You have'} <strong>{credits === null ? '…' : credits.toLocaleString()}</strong> {t.credits}
          </span>
          {/* VÂNZAREA E LA ADMIN (Adrian, 24 iul, confirmat DA: „butonul de
              credite e doar la admin; ceilalți doar afișare"). Userii obișnuiți
              văd DOAR soldul; creditele se cumpără prin linkul de plată primit
              de la administrator. Adminul păstrează meniul (testare). */}
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
          ) : null}
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
