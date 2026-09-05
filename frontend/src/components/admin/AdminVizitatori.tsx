import { useEffect, useState } from 'react'
import { fetchVisitorStats, statisticsPeriodLabel, type VisitorStats } from '../../lib/adminStatistics'

export function VisitorStatsReport({ stats }: { stats: VisitorStats }) {
  return <div className="admin-card">
    <div className="admin-card-head">Vizitatori — trafic agregat</div>
    <p className="chat-hint">{statisticsPeriodLabel(stats.statsSince)}</p>
    <div className="fin-row"><span>Vizite în perioada internă</span><b>{stats.visitsTotal.toLocaleString('ro-RO')}</b></div>
    <div className="fin-row"><span>Vizite azi (ziua bazei de date)</span><b>{stats.visitsToday.toLocaleString('ro-RO')}</b></div>
    <p className="chat-hint">Sunt afișări înregistrate, nu persoane unice și nu utilizatori conectați acum. Nu se afișează IP-uri, identități sau conversații. Țara poate lipsi din măsurare.</p>
    {stats.byCountry.length > 0 && <div aria-label="Vizite agregate pe țară">
      {stats.byCountry.map((row) => <div className="fin-row" key={row.code}><span>{row.code}</span><span>{row.count.toLocaleString('ro-RO')}</span></div>)}
    </div>}
  </div>
}

export function AdminVizitatori() {
  const [stats, setStats] = useState<VisitorStats | null | 'loading'>('loading')
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setStats('loading')
    void fetchVisitorStats(controller.signal).then((result) => { if (!controller.signal.aborted) setStats(result) })
    return () => controller.abort()
  }, [revision])
  return <div className="admin-tab-content">
    <button type="button" className="ghost" disabled={stats === 'loading'} onClick={() => setRevision((value) => value + 1)}>Reîmprospătează vizitele</button>
    {stats === 'loading' ? <p className="chat-hint">Se citesc vizitele…</p>
      : stats === null ? <p className="chat-hint" role="alert">Vizitele nu pot fi citite. Aceasta nu este o măsurare de zero vizite.</p>
        : <VisitorStatsReport stats={stats} />}
  </div>
}
