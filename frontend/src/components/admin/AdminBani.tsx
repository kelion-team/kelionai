import { useEffect, useRef, useState } from 'react'
import { adminStrings } from '../../lib/adminText'
import {
  fetchFinance,
  fetchMoneyCircuit,
  type Finance,
  type MoneyCircuit,
  fetchStores,
  type StoresData,
} from '../../lib/admin'
import { startStatisticsPeriod, statisticsPeriodLabel } from '../../lib/adminStatistics'
import { formatLondonTimestamp } from '../../lib/versionEvidence'
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
  const resetBusyRef = useRef(false)
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
                Starea reparațiilor automate și autorizarea lor se verifică în Sistem → Doctor. Acest panou de costuri nu confirmă activarea Doctorului.
              </span>
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
              Perioadă UTC: {new Date(finance.providerOpenAI.period.start).toLocaleString('ro-RO', { timeZone: 'UTC' })} – {new Date(finance.providerOpenAI.period.end).toLocaleString('ro-RO', { timeZone: 'UTC' })}. Cheia Admin este folosită numai pentru aceste citiri; starea chatului rămâne separată.
            </div>
          </div>
          <div className="admin-card">
            <div className="admin-card-head">
              Jurnal intern de cost — total ${finance.spentUsd.toFixed(2)}
              {` (măsurat $${finance.masurat.toFixed(2)} · estimare internă $${finance.estimat.toFixed(2)})`}, azi ${finance.today.toFixed(2)}
              <button
                type="button"
                className="pool-btn withdraw"
                style={{ marginLeft: 10, fontSize: 12, padding: '3px 9px' }}
                disabled={resetBusy || !(finance.statsSince === null || formatLondonTimestamp(finance.statsSince))}
                onClick={async () => {
                  if (resetBusyRef.current || !window.confirm('Începi acum o perioadă nouă pentru statisticile interne? Conversațiile, erorile, auditul, plățile, soldurile și costurile istorice se păstrează. Costurile furnizorilor nu se resetează.')) return
                  resetBusyRef.current = true
                  setResetBusy(true)
                  const since = await startStatisticsPeriod()
                  setResetMsg(
                    since
                      ? `Perioadă nouă confirmată: ${formatLondonTimestamp(since)}. Nicio înregistrare ștearsă.`
                      : 'Perioada nouă nu a fost confirmată. Verifică data recitită înainte de reîncercare.',
                  )
                  await Promise.all([
                    fetchFinance().then((f) => { if (f) setFinance(f); setFinanceFailed(!f) }),
                    fetchMoneyCircuit().then((c) => { if (c) setCircuit(c); setCircuitFailed(!c) }),
                  ])
                  resetBusyRef.current = false
                  setResetBusy(false)
                }}
              >
                {resetBusy ? 'Se confirmă…' : 'Începe perioadă nouă'}
              </button>
              {resetMsg && (
                <span className="fin-sub" role="status" style={{ marginLeft: 8 }}>{resetMsg}</span>
              )}
            </div>
            <p className="chat-hint">{statisticsPeriodLabel(finance.statsSince)}. Perioada afectează numai statisticile interne; Costs/Usage ale furnizorului păstrează intervalul afișat separat. Istoricul nu se șterge.</p>
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
                {s.listed === true ? (
                  <a href={s.url} target="_blank" rel="noreferrer" className="store-live">● LISTAT — deschide</a>
                ) : s.listed === false ? (
                  <span className="store-missing">{A.notListedYet}</span>
                ) : (
                  <span className="chat-hint">⚠ Stare necunoscută — verificarea paginii a eșuat ({s.reason}).</span>
                )}
                <span className="fin-sub"> · Măsurat: {formatLondonTimestamp(s.checkedAt) ?? 'dată necunoscută'}</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
