import { useEffect, useRef, useState } from 'react'
import { adminStrings } from '../../lib/adminText'
import {
  fetchHistory,
  translateToRo,
  fetchActivity,
  manageUser,
  type UserActivity,
  type UserActivityRow,
  type HistoryRow,
  fetchTokenChecks,
  fetchEnvCheck,
  type EnvCheckResult,
  type TokenChecksResult,
} from '../../lib/admin'
import {
  GESTURE_CATALOG,
  GESTURE_CATEGORIES,
  previewGesture,
  fetchDisabledGestures,
  saveDisabledGesturesCanonical,
} from '../../lib/gestures'
import { fetchBalance, majorToMinor } from '../../lib/billing'
import { fmtDur, groupByDay } from './adminHelpers'
import { RegistruAudit } from './shared'

// ── USERS tab ───────────────────────────────────────────────────────────────

export function AdminUsers() {
  const A = adminStrings()
  const [activity, setActivity] = useState<UserActivity | null | 'necitit'>('necitit')
  const [billingUnit, setBillingUnit] = useState<{ currency: string; minorUnit: number } | null>(null)
  const [userConvo, setUserConvo] = useState<{ u: UserActivityRow; rows: HistoryRow[] | null } | null>(null)
  const [userConvoLoading, setUserConvoLoading] = useState(false)
  const [roOn, setRoOn] = useState(false)
  const [roMap, setRoMap] = useState<Record<string, string>>({})
  const [roBusy, setRoBusy] = useState(false)
  const [roFailed, setRoFailed] = useState(0)

  useEffect(() => {
    void fetchActivity().then(setActivity)
    void fetchBalance().then((balance) => {
      if (balance && typeof balance.currency === 'string' && Number.isSafeInteger(balance.minorUnit)) {
        setBillingUnit({ currency: balance.currency, minorUnit: balance.minorUnit as number })
      }
    })
  }, [])

  const activityData = typeof activity === 'object' && activity !== null ? activity : null
  const sym = billingUnit?.currency === 'usd' ? '$' : '£'

  async function toggleRo(rows: HistoryRow[]): Promise<void> {
    if (roOn) { setRoOn(false); return }
    const missing = Array.from(new Set(rows.map((r) => r.content).filter((c) => c && !(c in roMap))))
    if (missing.length > 0) {
      setRoBusy(true)
      const { translations: translated, failed } = await translateToRo(missing)
      setRoMap((m) => { const next = { ...m }; missing.forEach((src, i) => (next[src] = translated[i] ?? src)); return next })
      setRoFailed(failed)
      setRoBusy(false)
    }
    setRoOn(true)
  }
  const showMsg = (content: string): string => (roOn ? (roMap[content] ?? content) : content)

  async function openUserConvo(u: UserActivityRow): Promise<void> {
    setUserConvoLoading(true)
    setRoOn(false)
    setRoFailed(0)
    setUserConvo({ u, rows: [] })
    const rows = await fetchHistory(u.email)
    setUserConvo({ u, rows })
    setUserConvoLoading(false)
  }
  const closeUserConvo = (): void => { setUserConvo(null); setRoOn(false); setRoFailed(0) }

  return (
    <div className="admin-tab-content">
      {activity === 'necitit' && <p className="chat-hint">{A.loading}</p>}
      {activity === null && (
        <p className="chat-hint" style={{ color: '#e6a23c' }}>
          ⚠ Nu pot citi activitatea — citirea a eșuat, nu e cont fără activitate.{' '}
          <button type="button" className="ghost" onClick={() => void fetchActivity().then(setActivity)}>Reîncearcă</button>
        </p>
      )}
      <RegistruAudit />
      {activityData && activityData.users.length === 0 && (
        <p className="chat-hint">Încă nu s-a strâns activitate pe conturi — se adună de la prima intrare a fiecărui utilizator după această actualizare.</p>
      )}
      {activityData && activityData.users.length > 0 && (
        <div className="admin-card">
          <div className="admin-card-head">Pe utilizator — ultima intrare și cât a stat în total</div>
          {activityData.users.map((u) => (
            <div className="vis-row vis-clickable" key={u.email} role="button" tabIndex={0}
              onClick={() => void openUserConvo(u)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') void openUserConvo(u) }}
              title={A.seeWhatTheyWrote}>
              <div className="vis-main">
                <span className="vis-flagline"><strong>{u.email}</strong></span>
                <span className="vis-open">deschide ›</span>
                <span className="vis-time">{new Date(u.last_seen).toLocaleString('ro-RO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
              </div>
              <div className="vis-meta">
                <span>{u.sessions} sesiuni</span>
                <span>timp total {fmtDur(u.seconds)}</span>
                <span>{u.messages} mesaje</span>
                <span title={u.scutit ? 'Ownerul e scutit de taxare peste tot — soldul negativ e istoric, dinaintea scutirilor, și nu se mai mișcă. Îl poți aduce la zero din Admin → user → credit.' : undefined}>
                  sold {sym}{u.balance.toFixed(2)}{u.scutit ? ' (scutit — sold istoric)' : ''}
                </span>
                <span style={typeof u.consumedUsd === 'number' && u.consumedUsd > 0 && u.balance <= 0 ? { color: '#e5484d', fontWeight: 600 } : undefined}>
                  consum {typeof u.consumedUsd === 'number' ? `$${u.consumedUsd.toFixed(2)}` : '—'}
                </span>
                {u.blocked && <span className="user-badge blocked">BLOCAT</span>}
              </div>
              <div className="vis-actions" onClick={(e) => e.stopPropagation()}>
                <button type="button" className="user-act" title={A.seeWholeChat} onClick={() => void openUserConvo(u)}>💬 Vezi chat</button>
                <button type="button" className="user-act"
                  onClick={async () => {
                    const r = await manageUser(u.email, u.blocked ? 'unblock' : 'block')
                    if (r) setActivity(r)
                    else window.alert(A.alertCouldNotPerf)
                  }}>
                  {u.blocked ? 'Deblochează' : 'Blochează'}
                </button>
                <button type="button" className="user-act" disabled={!billingUnit}
                  onClick={async () => {
                    if (!billingUnit) return
                    const s = window.prompt(A.promptManualCreditAmount(u.email, billingUnit.currency))
                    if (s == null) return
                    const amount = Number(s.replace(',', '.').trim())
                    const amountMinor = majorToMinor(amount, billingUnit.minorUnit)
                    if (amountMinor === null || amountMinor <= 0) { window.alert(A.alertInvalidAmount(s)); return }
                    const r = await manageUser(u.email, 'credit', amountMinor)
                    if (r) setActivity(r)
                    else window.alert(A.alertNotCredited)
                  }}>
                  Credit
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {userConvo && (
        <div className="convo-overlay" onClick={closeUserConvo}>
          <div className="convo-panel" onClick={(e) => e.stopPropagation()}>
            <header className="admin-head">
              <div className="convo-title">
                <strong>{userConvo.u.email}</strong>
                <span className="convo-sub">{userConvo.u.sessions} sesiuni · timp total {fmtDur(userConvo.u.seconds)} · {userConvo.u.messages} mesaje</span>
              </div>
              <div className="convo-head-actions">
                <button type="button" className="user-act" disabled={roBusy || (userConvo.rows?.length ?? 0) === 0} title={A.translateToRo}
                  onClick={() => void toggleRo(userConvo.rows ?? [])}>
                  {roBusy ? 'Traduc…' : roOn ? 'Arată originalul' : '🌐 Tradu în română'}
                </button>
                {roOn && roFailed > 0 && <span className="chat-hint" style={{ color: '#d97706' }}>⚠ {roFailed} netraduse</span>}
                <button type="button" className="ghost" onClick={closeUserConvo}>Închide</button>
              </div>
            </header>
            <div className="admin-history convo-body">
              {userConvoLoading && <p className="chat-hint">{A.loading}</p>}
              {!userConvoLoading && userConvo.rows === null && <p className="chat-hint" style={{ color: '#e6a23c' }}>⚠ {A.historyReadFail}</p>}
              {!userConvoLoading && userConvo.rows !== null && userConvo.rows.length === 0 && <p className="chat-hint">{A.noMessagesYet}</p>}
              {!userConvoLoading && groupByDay(userConvo.rows ?? []).map((g) => (
                <div key={g.header} className="admin-day">
                  <div className="admin-day-header">{g.header}</div>
                  {g.rows.map((h, i) => (
                    <div key={i} className={`bubble ${h.role === 'user' ? 'user' : 'assistant'}`}>
                      <span className="admin-msg-time">{new Date(h.created_at).toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' })}</span>
                      {showMsg(h.content)}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── TOKENURI tab ────────────────────────────────────────────────────────────

export function AdminTokenuri() {
  const A = adminStrings()
  const [envCheck, setEnvCheck] = useState<EnvCheckResult | null | 'necitit'>('necitit')
  const [tokenChecks, setTokenChecks] = useState<TokenChecksResult | null>(null)
  const [tokenChecksLoading, setTokenChecksLoading] = useState(false)

  useEffect(() => {
    void fetchEnvCheck().then(setEnvCheck)
    setTokenChecksLoading(true)
    void fetchTokenChecks().then((r) => { setTokenChecks(r); setTokenChecksLoading(false) })
  }, [])

  const envCheckData = typeof envCheck === 'object' && envCheck !== null ? envCheck : null

  return (
    <div className="admin-tab-content">
      {envCheck === 'necitit' && <p className="chat-hint">{A.loading}</p>}
      {envCheck === null && <p className="chat-hint" style={{ color: '#e6a23c' }}>⚠ Nu am putut citi cheile procesului — citire eșuată, NU înseamnă că lipsesc. Apasă „Reîmprospătează".</p>}
      {envCheckData && (
        <div className="admin-card" style={{ marginBottom: 14 }}>
          <div className="admin-card-head">
            Ce chei vede serverul CHIAR ACUM — {envCheckData.summary.total - envCheckData.summary.lipsa - envCheckData.summary.goale}/{envCheckData.summary.total} prezente
          </div>
          <div className="or-wallet-sub">
            Procesul a pornit la <strong>{new Date(envCheckData.startedAt).toLocaleString('ro-RO')}</strong>. O cheie scrisă DUPĂ ora asta nu e încărcată până la repornirea containerului.
          </div>
          {envCheckData.orphans.length > 0 && (
            <div className="fin-row">
              <span style={{ color: '#e6a23c', fontWeight: 600 }}>
                ⚠ Chei pe care LE AI, dar sub alt nume:{' '}
                {envCheckData.orphans.map((n, i) => (<span key={n}>{i > 0 && ', '}<code>{n}</code></span>))}
              </span>
              <span className="fin-sub">redenumește-le, sau spune-mi și le citesc și așa</span>
            </div>
          )}
          {envCheckData.vars.filter((v) => !v.present || v.length === 0).map((v) => (
            <div className="fin-row" key={v.name}>
              <span style={{ color: '#e6a23c' }}>⚠ <code>{v.name}</code> — {v.what}</span>
              <span className="fin-sub" title={`Nume acceptate: ${v.accepts.join(', ')}`}>{v.present ? 'prezentă dar GOALĂ' : 'nu e în proces'} · {v.breaks}</span>
            </div>
          ))}
          {envCheckData.summary.lipsa === 0 && envCheckData.summary.goale === 0 && (
            <div className="fin-row"><span>✅ Toate cheile așteptate sunt în procesul care rulează.</span></div>
          )}
          {envCheckData.vars.filter((v) => v.present && v.length > 0).map((v) => (
            <div className="fin-row" key={v.name}>
              <span>✅ <code>{v.name}</code> — {v.what}</span>
              <span className="fin-sub" title={`Nume acceptate: ${v.accepts.join(', ')}`}>
                {v.foundAs && v.foundAs !== v.name ? `găsită ca ${v.foundAs} · ` : ''}{v.length} caractere
              </span>
            </div>
          ))}
        </div>
      )}
      <div className="admin-card">
        <div className="admin-card-head">
          Tokenuri și chei API cu drepturi — verificare LIVE
          <button type="button" className="ghost" style={{ marginLeft: 12 }}
            onClick={() => {
              void fetchEnvCheck().then(setEnvCheck)
              setTokenChecksLoading(true)
              void fetchTokenChecks().then((r) => { setTokenChecks(r); setTokenChecksLoading(false) })
            }}>
            Reîmprospătează
          </button>
        </div>
        {tokenChecksLoading && <p className="chat-hint">{A.checkingTokens}</p>}
        {!tokenChecksLoading && !tokenChecks && <p className="chat-hint">{A.tokensFailed}</p>}
        {tokenChecks && (
          <>
            <div className="fin-row" style={{ fontWeight: 600 }}>
              <span>✅ {tokenChecks.ok} OK</span>
              <span>⚪ {tokenChecks.notConfigured} neconfigurate</span>
              <span>🔴 {tokenChecks.failed} eșuate</span>
            </div>
            {tokenChecks.checks.map((c) => (
              <div className="fin-row" key={c.name}>
                <span>{c.status === 'ok' ? '✅' : c.status === 'not_configured' ? '⚪' : '🔴'} {c.name}{c.detail ? ` — ${c.detail}` : ''}</span>
                <span className="fin-sub" title={`Drepturi necesare: ${c.requiredScope ?? 'n/a'}`}>{c.requiredScope ?? ''}</span>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}

// ── GESTURI tab ─────────────────────────────────────────────────────────────

export function AdminGesturi({ onPeek }: { onPeek: (clip: string) => void }) {
  const A = adminStrings()
  const [gestOff, setGestOff] = useState<string[] | null | 'necitit'>('necitit')
  const [gestSaved, setGestSaved] = useState(false)
  const [gestSaving, setGestSaving] = useState(false)
  const gestSavePendingRef = useRef(false)
  const [gestErr, setGestErr] = useState('')

  useEffect(() => {
    setGestOff('necitit')
    void fetchDisabledGestures().then(setGestOff)
  }, [])

  const gestOffData = Array.isArray(gestOff) ? gestOff : null

  const toggleGesture = (clip: string): void => {
    if (!Array.isArray(gestOff) || gestSavePendingRef.current) return
    const next = gestOff.includes(clip) ? gestOff.filter((c) => c !== clip) : [...gestOff, clip]
    gestSavePendingRef.current = true
    setGestSaving(true)
    setGestSaved(false)
    setGestOff(next)
    setGestErr('')
    void (async () => {
      try {
        const persisted = await saveDisabledGesturesCanonical(next)
        if (persisted !== null) {
          setGestOff(persisted)
          setGestSaved(true)
          window.setTimeout(() => setGestSaved(false), 1500)
          return
        }
        setGestErr(A.gestureSaveFailed)
        setGestOff(await fetchDisabledGestures())
      } catch {
        setGestErr(A.gestureSaveFailed)
        setGestOff(await fetchDisabledGestures())
      } finally {
        gestSavePendingRef.current = false
        setGestSaving(false)
      }
    })()
  }

  const previewAndPeek = (clip: string): void => {
    previewGesture(clip)
    onPeek(clip)
  }

  return (
    <div className="admin-tab-content">
      <div className="admin-card">
        <div className="admin-card-head">
          Gesturile lui Kelion — apasă „▶ Arată" ca să-l vezi făcând gestul; bifează ce are voie să folosească pe logică/context. Ce NU e bifat NU se folosește deloc în aplicație.
          {gestSaved ? ' · salvat ✓' : ''}
          {gestErr && <span style={{ color: '#ff7a7a' }}> · {gestErr}</span>}
        </div>
        {gestOff === 'necitit' && <div className="chat-hint">{A.loading}</div>}
        {gestOff === null && (
          <div className="chat-hint" style={{ color: '#e6a23c' }}>⚠ Nu am putut citi starea gesturilor — bifele sunt blocate ca să nu salvez peste o listă necitită. Redeschide tabul.</div>
        )}
        {GESTURE_CATEGORIES.map((cat) => (
          <div key={cat}>
            <div className="admin-card-subhead">{cat}</div>
            {GESTURE_CATALOG.filter((g) => g.category === cat).map((g) => {
              const on = gestOffData ? !gestOffData.includes(g.clip) : false
              return (
                <div className="fin-row" key={g.clip}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: gestOffData && !gestSaving ? 'pointer' : 'not-allowed' }}>
                    <input type="checkbox" checked={on} disabled={!gestOffData || gestSaving} onChange={() => toggleGesture(g.clip)} />
                    <span style={{ opacity: on ? 1 : 0.5 }}>{g.label}</span>
                  </label>
                  <button type="button" className="ghost" onClick={() => previewAndPeek(g.clip)}>▶ Arată</button>
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
