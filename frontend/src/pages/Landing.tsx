import { Suspense, useEffect, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import AvatarModel from '../components/AvatarModel'
import { startGoogleLogin, startDemo } from '../lib/api'
import { deviceFingerprint } from '../lib/fingerprint'
import { strings, browserLang } from '../lib/i18n'

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
  const t = strings(browserLang())
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(
    error ? (t[ERR_KEY[error] ?? 'errGeneric'] as string) : null,
  )

  // PWA install: when the browser offers native install (Android/desktop
  // Chrome), the app button triggers IT — no APK sideload, no Android
  // developer-verification block, no warnings. APK stays as the fallback.
  const [installEvt, setInstallEvt] = useState<{ prompt: () => Promise<void> } | null>(null)
  // iOS can't offer a programmatic install (Apple policy) — show the two-tap
  // Safari guide instead. Hidden when already running as the installed app.
  const isIos =
    /iphone|ipad|ipod/i.test(navigator.userAgent) &&
    !window.matchMedia('(display-mode: standalone)').matches
  const [iosHelp, setIosHelp] = useState(false)
  useEffect(() => {
    const h = (e: Event): void => {
      e.preventDefault()
      setInstallEvt(e as unknown as { prompt: () => Promise<void> })
    }
    window.addEventListener('beforeinstallprompt', h)
    return () => window.removeEventListener('beforeinstallprompt', h)
  }, [])

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
      <div className="landing-hero">
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

          <p className="landing-download">
            {installEvt && (
              <button
                type="button"
                className="install-btn"
                onClick={() => void installEvt.prompt()}
              >
                📱 {t.installApp}
              </button>
            )}
            {isIos && (
              <button type="button" className="install-btn" onClick={() => setIosHelp((v) => !v)}>
                 {t.iosInstall}
              </button>
            )}
            <a href="/dl/Kelionai-Setup.exe" download>
              ⊞ {t.downloadWin}
            </a>
            {!installEvt && !isIos && (
              <a href="/dl/Kelionai.apk" download>
                🤖 {t.downloadAndroid}
              </a>
            )}
          </p>
          {iosHelp && <p className="ios-steps">{t.iosSteps}</p>}

          {/* Scan to install on a phone/tablet — shown next to the desktop
              downloads so a visitor can jump straight to the mobile app. */}
          <div className="landing-qr">
            <span className="landing-qr-hint">{t.scanHint}</span>
            <div className="landing-qr-row">
              <figure>
                <img src="/dl/qr-site.png" alt="QR — Kelionai app" width="96" height="96" />
                <figcaption>{t.installApp}</figcaption>
              </figure>
              <figure>
                <img src="/dl/qr-play.png" alt="QR — Google Play" width="96" height="96" />
                <figcaption>Google Play</figcaption>
              </figure>
              <figure>
                <img src="/dl/qr-apk.png" alt="QR — Android APK" width="96" height="96" />
                <figcaption>APK</figcaption>
              </figure>
            </div>
          </div>

          <p className="landing-legal">
            {t.cookieNote}{' '}
            <a href="/privacy">{t.privacyLabel}</a> · <a href="/terms">{t.termsLabel}</a>
          </p>
        </div>
      </div>
    </div>
  )
}
