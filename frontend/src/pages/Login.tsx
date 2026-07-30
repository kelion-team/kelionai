// PAGINA DEDICATĂ DE LOGIN (Adrian, 26 iul: „să avem pagină dedicată de login...
// da, pornește, inclusiv să poată crea"). Toate căile într-un singur loc:
//   • email + parolă (login SAU creare cont — comutator)
//   • link magic pe email (fără parolă; contul se creează din zbor la click)
//   • resetare parolă (?reset=TOKEN vine din emailul de resetare)
//   • Google (procedura completă — alegerea contului + reautentificare)
// Identitatea = emailul, deci contul local are TOATE funcțiile (mai puțin
// skill-urile pe datele Google personale, imposibile fără cont Google).
import React, { useState } from 'react'
import { PUBLIC_TEXT as T } from '../lib/publicText'
import BackLink from '../components/BackLink'

type Mode = 'login' | 'register' | 'magic' | 'reset'

export default function Login(): React.JSX.Element {
  const resetToken = new URLSearchParams(window.location.search).get('reset') ?? ''
  const urlError = new URLSearchParams(window.location.search).get('error') ?? ''
  const [mode, setMode] = useState<Mode>(resetToken ? 'reset' : 'login')
  const [email, setEmail] = useState('')
  const [pass, setPass] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState(urlError === 'link_expirat' ? T.errLinkExpired : '')

  const post = async (url: string, body: object): Promise<{ ok?: boolean; error?: string }> => {
    const r = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    return (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string }
  }

  const ERR: Record<string, string> = {
    email_invalid: T.errEmailInvalid,
    parola_scurta: T.errPasswordShort,
    cont_existent: T.errAccountExists,
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
      } else if (mode === 'register') {
        const j = await post('/auth/local/register', { email, password: pass, name })
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
          {mode === 'register' ? T.registerTitle : mode === 'magic' ? T.magicTitle : mode === 'reset' ? T.resetTitle : T.loginTitle}
        </h2>

        {mode !== 'reset' && (
          <>
            <a className="login-google" href="/auth/google/login">🔵 {T.continueGoogle}</a>
            <div className="login-sep">{T.orEmail}</div>
          </>
        )}

        {mode === 'register' && (
          <input className="login-input" placeholder={T.yourName} value={name} onChange={(e) => setName(e.target.value)} />
        )}
        {mode !== 'reset' && (
          <input className="login-input" type="email" placeholder="email@exemplu.com" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        )}
        {(mode === 'login' || mode === 'register' || mode === 'reset') && (
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
          {busy ? '…' : mode === 'login' ? T.signIn : mode === 'register' ? T.createAccount : mode === 'magic' ? T.sendLink : T.savePassword}
        </button>

        {note && <div className="login-note">{note}</div>}

        <div className="login-links">
          {mode === 'login' && (
            <>
              <button type="button" onClick={() => setMode('register')}>{T.noAccount}</button>
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
