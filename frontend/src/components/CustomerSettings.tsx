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
import { fetchBalance, type WalletStatus } from '../lib/billing'
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
      const [p, b] = await Promise.all([loadServerPrefs(), fetchBalance()])
      if (p?.speechLang) setLang(p.speechLang)
      if (p?.voices?.length) setVoices(p.voices)
      setVoice(p?.voice ?? '')
      if (b) setWallet(b)
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

          {/* VOCEA, PER USER (Adrian, 30 iul: „își poate seta aplicația cu ce
              voce dorește… se ține minte per user. A nu se încurca cu alt user
              sau să afecteze alt cont"). Lista vine de la server — o listă
              paralelă aici s-ar învechi când se schimbă env-ul. */}
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

        {/* 2 — Credit / portofel (+ mențiunea 25%). Alimentarea MANUALĂ se face
            dintr-un SINGUR loc — pastila de credit din bară (Adrian, 24 iul:
            „utilizatorul trebuie să vadă doar acea parte de alimentare"). Aici
            rămân doar soldul, regula 25% și reîncărcarea automată. */}
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

          {/* Reîncărcare automată — ca să nu rămâi fără credit în mijlocul unei sesiuni */}
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
              {/* USERUL VEDE DOAR CREDITE (Adrian, 30 iul). Serverul lucrează în
                  lire (regula lui: multipli de £5), deci pachetele de mai jos sunt
                  aceleași sume, arătate în singura unitate care-l privește pe el.
                  Conversia rămâne aici, într-un singur loc. */}
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
