import { useEffect, useState } from 'react'
import { adminStrings } from '../../lib/adminText'
import { fetchErori, type EroriAdmin } from '../../lib/admin'
import { apiFetch } from '../../lib/transport'
import {
  ErrRow,
  RegistruAudit,
} from './shared'
import {
  rangVerdict,
  type RaportAutoverificare,
  type RecoveryRow,
} from './adminHelpers'
import type { BrainCredit } from '../../pages/Stage'

// ── SISTEM tab ──────────────────────────────────────────────────────────────

export function AdminSistem({ brainCredit }: { brainCredit?: BrainCredit | null }) {
  const [avBusy, setAvBusy] = useState(false)
  const [avRaport, setAvRaport] = useState<RaportAutoverificare | null>(null)
  const [avEroare, setAvEroare] = useState('')

  return (
    <div className="admin-tab-content">
      <div className="admin-card">
        <div className="admin-card-head">Sistem (VPS)</div>
        {brainCredit?.vps ? (
          (() => {
            const v = brainCredit.vps
            const critic = v.liberPct <= (v.pragMemoriePct ?? 10) || v.incarcarePct >= (v.pragIncarcarePct ?? 200)
            return (
              <div className={`vps-resurse${critic ? ' vps-critic' : ''}`}>
                <span className="vps-cifra">RAM liber: <b>{v.liberGb.toFixed(1)}GB</b> / {v.totalGb.toFixed(1)}GB</span>
                <span className="vps-cifra">Încărcare: <b>{(v.incarcarePct / 100).toFixed(1)}×</b> pe {v.procesoare} nuclee</span>
                <span className="vps-cifra vps-load">load: {v.incarcare.map((n) => n.toFixed(2)).join(' / ')}</span>
                {critic && <span className="vps-alarma">⚠ critic</span>}
              </div>
            )
          })()
        ) : (
          <div className="vps-resurse">
            <span className="vps-cifra">⚠ VPS necitibil (nu s-au putut măsura RAM/încărcarea acum)</span>
          </div>
        )}
        <p className="chat-hint" style={{ marginTop: 8 }}>
          Monitorizare doar în citire. Operațiunile asupra serverului se execută exclusiv prin infrastructura separată, nu din aplicația web.
        </p>
      </div>

      <div className="admin-card" style={{ marginTop: 16 }}>
        <div className="admin-card-head">Autoverificare inteligentă</div>
        <p className="chat-hint" style={{ marginTop: 8 }}>
          Kelion se testează pe el însuși pe toate funcțiile și spune, pentru fiecare care nu merge, <b>de ce</b> și ce e de făcut. Durează câteva secunde (probează real citirile).
        </p>
        <button
          className="ghost"
          style={{ marginTop: 12 }}
          disabled={avBusy}
          onClick={async () => {
            setAvBusy(true)
            setAvEroare('')
            try {
              const res = await apiFetch('/api/admin/autoverificare', { method: 'POST', credentials: 'include' })
              if (!res.ok) { setAvEroare(`Autoverificarea NU a pornit: HTTP ${res.status}`); setAvRaport(null); return }
              const j = (await res.json().catch(() => null)) as RaportAutoverificare | null
              if (!j || typeof j.total !== 'number') { setAvEroare('Răspuns necitibil de la server (nu pot afișa un raport pe care nu l-am măsurat).'); setAvRaport(null); return }
              setAvRaport(j)
            } catch (e) {
              const motiv = e instanceof Error ? e.message : String(e)
              console.error('[autoverificare]', e)
              setAvEroare(`Eroare la autoverificare: ${motiv}`)
              setAvRaport(null)
            } finally {
              setAvBusy(false)
            }
          }}
        >
          {avBusy ? 'Verific toate funcțiile…' : '🧪 Verifică toate funcțiile'}
        </button>
        {avEroare && <p className="chat-hint" style={{ marginTop: 10, color: '#e0603a' }}>⚠ {avEroare}</p>}
        {avRaport && (
          <div style={{ marginTop: 12 }}>
            <div className="admin-av-summary">
              <span>Total: <b>{avRaport.total}</b></span>
              <span style={{ color: '#2e9e5b' }}>Merg: <b>{avRaport.merg}</b></span>
              <span style={{ color: '#e0603a' }}>Stricate: <b>{avRaport.stricate}</b></span>
              <span style={{ color: '#c79218' }}>Nu pot verifica: <b>{avRaport.nepotverifica}</b></span>
            </div>
            <ul className="admin-av-list">
              {avRaport.functii
                .slice()
                .sort((a, b) => rangVerdict(a.verdict) - rangVerdict(b.verdict))
                .map((f) => {
                  const c = f.verdict === 'merge' ? '#2e9e5b' : f.verdict === 'stricat' ? '#e0603a' : '#c79218'
                  const et = f.verdict === 'merge' ? '✓ merge' : f.verdict === 'stricat' ? '✗ stricat' : '… nu pot verifica'
                  return (
                    <li key={f.functie} style={{ borderLeft: `3px solid ${c}`, paddingLeft: 10 }}>
                      <div className="admin-av-func">
                        <b>{f.functie}</b>
                        <span style={{ color: c, fontSize: '0.85em' }}>{et}</span>
                        <span className="chat-hint" style={{ fontSize: '0.8em' }}>
                          {f.tip === 'efect' ? '(cu efect — dry-run)' : '(citire — probat real)'}
                        </span>
                      </div>
                      <div className="chat-hint" style={{ fontSize: '0.85em' }}>{f.face}</div>
                      {f.verdict !== 'merge' && (
                        <div style={{ fontSize: '0.85em', marginTop: 2 }}>
                          <span style={{ color: c }}>De ce:</span> {f.deCe}
                          {f.recomandare && (<>{' '}<span style={{ color: c }}>→</span> <b>{f.recomandare}</b></>)}
                        </div>
                      )}
                    </li>
                  )
                })}
            </ul>
          </div>
        )}
      </div>

      <RegistruAudit />
    </div>
  )
}

