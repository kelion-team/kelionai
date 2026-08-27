import { useEffect, useState } from 'react'
import { adminStrings } from '../../lib/adminText'
import {
  fetchCreditAI,
  type CreditAIFurnizor,
  clasaBec,
} from '../../lib/admin'
import { apiFetch } from '../../lib/transport'
import type { BrainCredit } from '../../pages/Stage'

// Non-component helpers (fmtDur, aiLabel, dayHeader, groupByDay, rangVerdict,
// and type exports) live in ./adminHelpers to keep this file Fast-Refresh-safe.

// ── Severity pill for error rows — color + category, not just color. ────────

export function ErrRow({
  sev,
  cat,
  text,
  ceEste,
  meta,
}: {
  readonly sev: 'critic' | 'important' | 'minor'
  readonly cat: string
  readonly text: string
  readonly ceEste: string
  readonly meta?: string
}) {
  const culoare =
    sev === 'critic' ? '#e5484d' : sev === 'important' ? '#e6a23c' : '#8a8f98'
  return (
    <div className="admin-err-row">
      <div className="admin-err-head">
        <span className="admin-err-dot" style={{ background: culoare }} aria-hidden />
        <span className="admin-err-cat">{cat}</span>
        <span className="admin-err-sev">{sev}{meta ? ` · ${meta}` : ''}</span>
      </div>
      <div className="admin-err-what">{ceEste}</div>
      <div className="admin-err-text">{text}</div>
    </div>
  )
}

// ── Audit registry ──────────────────────────────────────────────────────────

interface RandAudit {
  la: string
  actor: string
  actiune: string
  tabel: string
  cheie: string
  vechi: string
  nou: string
}

