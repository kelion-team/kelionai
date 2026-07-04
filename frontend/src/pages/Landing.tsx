import { Suspense, useEffect, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import AvatarModel from '../components/AvatarModel'
import ContactModal from '../components/ContactModal'
import { startGoogleLogin, startDemo } from '../lib/api'
import { deviceFingerprint } from '../lib/fingerprint'
import { strings } from '../lib/i18n'
import { greetOnHover } from '../lib/voice'

// The four install codes — one per platform. Click → enlarged for scanning.
const QR_CODES = [
  { key: 'win', label: '⊞ Windows', img: '/dl/qr-win.png' },
  { key: 'linux', label: '🐧 Linux', img: '/dl/qr-linux.png' },
  { key: 'ios', label: 'iOS', img: '/dl/qr-ios.png' },
  { key: 'android', label: '🤖 Android', img: '/dl/qr-apk.png' },
] as const
type QrCode = (typeof QR_CODES)[number]

const ERR_KEY: Record<string, keyof ReturnType<typeof strings>> = {
  closed: 'errClosed',
  bad_state: 'errBadState',
  token_exchange: 'errTokenExchange',
  no_id_token: 'errNoIdToken',
  no_email: 'errNoEmail',
}

// The public start page: a professional hero with a LIVE 3D Kelion, plus the two
// ways in — a free 3-minute trial (no sign-up) and Google sign-in.
// AUTOMATICALLY multilingual: the UI follows the visitor's browser language
// (en/ro/es/fr/de/it/pt; anything else falls back to English). The conversation
// itself adapts to dozens of languages independently of the UI.
export default function Landing({ error }: { error?: string | null }) {
  // The start page is ALWAYS English — the professional international default.
  // (The conversation itself still adapts to the visitor's own language.)
  const t = strings('en')
  const [busy, setBusy] = useState(false)
  const [contactOpen, setContactOpen] = useState(false)
  const [qrZoom, setQrZoom] = useState<QrCode | null>(null)
  const [notice, setNotice] = useState<string | null>(
    error ? (t[ERR_KEY[error] ?? 'errGeneric'] as string) : null,
  )

  // Visit beacon: every arrival lands in the owner's analytics (server dedupes
  // 6h; the sessionStorage guard just avoids re-firing on SPA re-renders).
  useEffect(() => {
    if (sessionStorage.getItem('kelion_visited')) return
    sessionStorage.setItem('kelion_visited', '1')
    void deviceFingerprint().then((fp) =>
      fetch('/api/visit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fp, ref: document.referrer }),
      }).catch(() => {}),
    )
  }, [])

  async function tryDemo(): Promise<void> {
    if (busy) return
    setBusy(true)
    setNotice(null)
    const fp = await deviceFingerprint()
    const res = await startDemo(fp, document.referrer)
    if (res === 'ok') {
      window.location.href = '/' // reload into the live app on the demo session
      return
    }
    setBusy(false)
    setNotice(
      res === 'already_used' ? t.trialUsed : res === 'cap_reached' ? t.trialBusy : t.errGeneric,
    )
  }

  return (
    <div className="landing">
      {/* Hover over Kelion → he greets you, time-appropriately, in his own voice
          with his mouth moving (landing page only, never after login). */}
      <div className="landing-hero" onMouseEnter={() => void greetOnHover()}>
        {/* Same proven framing as the in-app stage: camera at chest height looking
            AT the chest (target), so the head and torso fill the hero. */}
        <Canvas shadows camera={{ position: [0, 0.7, 2.4], fov: 40 }} dpr={[1, 2]}>
          <color attach="background" args={['#0b0d12']} />
          {/* Self-contained lighting (no remote HDR): a third-party CDN failure
              must never leave the marketing hero black. Key + fill + cool rim. */}
          <ambientLight intensity={0.75} />
          <directionalLight position={[2, 3, 2]} intensity={1.7} castShadow />
          <directionalLight position={[-2.5, 1.2, -2]} intensity={0.7} color="#8fb6ff" />
          <Suspense fallback={null}>
            <AvatarModel />
          </Suspense>
          <OrbitControls
            enablePan={false}
            enableZoom={false}
            minPolarAngle={Math.PI / 2.3}
            maxPolarAngle={Math.PI / 1.95}
            minAzimuthAngle={-Math.PI / 60}
            maxAzimuthAngle={Math.PI / 60}
            target={[0, 0.7, 0]}
          />
        </Canvas>
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
            <button
              type="button"
              className="cta-primary"
              onClick={() => void tryDemo()}
              disabled={busy}
            >
              {busy ? t.trialStarting : t.tryFree}
            </button>
            <button type="button" className="google-btn" onClick={startGoogleLogin}>
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
            <span className="landing-qr-hint">Scan to install — click a code to enlarge it</span>
            <div className="landing-qr-row">
              {QR_CODES.map((q) => (
                <figure key={q.key}>
                  <button type="button" className="qr-btn" onClick={() => setQrZoom(q)}>
                    <img src={q.img} alt={`QR — ${q.label}`} width="96" height="96" />
                  </button>
                  <figcaption>{q.label}</figcaption>
                </figure>
              ))}
            </div>
          </div>

          <p className="landing-legal">
            <button type="button" className="landing-contact-link" onClick={() => setContactOpen(true)}>
              Contact
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
            <img src={qrZoom.img} alt={`QR — ${qrZoom.label}`} />
            <figcaption>
              {qrZoom.label}
              <span className="qr-zoom-hint">Scan with your phone — tap anywhere to close</span>
            </figcaption>
          </figure>
        </div>
      )}
    </div>
  )
}
