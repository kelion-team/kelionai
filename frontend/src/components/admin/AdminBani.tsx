import { useEffect, useState } from 'react'
import { adminStrings } from '../../lib/adminText'
import {
  fetchFinance,
  fetchMoneyCircuit,
  type Finance,
  type MoneyCircuit,
  fetchStores,
  type StoresData,
} from '../../lib/admin'
import { apiFetch } from '../../lib/transport'
import { BecuriCredit } from './shared'
import { aiLabel } from './adminHelpers'

// ── FINANCE tab ─────────────────────────────────────────────────────────────

function providerCostsLabel(costs: Finance['providerOpenAI']['costs']): string {
  if (costs.available && typeof costs.monthUsd === 'number' && Number.isFinite(costs.monthUsd) && costs.monthUsd >= 0) {
    return `$${costs.monthUsd.toFixed(2)}`
  }
  return `⚠ indisponibil (${costs.available ? 'invalid_response' : costs.class})`
}

function providerUsageLabel(usage: Finance['providerOpenAI']['usage']): string {
  const values = [usage.requests, usage.inputTokens, usage.outputTokens]
  if (usage.available && values.every((value) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)) {
    return values.map((value) => (value as number).toLocaleString('ro-RO')).join(' / ')
  }
  return `⚠ indisponibil (${usage.available ? 'invalid_response' : usage.class})`
}

