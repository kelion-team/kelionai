import { useEffect, useState } from 'react'
import BackLink from './BackLink'
import type { User } from '../lib/api'
import { logout } from '../lib/api'
import {
  loadServerPrefs,
  saveSpeechLang,
  deleteMyAccount,
  loadLocalLang,
  saveVoicePref,
} from '../lib/prefs'
import { fetchBalance, fetchHistory, type WalletStatus, type PurchaseRecord } from '../lib/billing'
import { LANGS } from '../lib/languages'

// CLIENT SETTINGS (paying). A client has less access than the admin — doesn't
// see the admin panel — but has their own ⚙ button with three sections:
//   1. Basic preferences — the language Kelion listens and speaks to them in.
//   2. Credit / wallet    — balance, top-up, AND the 25% platform share note.
//   3. Account            — email, logout, account deletion (GDPR).
// BYOK-provider a fost SCOS complet (Adrian, 12 iul: „scoatem vechiul provider") —
// the brain is on Kimi/GLM, all users go through the credit above.
// The backend (prefs + billing + me/delete) is already verified live. It does NOT
// duplicate code: it uses exactly the same routes the rest of the app uses.

// Labels in the client's language (ro for Romanian speakers, otherwise English —
// clients can be from any language). Only the UI texts; values come from the server.
interface L {
  title: string
  prefs: string
  langLabel: string
  voiceLabel: string
  voiceDefault: string
  voiceNote: string
  wallet: string
  credits: string
  topUp: string
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
  voiceLabel: 'Vocea cu care îți vorbește Kelion',
  voiceDefault: 'Implicită (a aplicației)',
  voiceNote: 'Se ține minte doar pentru contul tău. Se aplică de la următoarea pornire a vocii.',
  wallet: 'Credit / portofel',
  credits: 'credite disponibile',
  topUp: 'Reîncarcă',
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
  voiceLabel: 'The voice Kelion speaks to you with',
  voiceDefault: 'Default (the app’s)',
  voiceNote: 'Remembered for your account only. It applies the next time voice starts.',
  wallet: 'Credit / wallet',
  credits: 'credits available',
  topUp: 'Top up',
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

// How much you get per pound. The same value as at purchase (WalletButton) —
// the user never sees pounds anywhere on their screen, only the resulting credits.
const CREDITE_PE_LIRA = 7.5

interface CatModel {
  id: string
  name: string
  provider: string
  vision: boolean
}

export default function CustomerSettings({
  user,
  onClose,
}: {
  readonly user: User
  readonly onClose: () => void
}): React.JSX.Element {
  // Default ENGLISH until language identification (not the browser language).
  const base = (loadLocalLang() ?? 'en')
    .slice(0, 2)
    .toLowerCase()
  const t = base === 'ro' ? RO : EN

  const [lang, setLang] = useState<string>('en-US')
  // The voice chosen by this person ('' = the app's default) + the allowed list,
  // both from the server.
  const [voice, setVoice] = useState<string>('')
  const [voices, setVoices] = useState<string[]>([])
  const [wallet, setWallet] = useState<WalletStatus | null>(null)
  // THE HISTORY (M4 „istoric", Aug 2): the person's own top-ups. `null` =
  // could not read (shown as such), `[]` = truly no purchases yet.
  const [istoric, setIstoric] = useState<PurchaseRecord[] | null | 'necitit'>('necitit')
  const [busy, setBusy] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  // Selectable models (OpenRouter) + automatic reload.
  const [catalog, setCatalog] = useState<{ chat: CatModel[]; work: CatModel[] }>({ chat: [], work: [] })
  const [sel, setSel] = useState<{ chat: string; work: string }>({ chat: '', work: '' })
  const [ar, setAr] = useState<{ enabled: boolean; threshold: number; topupAmount: number }>({
    enabled: false,
    threshold: 20,
    topupAmount: 10,
  })
  const ro = base === 'ro'

  useEffect(() => {
    void (async () => {
      const [p, b, h] = await Promise.all([loadServerPrefs(), fetchBalance(), fetchHistory()])
      if (p?.speechLang) setLang(p.speechLang)
      if (p?.voices?.length) setVoices(p.voices)
      setVoice(p?.voice ?? '')
      if (b) setWallet(b)
      setIstoric(h) // null = read failed (said as such, never an empty list)
      try {
        const [cat, s, a] = await Promise.all([
          fetch('/api/models/catalog', { credentials: 'include' }).then((r) => (r.ok ? r.json() : null)),
          fetch('/api/models/selection', { credentials: 'include' }).then((r) => (r.ok ? r.json() : null)),
          fetch('/api/billing/autorecharge', { credentials: 'include' }).then((r) => (r.ok ? r.json() : null)),
        ])
        if (cat) setCatalog({ chat: cat.chat ?? [], work: cat.work ?? [] })
        if (s) setSel({ chat: s.chat ?? '', work: s.work ?? '' })
        if (a) setAr({ enabled: !!a.enabled, threshold: Number(a.threshold ?? 20), topupAmount: Number(a.topupAmount ?? 10) })
      } catch {
        /* endpoints unavailable → the sections stay empty */
      }
    })()
  }, [])

  async function onModel(tier: 'chat' | 'work', model: string): Promise<void> {
    setSel((s) => ({ ...s, [tier]: model }))
    await fetch('/api/models/selection', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ tier, model }),
    }).catch(() => {})
  }

  async function onAr(patch: Partial<typeof ar>): Promise<void> {
    const next = { ...ar, ...patch }
    setAr(next)
    await fetch('/api/billing/autorecharge', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(next),
    }).catch(() => {})
  }

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
          <BackLink onBack={onClose} />
          <div className="contact-title" style={{ margin: 0 }}>
            ⚙ {t.title}
          </div>
          <button type="button" className="contact-x" aria-label={t.close} onClick={onClose}>
            ✕
          </button>
        </div>

        {/* 1 — Basic preferences */}
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

          {/* THE VOICE, PER USER (Adrian, Jul 30: „he can set the app with whatever
          voice he wants… it's remembered per user. Not to be mixed up with another
          user or affect another account”). The list comes from the server — a
          parallel list here would go stale when the env changes. */}
          {voices.length > 0 && (
            <>
              <label className="contact-label" style={{ marginTop: 12 }}>
                {t.voiceLabel}
              </label>
              <select
                value={voice}
                onChange={(e) => {
                  const v = e.target.value
                  setVoice(v)
                  void saveVoicePref(v || null)
                }}
              >
                <option value="">{t.voiceDefault}</option>
                {voices.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
              <p className="settings-note">{t.voiceNote}</p>
            </>
          )}
        </section>

        {/* 2 — Credit / wallet (+ the 25% note). MANUAL top-up happens from ONE
        single place — the credit pill in the bar (Adrian, Jul 24: „the user must
        see only that top-up part”). Here remain only the balance, the 25% rule
        and the automatic top-up. */}
        <section className="settings-sec">
          <h4>{t.wallet}</h4>
          <div className="settings-credits">
            <strong>{wallet ? wallet.credits.toLocaleString() : '…'}</strong> {t.credits}
          </div>
          <p className="settings-note">
            {ro
              ? 'Alimentezi din pastila de credit „＋" din bara de sus — alegi pachetul de credite dorit.'
              : 'Top up from the credit pill “＋” in the top bar — pick the credit pack you want.'}
          </p>

          {/* Automatic top-up — so you never run out of credit mid-session */}
          <label className="contact-label" style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={ar.enabled} onChange={(e) => void onAr({ enabled: e.target.checked })} />
            {ro ? 'Reîncărcare automată (să nu rămân fără credit)' : 'Auto top-up (never run out of credit)'}
          </label>
          {ar.enabled && (
            <div className="settings-topup" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="settings-note">{ro ? 'Când scad sub' : 'When below'}</span>
              <input
                type="number"
                min={0}
                value={ar.threshold}
                onChange={(e) => void onAr({ threshold: Math.max(0, Number(e.target.value)) })}
                style={{ width: 70 }}
              />
              <span className="settings-note">{ro ? 'credite, adaugă' : 'credits, add'}</span>
              {/* THE USER SEES ONLY CREDITS (Adrian, Jul 30). The server works in
              pounds (his rule: multiples of £5), so the packs below are the same
              amounts, shown in the only unit that concerns him. The conversion
              stays here, in a single place. */}
              <select
                value={ar.topupAmount}
                onChange={(e) => void onAr({ topupAmount: Number(e.target.value) })}
              >
                {[5, 10, 20, 50].map((lire) => (
                  <option key={lire} value={lire}>
                    {Math.floor(lire * CREDITE_PE_LIRA)} {ro ? 'credite' : 'credits'}
                  </option>
                ))}
              </select>
            </div>
          )}
          {ar.enabled && (
            <p className="settings-note">
              {ro
                ? 'Când ajungi sub prag, îți pregătim plata automat (cod unic + link) — confirmi cu o singură apăsare. Banii se mișcă doar la confirmarea ta: linkul Revolut nu poate trage singur din cont.'
                : 'When you drop below the threshold, we prepare your payment automatically (unique code + link) — you confirm with a single tap. Money moves only on your confirmation: the Revolut link cannot pull from your account by itself.'}
            </p>
          )}

          {/* THE PURCHASE HISTORY (M4 „istoric", Aug 2): the route existed with
          zero callers — the person could never see their own top-ups. A failed
          read says so; it is NOT shown as "no purchases" (rule no. 1). */}
          {istoric !== 'necitit' && (
            <div style={{ marginTop: 12 }}>
              <label className="contact-label">{ro ? 'Istoricul plăților' : 'Payment history'}</label>
              {istoric === null ? (
                <p className="settings-note">
                  {ro ? 'Nu am putut citi istoricul — reîncearcă.' : 'Could not read the history — try again.'}
                </p>
              ) : istoric.length === 0 ? (
                <p className="settings-note">{ro ? 'Nicio plată încă.' : 'No payments yet.'}</p>
              ) : (
                <ul className="settings-history">
                  {istoric.slice(0, 10).map((r) => (
                    <li key={r.id} className="settings-note" style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <span>{new Date(r.created_at).toLocaleDateString()}</span>
                      <span>£{r.amount} → {r.credits.toLocaleString()} {ro ? 'credite' : 'credits'}</span>
                      <span>{r.status}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>

        {/* 3 — Model AI (chat + creier), selectabil prin OpenRouter */}
        {(catalog.chat.length > 0 || catalog.work.length > 0) && (
          <section className="settings-sec">
            <h4>{ro ? 'Model AI' : 'AI model'}</h4>
            <label className="contact-label">{ro ? 'Chat (conversație)' : 'Chat'}</label>
            <select value={sel.chat} onChange={(e) => void onModel('chat', e.target.value)}>
              {catalog.chat.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <label className="contact-label" style={{ marginTop: 8 }}>
              {ro ? 'Creier (sarcini grele)' : 'Brain (heavy tasks)'}
            </label>
            <select value={sel.work} onChange={(e) => void onModel('work', e.target.value)}>
              {catalog.work.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <p className="settings-note">
              {ro
                ? 'Toate capabilitățile (voce, Google, memorie) merg la fel, indiferent de model.'
                : 'All capabilities (voice, Google, memory) work the same, whichever model you pick.'}
            </p>
          </section>
        )}

        {/* 4 — Cont */}
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