export function RegistruAudit() {
  const [date, setDate] = useState<
    | { randuri: RandAudit[]; backup: { fisier: string; la: string; octeti: number } | null }
    | null
    | 'eroare'
  >(null)
  useEffect(() => {
    let viu = true
    void apiFetch('/api/admin/registru-audit', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j) => { if (viu) setDate(j) })
      .catch(() => { if (viu) setDate('eroare') })
    return () => { viu = false }
  }, [])
  if (date === null) return <div className="chat-hint">registrul se încarcă…</div>
  if (date === 'eroare') return <div className="chat-hint">⚠ Registrul de audit nu s-a putut citi.</div>
  return (
    <div className="admin-card">
      <div className="admin-card-head">Registrul modificărilor (audit — cine, când, ce)</div>
      <div className="chat-hint">
        {date.backup
          ? `Ultimul backup: ${date.backup.fisier} · ${new Date(date.backup.la).toLocaleString('ro-RO')} · ${(date.backup.octeti / 1024 / 1024).toFixed(1)} MB`
          : 'Backup: nemăsurabil de aici (directorul de backup nu e pe mașina asta sau e gol) — de verificat pe VPS.'}
      </div>
      {date.randuri.length === 0 && (
        <div className="chat-hint">— încă nicio modificare înregistrată (registrul pornește de la publicarea asta)</div>
      )}
      {date.randuri.slice(0, 60).map((r, i) => (
        <div className="vis-meta" key={i} style={{ padding: '3px 0' }}>
          <span className="vis-time">
            {new Date(r.la).toLocaleString('ro-RO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
          </span>
          <span><strong>{r.actor || '—'}</strong></span>
          <span>{r.actiune}</span>
          <span className="muted">{r.tabel}{r.cheie ? ` · ${r.cheie}` : ''}</span>
          {(r.vechi || r.nou) && <span>{r.vechi ? `${r.vechi} → ` : ''}{r.nou}</span>}
        </div>
      ))}
    </div>
  )
}

// ── Share grid (one component, used by AdminShare) ──────────────────────────

export function ShareGrid({
  title,
  items,
}: {
  title: string
  items: { name: string; href: string }[]
}) {
  return (
    <div className="admin-card">
      <div className="admin-card-head">{title}</div>
      <div className="share-grid">
        {items.map((l) => (
          <a key={l.name} className="share-btn" href={l.href} target="_blank" rel="noreferrer">
            {l.name}
          </a>
        ))}
      </div>
    </div>
  )
}

// ── AI credit lights (becuri) ───────────────────────────────────────────────

export function BecuriCredit() {
  const A = adminStrings()
  const [rows, setRows] = useState<CreditAIFurnizor[] | null>(null)
  const [err, setErr] = useState(false)
  useEffect(() => {
    let viu = true
    void fetchCreditAI().then((r) => {
      if (!viu) return
      if (r) setRows(r)
      else setErr(true)
    })
    return () => { viu = false }
  }, [])
  if (err) return <div className="becuri-credit becuri-stare">{A.becuriEroare}</div>
  if (!rows) return <div className="becuri-credit becuri-stare">{A.becuriLoad}</div>
  return (
    <div className="becuri-credit">
      <div className="becuri-titlu">{A.becuriTitlu}</div>
      <div className="becuri-lista">
        {rows.map((f) => {
          const motivRosu =
            f.serveste?.masurat && f.serveste.valoare && !f.serveste.valoare.da && f.serveste.valoare.detaliu
              ? f.serveste.valoare.detaliu.slice(0, 140)
              : undefined
          const stare =
            f.ramas.masurat && f.ramas.valoare
              ? `${f.ramas.valoare.cantitate} ${f.ramas.valoare.unitate}`
              : f.bec === 'rosu'
                ? (motivRosu ?? A.becuriReincarca)
                : f.bec === 'verde'
                  ? A.becuriServeste
                  : `${A.becuriNecunoscut}${f.ramas.motiv ? ` — ${f.ramas.motiv}` : ''}`
          const titlu = f.bec === 'rosu' ? (motivRosu ?? A.becuriReincarca) : A.becuriDeschideFactura
          const continut = (
            <>
              <span className={clasaBec(f.bec)} aria-hidden="true" />
              <span className="bec-nume">{f.furnizor}</span>
              <span className="bec-alim">{f.alimenteaza}</span>
              <span className="bec-stare">{stare}</span>
            </>
          )
          return f.facturare ? (
            <a key={f.furnizor} className={`bec-rand bec-rand-${f.bec}`} href={f.facturare} target="_blank" rel="noreferrer" title={titlu}>
              {continut}
            </a>
          ) : (
            <div key={f.furnizor} className={`bec-rand bec-rand-${f.bec}`} title={titlu}>
              {continut}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── AI credit card (top bar) ────────────────────────────────────────────────

export function CreditAICard({ brainCredit }: { brainCredit?: BrainCredit | null }) {
  if (!brainCredit) return null
  const o = brainCredit.openai
  const s = brainCredit.serper
  const serperK = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))
  const openaiEticheta =
    o?.sold != null ? `${o.sold.toFixed(2)} ${o.soldMoneda ?? ''}`.trim()
    : o?.serving ? '✓' : '·'
  const openaiTitlu = [
    o?.sold != null ? `sold măsurat: ${o.sold.toFixed(2)} ${o.soldMoneda ?? ''}` : `sold necitit: ${o?.soldMotiv ?? 'motiv necunoscut'}`,
    o?.monthUsd != null ? `cheltuit luna asta: $${o.monthUsd.toFixed(2)}` : 'cheltuiala lunii necitibilă',
  ].join(' · ')
  return (
    <div className="admin-credit-bar">
      <strong className="admin-credit-label">Credite AI</strong>
      <span title={s?.live && typeof s.balance === 'number' ? `${s.balance.toLocaleString()} căutări rămase (Serper)` : 'citirea Serper a eșuat'}>
        Serper {s?.live && typeof s.balance === 'number' ? serperK(s.balance) : '⚠'}
      </span>
      <span title={openaiTitlu}>OpenAI {openaiEticheta}</span>
    </div>
  )
}