// ── EROI tab ────────────────────────────────────────────────────────────────

export function AdminErori() {
  const [erori, setErori] = useState<EroriAdmin | null | 'necitit'>('necitit')
  const [eroriBusy, setEroriBusy] = useState(false)

  useEffect(() => {
    const loadErori = (): void => {
      setEroriBusy(true)
      fetchErori().then((e) => setErori(e)).finally(() => setEroriBusy(false))
    }
    loadErori()
    const id = window.setInterval(loadErori, 20000)
    return () => window.clearInterval(id)
  }, [])

  return (
    <div className="admin-tab-content">
      <div className="admin-card">
        <div className="admin-card-head">
          Erori — ce e fiecare, în clar. Kelion le vede și el în creier (le poți întreba în chat: „ce e eroarea asta?").
          {eroriBusy && <span className="chat-hint"> · se încarcă…</span>}
        </div>
        {erori === 'necitit' && <p className="chat-hint">Se încarcă…</p>}
        {erori === null && (
          <p className="chat-hint" style={{ color: '#e6a23c' }}>⚠ Nu pot citi erorile — citirea a eșuat (NU înseamnă „zero erori"). Reîncerc automat la 20s.</p>
        )}
        {erori && erori !== 'necitit' && (
          <>
            {erori.sistem.length === 0 && erori.browser.length === 0 && (
              <p className="chat-hint" style={{ marginTop: 8 }}>Nicio eroare în ultimele 48h. 🎉</p>
            )}
            {erori.sistem.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <div className="admin-err-group">Sistem (server + ordine de build)</div>
                {erori.sistem.map((p, i) => (
                  <ErrRow key={`s${i}`} sev={p.severitate} cat={p.categorie} text={p.text} ceEste={p.ceEste} />
                ))}
              </div>
            )}
            {erori.browser.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <div className="admin-err-group">Browser (F12 la utilizatori, ultimele 48h)</div>
                {erori.browser.map((e, i) => (
                  <ErrRow key={`b${i}`} sev={e.severitate} cat={e.categorie} text={e.text} ceEste={e.ceEste} meta={`×${e.cate}${e.cine ? ` · ${e.cine}` : ''}`} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ── RECUPERARE tab ──────────────────────────────────────────────────────────

export function AdminRecuperare() {
  const A = adminStrings()
  const [recoveryPoints, setRecoveryPoints] = useState<RecoveryRow[]>([])
  const [recoveryFailed, setRecoveryFailed] = useState(false)
  const [recoveryLoading, setRecoveryLoading] = useState(false)
  const [recoveryNote, setRecoveryNote] = useState('')
  const [recoveryMsg, setRecoveryMsg] = useState('')
  const [restoringTag, setRestoringTag] = useState<string | null>(null)

  const loadRecovery = (): void => {
    setRecoveryLoading(true)
    apiFetch('/api/admin/backups', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { points?: RecoveryRow[] } | null) => {
        if (j?.points) { setRecoveryPoints(j.points); setRecoveryFailed(false) }
        else setRecoveryFailed(true)
        setRecoveryLoading(false)
      })
      .catch(() => { setRecoveryFailed(true); setRecoveryLoading(false) })
  }

  useEffect(() => { loadRecovery() }, [])

  const saveRecoveryNow = (): void => {
    setRecoveryMsg(A.savingRecovery)
    void apiFetch('/api/admin/backups', {
      method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ note: recoveryNote.trim() }),
    })
      .then((r) => r.json().then((j: { ok?: boolean; tag?: string; error?: string }) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (ok && j.tag != null) { setRecoveryMsg(A.recoverySaved(j.tag)); setRecoveryNote(''); loadRecovery() }
        else setRecoveryMsg(A.recoverySaveFailed(j.error ?? 'eroare necunoscută'))
      })
      .catch(() => setRecoveryMsg(A.recoverySaveNetworkError))
  }

  const restoreFromPoint = (p: RecoveryRow): void => {
    const when = p.date ? new Date(p.date).toLocaleString('ro-RO') : p.tag
    if (!window.confirm(A.confirmRestoreApp(when, p.sha))) return
    if (!window.confirm(A.confirmRestoreAppSure(p.note.split('\n')[0].slice(0, 80), p.tag))) return
    setRestoringTag(p.tag)
    setRecoveryMsg(A.restoringApp(p.tag))
    void apiFetch('/api/admin/backups/restore', {
      method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ tag: p.tag }),
    })
      .then((r) => r.json().then((j: { ok?: boolean; sha?: string; error?: string }) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        setRestoringTag(null)
        if (ok && j.ok) setRecoveryMsg(A.restoreSuccess(j.sha ?? p.sha))
        else setRecoveryMsg(A.restoreFailed(j.error ?? 'eroare necunoscută'))
      })
      .catch(() => { setRestoringTag(null); setRecoveryMsg(A.restoreNetworkError) })
  }

  return (
    <div className="admin-tab-content">
      <div className="admin-card">
        <div className="admin-card-head">Recuperare — versiunile salvate ale aplicației (tag-uri git, oglindite pe serverul Linux ca .bundle + .tar.gz). Fiecare e recuperabilă integral.</div>
        <form className="admin-form-row" onSubmit={(e) => { e.preventDefault(); saveRecoveryNow() }}>
          <input value={recoveryNote} onChange={(e) => setRecoveryNote(e.target.value)} placeholder={A.versionNotePlaceholder} style={{ flex: 1, minWidth: 0 }} />
          <button type="submit" className="ghost">Salvează versiunea curentă</button>
        </form>
        {recoveryMsg && <div className="chat-hint">{recoveryMsg}</div>}
      </div>
      <div className="admin-card" style={{ marginTop: 12 }}>
        <div className="admin-card-head">Versiuni salvate ({recoveryPoints.length})</div>
        {recoveryLoading && recoveryPoints.length === 0 && <div className="chat-hint">{A.loading}</div>}
        {!recoveryLoading && recoveryFailed && (
          <div className="chat-hint" style={{ color: '#e6a23c' }}>
            ⚠ Nu am putut citi versiunile — citire eșuată (GITHUB_TOKEN lipsă sau GitHub n-a răspuns), NU listă goală.{' '}
            <button type="button" className="ghost" onClick={loadRecovery}>Reîncearcă</button>
          </div>
        )}
        {!recoveryLoading && !recoveryFailed && recoveryPoints.length === 0 && <div className="chat-hint">{A.noVersionsYet}</div>}
        {recoveryPoints.map((p) => (
          <div className="admin-list-row" key={p.tag}>
            <span>
              <strong>{p.date ? new Date(p.date).toLocaleString('ro-RO', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : p.tag}</strong>
              {' · '}<code>{p.sha}</code>
              {p.note ? <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{p.note.split('\n')[0].slice(0, 140)}</div> : null}
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="muted" style={{ fontSize: 12 }}>{p.tag}</span>
              <button type="button" className="ghost" disabled={restoringTag !== null} onClick={() => restoreFromPoint(p)}>
                {restoringTag === p.tag ? 'Restaurez…' : 'Restaurează'}
              </button>
            </span>
          </div>
        ))}
        <div className="chat-hint">
          „Restaurează" aduce aplicația EXACT la versiunea aleasă (commit nou pe master — nimic nu se pierde din istoric) și republică automat pe server. Rezerve manuale: bundle-urile din <code>/root/kelion/backups/</code>.
        </div>
      </div>
    </div>
  )
}
