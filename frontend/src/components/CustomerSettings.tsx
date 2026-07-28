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
  const isAdmin = user.role === 'admin'
  // CREIERUL DE ABONAMENT (Adrian, 28 iul) — comutator admin-only + cheia proprie
  // + soldul (card ca la OpenRouter). Userii nu văd această secțiune.
  interface SubBalance {
    ok: boolean
    balance: number
    low: boolean
    topup: string
    error?: string
  }
  const [sub, setSub] = useState<{
    mode: 'free' | 'subscription'
    model: string
    hasKey: boolean
    keyHint: string
    balance: SubBalance | null
  }>({ mode: 'free', model: '', hasKey: false, keyHint: '', balance: null })
  const [subKeyInput, setSubKeyInput] = useState('')
  const [subBusy, setSubBusy] = useState(false)

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
      // Creierul de abonament — DOAR pentru admin (userii nici nu ating ruta).
      if (isAdmin) {
        try {
          const d = await fetch('/api/admin/brain-sub', { credentials: 'include' }).then((r) =>
            r.ok ? r.json() : null,
          )
          if (d) setSub(d)
        } catch {
          /* ruta indisponibilă → secțiunea rămâne pe implicit */
        }
      }
    })()
  }, [isAdmin])

  async function saveSub(patch: { mode?: 'free' | 'subscription'; model?: string; key?: string }): Promise<void> {
    setSubBusy(true)
    try {
      const r = await fetch('/api/admin/brain-sub', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(patch),
      })
      if (r.ok) {
        setSub(await r.json())
        if (patch.key !== undefined) setSubKeyInput('')
      }
    } catch {
      /* rețea → starea rămâne cum era */
    }
    setSubBusy(false)
  }

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

        {/* 3.5 — CREIERUL DE ABONAMENT (Adrian, 28 iul) — DOAR admin. Comutator
            Free ⟷ Abonament + model puternic selectabil MANUAL + cheia proprie +
            soldul (card ca la OpenRouter). Userii nu văd această secțiune. */}
        {isAdmin && (
          <section className="settings-sec">
            <h4>{ro ? 'Creier abonament (doar tu)' : 'Subscription brain (you only)'}</h4>
            <p className="settings-note">
              {ro
                ? 'Comutatorul e DOAR pentru tine. Pe cererile grele (raționament/acțiune), creierul tău urcă pe modelul puternic ales mai jos, plătit din CHEIA TA. Userii rămân pe creierul de acum.'
                : 'This switch is for YOU only. On heavy requests, your brain moves up to the powerful model chosen below, paid from YOUR key. Users stay on the current brain.'}
            </p>

            {/* Comutator Free ⟷ Abonament */}
            <div style={{ display: 'inline-flex', border: '1px solid rgba(140,150,180,0.4)', borderRadius: 8, overflow: 'hidden', marginBottom: 6 }}>
              {(['free', 'subscription'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  disabled={subBusy}
                  onClick={() => void saveSub({ mode: m })}
                  style={{
                    border: 0,
                    padding: '6px 18px',
                    cursor: subBusy ? 'default' : 'pointer',
                    font: 'inherit',
                    background: sub.mode === m ? '#4f7cff' : 'transparent',
                    color: sub.mode === m ? '#fff' : 'inherit',
                  }}
                >
                  {m === 'free' ? 'Free' : ro ? 'Abonament' : 'Subscription'}
                </button>
              ))}
            </div>

            {/* Model puternic — selectabil MANUAL, identic cu selectorul de creier */}
            <label className="contact-label" style={{ marginTop: 8 }}>
              {ro ? 'Model puternic (pe abonament)' : 'Powerful model (on subscription)'}
            </label>
            <select value={sub.model} disabled={subBusy} onChange={(e) => void saveSub({ model: e.target.value })}>
              {/* modelul curent apare mereu, chiar dacă nu e în catalogul filtrat */}
              {sub.model && !catalog.work.some((m) => m.id === sub.model) && (
                <option value={sub.model}>{sub.model}</option>
              )}
              {catalog.work.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>

            {/* Cheia proprie — UNDE PUI CHEIA */}
            <label className="contact-label" style={{ marginTop: 8 }}>
              {ro ? 'Cheia ta OpenRouter (sk-or-…)' : 'Your OpenRouter key (sk-or-…)'}
            </label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                type="password"
                autoComplete="off"
                placeholder={sub.hasKey ? `${ro ? 'setată' : 'set'} ${sub.keyHint}` : 'sk-or-…'}
                value={subKeyInput}
                onChange={(e) => setSubKeyInput(e.target.value)}
                style={{ flex: 1 }}
              />
              <button
                type="button"
                className="ghost"
                disabled={subBusy || !subKeyInput.trim()}
                onClick={() => void saveSub({ key: subKeyInput.trim() })}
              >
                {ro ? 'Salvează' : 'Save'}
              </button>
              {sub.hasKey && (
                <button
                  type="button"
                  className="ghost settings-danger"
                  disabled={subBusy}
                  onClick={() => void saveSub({ key: '' })}
                >
                  {ro ? 'Șterge' : 'Remove'}
                </button>
              )}
            </div>
            <p className="settings-note">
              {ro
                ? 'Cheia o generezi la openrouter.ai/keys (contul tău, creditul tău) și o lipești aici. Stă doar pe server, nu se afișează niciodată înapoi.'
                : 'Generate the key at openrouter.ai/keys (your account, your credit) and paste it here. Stored server-side only, never shown back.'}
            </p>

            {/* Afișajul de sold — EXACT ca la OpenRouter (e o cheie OpenRouter) */}
            {sub.hasKey && sub.balance && (
              <div
                style={{
                  marginTop: 8,
                  padding: '8px 12px',
                  borderRadius: 8,
                  display: 'flex',
                  gap: 10,
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  fontSize: 14,
                  background: sub.balance.low ? 'rgba(255,80,80,0.15)' : 'rgba(80,140,255,0.14)',
                }}
              >
                {sub.balance.ok ? (
                  <>
                    <span>
                      {ro ? 'Sold abonament' : 'Subscription balance'}:{' '}
                      <strong>${sub.balance.balance.toFixed(2)}</strong>
                      {sub.balance.low ? (ro ? ' — depune bani!' : ' — top up!') : ''}
                    </span>
                    <a href={sub.balance.topup} target="_blank" rel="noopener noreferrer">
                      {ro ? 'alimentează' : 'top up'}
                    </a>
                  </>
                ) : (
                  <span>
                    {ro ? 'Sold indisponibil' : 'Balance unavailable'}
                    {sub.balance.error ? ` (${sub.balance.error})` : ''}
                  </span>
                )}
              </div>
            )}
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
