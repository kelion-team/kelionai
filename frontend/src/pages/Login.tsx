// PAGINA DEDICATĂ DE LOGIN (Adrian, 26 iul: „să avem pagină dedicată de login...
// da, pornește, inclusiv să poată crea"). Toate căile într-un singur loc:
//   • email + parolă (login SAU creare cont — comutator)
//   • link magic pe email (fără parolă; contul se creează din zbor la click)
//   • resetare parolă (?reset=TOKEN vine din emailul de resetare)
//   • Google (procedura completă — alegerea contului + reautentificare)
// Identitatea = emailul, deci contul local are TOATE funcțiile (mai puțin
// skill-urile pe datele Google personale, imposibile fără cont Google).
import React, { useState } from 'react'

type Mode = 'login' | 'register' | 'magic' | 'reset'

export default function Login(): React.JSX.Element {
  const resetToken = new URLSearchParams(window.location.search).get('reset') ?? ''
  const urlError = new URLSearchParams(window.location.search).get('error') ?? ''
  const [mode, setMode] = useState<Mode>(resetToken ? 'reset' : 'login')
  const [email, setEmail] = useState('')
  const [pass, setPass] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState(urlError === 'link_expirat' ? 'Linkul a expirat — cere unul nou.' : '')

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
    email_invalid: 'Emailul nu arată valid.',
    parola_scurta: 'Parola trebuie să aibă minim 8 caractere.',
    cont_existent: 'Există deja un cont cu emailul ăsta — intră cu parola sau cere link magic.',
    date_gresite: 'Email sau parolă greșite.',
    link_expirat: 'Linkul a expirat — cere unul nou.',
  }

  const submit = async (): Promise<void> => {
    setBusy(true)
    setNote('')
    try {
      if (mode === 'login') {
        const j = await post('/auth/local/login', { email, password: pass })
        if (j.ok) window.location.href = '/'
        else setNote(ERR[j.error ?? ''] ?? 'Nu a mers — mai încearcă.')
      } else if (mode === 'register') {
        const j = await post('/auth/local/register', { email, password: pass, name })
        if (j.ok) window.location.href = '/'
        else setNote(ERR[j.error ?? ''] ?? 'Nu a mers — mai încearcă.')
      } else if (mode === 'magic') {
        await post('/auth/local/magic', { email })
        setNote('Dacă emailul e valid, linkul de intrare e pe drum — verifică inboxul (și Spam).')
      } else if (mode === 'reset') {
        const j = await post('/auth/local/reset', { token: resetToken, password: pass })
        if (j.ok) window.location.href = '/'
        else setNote(ERR[j.error ?? ''] ?? 'Nu a mers — cere alt link de resetare.')
      }
    } finally {
      setBusy(false)
    }
  }

  const forgot = async (): Promise<void> => {
    if (!email) {
      setNote('Scrie emailul mai întâi, apoi apasă „Am uitat parola".')
      return
    }
    await post('/auth/local/reset-request', { email })
    setNote('Dacă există cont pe emailul ăsta, linkul de resetare e pe drum.')
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <a className="login-brand" href="/">Kelionai</a>
        <h2 className="login-title">
          {mode === 'register' ? 'Creează-ți contul' : mode === 'magic' ? 'Intră cu link pe email' : mode === 'reset' ? 'Parolă nouă' : 'Intră în cont'}
        </h2>

        {mode !== 'reset' && (
          <>
            <a className="login-google" href="/auth/google/login">🔵 Continuă cu Google</a>
            <div className="login-sep">sau cu emailul tău</div>
          </>
        )}

        {mode === 'register' && (
          <input className="login-input" placeholder="Numele tău" value={name} onChange={(e) => setName(e.target.value)} />
        )}
        {mode !== 'reset' && (
          <input className="login-input" type="email" placeholder="email@exemplu.com" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        )}
        {(mode === 'login' || mode === 'register' || mode === 'reset') && (
          <input
            className="login-input"
            type="password"
            placeholder={mode === 'reset' ? 'Parola nouă (minim 8 caractere)' : 'Parola'}
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            onKeyDown={(e) => { if (e.key === 'Enter') void submit() }}
          />
        )}

        <button type="button" className="login-submit" disabled={busy} onClick={() => void submit()}>
          {busy ? '…' : mode === 'login' ? 'Intră' : mode === 'register' ? 'Creează contul' : mode === 'magic' ? 'Trimite-mi linkul' : 'Salvează parola'}
        </button>

        {note && <div className="login-note">{note}</div>}

        <div className="login-links">
          {mode === 'login' && (
            <>
              <button type="button" onClick={() => setMode('register')}>Nu ai cont? Creează unul</button>
              <button type="button" onClick={() => setMode('magic')}>Intră fără parolă (link pe email)</button>
              <button type="button" onClick={() => void forgot()}>Am uitat parola</button>
            </>
          )}
          {mode !== 'login' && (
            <button type="button" onClick={() => setMode('login')}>← Înapoi la login</button>
          )}
        </div>
        <div className="login-legal">
          <a href="/privacy">Confidențialitate</a> · <a href="/terms">Termeni</a>
        </div>
      </div>
    </div>
  )
}
