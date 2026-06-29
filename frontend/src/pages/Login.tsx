import { startGoogleLogin } from '../lib/api'

const ERRORS: Record<string, string> = {
  closed: 'Kelionai is currently private. This account does not have access yet.',
  bad_state: 'Login failed (security check). Please try again.',
  token_exchange: 'Could not complete Google sign-in. Please try again.',
  no_id_token: 'Google did not return an identity. Please try again.',
  no_email: 'Could not read a verified email from Google.',
}

export default function Login({ error }: { error?: string | null }) {
  return (
    <div className="login">
      <div className="login-card">
        <h1 className="brand-lg">Kelionai</h1>
        <p className="tagline">Your assistant. Sign in to continue.</p>

        {error && <p className="error">{ERRORS[error] ?? 'Sign-in error. Please try again.'}</p>}

        <button className="google-btn" onClick={startGoogleLogin}>
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.9 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 6.1 29.6 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.3-.4-3.5z" />
            <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 6.1 29.6 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
            <path fill="#4CAF50" d="M24 44c5.2 0 10-2 13.6-5.2l-6.3-5.2C29.2 35 26.7 36 24 36c-5.3 0-9.7-3.1-11.3-7.6l-6.6 5.1C9.6 39.6 16.2 44 24 44z" />
            <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4 5.5l6.3 5.2C41.4 36.5 44 31 44 24c0-1.3-.1-2.3-.4-3.5z" />
          </svg>
          Sign in with Google
        </button>

        <p className="fine">Access is restricted. Only authorized accounts may enter.</p>
      </div>
    </div>
  )
}
