import { useEffect, useRef, useState } from 'react'
import {
  GESTURE_CATALOG,
  GESTURE_CATEGORIES,
  previewGesture,
  fetchDisabledGestures,
  saveDisabledGestures,
} from '../lib/gestures'
import {
  fetchUsers,
  fetchHistory,
  translateToRo,
  fetchGaps,
  runGapsTriage,
  fetchFinance,
  fetchTransactions,
  type TransactionRow,
  updatePool,
  manageUser,
  sellCredits,
  fetchMoneyCircuit,
  createAiCard,
  type MoneyCircuit,
  fetchLeads,
  emailLead,
  type Lead,
  fetchVisitorConvos,
  fetchVisitorChat,
  replyVisitorChat,
  type VisitorConvo,
  type VisitorMsg,
  fetchDemos,
  fetchActivity,
  resolveGap,
  type UserSummary,
  type HistoryRow,
  type CapabilityGap,
  type Finance,
  type DemoStats,
  type UserActivity,
  type UserActivityRow,
  fetchStores,
  type StoresData,
  fetchInbound,
  fetchMailboxLive,
  type MailboxLiveItem,
  type InboundEmail,
  fetchContactMessages,
  type ContactMessage,
  fetchVoiceprints,
  fetchVoiceprintAudio,
  deleteVoiceprint,
  type VoiceprintRow,
  fetchTokenChecks,
  type TokenChecksResult,
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
  chat: 'Creier (OpenRouter)',
  correct: 'Gemini (correct)',
  image: 'Images (Gemini)',
  tts: 'Voice (TTS)',
  asr: 'Hearing (STT)',
  search: 'Căutare (OpenRouter web)',
  memory: 'Memorie',
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

export default function AdminPanel({
  onClose,
  initialTab,
}: {
  readonly onClose: () => void
  readonly initialTab?: 'finance' | 'users' | 'visitors' | 'vchat' | 'history' | 'gaps' | 'share' | 'stores' | 'inbox' | 'voiceprints' | 'tokenuri'
}) {
  const [tab, setTab] = useState<
    'finance' | 'users' | 'visitors' | 'vchat' | 'history' | 'gaps' | 'share' | 'stores' | 'inbox' | 'voiceprints' | 'gesturi' | 'tokenuri'
  >(initialTab ?? 'finance')
  // GESTURI (Adrian, 13 iul): lista dezactivată; ce NU e bifat NU se folosește.
  const [gestOff, setGestOff] = useState<string[]>([])
  const [gestSaved, setGestSaved] = useState(false)
  // La preview, panoul devine transparent ~3.5s ca să vezi avatarul din spate.
  const [peek, setPeek] = useState(false)
  const previewAndPeek = (clip: string): void => {
    previewGesture(clip)
    setPeek(true)
    window.setTimeout(() => setPeek(false), 3500)
  }
  // Chat live cu vizitatorii (inbox owner): conversații, cea selectată, răspuns.
  const [vconvos, setVconvos] = useState<VisitorConvo[]>([])
  const [vsel, setVsel] = useState<string | null>(null)
  const [vmsgs, setVmsgs] = useState<VisitorMsg[]>([])
  const [vreply, setVreply] = useState('')
  const vLastId = useState({ id: 0 })[0]
  const [inbound, setInbound] = useState<InboundEmail[]>([])
  const [mailboxLive, setMailboxLive] = useState<MailboxLiveItem[]>([])
  const [mailboxLoading, setMailboxLoading] = useState(false)
  const [contactMsgs, setContactMsgs] = useState<ContactMessage[]>([])
  const [copied, setCopied] = useState(false)
  const [users, setUsers] = useState<UserSummary[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [history, setHistory] = useState<HistoryRow[]>([])
  const [loading, setLoading] = useState(false)
  const [gaps, setGaps] = useState<CapabilityGap[]>([])
  const [triaging, setTriaging] = useState(false)
  const [finance, setFinance] = useState<Finance | null>(null)
  // Circuitul banilor Stripe→AI, gestionat DIN admin (Adrian, 24 iul).
  const [circuit, setCircuit] = useState<MoneyCircuit | null>(null)
  const [cardBusy, setCardBusy] = useState(false)
  // Tranzacțiile Stripe reale (alimentări credite) — tabul Bani.
  const [transactions, setTransactions] = useState<TransactionRow[]>([])
  // Pool AI — cât încarci/scoți (valoare tastată) + starea butoanelor.
  const [poolAmount, setPoolAmount] = useState('')
  const [poolBusy, setPoolBusy] = useState(false)
  // Lead-uri — vizitatori care și-au lăsat emailul.
  const [leads, setLeads] = useState<Lead[]>([])
  const [demos, setDemos] = useState<DemoStats | null>(null)
  const [activity, setActivity] = useState<UserActivity | null>(null)
  const [stores, setStores] = useState<StoresData | null>(null)
  const [voiceprints, setVoiceprints] = useState<VoiceprintRow[]>([])
  const [voiceprintsLoading, setVoiceprintsLoading] = useState(false)
  // Redarea mostrei audio a unei amprente (butonul „play"): reținem cine cântă
  // acum ca să arătăm ⏸ și să nu pornim două deodată.
  const [playingVp, setPlayingVp] = useState<string | null>(null)
  const vpAudioRef = useRef<HTMLAudioElement | null>(null)
  const playVoiceprint = async (email: string): Promise<void> => {
    // Al doilea click pe același rând oprește redarea.
    if (vpAudioRef.current) {
      vpAudioRef.current.pause()
      vpAudioRef.current = null
    }
    if (playingVp === email) {
      setPlayingVp(null)
      return
    }
    const clip = await fetchVoiceprintAudio(email)
    if (!clip) {
      setPlayingVp(null)
      return
    }
    const audio = new Audio(clip)
    vpAudioRef.current = audio
    audio.onended = () => setPlayingVp(null)
    audio.onerror = () => setPlayingVp(null)
    setPlayingVp(email)
    try {
      await audio.play()
    } catch {
      setPlayingVp(null)
    }
  }
  const [tokenChecks, setTokenChecks] = useState<TokenChecksResult | null>(null)
  const [tokenChecksLoading, setTokenChecksLoading] = useState(false)

  // The conversation + testing profile of a clicked user (tab "Utilizatori") —
  // ce a scris (chatul) și cum a testat (browser/device/IP/sesiuni/timp), într-un
  // singur click, fără să mai treacă prin tabul separat "Istoric chat".
  const [userConvo, setUserConvo] = useState<{ u: UserActivityRow; rows: HistoryRow[] } | null>(null)
  const [userConvoLoading, setUserConvoLoading] = useState(false)
  // „Tradu în română" în vizualizarea conversațiilor: roOn = afișăm traducerea;
  // roMap = cache text-original → traducere (o singură cerere per mesaj nou).
  const [roOn, setRoOn] = useState(false)
  const [roMap, setRoMap] = useState<Record<string, string>>({})
  const [roBusy, setRoBusy] = useState(false)

  async function toggleRo(rows: HistoryRow[]): Promise<void> {
    if (roOn) {
      setRoOn(false)
      return
    }
    const missing = Array.from(new Set(rows.map((r) => r.content).filter((c) => c && !(c in roMap))))
    if (missing.length > 0) {
      setRoBusy(true)
      const translated = await translateToRo(missing)
      setRoMap((m) => {
        const next = { ...m }
        missing.forEach((src, i) => (next[src] = translated[i] ?? src))
        return next
      })
      setRoBusy(false)
    }
    setRoOn(true)
  }
  // La deschiderea unei conversații noi, pornim mereu pe limba originală.
  const showMsg = (content: string): string => (roOn ? (roMap[content] ?? content) : content)

  async function openUserConvo(u: UserActivityRow): Promise<void> {
    setUserConvoLoading(true)
    setRoOn(false)
    setUserConvo({ u, rows: [] })
    const rows = await fetchHistory(u.email)
    setUserConvo({ u, rows })
    setUserConvoLoading(false)
  }

  useEffect(() => {
    void fetchUsers().then(setUsers)
    void fetchGaps().then(setGaps)
    void fetchFinance().then(setFinance)
    void fetchMoneyCircuit().then(setCircuit)
    void fetchTransactions().then(setTransactions)
    void fetchDemos().then(setDemos)
    void fetchLeads().then(setLeads)
    void fetchVisitorConvos().then(setVconvos)
    void fetchActivity().then(setActivity)
  }, [])

  // While the "Cereri neacoperite" tab is open, refresh every 15s so a request
  // that reached a successful deploy DISPARE singură din listă (auto-rezolvat).
  useEffect(() => {
    if (tab !== 'gaps') return
    const id = window.setInterval(() => void fetchGaps().then(setGaps), 15_000)
    return () => window.clearInterval(id)
  }, [tab])

  // BANI ÎN TIMP REAL (Adrian, 24 iul: „toate creditele se afișează în timp
  // real, valoarea reală"): cât timp tabul Bani e deschis, reîmprospătăm soldul
  // OpenRouter, Stripe, profit și tranzacțiile la fiecare 15s — valori LIVE.
  useEffect(() => {
    if (tab !== 'finance') return
    const id = window.setInterval(() => {
      void fetchFinance().then(setFinance)
      void fetchTransactions().then(setTransactions)
    }, 15_000)
    return () => window.clearInterval(id)
  }, [tab])

  // Live visitor chat: refresh the conversation list while the tab is open, and
  // poll the OPEN conversation for new visitor lines (both every few seconds).
  useEffect(() => {
    if (tab !== 'vchat') return
    const id = window.setInterval(() => void fetchVisitorConvos().then(setVconvos), 5000)
    return () => window.clearInterval(id)
  }, [tab])

  useEffect(() => {
    if (tab !== 'vchat' || !vsel) return
    let alive = true
    const tick = async (): Promise<void> => {
      const more = await fetchVisitorChat(vsel, vLastId.id)
      if (alive && more.length > 0) {
        vLastId.id = more[more.length - 1].id
        setVmsgs((m) => [...m, ...more])
      }
    }
    void tick()
    const id = window.setInterval(() => void tick(), 3000)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [tab, vsel, vLastId])

  async function openConvo(conv: string): Promise<void> {
    vLastId.id = 0
    setVsel(conv)
    setVmsgs([])
    const rows = await fetchVisitorChat(conv, 0)
    vLastId.id = rows.length ? rows[rows.length - 1].id : 0
    setVmsgs(rows)
  }

  async function sendReply(): Promise<void> {
    const t = vreply.trim()
    if (!t || !vsel) return
    const id = await replyVisitorChat(vsel, t)
    if (id > 0) {
      setVmsgs((m) => [...m, { id, role: 'owner', text: t, created_at: '' }])
      vLastId.id = Math.max(vLastId.id, id)
      setVreply('')
    }
  }

  // Tab „Amprente vocale" deschis → încarcă lista și reîmprospătează la 10s.
  useEffect(() => {
    if (tab !== 'voiceprints') return
    const load = async (): Promise<void> => {
      setVoiceprintsLoading(true)
      const rows = await fetchVoiceprints()
      setVoiceprints(rows)
      setVoiceprintsLoading(false)
    }
    void load()
    const id = window.setInterval(() => void load(), 10_000)
    return () => window.clearInterval(id)
  }, [tab])

  // Tab „Gesturi" deschis → încarcă lista dezactivată.
  useEffect(() => {
    if (tab !== 'gesturi') return
    void fetchDisabledGestures().then(setGestOff)
  }, [tab])

  // Bifează/debifează un gest → salvează pe server. Bifat = activ (NU în lista
  // dezactivată). Ce nu e bifat NU se folosește deloc în aplicație.
  const toggleGesture = (clip: string): void => {
    const next = gestOff.includes(clip) ? gestOff.filter((c) => c !== clip) : [...gestOff, clip]
    setGestOff(next)
    void saveDisabledGestures(next).then((ok) => {
      if (ok) {
        setGestSaved(true)
        window.setTimeout(() => setGestSaved(false), 1500)
      }
    })
  }

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

  useEffect(() => {
    if (!selected) return
    setLoading(true)
    void fetchHistory(selected).then((h) => {
      setHistory(h)
      setLoading(false)
    })
  }, [selected])

  return (
    <div className={`admin-overlay ${peek ? 'peek' : ''}`}>
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
              className={`admin-tab ${tab === 'vchat' ? 'sel' : ''}`}
              onClick={() => setTab('vchat')}
            >
              Chat live{vconvos.length > 0 ? ` (${vconvos.length})` : ''}
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
              className={`admin-tab ${tab === 'stores' ? 'sel' : ''}`}
              onClick={() => {
                setTab('stores')
                void fetchStores().then(setStores)
              }}
            >
              Magazine
            </button>
            <button
              type="button"
              className={`admin-tab ${tab === 'inbox' ? 'sel' : ''}`}
              onClick={() => {
                setTab('inbox')
                void fetchInbound().then(setInbound)
                void fetchContactMessages().then(setContactMsgs)
                setMailboxLoading(true)
                void fetchMailboxLive().then((m) => {
                  setMailboxLive(m)
                  setMailboxLoading(false)
                })
              }}
            >
              Inbox
            </button>
            <button
              type="button"
              className={`admin-tab ${tab === 'voiceprints' ? 'sel' : ''}`}
              onClick={() => setTab('voiceprints')}
            >
              Amprente vocale{voiceprints.length > 0 ? ` (${voiceprints.length})` : ''}
            </button>
            <button
              type="button"
              className={`admin-tab ${tab === 'gesturi' ? 'sel' : ''}`}
              onClick={() => setTab('gesturi')}
            >
              Gesturi
            </button>
            <button
              type="button"
              className={`admin-tab ${tab === 'tokenuri' ? 'sel' : ''}`}
              onClick={() => {
                setTab('tokenuri')
                setTokenChecksLoading(true)
                void fetchTokenChecks().then((r) => {
                  setTokenChecks(r)
                  setTokenChecksLoading(false)
                })
              }}
            >
              Tokenuri
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
                <div className="fin-cards fin-cards-4">
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
                    {finance.stripe && finance.stripe.available < 0 && (
                      <span className="fin-sub">
                        sub zero = taxe Stripe reținute la rambursări/dispute (cifra vine direct de
                        la Stripe)
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
                    <span className="fin-label">Consumat azi</span>
                    <span className="fin-val">${finance.today.toFixed(2)}</span>
                  </div>
                  <div className="fin-card">
                    <span className="fin-label">Profit</span>
                    <span className="fin-val">
                      {sym}
                      {finance.profit.toFixed(2)}
                    </span>
                  </div>
                </div>
                {/* PUNGA LUI KELION = soldul REAL, exact din contul OpenRouter
                    (creierul central). Valoare LIVE; când e sub prag, avertizăm
                    să depui bani. Doar adminul vede acest tab. */}
                {finance.openrouter && (
                  <div className={`or-wallet ${finance.openrouter.low ? 'low' : ''}`}>
                    <div className="or-wallet-main">
                      <span className="or-wallet-label">
                        OpenRouter — punga lui Kelion (creierul central)
                      </span>
                      <span className="or-wallet-val">
                        {finance.openrouter.live ? `$${finance.openrouter.balance.toFixed(2)}` : '—'}
                      </span>
                    </div>
                    {!finance.openrouter.live && (
                      <span className="or-wallet-sub">
                        Nu pot citi soldul acum (cheia OpenRouter lipsește sau contul e inaccesibil).
                      </span>
                    )}
                    {finance.openrouter.live && finance.openrouter.low && (
                      <span className="or-wallet-sub">
                        ⚠️ Sub ${finance.openrouter.threshold} — depune bani ca să nu pice creierul.{' '}
                        <a href={finance.openrouter.topup} target="_blank" rel="noreferrer">
                          Alimentează OpenRouter
                        </a>
                        {' · '}
                        Ca să se alimenteze SINGUR, activează „Auto Top-Up" pe OpenRouter (cu un card salvat) — se reîncarcă automat sub prag.
                      </span>
                    )}
                    {finance.openrouter.live && !finance.openrouter.low && (
                      <span className="or-wallet-sub">
                        Creierul central consumă din acest cont. Pentru alimentare automată, activează „Auto Top-Up" pe OpenRouter.{' '}
                        <a href={finance.openrouter.topup} target="_blank" rel="noreferrer">
                          Deschide OpenRouter
                        </a>
                      </span>
                    )}
                  </div>
                )}
                {/* CIRCUITUL BANILOR, din admin (Adrian, 24 iul: „din platforma
                    kelionai admin"): userii plătesc → punga Stripe → cardul
                    virtual → OpenAI + OpenRouter. Fiecare verigă cu starea ei
                    LIVE; ce se poate prin API se face de AICI. */}
                <div className="or-wallet">
                  <div className="or-wallet-main">
                    <span className="or-wallet-label">Circuitul banilor: useri → Stripe → AI</span>
                  </div>
                  {!circuit && <span className="or-wallet-sub">Se citește starea din Stripe…</span>}
                  {circuit && (
                    <>
                      <span className="or-wallet-sub">
                        {circuit.payoutsInterval === 'manual' ? '✅' : '❌'} 1. Banii RĂMÂN în pungă (payouts: {circuit.payoutsInterval}){' '}
                        {circuit.payoutsInterval !== 'manual' && (
                          <a href="https://dashboard.stripe.com/settings/payouts" target="_blank" rel="noreferrer">Setează Manual</a>
                        )}
                      </span>
                      <span className="or-wallet-sub">
                        {circuit.issuingStatus === 'active' ? '✅' : '❌'} 2. Carduri virtuale Stripe (Issuing: {circuit.issuingStatus}){' '}
                        {circuit.issuingStatus !== 'active' && (
                          <a href="https://dashboard.stripe.com/issuing/overview" target="_blank" rel="noreferrer">Activează</a>
                        )}
                      </span>
                      <span className="or-wallet-sub">
                        {circuit.cards.length > 0 ? `✅ 3. Cardul Kelion AI: •••• ${circuit.cards[0].last4}` : '❌ 3. Cardul Kelion AI: necreat'}{' '}
                        {circuit.issuingStatus === 'active' && circuit.cards.length === 0 && (
                          <button
                            type="button"
                            className="ghost"
                            disabled={cardBusy}
                            onClick={async () => {
                              setCardBusy(true)
                              const c = await createAiCard()
                              setCardBusy(false)
                              if (c) {
                                window.open(c.url, '_blank', 'noopener')
                                void fetchMoneyCircuit().then(setCircuit)
                              } else window.alert('Crearea cardului a eșuat — activează întâi Issuing.')
                            }}
                          >
                            {cardBusy ? 'Se creează…' : 'Creează cardul'}
                          </button>
                        )}
                        {circuit.cards.length > 0 && (
                          <a href={`https://dashboard.stripe.com/issuing/cards/${circuit.cards[0].id}`} target="_blank" rel="noreferrer">Vezi datele cardului</a>
                        )}
                      </span>
                      <span className="or-wallet-sub">
                        4. Cardul pus la AI:{' '}
                        <a href="https://platform.openai.com/settings/organization/billing/overview" target="_blank" rel="noreferrer">OpenAI (voce)</a>
                        {' · '}
                        <a href="https://openrouter.ai/settings/credits" target="_blank" rel="noreferrer">OpenRouter (creier)</a>
                        {' '}— cu auto-recharge pornit la amândouă
                      </span>
                      <span className="or-wallet-sub">
                        Punga Issuing (gata de cheltuit pe card): <strong>£{circuit.issuingAvailable.toFixed(2)}</strong>{' '}
                        <a href="https://dashboard.stripe.com/balance/overview" target="_blank" rel="noreferrer">Adaugă fonduri</a>
                      </span>
                    </>
                  )}
                </div>
                <div className="pool-manage">
                  <div className="pool-manage-head">
                    Pool AI — banii puși la dispoziția AI. Încărcat {sym}
                    {finance.loaded.toFixed(2)} · rămas {sym}
                    {finance.remaining.toFixed(2)}
                  </div>
                  <div className="pool-manage-row">
                    <input
                      className="pool-input"
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder={`Sumă (${sym})`}
                      value={poolAmount}
                      onChange={(e) => setPoolAmount(e.target.value)}
                      onKeyDown={(e) => {
                        // Enter în câmp = „Adaugă bani" (fluxul principal), ca să nu
                        // pară că „nu face nimic" când apeși Enter în loc de buton.
                        if (e.key !== 'Enter' || poolBusy || !(Number(poolAmount) > 0)) return
                        e.preventDefault()
                        void (async () => {
                          setPoolBusy(true)
                          const ok = await updatePool(Number(poolAmount), 'add')
                          if (ok) {
                            setPoolAmount('')
                            await fetchFinance().then(setFinance)
                          }
                          setPoolBusy(false)
                        })()
                      }}
                    />
                    <button
                      type="button"
                      className="pool-btn add"
                      disabled={poolBusy || !(Number(poolAmount) > 0)}
                      onClick={async () => {
                        setPoolBusy(true)
                        const ok = await updatePool(Number(poolAmount), 'add')
                        if (ok) {
                          setPoolAmount('')
                          await fetchFinance().then(setFinance)
                        }
                        setPoolBusy(false)
                      }}
                    >
                      + Adaugă bani
                    </button>
                    <button
                      type="button"
                      className="pool-btn withdraw"
                      disabled={poolBusy || !(Number(poolAmount) > 0)}
                      onClick={async () => {
                        setPoolBusy(true)
                        const ok = await updatePool(Number(poolAmount), 'withdraw')
                        if (ok) {
                          setPoolAmount('')
                          await fetchFinance().then(setFinance)
                        }
                        setPoolBusy(false)
                      }}
                    >
                      − Scoate bani
                    </button>
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
                {/* Tranzacțiile Stripe REALE (alimentări credite) — cine, cât, status, când. */}
                <div className="fin-breakdown">
                  <div className="fin-breakdown-head">Tranzacții — alimentări credite prin Stripe</div>
                  {transactions.length === 0 && <div className="chat-hint">Nicio tranzacție încă.</div>}
                  {transactions.map((t) => (
                    <div className="fin-row" key={t.id}>
                      <span>
                        {t.user_id} · {t.status} ·{' '}
                        {new Date(t.created_at).toLocaleString('ro-RO', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                      <span>
                        {sym}
                        {Number(t.amount).toFixed(2)} · {Number(t.credits).toFixed(0)} credite
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
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
        {tab === 'inbox' && (
          <section className="admin-finance">
            <div className="fin-breakdown">
              <div className="fin-breakdown-head">
                📬 Cutia REALĂ contact@kelionai.app — citită direct din server (toate
                mesajele, citite sau nu). Aici vezi tot ce e în inbox, nu doar mailul
                nou. Ultimele 40.
              </div>
              {mailboxLoading && <p className="chat-hint">Se citește cutia…</p>}
              {!mailboxLoading && mailboxLive.length === 0 && (
                <p className="chat-hint">Cutia e goală sau nu s-a putut citi (verifică MAIL_PASS).</p>
              )}
              {mailboxLive.map((m) => (
                <div className="inbox-item" key={m.uid}>
                  <div className="inbox-top">
                    <span className="inbox-from">
                      {m.fromName ? `${m.fromName} <${m.from}>` : m.from || '(expeditor necunoscut)'}
                    </span>
                    <span className={`inbox-flag ${m.seen ? 'ok' : 'wait'}`}>
                      {m.seen ? 'citit' : '● necitit'}
                    </span>
                  </div>
                  <div className="inbox-subj">{m.subject || '(fără subiect)'}</div>
                  <div className="chat-hint">
                    {new Date(m.date).toLocaleString('ro-RO', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </div>
                </div>
              ))}
            </div>
            <div className="fin-breakdown">
              <div className="fin-breakdown-head">
                Mesaje din formularul „Contact" — salvate MEREU aici, chiar dacă
                emailul (MAIL_PASS) nu e configurat. Niciun mesaj nu se mai pierde.
              </div>
              {contactMsgs.length === 0 && (
                <p className="chat-hint">Niciun mesaj de contact încă.</p>
              )}
              {contactMsgs.map((m) => (
                <div className="inbox-item" key={m.id}>
                  <div className="inbox-top">
                    <span className="inbox-from">
                      {m.name || '(fără nume)'} &lt;{m.email}&gt;
                    </span>
                    <span className={`inbox-flag ${m.emailed ? 'ok' : 'wait'}`}>
                      {m.emailed ? '✉️ redirecționat pe email' : '📥 doar salvat (email off)'}
                    </span>
                  </div>
                  <div className="inbox-subj">
                    {m.department ? `[${m.department}] ` : ''}
                    {m.subject || '(fără subiect)'}
                  </div>
                  <div className="inbox-body">{m.message.slice(0, 500)}</div>
                  <div className="chat-hint">
                    {new Date(m.created_at).toLocaleString('ro-RO', {
                      day: 'numeric',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </div>
                </div>
              ))}
            </div>
            <div className="fin-breakdown">
              <div className="fin-breakdown-head">
                Inbox contact@kelionai.app — emailurile PRIMITE și răspunsul redactat
                automat de Secretar (row 19). Se citesc la fiecare 3 minute.
              </div>
              {inbound.length === 0 && (
                <p className="chat-hint">Nicio scrisoare încă (sau MAIL_PASS nesetat).</p>
              )}
              {inbound.map((m) => (
                <div className="inbox-item" key={m.id}>
                  <div className="inbox-top">
                    <span className="inbox-from">{m.from_name || m.from_addr}</span>
                    <span className={`inbox-flag ${m.replied ? 'ok' : 'wait'}`}>
                      {m.replied ? '✅ răspuns trimis' : '⏳ fără răspuns'}
                    </span>
                  </div>
                  <div className="inbox-subj">{m.subject || '(fără subiect)'}</div>
                  {m.body && <div className="inbox-body">{m.body.slice(0, 300)}</div>}
                  {m.reply && (
                    <div className="inbox-reply">
                      <b>Răspuns:</b> {m.reply.slice(0, 300)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}
        {tab === 'voiceprints' && (
          <section className="admin-finance">
            <div className="fin-breakdown">
              <div className="fin-breakdown-head">
                Amprente vocale înregistrate — identificare speaker + gen detectat
              </div>
              {voiceprintsLoading && voiceprints.length === 0 && (
                <div className="chat-hint">Se încarcă…</div>
              )}
              {!voiceprintsLoading && voiceprints.length === 0 && (
                <div className="chat-hint">Nicio amprentă vocală înregistrată încă.</div>
              )}
              {voiceprints.map((v) => (
                <div className="fin-row" key={v.email}>
                  <span>
                    <strong>{v.name || v.email}</strong>
                    {' · '}
                    <span className={`vis-badge ${v.isAdmin ? 'kind-demo' : 'human'}`}>
                      {v.isAdmin ? 'ADMIN' : 'USER'}
                    </span>
                    {' · '}
                    <span>
                      gen: {v.gender === 'male' ? 'bărbat' : v.gender === 'female' ? 'femeie' : 'necunoscut'}
                    </span>
                  </span>
                  <span>
                    {new Date(v.updatedAt).toLocaleString('ro-RO', {
                      day: 'numeric',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                    {' · '}
                    {v.hasAudio ? (
                      <button
                        type="button"
                        className="ghost"
                        title="Ascultă mostra vocii"
                        onClick={() => void playVoiceprint(v.email)}
                      >
                        {playingVp === v.email ? '⏸ oprește' : '▶ ascultă'}
                      </button>
                    ) : (
                      <span className="muted" title="Încă nu s-a captat o mostră audio">
                        fără audio
                      </span>
                    )}
                    {' · '}
                    <button
                      type="button"
                      className="ghost"
                      onClick={() =>
                        void deleteVoiceprint(v.email).then((ok) => {
                          if (ok) setVoiceprints((cur) => cur.filter((x) => x.email !== v.email))
                        })
                      }
                    >
                      șterge
                    </button>
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}
        {tab === 'gesturi' && (
          <section className="admin-finance">
            <div className="fin-breakdown">
              <div className="fin-breakdown-head">
                Gesturile lui Kelion — apasă „▶ Arată" ca să-l vezi făcând gestul; bifează ce are voie
                să folosească pe logică/context. Ce NU e bifat NU se folosește deloc în aplicație.
                {gestSaved ? ' · salvat ✓' : ''}
              </div>
              {GESTURE_CATEGORIES.map((cat) => (
                <div key={cat}>
                  <div className="fin-breakdown-head" style={{ opacity: 0.7, marginTop: 12 }}>
                    {cat}
                  </div>
                  {GESTURE_CATALOG.filter((g) => g.category === cat).map((g) => {
                    const on = !gestOff.includes(g.clip)
                    return (
                      <div className="fin-row" key={g.clip}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                          <input type="checkbox" checked={on} onChange={() => toggleGesture(g.clip)} />
                          <span style={{ opacity: on ? 1 : 0.5 }}>{g.label}</span>
                        </label>
                        <button type="button" className="ghost" onClick={() => previewAndPeek(g.clip)}>
                          ▶ Arată
                        </button>
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          </section>
        )}
        {tab === 'tokenuri' && (
          <section className="admin-finance">
            <div className="fin-breakdown">
              <div className="fin-breakdown-head">
                Tokenuri și chei API cu drepturi — verificare LIVE
                <button
                  type="button"
                  className="ghost"
                  style={{ marginLeft: 12 }}
                  onClick={() => {
                    setTokenChecksLoading(true)
                    void fetchTokenChecks().then((r) => {
                      setTokenChecks(r)
                      setTokenChecksLoading(false)
                    })
                  }}
                >
                  Reîmprospătează
                </button>
              </div>
              {tokenChecksLoading && <p className="chat-hint">Se verifică tokenurile…</p>}
              {!tokenChecksLoading && !tokenChecks && <p className="chat-hint">Nu s-au putut încărca verificările.</p>}
              {tokenChecks && (
                <>
                  <div className="fin-row" style={{ fontWeight: 600 }}>
                    <span>✅ {tokenChecks.ok} OK</span>
                    <span>⚪ {tokenChecks.notConfigured} neconfigurate</span>
                    <span>🔴 {tokenChecks.failed} eșuate</span>
                  </div>
                  {tokenChecks.checks.map((c) => (
                    <div className="fin-row" key={c.name}>
                      <span>
                        {c.status === 'ok' ? '✅' : c.status === 'not_configured' ? '⚪' : '🔴'} {c.name}
                        {c.detail ? ` — ${c.detail}` : ''}
                      </span>
                      <span className="fin-sub" title={`Drepturi necesare: ${c.requiredScope ?? 'n/a'}`}>
                        {c.requiredScope ?? ''}
                      </span>
                    </div>
                  ))}
                </>
              )}
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
                    <div
                      className="vis-row vis-clickable"
                      key={u.email}
                      role="button"
                      tabIndex={0}
                      onClick={() => void openUserConvo(u)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') void openUserConvo(u)
                      }}
                      title="Vezi ce a scris și cum a testat"
                    >
                      <div className="vis-main">
                        <span className="vis-flagline">
                          <Flag code={u.code} />
                          <strong>{u.email}</strong>
                        </span>
                        <span className="vis-open">deschide ›</span>
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
                        <span>
                          sold {sym}
                          {u.balance.toFixed(2)}
                        </span>
                        {u.blocked && <span className="user-badge blocked">BLOCAT</span>}
                      </div>
                      <div className="vis-actions" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          className="user-act"
                          title="Vezi tot chatul: ce a scris și cum a răspuns Kelion"
                          onClick={() => void openUserConvo(u)}
                        >
                          💬 Vezi chat
                        </button>
                        <button
                          type="button"
                          className="user-act"
                          onClick={async () => {
                            const r = await manageUser(u.email, u.blocked ? 'unblock' : 'block')
                            if (r) setActivity(r)
                          }}
                        >
                          {u.blocked ? 'Deblochează' : 'Blochează'}
                        </button>
                        <button
                          type="button"
                          className="user-act"
                          onClick={async () => {
                            const s = window.prompt(
                              `Credit pentru ${u.email} în ${sym}. Pune negativ ca să scazi:`,
                            )
                            if (s == null) return
                            const amt = Number(s)
                            if (!Number.isFinite(amt) || amt === 0) return
                            const r = await manageUser(u.email, 'credit', amt)
                            if (r) setActivity(r)
                          }}
                        >
                          Credit
                        </button>
                        {/* VÂNZARE (Adrian, 24 iul): X credite pe bani — generează
                            linkul de plată Stripe pentru user; la plată primește
                            EXACT X credite. Userii nu au buton de cumpărare. */}
                        <button
                          type="button"
                          className="user-act"
                          onClick={async () => {
                            const s = window.prompt(`Câte credite îi vinzi lui ${u.email}?`)
                            if (s == null) return
                            const credits = Math.floor(Number(s))
                            if (!(credits > 0)) return
                            const r = await sellCredits(u.email, credits)
                            if (!r) {
                              window.alert('Generarea linkului a eșuat — vezi consola.')
                              return
                            }
                            try {
                              await navigator.clipboard.writeText(r.url)
                            } catch {
                              /* clipboard indisponibil — linkul rămâne în prompt */
                            }
                            window.prompt(
                              `${r.credits} credite = £${r.pounds.toFixed(2)}. Linkul de plată (copiat deja în clipboard) — trimite-i-l userului:`,
                              r.url,
                            )
                          }}
                        >
                          Vinde credite
                        </button>
                        <button
                          type="button"
                          className="user-act danger"
                          onClick={async () => {
                            if (
                              !window.confirm(
                                `Ștergi definitiv datele lui ${u.email}? (mesaje, sold, sesiuni, memorie)`,
                              )
                            )
                              return
                            const r = await manageUser(u.email, 'delete')
                            if (r) setActivity(r)
                          }}
                        >
                          Șterge
                        </button>
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
            <div className="fin-breakdown leads-box">
              <div className="fin-breakdown-head">
                Contacte — vizitatori care și-au lăsat emailul ({leads.length})
              </div>
              {leads.length === 0 && <div className="chat-hint">Niciun contact încă.</div>}
              {leads.map((l) => (
                <div className="lead-row" key={l.id}>
                  <div className="lead-main">
                    <span className="lead-email">{l.email}</span>
                    {l.note && <span className="lead-note">„{l.note}"</span>}
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    {l.contacted && <span className="lead-contacted">contactat</span>}
                    <button
                      type="button"
                      className="user-act"
                      onClick={async () => {
                        const subject = window.prompt(`Subiect pentru ${l.email}:`)
                        if (!subject) return
                        const body = window.prompt('Mesajul:')
                        if (!body) return
                        const ok = await emailLead(l.id, l.email, subject, body)
                        if (ok) {
                          await fetchLeads().then(setLeads)
                          window.alert('Email trimis.')
                        } else {
                          window.alert('Nu s-a putut trimite (verifică MAIL_PASS pe server).')
                        }
                      }}
                    >
                      Trimite email
                    </button>
                  </div>
                </div>
              ))}
            </div>
            {!demos && <p className="chat-hint">Se încarcă…</p>}
            {demos && (
              <>
                <div className="fin-cards">
                  <div className="fin-card">
                    <span className="fin-label">Vizite azi / total</span>
                    <span className="fin-val">
                      {demos.visitsToday} / {demos.visitsTotal}
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
                {/* Probele demo sunt MOARTE (nimic nu mai scrie demo_uses) — lista
                    arată doar VIZITELE, fără badge/flux DEMO. */}
                <div className="fin-breakdown">
                  <div className="fin-breakdown-head">Vizite recente — profil complet</div>
                  {demos.recent.length === 0 && <div className="chat-hint">—</div>}
                  {demos.recent.map((r, i) => (
                    <div className="vis-row" key={i}>
                      <div className="vis-main">
                        <span className="vis-flagline">
                          <Flag code={r.code} />
                          <strong>
                            {r.country || 'Necunoscut'}
                            {r.region && r.region !== r.city ? ` · ${r.region}` : ''}
                            {r.city ? ` · ${r.city}` : ''}
                          </strong>
                        </span>
                        <span className={`vis-badge ${r.is_bot ? 'bot' : 'human'}`}>
                          {r.is_bot ? 'BOT' : 'UMAN'}
                        </span>
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
                  ))}
                </div>
              </>
            )}
          </section>
        )}
        {tab === 'vchat' && (
          <section className="admin-finance vchat-admin">
            <div className="vchat-admin-list">
              <div className="fin-breakdown-head">Conversații live cu vizitatorii</div>
              {vconvos.length === 0 && <div className="chat-hint">Nicio conversație încă.</div>}
              {vconvos.map((c) => (
                <div
                  key={c.conv_id}
                  className={`vchat-convo ${vsel === c.conv_id ? 'sel' : ''}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => void openConvo(c.conv_id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') void openConvo(c.conv_id)
                  }}
                >
                  <span className="vchat-convo-last">{c.last_text.slice(0, 60)}</span>
                  <span className="vchat-convo-meta">
                    {c.visitor_msgs} de la vizitator ·{' '}
                    {new Date(c.last_at).toLocaleString('ro-RO', {
                      day: 'numeric',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
              ))}
            </div>
            <div className="vchat-admin-thread">
              {!vsel && <div className="chat-hint">Alege o conversație ca să răspunzi.</div>}
              {vsel && (
                <>
                  <div className="vchat-admin-log">
                    {vmsgs.map((m) => (
                      <div
                        key={m.id}
                        className={`vchat-bubble ${m.role === 'owner' ? 'me' : 'owner'}`}
                      >
                        {m.text}
                      </div>
                    ))}
                  </div>
                  <div className="vchat-row">
                    <input
                      className="vchat-input"
                      value={vreply}
                      placeholder="Răspunde vizitatorului…"
                      onChange={(e) => setVreply(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void sendReply()
                      }}
                    />
                    <button type="button" className="vchat-send" onClick={() => void sendReply()}>
                      ↑
                    </button>
                  </div>
                </>
              )}
            </div>
          </section>
        )}
        {tab === 'share' && (
          <section className="admin-finance">
            {(() => {
              const url = 'https://kelionai.app'
              const text =
                'Ți-l prezint pe Kelion — asistentul meu AI cu avatar și voce: vede, aude și vorbește, în orice limbă. Îl încerci 3 minute gratuit, fără cont:'
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
            {/* TRIAJ AUTONOM (Adrian, 24 iul): Kelion decide singur — valoros
                rămâne „DE IMPLEMENTAT", restul se închide automat cu motiv. */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <button
                type="button"
                className="ghost"
                disabled={triaging}
                onClick={() => {
                  setTriaging(true)
                  void runGapsTriage().then(async (r) => {
                    setTriaging(false)
                    if (r) setGaps(await fetchGaps())
                  })
                }}
              >
                {triaging ? 'Kelion analizează…' : '🤖 Triaj Kelion (autonom)'}
              </button>
            </div>
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
                  {g.triage && (
                    <span className="admin-gap-reason" style={{ color: g.triage.startsWith('DE IMPLEMENTAT') ? '#7ee2a8' : '#ffb86b' }}>
                      {g.triage}
                    </span>
                  )}
                  {g.reason && <span className="admin-gap-reason">{g.reason}</span>}
                  <span className="admin-gap-meta">
                    {g.hits > 1 ? `cerut de ${g.hits} ori · ` : ''}
                    {g.user_email} ·{' '}
                    {new Date(g.last_seen).toLocaleDateString('ro-RO', { day: 'numeric', month: 'short' })}
                  </span>
                </div>
                <div className="admin-gap-actions">
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
                onClick={() => {
                  setRoOn(false)
                  setSelected(u.email)
                }}
              >
                <span className="admin-user-email">{u.email}</span>
                <span className="admin-user-meta">{u.count} msg</span>
              </button>
            ))}
          </aside>
          <section className="admin-history">
            {!selected && <p className="chat-hint">Select a user to view their history.</p>}
            {loading && <p className="chat-hint">Loading…</p>}
            {selected && !loading && history.length > 0 && (
              <div className="convo-head-actions" style={{ marginBottom: 8 }}>
                <button
                  type="button"
                  className="user-act"
                  disabled={roBusy}
                  title="Traduce toată conversația în română (din orice limbă), instant"
                  onClick={() => void toggleRo(history)}
                >
                  {roBusy ? 'Traduc…' : roOn ? 'Arată originalul' : '🌐 Tradu în română'}
                </button>
              </div>
            )}
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
                      {showMsg(h.content)}
                    </div>
                  ))}
                </div>
              ))}
          </section>
        </div>
      </div>
      {userConvo && (
        <div className="convo-overlay" onClick={() => setUserConvo(null)}>
          <div className="convo-panel" onClick={(e) => e.stopPropagation()}>
            <header className="admin-head">
              <div className="convo-title">
                <strong>{userConvo.u.email}</strong>
                <span className="convo-sub">
                  {[userConvo.u.city, userConvo.u.country].filter(Boolean).join(', ') || 'loc necunoscut'} ·{' '}
                  {userConvo.u.browser || '—'}
                  {userConvo.u.device ? ` · ${userConvo.u.device === 'mobile' ? 'mobil' : 'desktop'}` : ''} ·{' '}
                  {userConvo.u.last_ip || 'IP necunoscut'} · {userConvo.u.sessions} sesiuni · timp total{' '}
                  {fmtDur(userConvo.u.seconds)} · {userConvo.u.messages} mesaje
                </span>
              </div>
              <div className="convo-head-actions">
                <button
                  type="button"
                  className="user-act"
                  disabled={roBusy || userConvo.rows.length === 0}
                  title="Traduce toată conversația în română (din orice limbă), instant"
                  onClick={() => void toggleRo(userConvo.rows)}
                >
                  {roBusy ? 'Traduc…' : roOn ? 'Arată originalul' : '🌐 Tradu în română'}
                </button>
                <button type="button" className="ghost" onClick={() => setUserConvo(null)}>
                  Close
                </button>
              </div>
            </header>
            <div className="admin-history convo-body">
              {userConvoLoading && <p className="chat-hint">Se încarcă…</p>}
              {!userConvoLoading && userConvo.rows.length === 0 && (
                <p className="chat-hint">Nu a scris niciun mesaj încă.</p>
              )}
              {!userConvoLoading &&
                groupByDay(userConvo.rows).map((g) => (
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
