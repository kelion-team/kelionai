import { useEffect, useState } from 'react'
import {
  fetchUsers,
  fetchHistory,
  fetchGaps,
  fetchFinance,
  fetchDemos,
  fetchActivity,
  fetchDevLog,
  fetchReleases,
  decideRelease,
  resolveGap,
  escalateGap,
  type StagedRelease,
  type UserSummary,
  type HistoryRow,
  type CapabilityGap,
  type Finance,
  type DemoStats,
  type DemoRecent,
  type UserActivity,
  fetchStores,
  type StoresData,
  fetchWorkOrders,
  type WorkOrder,
} from '../lib/admin'

// "cât a stat" — human-readable duration from seconds: 45s / 7m / 2h 13m.
function fmtDur(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

// A REAL flag image (Windows doesn't render emoji flags — they show as "GB"
// text). flagcdn serves every ISO country; on any failure we fall back to a dot.
function Flag({ code }: { readonly code: string }) {
  if (!code || code.length !== 2) return <span className="flag-none">🌐</span>
  return (
    <img
      className="flag-img"
      src={`https://flagcdn.com/20x15/${code.toLowerCase()}.png`}
      srcSet={`https://flagcdn.com/40x30/${code.toLowerCase()}.png 2x`}
      width={20}
      height={15}
      alt={code}
      onError={(e) => {
        ;(e.target as HTMLImageElement).style.display = 'none'
      }}
    />
  )
}

const AI_LABELS: Record<string, string> = {
  chat: 'Claude (brain)',
  correct: 'Gemini (correct)',
  image: 'Images (Gemini)',
  tts: 'Voice (TTS)',
  asr: 'Hearing (STT)',
  search: 'Search (Serper)',
  memory: 'Memory (Haiku)',
}

// Group the history newest-first, with a date header per day (Today / Yesterday /
// full date). Each message keeps its time so you can scan by the hour.
function dayHeader(d: Date): string {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const day = new Date(d)
  day.setHours(0, 0, 0, 0)
  const diff = Math.round((today.getTime() - day.getTime()) / 86_400_000)
  if (diff === 0) return 'Astăzi'
  if (diff === 1) return 'Ieri'
  return d.toLocaleDateString('ro-RO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

function groupByDay(rows: HistoryRow[]): { header: string; rows: HistoryRow[] }[] {
  const sorted = [...rows].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  )
  const groups: { header: string; rows: HistoryRow[] }[] = []
  for (const r of sorted) {
    const header = dayHeader(new Date(r.created_at))
    const last = groups.at(-1)
    if (!last || last.header !== header) groups.push({ header, rows: [r] })
    else last.rows.push(r)
  }
  return groups
}

export default function AdminPanel({ onClose }: { readonly onClose: () => void }) {
  const [tab, setTab] = useState<
    'finance' | 'users' | 'visitors' | 'history' | 'gaps' | 'share' | 'jurnal' | 'releases' | 'stores'
  >('finance')
  const [copied, setCopied] = useState(false)
  const [users, setUsers] = useState<UserSummary[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [history, setHistory] = useState<HistoryRow[]>([])
  const [loading, setLoading] = useState(false)
  const [gaps, setGaps] = useState<CapabilityGap[]>([])
  const [finance, setFinance] = useState<Finance | null>(null)
  const [demos, setDemos] = useState<DemoStats | null>(null)
  const [activity, setActivity] = useState<UserActivity | null>(null)
  const [devLog, setDevLog] = useState<string[]>([])
  const [releases, setReleases] = useState<StagedRelease[]>([])
  const [stores, setStores] = useState<StoresData | null>(null)
  const [orders, setOrders] = useState<WorkOrder[]>([])
  // Gaps already sent to execution this session — shown marked, never hidden.
  const [escalatedIds, setEscalatedIds] = useState<Set<number>>(new Set())

  async function decide(id: string, d: 'approve' | 'reject'): Promise<void> {
    await decideRelease(id, d)
    setReleases((cur) => cur.map((r) => (r.id === id ? { ...r, status: d === 'approve' ? 'approved' : 'rejected' } : r)))
  }
  // The conversation of a clicked TRIAL visitor — what interested them, and in
  // what language they wrote / Kelion answered.
  const [convo, setConvo] = useState<{ v: DemoRecent; rows: HistoryRow[] } | null>(null)
  const [convoLoading, setConvoLoading] = useState(false)

  async function openVisitorConvo(v: DemoRecent): Promise<void> {
    if (!v.session_email) return
    setConvoLoading(true)
    setConvo({ v, rows: [] })
    const rows = await fetchHistory(v.session_email)
    setConvo({ v, rows })
    setConvoLoading(false)
  }

  useEffect(() => {
    void fetchUsers().then(setUsers)
    void fetchGaps().then(setGaps)
    void fetchFinance().then(setFinance)
    void fetchDemos().then(setDemos)
    void fetchActivity().then(setActivity)
    void fetchDevLog().then(setDevLog)
    void fetchReleases().then(setReleases)
  }, [])

  const sym = finance?.currency === 'usd' ? '$' : '£'
  const aiParts = finance
    ? Object.entries(finance.byKind)
        .filter(([, v]) => v > 0)
        .sort((a, b) => b[1] - a[1])
    : []

  async function markResolved(id: number): Promise<void> {
    await resolveGap(id, true)
    setGaps((cur) => cur.filter((g) => g.id !== id))
  }

  async function sendToClaude(id: number): Promise<void> {
    const res = await escalateGap(id)
    if (res.escalated) {
      // Adrian's flow: the request STAYS visible, marked as sent — it lands in
      // the persistent order registry (Jurnal) and HE cleans it here with
      // "Rezolvat" only after the fix is deployed and he tested it.
      setEscalatedIds((cur) => new Set(cur).add(id))
    } else {
      alert('Nu am putut trimite — încearcă din nou în câteva secunde.')
    }
  }

  useEffect(() => {
    if (!selected) return
    setLoading(true)
    void fetchHistory(selected).then((h) => {
      setHistory(h)
      setLoading(false)
    })
  }, [selected])

  return (
    <div className="admin-overlay">
      <div className="admin-panel">
        <header className="admin-head">
          <div className="admin-tabs">
            <button
              type="button"
              className={`admin-tab ${tab === 'finance' ? 'sel' : ''}`}
              onClick={() => setTab('finance')}
            >
              Bani
            </button>
            <button
              type="button"
              className={`admin-tab ${tab === 'users' ? 'sel' : ''}`}
              onClick={() => setTab('users')}
            >
              Utilizatori{activity && activity.users.length > 0 ? ` (${activity.users.length})` : ''}
            </button>
            <button
              type="button"
              className={`admin-tab ${tab === 'visitors' ? 'sel' : ''}`}
              onClick={() => setTab('visitors')}
            >
              Vizitatori
              {demos && demos.visitsToday + demos.today > 0
                ? ` (${demos.visitsToday + demos.today})`
                : ''}
            </button>
            <button
              type="button"
              className={`admin-tab ${tab === 'history' ? 'sel' : ''}`}
              onClick={() => setTab('history')}
            >
              Istoric chat
            </button>
            <button
              type="button"
              className={`admin-tab ${tab === 'share' ? 'sel' : ''}`}
              onClick={() => setTab('share')}
            >
              Distribuie
            </button>
            <button
              type="button"
              className={`admin-tab ${tab === 'gaps' ? 'sel' : ''}`}
              onClick={() => setTab('gaps')}
            >
              Cereri neacoperite{gaps.length > 0 ? ` (${gaps.length})` : ''}
            </button>
            <button
              type="button"
              className={`admin-tab ${tab === 'jurnal' ? 'sel' : ''}`}
              onClick={() => {
                setTab('jurnal')
                void fetchDevLog().then(setDevLog)
                void fetchWorkOrders().then(setOrders)
              }}
            >
              Jurnal Claude
            </button>
            <button
              type="button"
              className={`admin-tab ${tab === 'releases' ? 'sel' : ''}`}
              onClick={() => {
                setTab('releases')
                void fetchReleases().then(setReleases)
              }}
            >
              Release-uri
              {releases.filter((r) => r.status === 'pending').length > 0
                ? ` (${releases.filter((r) => r.status === 'pending').length})`
                : ''}
            </button>
            <button
              type="button"
              className={`admin-tab ${tab === 'stores' ? 'sel' : ''}`}
              onClick={() => {
                setTab('stores')
                void fetchStores().then(setStores)
              }}
            >
              Magazine
            </button>
          </div>
          <button type="button" className="ghost" onClick={onClose}>
            Close
          </button>
        </header>
        {tab === 'finance' && (
          <section className="admin-finance">
            {!finance && <p className="chat-hint">Se încarcă…</p>}
            {finance && (
              <>
                <div className="fin-cards">
                  <div className="fin-card">
                    <span className="fin-label">Stripe — disponibil</span>
                    <span className="fin-val">
                      {finance.stripe ? `${sym}${finance.stripe.available.toFixed(2)}` : '—'}
                    </span>
                    {finance.stripe && finance.stripe.pending !== 0 && (
                      <span className="fin-sub">
                        în tranzit {sym}
                        {finance.stripe.pending.toFixed(2)}
                      </span>
                    )}
                  </div>
                  <div className="fin-card">
                    <span className="fin-label">Consumat la AI (real)</span>
                    <span className="fin-val">
                      {sym}
                      {finance.spent.toFixed(2)}
                    </span>
                  </div>
                  <div className="fin-card">
                    <span className="fin-label">Profit</span>
                    <span className="fin-val">
                      {sym}
                      {finance.profit.toFixed(2)}
                    </span>
                  </div>
                </div>
                <div className="fin-breakdown">
                  <div className="fin-breakdown-head">Cost per AI (real)</div>
                  {aiParts.length === 0 && <div className="chat-hint">Niciun consum încă.</div>}
                  {aiParts.map(([k, v]) => (
                    <div className="fin-row" key={k}>
                      <span>{AI_LABELS[k] ?? k}</span>
                      <span>${v.toFixed(4)}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>
        )}
        {tab === 'releases' && (
          <section className="admin-finance">
            <div className="fin-breakdown">
              <div className="fin-breakdown-head">
                Release-uri — modificări construite de Claude, în așteptarea aprobării tale. Nimic nu
                intră live până nu apeși „Aprobă și publică".
              </div>
              {releases.length === 0 && (
                <div className="chat-hint">
                  Niciun release în așteptare. Aici apar modificările pe care Claude le-a construit
                  headless pe server; le vezi, le aprobi (→ se publică) sau le respingi.
                </div>
              )}
              {releases.map((r) => (
                <div key={r.id} className={`release-row status-${r.status}`}>
                  <div className="release-main">
                    <span className="release-title">{r.title}</span>
                    <span className={`release-badge b-${r.status}`}>
                      {r.status === 'pending'
                        ? 'ÎN AȘTEPTARE'
                        : r.status === 'approved'
                          ? 'APROBAT'
                          : r.status === 'deployed'
                            ? 'PUBLICAT'
                            : 'RESPINS'}
                    </span>
                    <span className="release-time">
                      {new Date(r.at).toLocaleString('ro-RO', {
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                  {r.detail && <pre className="release-detail">{r.detail}</pre>}
                  {r.status === 'pending' && (
                    <div className="release-actions">
                      <button
                        type="button"
                        className="composer-send"
                        onClick={() => void decide(r.id, 'approve')}
                      >
                        Aprobă și publică
                      </button>
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => void decide(r.id, 'reject')}
                      >
                        Respinge
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}
        {tab === 'stores' && (
          <section className="admin-finance">
            {!stores && <p className="chat-hint">Se verifică magazinele live…</p>}
            {stores && (
              <>
                <div className="fin-breakdown">
                  <div className="fin-breakdown-head">
                    Magazine — verificare LIVE pe paginile publice (nu pe promisiunile
                    dashboard-urilor), la maxim 5 minute vechime.
                  </div>
                  {stores.stores.map((s) => (
                    <div className="fin-row" key={s.key}>
                      <span>
                        {s.name} — {s.store}
                      </span>
                      <span>
                        {s.listed ? (
                          <a href={s.url} target="_blank" rel="noreferrer" className="store-live">
                            ● LISTAT — deschide
                          </a>
                        ) : (
                          <span className="store-missing">○ nelistat încă</span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="fin-breakdown">
                  <div className="fin-breakdown-head">
                    Descărcări directe de pe site (numărate de serverul nostru — cifre reale).
                    Instalările DIN magazine sunt doar agregate, prin API-urile lor; niciun magazin
                    nu dezvăluie identitatea celui care instalează.
                  </div>
                  {stores.downloads.counts.length === 0 && (
                    <div className="chat-hint">
                      Nicio descărcare înregistrată încă (jurnalul pornește de la acest release).
                    </div>
                  )}
                  {stores.downloads.counts.map((c) => (
                    <div className="fin-row" key={c.file}>
                      <span>{c.file}</span>
                      <span>{c.total} descărcări</span>
                    </div>
                  ))}
                </div>
                {stores.downloads.recent.length > 0 && (
                  <div className="fin-breakdown">
                    <div className="fin-breakdown-head">Cine a descărcat (ultimele 100)</div>
                    {stores.downloads.recent.map((d, i) => (
                      <div className="fin-row" key={i}>
                        <span>
                          {d.user_email || `${d.ip}${d.country ? ` · ${d.country}` : ''} (nelogat)`}
                        </span>
                        <span>
                          {d.file} ·{' '}
                          {new Date(d.created_at).toLocaleString('ro-RO', {
                            day: 'numeric',
                            month: 'short',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </section>
        )}
        {tab === 'jurnal' && (
          <section className="admin-finance">
            <div className="fin-breakdown">
              <div className="fin-breakdown-head">
                Ordine de lucru — tot ce s-a trimis la execuție (păstrat permanent, supraviețuiește
                oricărui restart). Vezi exact CE s-a trimis și dacă constructorul l-a preluat.
              </div>
              {orders.length === 0 && (
                <div className="chat-hint">Niciun ordin înregistrat încă (registrul pornește de la acest release).</div>
              )}
              {orders.map((o) => (
                <div className="fin-row" key={o.id}>
                  <span>{o.text.length > 160 ? `${o.text.slice(0, 160)}…` : o.text}</span>
                  <span>
                    {o.status === 'pending' ? '⏳ în așteptare' : '✓ preluat'} ·{' '}
                    {new Date(o.created_at).toLocaleString('ro-RO', {
                      day: 'numeric',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
              ))}
            </div>
            <div className="fin-breakdown">
              <div className="fin-breakdown-head">
                Jurnal Claude — istoricul complet al lucrului (monitorul arată doar lucrul curent)
              </div>
              {devLog.length === 0 && (
                <div className="chat-hint">
                  Jurnalul e gol — se umple cât timp Claude lucrează (de la ultima repornire a
                  serverului).
                </div>
              )}
              {[...devLog].reverse().map((l, i) => (
                <div className="devlog-line" key={i}>
                  {l}
                </div>
              ))}
            </div>
          </section>
        )}
        {tab === 'users' && (
          <section className="admin-finance">
            {!activity && <p className="chat-hint">Se încarcă…</p>}
            {activity && activity.users.length === 0 && (
              <p className="chat-hint">
                Încă nu s-a strâns activitate pe conturi — se adună de la prima intrare a fiecărui
                utilizator după această actualizare.
              </p>
            )}
            {activity && activity.users.length > 0 && (
              <>
                <div className="fin-breakdown">
                  <div className="fin-breakdown-head">
                    Pe utilizator — ultima intrare, IP, loc, cât a stat în total
                  </div>
                  {activity.users.map((u) => (
                    <div className="vis-row" key={u.email}>
                      <div className="vis-main">
                        <span className="vis-flagline">
                          <Flag code={u.code} />
                          <strong>{u.email}</strong>
                        </span>
                        <span className="vis-time">
                          {new Date(u.last_seen).toLocaleString('ro-RO', {
                            day: 'numeric',
                            month: 'short',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                      <div className="vis-meta">
                        <span>{u.last_ip || '—'}</span>
                        <span>{[u.city, u.country].filter(Boolean).join(', ') || '—'}</span>
                        <span>
                          {u.browser || '—'}
                          {u.device ? ` · ${u.device === 'mobile' ? 'mobil' : 'desktop'}` : ''}
                        </span>
                        <span>{u.sessions} sesiuni</span>
                        <span>timp total {fmtDur(u.seconds)}</span>
                        <span>{u.messages} mesaje</span>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="fin-breakdown">
                  <div className="fin-breakdown-head">Sesiuni recente — cine, când, cât a stat</div>
                  {activity.sessions.length === 0 && <div className="chat-hint">—</div>}
                  {activity.sessions.map((s, i) => (
                    <div className="vis-row" key={i}>
                      <div className="vis-main">
                        <span className="vis-flagline">
                          <Flag code={s.code} />
                          <strong>{s.email}</strong>
                        </span>
                        <span className="vis-time">
                          {new Date(s.started_at).toLocaleString('ro-RO', {
                            day: 'numeric',
                            month: 'short',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                      <div className="vis-meta">
                        <span>a stat {fmtDur(s.seconds)}</span>
                        <span>{s.ip || '—'}</span>
                        <span>{[s.city, s.country].filter(Boolean).join(', ') || '—'}</span>
                        <span>{s.device === 'mobile' ? 'mobil' : 'desktop'}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>
        )}
        {tab === 'visitors' && (
          <section className="admin-finance">
            {!demos && <p className="chat-hint">Se încarcă…</p>}
            {demos && (
              <>
                <div className="fin-cards fin-cards-4">
                  <div className="fin-card">
                    <span className="fin-label">Vizite azi / total</span>
                    <span className="fin-val">
                      {demos.visitsToday} / {demos.visitsTotal}
                    </span>
                  </div>
                  <div className="fin-card">
                    <span className="fin-label">Probe demo azi / total</span>
                    <span className="fin-val">
                      {demos.today} / {demos.total}
                    </span>
                  </div>
                  <div className="fin-card">
                    <span className="fin-label">Țări</span>
                    <span className="fin-val">{demos.byCountry.filter((c) => c.code).length}</span>
                  </div>
                  <div className="fin-card">
                    <span className="fin-label">Boți detectați</span>
                    <span className="fin-val">{demos.bots}</span>
                  </div>
                </div>
                <div className="fin-breakdown">
                  <div className="fin-breakdown-head">După țară</div>
                  {demos.byCountry.length === 0 && (
                    <div className="chat-hint">Niciun vizitator încă.</div>
                  )}
                  {demos.byCountry.map((c) => (
                    <div className="fin-row" key={`${c.country}${c.code}`}>
                      <span className="vis-flagline">
                        <Flag code={c.code} /> {c.country}
                      </span>
                      <span>{c.count}</span>
                    </div>
                  ))}
                </div>
                <div className="fin-breakdown">
                  <div className="fin-breakdown-head">
                    Vizite recente — profil complet · click pe o PROBĂ ca să vezi conversația
                  </div>
                  {demos.recent.length === 0 && <div className="chat-hint">—</div>}
                  {demos.recent.map((r, i) => {
                    const clickable = r.kind === 'demo' && !!r.session_email
                    return (
                      <div
                        className={`vis-row ${clickable ? 'vis-clickable' : ''}`}
                        key={i}
                        role={clickable ? 'button' : undefined}
                        tabIndex={clickable ? 0 : undefined}
                        onClick={clickable ? () => void openVisitorConvo(r) : undefined}
                        onKeyDown={
                          clickable
                            ? (e) => {
                                if (e.key === 'Enter' || e.key === ' ') void openVisitorConvo(r)
                              }
                            : undefined
                        }
                        title={clickable ? 'Vezi ce l-a interesat' : undefined}
                      >
                        <div className="vis-main">
                          <span className="vis-flagline">
                            <Flag code={r.code} />
                            <strong>
                              {r.country || 'Necunoscut'}
                              {r.region && r.region !== r.city ? ` · ${r.region}` : ''}
                              {r.city ? ` · ${r.city}` : ''}
                            </strong>
                          </span>
                          <span className={`vis-badge ${r.kind === 'demo' ? 'kind-demo' : 'kind-visit'}`}>
                            {r.kind === 'demo' ? 'DEMO' : 'VIZITĂ'}
                          </span>
                          <span className={`vis-badge ${r.is_bot ? 'bot' : 'human'}`}>
                            {r.is_bot ? 'BOT' : 'UMAN'}
                          </span>
                          {clickable && <span className="vis-open">deschide ›</span>}
                          <span className="vis-time">
                            {new Date(r.started_at).toLocaleString('ro-RO', {
                              day: 'numeric',
                              month: 'short',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        </div>
                        <div className="vis-meta">
                          <span>{r.ip}</span>
                          {r.isp && <span>{r.isp}</span>}
                          <span>
                            {[r.browser, r.os].filter(Boolean).join(' / ') || '—'}
                            {r.device ? ` · ${r.device === 'mobile' ? 'mobil' : 'desktop'}` : ''}
                          </span>
                          {r.lang && <span>limbă {r.lang}</span>}
                          <span>{r.referrer ? `sursă: ${r.referrer}` : 'acces direct'}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </section>
        )}
        {tab === 'share' && (
          <section className="admin-finance">
            {(() => {
              const url = 'https://kelionai.app'
              const text =
                'Kelionai — your brilliant AI assistant. It sees, hears and speaks. Try 3 minutes free:'
              const enc = encodeURIComponent
              // Text/link networks accept a prefilled share URL; video platforms
              // require uploading IN their studio — the clips are in Downloads.
              const links: { name: string; href: string }[] = [
                { name: 'X (Twitter)', href: `https://twitter.com/intent/tweet?text=${enc(text)}&url=${enc(url)}` },
                { name: 'Facebook', href: `https://www.facebook.com/sharer/sharer.php?u=${enc(url)}&quote=${enc(text)}` },
                { name: 'WhatsApp', href: `https://wa.me/?text=${enc(`${text} ${url}`)}` },
                { name: 'Telegram', href: `https://t.me/share/url?url=${enc(url)}&text=${enc(text)}` },
                { name: 'LinkedIn', href: `https://www.linkedin.com/sharing/share-offsite/?url=${enc(url)}` },
                { name: 'Reddit', href: `https://www.reddit.com/submit?url=${enc(url)}&title=${enc(text)}` },
              ]
              const uploads: { name: string; href: string }[] = [
                { name: 'TikTok — încarcă clip', href: 'https://www.tiktok.com/tiktokstudio/upload' },
                { name: 'Instagram', href: 'https://www.instagram.com/' },
                { name: 'YouTube Studio', href: 'https://studio.youtube.com/' },
                { name: 'Facebook Reels', href: 'https://www.facebook.com/reels/create' },
              ]
              return (
                <>
                  <div className="fin-breakdown">
                    <div className="fin-breakdown-head">Linkul aplicației</div>
                    <div className="share-row">
                      <code className="share-url">{url}</code>
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => {
                          void navigator.clipboard.writeText(`${text} ${url}`).then(() => {
                            setCopied(true)
                            window.setTimeout(() => setCopied(false), 1800)
                          })
                        }}
                      >
                        {copied ? 'Copiat ✓' : 'Copiază text + link'}
                      </button>
                      {'share' in navigator && (
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => void navigator.share({ title: 'Kelionai', text, url }).catch(() => {})}
                        >
                          Distribuie…
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="fin-breakdown">
                    <div className="fin-breakdown-head">Trimite linkul pe rețele</div>
                    <div className="share-grid">
                      {links.map((l) => (
                        <a key={l.name} className="share-btn" href={l.href} target="_blank" rel="noreferrer">
                          {l.name}
                        </a>
                      ))}
                    </div>
                  </div>
                  <div className="fin-breakdown">
                    <div className="fin-breakdown-head">
                      Platforme video — clipurile promo sunt în folderul Downloads; se încarcă în studioul lor
                    </div>
                    <div className="share-grid">
                      {uploads.map((l) => (
                        <a key={l.name} className="share-btn" href={l.href} target="_blank" rel="noreferrer">
                          {l.name}
                        </a>
                      ))}
                    </div>
                  </div>
                </>
              )
            })()}
          </section>
        )}
        {tab === 'gaps' && (
          <section className="admin-gaps">
            {gaps.length === 0 && (
              <p className="chat-hint">
                Nicio cerere neacoperită încă. Aici apar lucrurile pe care userii i le cer lui Kelion și pe
                care nu le poate face încă — pentru a decide ce construim mai departe.
              </p>
            )}
            {gaps.map((g) => (
              <div key={g.id} className="admin-gap">
                <div className="admin-gap-main">
                  <span className="admin-gap-req">{g.request}</span>
                  {g.reason && <span className="admin-gap-reason">{g.reason}</span>}
                  <span className="admin-gap-meta">
                    {g.hits > 1 ? `cerut de ${g.hits} ori · ` : ''}
                    {g.user_email} ·{' '}
                    {new Date(g.last_seen).toLocaleDateString('ro-RO', { day: 'numeric', month: 'short' })}
                  </span>
                </div>
                <div className="admin-gap-actions">
                  {escalatedIds.has(g.id) ? (
                    <span className="gap-sent">✓ Trimisă la execuție — vezi Jurnal; după test, apasă „Rezolvat"</span>
                  ) : (
                    <button
                      type="button"
                      className="composer-send"
                      onClick={() => void sendToClaude(g.id)}
                      title="Trimite cererea în registrul de execuție (rămâne aici până o cureți tu, după test)"
                    >
                      Escaladează către Claude
                    </button>
                  )}
                  <button type="button" className="ghost" onClick={() => void markResolved(g.id)}>
                    Rezolvat (curăță)
                  </button>
                </div>
              </div>
            ))}
          </section>
        )}
        <div className="admin-body" style={tab !== 'history' ? { display: 'none' } : undefined}>
          <aside className="admin-users">
            {users.length === 0 && <p className="chat-hint">No history yet.</p>}
            {users.map((u) => (
              <button
                key={u.email}
                type="button"
                className={`admin-user ${selected === u.email ? 'sel' : ''}`}
                onClick={() => setSelected(u.email)}
              >
                <span className="admin-user-email">{u.email}</span>
                <span className="admin-user-meta">{u.count} msg</span>
              </button>
            ))}
          </aside>
          <section className="admin-history">
            {!selected && <p className="chat-hint">Select a user to view their history.</p>}
            {loading && <p className="chat-hint">Loading…</p>}
            {selected &&
              !loading &&
              groupByDay(history).map((g) => (
                <div key={g.header} className="admin-day">
                  <div className="admin-day-header">{g.header}</div>
                  {g.rows.map((h, i) => (
                    <div key={i} className={`bubble ${h.role === 'user' ? 'user' : 'assistant'}`}>
                      <span className="admin-msg-time">
                        {new Date(h.created_at).toLocaleTimeString('ro-RO', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                      {h.content}
                    </div>
                  ))}
                </div>
              ))}
          </section>
        </div>
      </div>
      {convo && (
        <div className="convo-overlay" onClick={() => setConvo(null)}>
          <div className="convo-panel" onClick={(e) => e.stopPropagation()}>
            <header className="admin-head">
              <div className="convo-title">
                <strong>Ce l-a interesat</strong>
                <span className="convo-sub">
                  {convo.v.country || 'Necunoscut'}
                  {convo.v.city ? ` · ${convo.v.city}` : ''} ·{' '}
                  {convo.v.lang ? `limbă browser: ${convo.v.lang}` : 'limbă necunoscută'} ·{' '}
                  {convo.v.device === 'mobile' ? 'mobil' : 'desktop'}
                </span>
              </div>
              <button type="button" className="ghost" onClick={() => setConvo(null)}>
                Close
              </button>
            </header>
            <div className="convo-insight">
              {convoLoading
                ? 'Se încarcă…'
                : convo.rows.length === 0
                  ? 'A intrat în probă dar nu a scris nimic — doar a privit.'
                  : `A scris ${convo.rows.filter((r) => r.role === 'user').length} mesaje. ` +
                    `Limba lui (din browser): ${convo.v.lang || 'necunoscută'}. ` +
                    'Vezi mai jos ce a întrebat și în ce limbă i-a răspuns Kelion — așa afli dacă a descoperit că-și poate folosi limba.'}
            </div>
            <div className="admin-history convo-body">
              {!convoLoading && convo.rows.length === 0 && (
                <p className="chat-hint">— fără conversație —</p>
              )}
              {convo.rows.map((h, i) => (
                <div key={i} className={`bubble ${h.role === 'user' ? 'user' : 'assistant'}`}>
                  <span className="admin-msg-time">
                    {new Date(h.created_at).toLocaleTimeString('ro-RO', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                  {h.content}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
