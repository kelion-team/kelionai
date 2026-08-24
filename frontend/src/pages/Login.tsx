// Intrarea prin email este verificată prin magic link; formularul nu creează
// direct identități neconfirmate. Adminul rămâne exclusiv pe sesiunea Google.
import React, { useState } from 'react'
import { PUBLIC_TEXT as T } from '../lib/publicText'
import BackLink from '../components/BackLink'
import { apiFetch } from '../lib/transport'
import { startGoogleLogin } from '../lib/api'

type Mode = 'login' | 'magic' | 'reset'

export default function Login(): React.JSX.Element {
  const resetToken = new URLSearchParams(window.location.search).get('reset') ?? ''
  const urlError = new URLSearchParams(window.location.search).get('error') ?? ''
  const [mode, setMode] = useState<Mode>(resetToken ? 'reset' : 'login')
  const [email, setEmail] = useState('')
  const [pass, setPass] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState(urlError === 'link_expirat' ? T.errLinkExpired : '')

  const post = async (url: string, body: object): Promise<{ ok?: boolean; error?: string }> => {
    const r = await apiFetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    return (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string }
  }

  const ERR: Record<string, string> = {
    email_invalid: T.errEmailInvalid,
    parola_scurta: T.errPasswordShort,
    date_gresite: T.errWrongCredentials,
    link_expirat: T.errLinkExpired,
  }

  const submit = async (): Promise<void> => {
    setBusy(true)
    setNote('')
    try {
      if (mode === 'login') {
        const j = await post('/auth/local/login', { email, password: pass })
        if (j.ok) window.location.href = '/'
        else setNote(ERR[j.error ?? ''] ?? T.errGeneric)
      } else if (mode === 'magic') {
        await post('/auth/local/magic', { email })
        setNote(T.magicSent)
      } else if (mode === 'reset') {
        const j = await post('/auth/local/reset', { token: resetToken, password: pass })
        if (j.ok) window.location.href = '/'
        else setNote(ERR[j.error ?? ''] ?? T.errResetGeneric)
      }
    } finally {
      setBusy(false)
    }
  }

  const forgot = async (): Promise<void> => {
    if (!email) {
      setNote(T.typeEmailFirst)
      return
    }
    await post('/auth/local/reset-request', { email })
    setNote(T.resetSent)
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <BackLink />
        <a className="login-brand" href="/">Kelionai</a>
        <h2 className="login-title">
          {mode === 'magic' ? T.magicTitle : mode === 'reset' ? T.resetTitle : T.loginTitle}
        </h2>

        {mode !== 'reset' && (
          <>
            <button type="button" className="login-google" onClick={startGoogleLogin}>🔵 {T.continueGoogle}</button>
            <div className="login-sep">{T.orEmail}</div>
          </>
        )}

        {mode !== 'reset' && (
          <input className="login-input" type="email" placeholder={T.emailPlaceholder} value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        )}
        {(mode === 'login' || mode === 'reset') && (
          <input
            className="login-input"
            type="password"
            placeholder={mode === 'reset' ? T.newPassword : T.password}
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            onKeyDown={(e) => { if (e.key === 'Enter') void submit() }}
          />
        )}

        <button type="button" className="login-submit" disabled={busy} onClick={() => void submit()}>
          {busy ? '…' : mode === 'login' ? T.signIn : mode === 'magic' ? T.sendLink : T.savePassword}
        </button>

        {note && <div className="login-note">{note}</div>}

        <div className="login-links">
          {mode === 'login' && (
            <>
              <button type="button" onClick={() => setMode('magic')}>{T.passwordless}</button>
              <button type="button" onClick={() => void forgot()}>{T.forgotPassword}</button>
            </>
          )}
          {mode !== 'login' && (
            <button type="button" onClick={() => setMode('login')}>← {T.backToSignIn}</button>
          )}
        </div>
        <div className="login-legal">
          <a href="/privacy">{T.privacyLink}</a> · <a href="/terms">{T.termsLink}</a>
        </div>
      </div>
    </div>
  )
}
