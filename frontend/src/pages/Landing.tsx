import { Suspense, lazy, useEffect, useState } from 'react'
import ContactModal from '../components/ContactModal'
import VisitorChatWidget from '../components/VisitorChatWidget'
import { ButonInstalarePwa } from '../components/ButonInstalarePwa'
import { startGoogleLogin } from '../lib/api'
import { deviceFingerprint } from '../lib/fingerprint'
import { raporteazaPagina } from '../lib/vizita'
import { strings, type Lang } from '../lib/i18n'
import { PUBLIC_TEXT as PT } from '../lib/publicText'
import { fetchServerVersion, versionLabel, type ServerVersion } from '../lib/updateCheck'
// Avatarul 3D — încărcat leneș (three.js scos din calea critică a landing-ului).
const LandingAvatar = lazy(() => import('../components/LandingAvatar'))

// The four install codes — one per platform. Click → enlarged for scanning.
const QR_CODES = [
  // `href` = the INSTALL target (Adrian, Jul 26: "under each code there must be
  // install that takes you to the install page") — the same place the code
  // scan leads to, but on click, for someone already on the target device.
  { key: 'win', label: '⊞ Windows', img: '/dl/qr-win.png', href: '/dl/Kelionai-Setup.exe' },
  { key: 'linux', label: '🐧 Linux', img: '/dl/qr-linux.png', href: '/dl/Kelionai-linux.zip' },
  { key: 'ios', label: 'iOS', img: '/dl/qr-ios.png', href: 'https://apps.apple.com/app/id6786766714' },
  { key: 'android', label: '🤖 Android', img: '/dl/qr-apk.png', href: '/dl/Kelionai.apk' },
] as const
type QrCode = (typeof QR_CODES)[number]

const ERR_KEY: Record<string, keyof ReturnType<typeof strings>> = {
  closed: 'errClosed',
  bad_state: 'errBadState',
  token_exchange: 'errTokenExchange',
  no_id_token: 'errNoIdToken',
  no_email: 'errNoEmail',
}

const LANGUAGES: { code: Lang; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'ro', label: 'Română' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
  { code: 'it', label: 'Italiano' },
  { code: 'pt', label: 'Português' },
]

