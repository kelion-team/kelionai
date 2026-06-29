import { startGoogleLogin } from '../lib/api'
import { browserLang, strings } from '../lib/i18n'

const ERR_KEY: Record<string, keyof ReturnType<typeof strings>> = {
  closed: 'errClosed',
  bad_state: 'errBadState',
  token_exchange: 'errTokenExchange',
  no_id_token: 'errNoIdToken',
  no_email: 'errNoEmail',
}

export default function Login({ error }: { error?: string | null }) {
  const t = strings(browserLang())
  const errMsg = error ? t[ERR_KEY[error] ?? 'errGeneric'] : null

  return (
    <div className="login">
      <div className="login-card">
        <h1 className="brand-lg">Kelionai</h1>
        <p className="tagline">{t.tagline}</p>

        {errMsg && <p className="error">{errMsg}</p>}

        <button className="google-btn" type="button" onClick={startGoogleLogin}>
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.9 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 6.1 29.6 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.3-.4-3.5z" />
            <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 6.1 29.6 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
            <path fill="#4CAF50" d="M24 44c5.2 0 10-2 13.6-5.2l-6.3-5.2C29.2 35 26.7 36 24 36c-5.3 0-9.7-3.1-11.3-7.6l-6.6 5.1C9.6 39.6 16.2 44 24 44z" />
            <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4 5.5l6.3 5.2C41.4 36.5 44 31 44 24c0-1.3-.1-2.3-.4-3.5z" />
          </svg>
          {t.signIn}
        </button>

        <p className="fine">{t.restricted}</p>
      </div>
    </div>
  )
}
