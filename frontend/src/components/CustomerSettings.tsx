import { useEffect, useState } from 'react'
import type { User } from '../lib/api'
import { logout } from '../lib/api'
import {
  loadServerPrefs,
  saveSpeechLang,
  deleteMyAccount,
  loadLocalLang,
} from '../lib/prefs'
import { fetchBalance, type WalletStatus } from '../lib/billing'
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
  // Default ENGLEZĂ până la identificarea limbii (nu limba browserului).
  const base = (loadLocalLang() ?? 'en')
    .slice(0, 2)
    .toLowerCase()
  const t = base === 'ro' ? RO : EN

  const [lang, setLang] = useState<string>('en-US')
  const [wallet, setWallet] = useState<WalletStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  // Modele selectabile (OpenRouter) + reîncărcare automată.
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
        /* endpointuri indisponibile → secțiunile rămân goale */
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
              ? 'Alimentezi din pastila de credit „＋" din bara de sus (prima dată £20, apoi multipli de £5).'
              : 'Top up from the credit pill “＋” in the top bar (first £20, then multiples of £5).'}
          </p>
          <p className="settings-note">{t.marginNote}</p>

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
              <span className="settings-note">{ro ? 'credite, reîncarcă £' : 'credits, top up £'}</span>
              {/* Multipli de £5 (regula cunoscută), min £5 — rotunjim la 5 la ieșire. */}
              <input
                type="number"
                min={5}
                max={500}
                step={5}
                value={ar.topupAmount}
                onChange={(e) => {
                  const n = Math.max(5, Math.min(500, Math.round(Number(e.target.value) / 5) * 5))
                  void onAr({ topupAmount: n })
                }}
                style={{ width: 70 }}
              />
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