// The public start page: a professional hero with a LIVE 3D Kelion, plus the two
// ways in — a free 3-minute trial (no sign-up) and Google sign-in.
// AUTOMATICALLY multilingual: the UI follows the visitor's browser language
// (en/ro/es/fr/de/it/pt; anything else falls back to English). The conversation
// itself adapts to dozens of languages independently of the UI.
export default function Landing({ error }: { error?: string | null }) {
  // Language selector state — defaults to English, visitor can change
  const [lang, setLang] = useState<Lang>('en')
  const [langOpen, setLangOpen] = useState(false)
  const t = strings(lang)
  const [contactOpen, setContactOpen] = useState(false)
  const [qrZoom, setQrZoom] = useState<QrCode | null>(null)
  // The live version (same source as the browser watermark) — we show it under
  // each QR code as proof that the installed app is EXACTLY the browser
  // version; it refreshes itself on every deploy (fetchServerVersion).
  const [srv, setSrv] = useState<ServerVersion | null>(null)
  useEffect(() => {
    let alive = true
    const refresh = (): void => {
      void fetchServerVersion().then((j) => {
        if (alive && j) setSrv(j)
      })
    }
    refresh()
    const id = window.setInterval(refresh, 60_000)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [])
  // Error arriving via URL (e.g. ?error=closed). Shown once; doesn't change
  // after mount (there's no probe flow left to update it).
  const [notice] = useState<string | null>(
    error ? (t[ERR_KEY[error] ?? 'errGeneric'] as string) : null,
  )
  // Lead capture: a visitor leaves an email so the owner can reach them.
  const [leadEmail, setLeadEmail] = useState('')
  const [leadNote, setLeadNote] = useState('')
  const [leadBusy, setLeadBusy] = useState(false)
  const [leadSent, setLeadSent] = useState(false)

  async function submitLead(): Promise<void> {
    if (leadBusy || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(leadEmail)) return
    setLeadBusy(true)
    const fp = await deviceFingerprint()
    try {
      const r = await fetch('/api/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: leadEmail, note: leadNote, fp }),
      })
      if (r.ok) {
        setLeadSent(true)
        setLeadEmail('')
        setLeadNote('')
      }
    } catch {
      /* ignore */
    }
    setLeadBusy(false)
  }

  // Visit beacon: every arrival lands in the owner's analytics (server dedupes
  // 6h). Eticheta „acasă" hrănește raportul „ce au vizitat" (owner, 13 aug).
  useEffect(() => raporteazaPagina('acasă'), [])

  const currentLang = LANGUAGES.find((l) => l.code === lang)

  return (
    <div className="landing">
      {/* THE MANUAL, top-right (Adrian): anyone, without an account, can read
      everything the app does — picks their language and downloads it in that
      language. */}
      <div className="landing-top-bar">
        {/* Language selector — compact capsule with vertical dropdown */}
        <div className="lang-selector">
          <button
            type="button"
            className="lang-btn"
            onClick={() => setLangOpen((v) => !v)}
            aria-haspopup="listbox"
            aria-expanded={langOpen}
          >
            <span className="lang-icon">🌐</span>
            <span className="lang-label">{currentLang?.label}</span>
            <span className="lang-arrow">{langOpen ? '▲' : '▼'}</span>
          </button>
          {langOpen && (
            <ul className="lang-dropdown" role="listbox">
              {LANGUAGES.map((l) => (
                <li
                  key={l.code}
                  role="option"
                  aria-selected={l.code === lang}
                  className={l.code === lang ? 'selected' : ''}
                  onClick={() => {
                    setLang(l.code)
                    setLangOpen(false)
                  }}
                >
                  {l.label}
                </li>
              ))}
            </ul>
          )}
        </div>
        <a className="landing-manual-btn" href="/manual">{PT.userManual}</a>
      </div>
      <div className="landing-hero">
        {/* Same proven framing as the in-app stage: camera at chest height looking
            AT the chest (target), so the head and torso fill the hero. */}
        {/* Avatarul 3D + AvatarLoading trăiesc în chunk-ul lazy LandingAvatar —
            three.js nu mai blochează prima vopsire a hero-ului. */}
        <Suspense fallback={null}>
          <LandingAvatar />
        </Suspense>
        <div className="landing-hero-fade" />
      </div>

      <div className="landing-panel">
        <div className="landing-content">
          <span className="brand-lg">Kelionai</span>
          <h1 className="landing-headline">{t.landingHeadline}</h1>
          <p className="landing-sub">{t.landingSub}</p>

          <div className="landing-multi">
            <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="9" />
              <path d="M3 12h18M12 3c2.5 2.5 3.8 5.8 3.8 9S14.5 18.5 12 21c-2.5-2.5-3.8-5.8-3.8-9S9.5 5.5 12 3z" />
            </svg>
            <span>{t.multilingual}</span>
          </div>

          {notice && <p className="error">{notice}</p>}

          <div className="landing-cta">
            {/* No free trial (Adrian): the only way in is the Google account, then
            buying credits. Nobody gets free minutes anymore. */}
            <button type="button" className="google-btn cta-primary" onClick={startGoogleLogin}>
              <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="#FFC107"
                  d="M43.6 20.5H42V20H24v8h11.3C33.7 32.9 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 6.1 29.6 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.3-.4-3.5z"
                />
                <path
                  fill="#FF3D00"
                  d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 6.1 29.6 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
                />
                <path
                  fill="#4CAF50"
                  d="M24 44c5.2 0 10-2 13.6-5.2l-6.3-5.2C29.2 35 26.7 36 24 36c-5.3 0-9.7-3.1-11.3-7.6l-6.6 5.1C9.6 39.6 16.2 44 24 44z"
                />
                <path
                  fill="#1976D2"
                  d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4 5.5l6.3 5.2C41.4 36.5 44 31 44 24c0-1.3-.1-2.3-.4-3.5z"
                />
              </svg>
              {t.signIn}
            </button>
            {/* THE ORPHAN PAGES, LINKED (Jul 27 — built on the Jul 26 order but
            never linked from the landing; the audit found them untouched by any
            link): the email sign-in + the public prices. */}
            <div className="landing-alt-links">
              <a href="/login">{PT.emailSignIn}</a>
              <span aria-hidden>·</span>
              <a href="/credite">{PT.creditsPricing}</a>
            </div>
          </div>

          <div className="landing-lead">
            {leadSent ? (
              <p className="landing-lead-done">{PT.leadThanks}</p>
            ) : (
              <>
                <h3 className="landing-lead-title">{PT.leadTitle}</h3>
                <div className="landing-lead-row">
                  <input
                    className="landing-lead-input"
                    type="email"
                    placeholder={PT.emailPlaceholder}
                    value={leadEmail}
                    onChange={(e) => setLeadEmail(e.target.value)}
                  />
                  <button
                    type="button"
                    className="landing-lead-btn"
                    onClick={() => void submitLead()}
                    disabled={leadBusy || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(leadEmail)}
                  >
                    {leadBusy ? PT.leadSending : PT.leadSend}
                  </button>
                </div>
                <input
                  className="landing-lead-input landing-lead-note"
                  type="text"
                  placeholder={PT.leadNotePlaceholder}
                  value={leadNote}
                  onChange={(e) => setLeadNote(e.target.value)}
                />
              </>
            )}
          </div>

          <div className="landing-manual">
            <h3>{t.manualTitle}</h3>
            <ul>
              {t.features.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </div>

          {/* Four platforms, four scan codes — the ONLY download UI. Clicking a
              code opens it LARGE so any phone can scan it comfortably. Every
              target always serves the LATEST version: the store apps are thin
              live shells over kelionai.app, /dl/* is served no-store, and the
              .exe self-updates. Store targets get swapped in the moment a
              listing goes public (MS Store, Play, App Store). */}
          <div className="landing-qr">
            {/* Drumul UȘOR (Faza 1 M1): un tap instalează PWA-ul ca aplicație de
                sine stătătoare, FĂRĂ .exe/.apk — distinct de codurile QR de mai
                jos (instalatorul nativ per platformă). Apare DOAR când chiar se
                poate instala; pe iOS, instrucțiunea reală, nu un buton mort. */}
            <ButonInstalarePwa
              invitatie={t.instalDeviceInvitatie}
              eticheta={t.instalDeviceButon}
              hintIos={t.instalDeviceIos}
            />
            <span className="landing-qr-hint">{PT.qrHint}</span>
            <div className="landing-qr-row">
              {QR_CODES.map((q) => (
                <figure key={q.key}>
                  {/* THE CODE IS AN INSTALL BUTTON (Adrian, Jul 26: „when you press the
                  win code the win app installs... each according to his system").
                  Click/tap on the code → installs that platform; the enlarge-for-scanning
                  stays on the 🔍 button. */}
                  <a className="qr-btn" href={q.href} target={q.href.startsWith('http') ? '_blank' : undefined} rel="noreferrer" aria-label={PT.qrInstallLabel(q.label)}>
                    <img src={q.img} alt={PT.qrAlt(q.label)} width="96" height="96" />
                  </a>
                  <figcaption>{q.label}</figcaption>
                  {/* The watermark number, under EVERY code — the same as in the browser;
                  it proves the installed app is exactly the live version. */}
                  <span className="qr-version">{versionLabel(srv)}</span>
                  <a className="qr-install" href={q.href} target={q.href.startsWith('http') ? '_blank' : undefined} rel="noreferrer">
                    {PT.installBtn}
                  </a>
                  <button type="button" className="qr-zoom-btn" onClick={() => setQrZoom(q)} title={PT.zoomQr}>
                    🔍
                  </button>
                </figure>
              ))}
            </div>
          </div>

          <p className="landing-legal">
            <button type="button" className="landing-contact-link" onClick={() => setContactOpen(true)}>
              {PT.contactLink}
            </button>{' '}
            · <a href="/privacy">{t.privacyLabel}</a> · <a href="/terms">{t.termsLabel}</a>
            <br />
            {t.cookieNote}
          </p>
        </div>
      </div>
      {contactOpen && <ContactModal onClose={() => setContactOpen(false)} />}
      {qrZoom && (
        <div
          className="qr-zoom-overlay"
          role="button"
          tabIndex={0}
          onClick={() => setQrZoom(null)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' || e.key === 'Enter') setQrZoom(null)
          }}
        >
          <figure className="qr-zoom">
            <img src={qrZoom.img} alt={PT.qrAlt(qrZoom.label)} />
            <figcaption>
              {qrZoom.label}
              <span className="qr-zoom-hint">{PT.qrZoomHint}</span>
            </figcaption>
          </figure>
        </div>
      )}
      <VisitorChatWidget />
    </div>
  )
}
