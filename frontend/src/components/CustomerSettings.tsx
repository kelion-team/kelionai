import { useEffect, useState } from 'react'
import type { User } from '../lib/api'
import { logout } from '../lib/api'
import {
  loadServerPrefs,
  saveSpeechLang,
  deleteMyAccount,
  loadLocalLang,
} from '../lib/prefs'
import { fetchBalance, startCheckout, fetchHistory, type WalletStatus, type PurchaseRecord } from '../lib/billing'
import { LANGS } from '../lib/languages'

// SETĂRI CLIENT (plătitor). Un client are mai puțin acces decât adminul — nu
// vede panoul de admin — dar are propriul buton ⚙ cu trei secțiuni:
//   1. Preferințe de bază  — limba în care Kelion îl ascultă și îi vorbește.
//   2. Credit / portofel   — soldul, reîncărcare, ȘI mențiunea 25% către platformă.
//   3. Cont                — email, delogare, ștergere cont (GDPR).
// BYOK-provider a fost SCOS complet (Adrian, 12 iul: „scoatem vechiul provider") —
// creierul e pe Kimi/GLM, toți userii trec prin creditul de mai sus.
// Backend-ul (prefs + billing + me/delete) e deja verificat live. NU dublează
// cod: folosește exact aceleași rute pe care le folosește restul aplicației.

const AMOUNTS = [5, 10, 20, 50]

// Etichete în limba clientului (ro pentru vorbitorii de română, altfel engleză —
// clienții pot fi din orice limbă). Doar textele UI; valorile vin de la server.
interface L {
  title: string
  prefs: string
  langLabel: string
  wallet: string
  credits: string
  topUp: string
  marginNote: string
  account: string
  signedInAs: string
  loggingOut: string
  logout: string
  deleteAcc: string
  deleteConfirm: string
  deleting: string
  cancel: string
  close: string
}
const RO: L = {
  title: 'Setări',
  prefs: 'Preferințe de bază',
  langLabel: 'Limba în care Kelion te ascultă și îți vorbește',
  wallet: 'Credit / portofel',
  credits: 'credite disponibile',
  topUp: 'Reîncarcă',
  marginNote:
    'Din fiecare reîncărcare, 75% devine credit disponibil pentru tine, iar 25% merge către contul platformei (admin).',
  account: 'Cont',
  signedInAs: 'Conectat ca',
  loggingOut: 'Se deloghează…',
  logout: 'Deconectare',
  deleteAcc: 'Șterge contul',
  deleteConfirm:
    'Sigur ștergi contul? Se șterg definitiv mesajele, preferințele, memoria și portofelul. Ireversibil.',
  deleting: 'Se șterge…',
  cancel: 'Anulează',
  close: 'Închide',
}
const EN: L = {
  title: 'Settings',
  prefs: 'Basic preferences',
  langLabel: 'The language Kelion hears you in and speaks',
  wallet: 'Credit / wallet',
  credits: 'credits available',
  topUp: 'Top up',
  marginNote:
    'From each top-up, 75% becomes credit available to you, and 25% goes to the platform account (admin).',
  account: 'Account',
  signedInAs: 'Signed in as',
  loggingOut: 'Signing out…',
  logout: 'Sign out',
  deleteAcc: 'Delete account',
  deleteConfirm:
    'Delete your account? Your messages, preferences, memory and wallet are permanently erased. Irreversible.',
  deleting: 'Deleting…',
  cancel: 'Cancel',
  close: 'Close',
}

export default function CustomerSettings({
  user,
  onClose,
}: {
  readonly user: User
  readonly onClose: () => void
}): React.JSX.Element {
  const base = (loadLocalLang() ?? (typeof navigator !== 'undefined' ? navigator.language : 'en'))
    .slice(0, 2)
    .toLowerCase()
  const t = base === 'ro' ? RO : EN

  const [lang, setLang] = useState<string>('en-US')
  const [wallet, setWallet] = useState<WalletStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)

  useEffect(() => {
    void (async () => {
      const [p, b] = await Promise.all([loadServerPrefs(), fetchBalance()])
      if (p) {
        if (p.speechLang) setLang(p.speechLang)
      }
      if (b) setWallet(b)
    })()
  }, [])

  async function onLang(code: string): Promise<void> {
    setLang(code)
    await saveSpeechLang(code)
  }

  async function onLogout(): Promise<void> {
    setBusy(true)
    await logout()
    window.location.reload()
  }

  async function onDelete(): Promise<void> {
    setBusy(true)
    const ok = await deleteMyAccount()
    if (ok) {
      window.location.href = '/'
    } else {
      setBusy(false)
    }
  }

  return (
    <div className="contact-overlay" onClick={onClose}>
      <div className="contact-panel settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="contact-langbar">
          <div className="contact-title" style={{ margin: 0 }}>
            ⚙ {t.title}
          </div>
          <button type="button" className="contact-x" aria-label={t.close} onClick={onClose}>
            ✕
          </button>
        </div>

        {/* 1 — Preferințe de bază */}
        <section className="settings-sec">
          <h4>{t.prefs}</h4>
          <label className="contact-label">{t.langLabel}</label>
          <select value={lang} onChange={(e) => void onLang(e.target.value)}>
            {LANGS.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
        </section>

        {/* 2 — Credit / portofel (+ mențiunea 25%) */}
        <section className="settings-sec">
          <h4>{t.wallet}</h4>
          <div className="settings-credits">
            <strong>{wallet ? wallet.credits.toLocaleString() : '…'}</strong> {t.credits}
          </div>
          <div className="settings-topup">
            {AMOUNTS.map((a) => (
              <button key={a} type="button" className="ghost" onClick={() => void startCheckout(a)}>
                £{a}
              </button>
            ))}
          </div>
          <p className="settings-note">{t.marginNote}</p>
        </section>

        {/* 3 — Cont */}
        <section className="settings-sec">
          <h4>{t.account}</h4>
          <div className="settings-account">
            <span className="settings-note">
              {t.signedInAs} <strong>{user.email}</strong>
            </span>
          </div>
          <div className="settings-account-actions">
            <button type="button" className="ghost" disabled={busy} onClick={() => void onLogout()}>
              {busy ? t.loggingOut : t.logout}
            </button>
            {!confirmDel ? (
              <button
                type="button"
                className="ghost settings-danger"
                disabled={busy}
                onClick={() => setConfirmDel(true)}
              >
                {t.deleteAcc}
              </button>
            ) : (
              <div className="settings-confirm">
                <span className="settings-note">{t.deleteConfirm}</span>
                <div className="settings-confirm-row">
                  <button type="button" className="ghost" disabled={busy} onClick={() => setConfirmDel(false)}>
                    {t.cancel}
                  </button>
                  <button
                    type="button"
                    className="contact-send settings-danger-solid"
                    disabled={busy}
                    onClick={() => void onDelete()}
                  >
                    {busy ? t.deleting : t.deleteAcc}
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