export function AdminFinance({ brainCredit: _brainCredit }: { brainCredit?: import('../../pages/Stage').BrainCredit | null }) {
  const A = adminStrings()
  const [finance, setFinance] = useState<Finance | null>(null)
  const [financeFailed, setFinanceFailed] = useState(false)
  const [circuit, setCircuit] = useState<MoneyCircuit | null>(null)
  const [circuitFailed, setCircuitFailed] = useState(false)
  const [resetBusy, setResetBusy] = useState(false)
  const [resetMsg, setResetMsg] = useState('')

  useEffect(() => {
    void fetchFinance().then((f) => { if (f) setFinance(f); setFinanceFailed(!f) })
    void fetchMoneyCircuit().then((c) => { if (c) setCircuit(c); setCircuitFailed(!c) })
  }, [])

  useEffect(() => {
    const id = window.setInterval(() => {
      void fetchFinance().then((f) => { if (f) setFinance(f); setFinanceFailed(!f) })
    }, 15_000)
    return () => window.clearInterval(id)
  }, [])

  const aiParts = finance
    ? Object.entries(finance.byKind).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])
    : []

  return (
    <div className="admin-tab-content">
      <BecuriCredit />
      {!finance && !financeFailed && <p className="chat-hint">{A.loading}</p>}
      {!finance && financeFailed && (
        <p className="chat-hint" style={{ color: '#e6a23c' }}>⚠ Nu pot citi datele de bani — citirea a eșuat (nu e o încărcare). Reîncerc automat la 15s.</p>
      )}
      {finance && financeFailed && (
        <p className="chat-hint" style={{ color: '#e6a23c' }}>⚠ Ultima reîmprospătare a picat — cifrele de mai jos sunt ultimele citite cu succes.</p>
      )}
      {finance && (
        <>
          {circuit && (
            <div className="admin-card or-wallet">
              <div className="or-wallet-main">
                <span className="or-wallet-label">Furnizorii plătiți cu cardul tău</span>
              </div>
              {circuit.paymentCollection?.status === 'active' && circuit.paymentCollection.automaticCredit ? (
                <span className="or-wallet-sub">Revolut Merchant activ: clientul confirmă checkout-ul, iar creditarea se face automat numai după webhook-ul semnat și verificat. Nu există debit automat fără mandatul clientului.</span>
              ) : circuit.paymentCollection?.status === 'setup_required' ? (
                <span className="or-wallet-sub" style={{ color: '#e6a23c' }}>⚠ Plățile sunt indisponibile până la configurarea integrării Merchant externe. Checkout-ul rămâne închis și nu există credit anticipat sau verificare manuală prezentată ca flux de produs.</span>
              ) : (
                <span className="or-wallet-sub" style={{ color: '#e6a23c' }}>⚠ Starea Merchant nu poate fi verificată; checkout-ul nu este considerat activ.</span>
              )}
              {circuit?.costReal && (
                <span className="or-wallet-sub">
                  💷 Cost furnizor reconciliat: <b>${circuit.costReal.total.toFixed(2)}</b>
                  {' · '}azi ${circuit.costReal.today.toFixed(2)}
                  {Object.keys(circuit.costReal.byKind).length > 0 && (
                    <>{' — '}{Object.entries(circuit.costReal.byKind).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k} $${v.toFixed(2)}`).join(' · ')}</>
                  )}
                </span>
              )}
              {circuit && !circuit.costReal && (
                <span className="or-wallet-sub">💷 nu pot citi jurnalul de cost{circuit.costRealMotiv ? `: ${circuit.costRealMotiv}` : ''}</span>
              )}
              <span className="or-wallet-sub">
                ▶ Autonomia: PORNITĂ PERMANENT (LEGE, 16 aug) — fără buton de oprire. Frânele tale reale: plafonul zilnic de bani, oprirea pe erori permanente (P27), cheile timerului de promovare.
              </span>
              {circuit?.autonomie && (
                <span className="or-wallet-sub" style={{ color: circuit.autonomie.ok ? undefined : '#8a8f98' }}>
                  {circuit.autonomie.ok ? '🤖' : '·'} Kelion, de capul lui: {circuit.autonomie.detaliu}
                </span>
              )}
              {(circuit.expenses?.length ?? 0) > 0 && (
                <span className="or-wallet-sub">
                  Unde se schimbă cardul, la fiecare:{' '}
                  {(circuit.expenses ?? []).filter((e) => e.configured).map((e, i) => (
                    <span key={e.name}>
                      {i > 0 && ' · '}
                      {e.platiAutomate ? '🔁 ' : e.cardPus ? '💳 ' : ''}
                      {e.billingUrl ? <a href={e.billingUrl} target="_blank" rel="noreferrer">{e.name}</a> : `${e.name} (${e.billing.toLowerCase()})`}
                    </span>
                  ))}
                </span>
              )}
            </div>
          )}
          {!circuit && circuitFailed && (
            <div className="admin-card or-wallet">
              <span className="or-wallet-sub" style={{ color: '#e6a23c' }}>⚠ Nu pot citi circuitul banilor (starea plăților, costul, autonomia) — citirea a eșuat.</span>
            </div>
          )}
          <div className="admin-card">
            <div className="admin-card-head">
              OpenAI furnizor — {finance.providerOpenAI.scope === 'project' ? 'proiectul Kelion' : 'întreaga organizație'}
            </div>
            <div className="fin-row">
              <span>Costs API · luna curentă</span>
              <span>
                {providerCostsLabel(finance.providerOpenAI.costs)}
              </span>
            </div>
            <div className="fin-row">
              <span>Usage API · cereri / tokeni intrare / tokeni ieșire</span>
              <span>
                {providerUsageLabel(finance.providerOpenAI.usage)}
              </span>
            </div>
            <div className="fin-sub">
              Perioadă UTC: {new Date(finance.providerOpenAI.period.start).toLocaleString('ro-RO')} – {new Date(finance.providerOpenAI.period.end).toLocaleString('ro-RO')}. Cheia Admin este folosită numai pentru aceste citiri; starea chatului rămâne separată.
            </div>
          </div>
          <div className="admin-card">
            <div className="admin-card-head">
              Cost per AI — total ${finance.spentUsd.toFixed(2)}
              {` (măsurat $${finance.masurat.toFixed(2)} · estimare internă $${finance.estimat.toFixed(2)})`}, azi ${finance.today.toFixed(2)}
              <button
                type="button"
                className="pool-btn withdraw"
                style={{ marginLeft: 10, fontSize: 12, padding: '3px 9px' }}
                disabled={resetBusy}
                onClick={async () => {
                  if (!window.confirm(A.confirmResetCounters)) return
                  setResetBusy(true)
                  const r = await apiFetch('/api/admin/reset-counters', { method: 'POST', credentials: 'include' }).catch(() => null)
                  const j = (await r?.json().catch(() => null)) as { ok?: boolean; sterse?: number; error?: string } | null
                  setResetMsg(
                    r?.ok && j?.ok === true
                      ? `Resetat ✓ (${j.sterse ?? 0} înregistrări șterse)`
                      : `Nu s-a putut reseta${j?.error ? ` — ${j.error}` : ''} — reîncearcă.`,
                  )
                  await fetchFinance().then((f) => { if (f) setFinance(f) }).catch(() => {})
                  setResetBusy(false)
                }}
              >
                {resetBusy ? '…' : 'Pune pe 0'}
              </button>
              {resetMsg && (
                <span className="fin-sub" style={{ marginLeft: 8, color: resetMsg.startsWith('Resetat') ? undefined : '#e6a23c' }}>{resetMsg}</span>
              )}
            </div>
            {aiParts.length === 0 && <div className="chat-hint">{A.noSpendYet}</div>}
            {aiParts.map(([k, v]) => (
              <div className="fin-row" key={k}>
                <span>
                  {aiLabel(k)}
                  {finance.felul[k] === 'estimat' && <span className="fin-sub" style={{ color: '#e6a23c' }}> — estimare internă</span>}
                </span>
                <span>${v.toFixed(4)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ── STORES tab ──────────────────────────────────────────────────────────────

export function AdminStores() {
  const A = adminStrings()
  const [stores, setStores] = useState<StoresData | null | 'necitit'>('necitit')

  useEffect(() => {
    setStores('necitit')
    void fetchStores().then(setStores)
  }, [])

  const storesData = typeof stores === 'object' && stores !== null ? stores : null

  return (
    <div className="admin-tab-content">
      {stores === 'necitit' && <p className="chat-hint">{A.checkingStores}</p>}
      {stores === null && (
        <p className="chat-hint" style={{ color: '#e6a23c' }}>
          ⚠ Nu am putut citi magazinele — citire eșuată, nu magazine lipsă.{' '}
          <button type="button" className="ghost" onClick={() => { setStores('necitit'); void fetchStores().then(setStores) }}>Reîncearcă</button>
        </p>
      )}
      {storesData && (
        <div className="admin-card">
          <div className="admin-card-head">Magazine — verificare LIVE pe paginile publice (nu pe promisiunile dashboard-urilor), la maxim 5 minute vechime.</div>
          {storesData.stores.map((s) => (
            <div className="fin-row" key={s.key}>
              <span>{s.name} — {s.store}</span>
              <span>
                {s.listed ? (
                  <a href={s.url} target="_blank" rel="noreferrer" className="store-live">● LISTAT — deschide</a>
                ) : (
                  <span className="store-missing">{A.notListedYet}</span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
