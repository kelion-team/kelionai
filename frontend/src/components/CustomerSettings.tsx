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
import { resolveLang, strings } from '../lib/i18n'
// the user never sees pounds anywhere on their screen, only the resulting credits.
const CREDITE_PE_LIRA = 7.5

// MODEL SELECTOR ASCUNS (Adrian, 3 aug: „migrăm complet pe Gemini"). Secțiunea 3
// de mai jos era un <select> cu catalogul de modele rutate prin OpenRouter
// (Claude, ByteDance, Gemma etc.). UI-ul e ascuns; starea (catalog/sel) și
// handler-ul de salvare (onModel) rămân conectate ca să nu se strice nimic.
// Pune pe false ca să reapară selectorul.
const MODEL_SELECTOR_HIDDEN: boolean = true

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
  const [lang, setLang] = useState<string>(loadLocalLang() ?? 'en')
  const base = lang.slice(0, 2).toLowerCase()
  const ro = base === 'ro'
  const t = strings(resolveLang(lang))
  const [voice, setVoice] = useState<string>('')
  const [voices, setVoices] = useState<string[]>([])
  const [wallet, setWallet] = useState<WalletStatus | null | 'necitit'>('necitit')
  const [saveErr, setSaveErr] = useState('')
  const [istoric, setIstoric] = useState<PurchaseRecord[] | null | 'necitit'>('necitit')
  const [busy, setBusy] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const [catalog, setCatalog] = useState<{ chat: CatModel[]; work: CatModel[] }>({ chat: [], work: [] })
  const [sel, setSel] = useState<{ chat: string; work: string }>({ chat: '', work: '' })
  const [ar, setAr] = useState<{ enabled: boolean; threshold: number; topupAmount: number }>({
    enabled: false,
    threshold: 20,
    topupAmount: 10,
  })
  const [voiceprint, setVoiceprint] = useState<{
    email: string
    gender?: string
    updated_at?: string
    meta?: { pitchMeanHz?: number; pitchStdHz?: number; voicedRatio?: number }
  } | null | 'necitit' | 'esuat'>('necitit')
  const [recordingVp, setRecordingVp] = useState(false)
  const [vpMsg, setVpMsg] = useState('')

  useEffect(() => {
    void (async () => {
      const [p, b, h, vpRes] = await Promise.all([
        loadServerPrefs(),
        fetchBalance(),
        fetchHistory(),
        fetch('/api/voiceprint/me', { credentials: 'include' })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
      ])
      if (p?.speechLang) setLang(p.speechLang)
      if (p?.voices?.length) setVoices(p.voices)
      setVoice(p?.voice ?? '')
      setWallet(b) // null = citirea a picat — se afișează ca eșec, nu „…" pe veci
      setIstoric(h) // null = read failed (said as such, never an empty list)
      if (vpRes && vpRes.voiceprint) {
        setVoiceprint(vpRes.voiceprint)
      } else if (vpRes && vpRes.voiceprint === null) {
        setVoiceprint(null) // serverul a spus clar: contul N-ARE amprentă
      } else {
        // vpRes === null = citirea a PICAT (401 sesiune/500 DB/rețea) — NU „n-are
        // amprentă". Nu mai colapsăm eșecul peste absența reală (owner, 19 aug).
        setVoiceprint('esuat')
      }
      try {
        // CÂT SELECTORUL DE MODELE E ASCUNS, nu mai cerem catalogul/selecția
        // (auditul admin, 3 aug: date cerute și aruncate la fiecare deschidere).
        const [cat, s, a] = await Promise.all([
          MODEL_SELECTOR_HIDDEN ? Promise.resolve(null) : fetch('/api/models/catalog', { credentials: 'include' }).then((r) => (r.ok ? r.json() : null)),
          MODEL_SELECTOR_HIDDEN ? Promise.resolve(null) : fetch('/api/models/selection', { credentials: 'include' }).then((r) => (r.ok ? r.json() : null)),
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

  // TOATE SALVĂRILE VERIFICĂ REZULTATUL (auditul admin, 3 aug): înainte,
  // .catch(() => {}) fără r.ok lăsa checkbox-ul/selectul pe ecran ca „salvat"
  // când serverul refuzase — la realitate serverul avea altă valoare. Pe eșec:
  // revert la valoarea anterioară + nota „Nu s-a salvat".
  async function onModel(tier: 'chat' | 'work', model: string): Promise<void> {
    const inainte = sel
    setSel((s) => ({ ...s, [tier]: model }))
    const r = await fetch('/api/models/selection', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ tier, model }),
    }).catch(() => null)
    if (!r?.ok) {
      setSel(inainte)
      setSaveErr(ro ? 'Nu s-a salvat modelul — reîncearcă.' : 'The model was not saved — try again.')
    } else setSaveErr('')
  }

  async function onAr(patch: Partial<typeof ar>): Promise<void> {
    const inainte = ar
    const next = { ...ar, ...patch }
    setAr(next)
    const r = await fetch('/api/billing/autorecharge', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(next),
    }).catch(() => null)
    if (!r?.ok) {
      setAr(inainte)
      setSaveErr(ro ? 'Nu s-a salvat reîncărcarea automată — reîncearcă.' : 'Auto top-up was not saved — try again.')
    } else setSaveErr('')
  }

  async function onLang(code: string): Promise<void> {
    const inainte = lang
    setLang(code)
    const ok = await saveSpeechLang(code)
    if (!ok) {
      setLang(inainte)
      setSaveErr(ro ? 'Nu s-a salvat limba — reîncearcă.' : 'The language was not saved — try again.')
    } else setSaveErr('')
  }

  async function onLogout(): Promise<void> {
    setBusy(true)
    await logout()
    window.location.reload()
  }

  async function onRecordVoiceprint(): Promise<void> {
    try {
      setRecordingVp(true)
      setVpMsg(ro ? 'Vorbește timp de 3 secunde...' : 'Speak for 3 seconds...')
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      const audioCtx = new AudioContextClass()
      const source = audioCtx.createMediaStreamSource(stream)
      const analyser = audioCtx.createAnalyser()
      analyser.fftSize = 512
      source.connect(analyser)

      const freqData = new Uint8Array(analyser.frequencyBinCount)
      const samples: number[][] = []

      const interval = setInterval(() => {
        analyser.getByteFrequencyData(freqData)
        samples.push(Array.from(freqData.slice(0, 32)))
      }, 100)

      await new Promise((resolve) => setTimeout(resolve, 3000))
      clearInterval(interval)
      stream.getTracks().forEach((track) => track.stop())
      await audioCtx.close().catch(() => {})

      const vectorLen = 32
      const avgVector = new Array(vectorLen).fill(0)
      if (samples.length > 0) {
        for (const sample of samples) {
          for (let i = 0; i < vectorLen; i++) {
            avgVector[i] += (sample[i] || 0) / samples.length
          }
        }
      }

      const energyMean = avgVector.reduce((a, b) => a + b, 0) / vectorLen
      const pitchMeanHz = 120 + (avgVector[4] || 0) * 1.5

      setVpMsg(ro ? 'Se salvează amprenta în cont...' : 'Saving voiceprint to account...')

      const resp = await fetch('/api/voiceprint/me', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          vector: avgVector,
          meta: {
            pitchMeanHz: Math.round(pitchMeanHz),
            pitchStdHz: 15,
            energyMean: Number(energyMean.toFixed(2)),
            spectralCentroidHz: 500,
            voicedRatio: 0.8,
          },
        }),
      })

      const data = await resp.json().catch(() => null)
      if (resp.ok && data?.voiceprint) {
        setVoiceprint(data.voiceprint)
        setVpMsg(ro ? 'Amprentă vocală salvată și asociată cu succes!' : 'Voiceprint saved and linked successfully!')
      } else {
        setVpMsg(ro ? 'Eroare la salvarea amprentei vocale.' : 'Failed to save voiceprint.')
      }
    } catch {
      setVpMsg(ro ? 'Microfon inaccesibil sau refuzat.' : 'Microphone inaccessible or denied.')
    } finally {
      setRecordingVp(false)
    }
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
                  const inainte = voice
                  setVoice(v)
                  // Rezultatul NU se aruncă (auditul admin, 3 aug) — pe eșec
                  // vocea revine și nota o spune.
                  void saveVoicePref(v || null).then((ok) => {
                    if (!ok) {
                      setVoice(inainte)
                      setSaveErr(ro ? 'Nu s-a salvat vocea — reîncearcă.' : 'The voice was not saved — try again.')
                    } else setSaveErr('')
                  })
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
          {saveErr && (
            <p className="settings-note" style={{ color: '#e6a23c' }}>
              ⚠ {saveErr}
            </p>
          )}
          <div className="settings-credits">
            {/* Tri-stat (auditul admin, 3 aug): „…" doar cât se citește; eșecul
            se declară, nu rămâne „…" pe veci. */}
            <strong>{wallet === 'necitit' ? '…' : wallet === null ? '—' : wallet.credits.toLocaleString()}</strong> {t.credits}
            {wallet === null && (
              <span className="settings-note" style={{ color: '#e6a23c' }}>
                {' '}
                {ro ? '(nu am putut citi soldul — redeschide Setările)' : '(could not read the balance — reopen Settings)'}
              </span>
            )}
          </div>
          {/* PENTRU ADMIN, ADEVĂRUL (auditul admin, 3 aug): bara lui NU are
          pastila „＋" (Stage o randează doar la role !== 'admin'), iar fluxul
          de reîncărcare (cod unic + link Revolut) e al clienților — pentru
          owner ar însemna să-și trimită bani singur. */}
          {user.role === 'admin' ? (
            <p className="settings-note">
              {ro
                ? 'Contul de admin nu cumpără credite (bara ta nu are pastila „＋"). Creditarea userilor se face din Admin → Utilizatori → Credit.'
                : 'The admin account does not buy credits (your bar has no “＋” pill). Users are credited from Admin → Users → Credit.'}
            </p>
          ) : (
            <p className="settings-note">
              {ro
                ? 'Alimentezi din pastila de credit „＋" din bara de sus — alegi pachetul de credite dorit.'
                : 'Top up from the credit pill “＋” in the top bar — pick the credit pack you want.'}
            </p>
          )}

          {/* Automatic top-up — so you never run out of credit mid-session.
          Ascuns pentru admin (fluxul e al clienților). */}
          {user.role !== 'admin' && (
          <label className="contact-label" style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={ar.enabled} onChange={(e) => void onAr({ enabled: e.target.checked })} />
            {ro ? 'Reîncărcare automată (să nu rămân fără credit)' : 'Auto top-up (never run out of credit)'}
          </label>
          )}
          {user.role !== 'admin' && ar.enabled && (
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
          {user.role !== 'admin' && ar.enabled && (
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

        {/* 3 — Model AI (chat + creier) — selectorul de modele OpenRouter, ASCUNS
        (migrare completă pe Gemini). Rămâne montat în cod, dar nu se randează;
        catalog/sel și handler-ul onModel stau conectate ca să nu se strice nimic. */}
        {!MODEL_SELECTOR_HIDDEN && (catalog.chat.length > 0 || catalog.work.length > 0) && (
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

        {/* 4 — Cont & Voiceprint */}
        <section className="settings-sec">
          <h4>{t.account}</h4>
          <div className="settings-account">
            <span className="settings-note">
              {t.signedInAs} <strong>{user.email}</strong>
            </span>
          </div>

          <div style={{ marginTop: 14, padding: '10px 12px', background: 'rgba(255,255,255,0.04)', borderRadius: 8 }}>
            <label className="contact-label" style={{ marginBottom: 6 }}>
              🎙 {ro ? 'Amprentă vocală cont' : 'Account Voiceprint'}
            </label>
            {voiceprint === 'necitit' ? (
              <p className="settings-note">{ro ? 'Se citește starea amprentei...' : 'Reading voiceprint status...'}</p>
            ) : voiceprint === 'esuat' ? (
              <p className="settings-note" style={{ color: '#c1121f' }}>
                {ro
                  ? 'Nu pot citi acum starea amprentei vocale (reîncearcă). NU înseamnă că n-ai una.'
                  : 'Cannot read voiceprint status right now (try again). It does NOT mean you have none.'}
              </p>
            ) : voiceprint ? (
              <div>
                <p className="settings-note" style={{ color: '#67c23a', margin: '4px 0' }}>
                  ✓ {ro ? 'Amprentă vocală înregistrată și asociată profilului' : 'Voiceprint registered and linked to profile'}
                </p>
                {voiceprint.updated_at && (
                  <p className="settings-note" style={{ opacity: 0.8, fontSize: '0.82rem', margin: '2px 0 8px' }}>
                    {ro ? 'Actualizată la:' : 'Last updated:'} {new Date(voiceprint.updated_at).toLocaleString()}
                    {voiceprint.gender ? ` • ${voiceprint.gender}` : ''}
                  </p>
                )}
                <button
                  type="button"
                  className="ghost"
                  disabled={recordingVp}
                  onClick={() => void onRecordVoiceprint()}
                  style={{ marginTop: 4, padding: '4px 10px', fontSize: '0.85rem' }}
                >
                  {recordingVp ? (ro ? 'Se înregistrează...' : 'Recording...') : (ro ? 'Reînregistrează amprenta vocală' : 'Re-record voiceprint')}
                </button>
              </div>
            ) : (
              <div>
                <p className="settings-note" style={{ margin: '4px 0 8px' }}>
                  {ro ? 'Nicio amprentă vocală asociată acestui cont.' : 'No voiceprint linked to this account yet.'}
                </p>
                <button
                  type="button"
                  className="ghost"
                  disabled={recordingVp}
                  onClick={() => void onRecordVoiceprint()}
                  style={{ padding: '4px 10px', fontSize: '0.85rem' }}
                >
                  {recordingVp ? (ro ? 'Se înregistrează (3s)...' : 'Recording (3s)...') : (ro ? 'Înregistrează amprenta vocală' : 'Record voiceprint')}
                </button>
              </div>
            )}
            {vpMsg && (
              <p className="settings-note" style={{ marginTop: 6, color: vpMsg.includes('succes') || vpMsg.includes('success') ? '#67c23a' : '#e6a23c' }}>
                {vpMsg}
              </p>
            )}
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
