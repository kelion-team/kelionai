import { useEffect, useRef, useState } from 'react'
import {
  GESTURE_CATALOG,
  GESTURE_CATEGORIES,
  previewGesture,
  fetchDisabledGestures,
  saveDisabledGestures,
} from '../lib/gestures'
import BackLink from './BackLink'
import { adminStrings } from '../lib/adminText'
import {
  fetchUsers,
  fetchHistory,
  translateToRo,
  fetchGaps,
  runGapsTriage,
  fetchFinance,
  manageUser,
  fetchMoneyCircuit,
  pauzaAutonomie,
  fetchDoveziAutonomie,
  type DovadaAutonomie,
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
  fetchEnvCheck,
  type EnvCheckResult,
  type TokenChecksResult,
  fetchAudit,
  type AuditReport,
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
  // The live-voice minutes — an INTERNAL ESTIMATE (mic-on seconds × a fixed
  // rate), never the OpenAI invoice. Labeled as such wherever it shows.
  voice_minutes: 'Minute voce (OpenAI Realtime)',
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

// ── ONE GRID OF LINKS, built once (unique, no duplicates) ───────────────────
// „Trimite linkul pe rețele” and „Platforme video” were TWO identical JSX
// blocks, differing only in title and list. If a button's look changed, it
// had to be changed in both. Now: one small component, two calls.
function ShareGrid({ title, items }: { title: string; items: { name: string; href: string }[] }): React.JSX.Element {
  return (
    <div className="fin-breakdown">
      <div className="fin-breakdown-head">{title}</div>
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

export default function AdminPanel({
  onClose,
  initialTab,
  onOpenSettings,
}: {
  readonly onClose: () => void
  readonly initialTab?: 'finance' | 'users' | 'visitors' | 'vchat' | 'history' | 'gaps' | 'share' | 'stores' | 'inbox' | 'voiceprints' | 'gesturi' | 'tokenuri' | 'constructor' | 'recuperare'
  // „⚙ Setări" moved OUT of the top bar into the panel (Adrian's order): the
  // bar keeps only measurements; the owner's settings open from here.
  readonly onOpenSettings?: () => void
}) {
  const [tab, setTab] = useState<
    'finance' | 'users' | 'visitors' | 'vchat' | 'history' | 'gaps' | 'share' | 'stores' | 'inbox' | 'voiceprints' | 'gesturi' | 'tokenuri' | 'constructor' | 'recuperare'
  >(initialTab ?? 'finance')
  // GESTURES (Adrian, Jul 13): the disabled list — what is NOT checked is NOT used.
  const [gestOff, setGestOff] = useState<string[]>([])
  const [gestSaved, setGestSaved] = useState(false)
  // On preview the panel goes transparent for ~3.5s, so you see the avatar behind.
  const [peek, setPeek] = useState(false)
  // The „Pune pe 0” button in the Money tab: while it runs, it can't be pressed twice.
  const [resetBusy, setResetBusy] = useState(false)
  const previewAndPeek = (clip: string): void => {
    previewGesture(clip)
    setPeek(true)
    window.setTimeout(() => setPeek(false), 3500)
  }
  // Live chat with visitors (owner inbox): conversations, the selected one, the reply.
  const [vconvos, setVconvos] = useState<VisitorConvo[]>([])
  const [vsel, setVsel] = useState<string | null>(null)
  const [vmsgs, setVmsgs] = useState<VisitorMsg[]>([])
  const [vLoading, setVLoading] = useState(false)
  const [vreply, setVreply] = useState('')
  const vLastId = useRef(0)
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
  // THE OUTAGES AUDIT (Adrian, Jul 27): everything that went down, in the same tab as gaps.
  const [audit, setAudit] = useState<AuditReport | null>(null)
  const [finance, setFinance] = useState<Finance | null>(null)
  // The money circuit, managed FROM admin (Adrian, Jul 24).
  const [circuit, setCircuit] = useState<MoneyCircuit | null>(null)
  // HERE STOOD `cardBusy` and `cardDeschis` — the state of the „Creează cardul”
  // button and of the window that showed the Stripe virtual card number. The
  // Issuing card left with Stripe (Jul 30): providers are paid with Adrian's card.
  // Stripe transactions were REMOVED from the panel on Jul 31 with the channel —
  // they are no longer read, so their state is no longer kept (nor requested
  // from the server on every tab load).
  // AI pool — how much you add/remove (typed value) + the buttons' state.
  // Leads — visitors who left their email.
  const [leads, setLeads] = useState<Lead[]>([])
  const [demos, setDemos] = useState<DemoStats | null>(null)
  const [activity, setActivity] = useState<UserActivity | null>(null)
  const [stores, setStores] = useState<StoresData | null>(null)
  const [voiceprints, setVoiceprints] = useState<VoiceprintRow[]>([])
  const [voiceprintsLoading, setVoiceprintsLoading] = useState(false)
  // THE BUILDER (Adrian, Jul 27: „Kelion must be able to create any software the
  // admin asks him to”): new orders + the queue with their state (the worker on
  // the VPS executes them and opens PRs; the merge is Adrian's).
  interface BuildJobRow {
    id: number
    status: 'queued' | 'running' | 'done' | 'failed'
    orderText: string
    branch: string | null
    prUrl: string | null
    tokens: number
    updatedAt: string
  }
  const [buildJobs, setBuildJobs] = useState<BuildJobRow[]>([])
  const [buildOrder, setBuildOrder] = useState('')
  const [buildMsg, setBuildMsg] = useState('')
  // RECOVERY (Adrian, Jul 27): saved versions + saving the current version.
  interface RecoveryRow {
    tag: string
    sha: string
    date: string
    note: string
  }
  const [recoveryPoints, setRecoveryPoints] = useState<RecoveryRow[]>([])
  const [recoveryLoading, setRecoveryLoading] = useState(false)
  const [recoveryNote, setRecoveryNote] = useState('')
  const [recoveryMsg, setRecoveryMsg] = useState('')
  // Restore BY BUTTON (Adrian, Jul 27: „the admin must be able to select it”).
  // While a restore runs, every restore button is locked.
  const [restoringTag, setRestoringTag] = useState<string | null>(null)
  // THE ADMIN BUTTON LOCK (Adrian, Jul 27): the activation secret is set HERE
  // (next to the voiceprints — both lock factors stay together). Once armed,
  // the Admin button asks for the voiceprint or the secret; it never disarms.
  const [lockArmed, setLockArmed] = useState<boolean | null>(null)
  const [lockSecret, setLockSecret] = useState('')
  const [lockMsg, setLockMsg] = useState('')
  // Playing a voiceprint's audio sample (the „play” button): we remember who is
  // playing now, to show ⏸ and never start two at once.
  const [playingVp, setPlayingVp] = useState<string | null>(null)
  const vpAudioRef = useRef<HTMLAudioElement | null>(null)
  const playVoiceprint = async (email: string): Promise<void> => {
    // A second click on the same row stops playback.
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
  // WHICH KEYS THE SERVER SEES RIGHT NOW — the answer to „I've typed them dozens of times”.
  const [envCheck, setEnvCheck] = useState<EnvCheckResult | null>(null)

  // The conversation + testing profile of a clicked user (tab "Utilizatori") —
  // what he wrote (the chat) and how he tested (browser/device/IP/sessions/time),
  // in one click, without going through the separate "Istoric chat" tab.
  const [userConvo, setUserConvo] = useState<{ u: UserActivityRow; rows: HistoryRow[] } | null>(null)
  const [userConvoLoading, setUserConvoLoading] = useState(false)
  // „Tradu în română” in the conversation view: roOn = show the translation;
  // roMap = original-text → translation cache (one request per new message).
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
  // Opening a new conversation always starts on the original language.
  const showMsg = (content: string): string => (roOn ? (roMap[content] ?? content) : content)

  async function openUserConvo(u: UserActivityRow): Promise<void> {
    setUserConvoLoading(true)
    setRoOn(false)
    setUserConvo({ u, rows: [] })
    const rows = await fetchHistory(u.email)
    setUserConvo({ u, rows })
    setUserConvoLoading(false)
  }

  // THE OWNER'S LEVER: stops / restarts autonomy in one click. After the press
  // we re-read the state from the server — we don't assume it worked.
  const [pauzaBusy, setPauzaBusy] = useState(false)
  // THE EIGHT PROOFS (Adrian, Jul 31: „there must be 8 out of 8 proofs”).
  const [dovezi, setDovezi] = useState<{ dovedite: number; din: number; dovezi: DovadaAutonomie[] } | null>(null)
  async function onPauzaAutonomie(oprit: boolean): Promise<void> {
    setPauzaBusy(true)
    await pauzaAutonomie(oprit)
    setCircuit(await fetchMoneyCircuit())
    setPauzaBusy(false)
  }

  useEffect(() => {
    void fetchUsers().then(setUsers)
    void fetchGaps().then(setGaps)
    void fetchFinance().then(setFinance)
    void fetchMoneyCircuit().then(setCircuit)
    void fetchDoveziAutonomie().then(setDovezi)
    void fetchDemos().then(setDemos)
    void fetchLeads().then(setLeads)
    void fetchVisitorConvos().then(setVconvos)
    void fetchActivity().then(setActivity)
  }, [])

  // While the "Cereri neacoperite" tab is open, refresh every 15s so a request
  // that reached a successful deploy DISAPPEARS from the list (auto-resolved).
  useEffect(() => {
    if (tab !== 'gaps') return
    // The outages audit loads when the tab opens and refreshes together with the
    // gaps — a single place where you see EVERYTHING that went down.
    void fetchAudit().then(setAudit)
    const id = window.setInterval(() => {
      void fetchGaps().then(setGaps)
      void fetchAudit().then(setAudit)
    }, 15_000)
    return () => window.clearInterval(id)
  }, [tab])

  // SYNC WITH VOICE NAVIGATION (fluidity audit Jul 27, defect 7): initialTab was
  // only the starting value — if the panel was ALREADY open and Kelion got
  // „deschide admin → vizitatori”, the tab didn't change at all.
  useEffect(() => {
    if (initialTab) setTab(initialTab)
  }, [initialTab])

  // LOAD ON TAB, NOT ON CLICK (defect 6): stores/inbox/tokens loaded their data
  // ONLY from the button's onClick — opened by voice or initialTab they stayed
  // forever empty („Se verifică magazinele live…” forever).
  useEffect(() => {
    if (tab === 'stores') {
      void fetchStores().then(setStores)
    } else if (tab === 'inbox') {
      void fetchInbound().then(setInbound)
      void fetchContactMessages().then(setContactMsgs)
      setMailboxLoading(true)
      void fetchMailboxLive().then((m) => {
        setMailboxLive(m)
        setMailboxLoading(false)
      })
    } else if (tab === 'tokenuri') {
      // The „Ce chei vede serverul CHIAR ACUM” table loads together with the tab.
      // This call had ended up by mistake at the tail of the `inbox` branch, so the
      // table NEVER appeared in Tokens — caught by Adrian from a screenshot.
      void fetchEnvCheck().then(setEnvCheck)
      setTokenChecksLoading(true)
      void fetchTokenChecks().then((r) => {
        setTokenChecks(r)
        setTokenChecksLoading(false)
      })
    }
  }, [tab])

  // MONEY IN REAL TIME (Adrian, Jul 24: „all credits show in real time, the real
  // value”): while the Money tab is open we refresh the balances and the profit
  // every 15s — LIVE values.
  useEffect(() => {
    if (tab !== 'finance') return
    const id = window.setInterval(() => {
      void fetchFinance().then(setFinance)
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
      const more = await fetchVisitorChat(vsel, vLastId.current)
      if (alive && more.length > 0) {
        vLastId.current = more[more.length - 1].id
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
    vLastId.current = 0
    setVsel(conv)
    setVmsgs([])
    // VISIBLE BUSY (fluidity audit Jul 27, defect 10): the thread emptied and
    // stayed WHITE while the conversation loaded — it looked broken.
    setVLoading(true)
    const rows = await fetchVisitorChat(conv, 0)
    setVLoading(false)
    vLastId.current = rows.length ? rows[rows.length - 1].id : 0
    setVmsgs(rows)
  }

  async function sendReply(): Promise<void> {
    const t = vreply.trim()
    if (!t || !vsel) return
    const id = await replyVisitorChat(vsel, t)
    if (id > 0) {
      setVmsgs((m) => [...m, { id, role: 'owner', text: t, created_at: '' }])
      vLastId.current = Math.max(vLastId.current, id)
      setVreply('')
    }
  }

  // Tab „Amprente vocale” open → loads the list and refreshes every 10s.
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

  // Tab „Constructor” open → the orders queue, refreshed every 10s.
  useEffect(() => {
    if (tab !== 'constructor') return
    const load = (): void => {
      fetch('/api/admin/constructor', { credentials: 'include' })
        .then((r) => (r.ok ? r.json() : null))
        .then((j: { jobs?: BuildJobRow[] } | null) => {
          if (j?.jobs) setBuildJobs(j.jobs)
        })
        .catch(() => {})
    }
    load()
    const id = window.setInterval(load, 10_000)
    return () => window.clearInterval(id)
  }, [tab])

  const sendBuildOrder = (): void => {
    const order = buildOrder.trim()
    if (order.length < 8) {
      setBuildMsg('Scrie ordinul complet (ce construiește, unde, cum verifici).')
      return
    }
    void fetch('/api/admin/constructor', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ order }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { id?: number } | null) => {
        if (j?.id) {
          setBuildOrder('')
          setBuildMsg(`Ordin #${j.id} în coadă — lucrătorul îl ia în max. 2 minute; primești email cu PR-ul.`)
        } else setBuildMsg('Nu s-a putut trimite — reîncearcă.')
      })
      .catch(() => setBuildMsg('Nu s-a putut trimite — reîncearcă.'))
  }

  // Tab „Recuperare” open → loads the saved recovery points.
  const loadRecovery = (): void => {
    setRecoveryLoading(true)
    fetch('/api/admin/backups', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { points?: RecoveryRow[] } | null) => {
        if (j?.points) setRecoveryPoints(j.points)
        setRecoveryLoading(false)
      })
      .catch(() => setRecoveryLoading(false))
  }
  useEffect(() => {
    if (tab !== 'recuperare') return
    loadRecovery()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  const saveRecoveryNow = (): void => {
    setRecoveryMsg('Salvez versiunea curentă…')
    void fetch('/api/admin/backups', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ note: recoveryNote.trim() }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('fail'))))
      .then((j: { tag?: string }) => {
        setRecoveryMsg(`Salvat ✓ punct de recuperare: ${j.tag ?? ''}`)
        setRecoveryNote('')
        loadRecovery()
      })
      .catch(() => setRecoveryMsg('Nu s-a putut salva — reîncearcă.'))
  }

  // Restores the app to a saved point: double confirmation (heavy action —
  // production changes), then the server brings master to the tag's state and
  // the publish starts by itself. The button shows progress and result, with proof.
  const restoreFromPoint = (p: RecoveryRow): void => {
    const when = p.date ? new Date(p.date).toLocaleString('ro-RO') : p.tag
    if (!window.confirm(`Restaurezi aplicația la versiunea din ${when} (${p.sha})?`)) return
    if (
      !window.confirm(
        `SIGUR? Producția va fi adusă EXACT la starea „${p.note.split('\n')[0].slice(0, 80) || p.tag}" și se republică automat. Modificările de după acest punct dispar din aplicație (rămân doar în istoricul git).`,
      )
    )
      return
    setRestoringTag(p.tag)
    setRecoveryMsg(`Restaurez la ${p.tag}…`)
    void fetch('/api/admin/backups/restore', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ tag: p.tag }),
    })
      .then((r) => r.json().then((j: { ok?: boolean; sha?: string; error?: string }) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        setRestoringTag(null)
        if (ok && j.ok)
          setRecoveryMsg(
            `Restaurat ✓ master e acum la ${j.sha ?? p.sha} — publicarea pe server pornește singură (1-2 min).`,
          )
        else setRecoveryMsg(`Restaurarea a eșuat: ${j.error ?? 'eroare necunoscută'}`)
      })
      .catch(() => {
        setRestoringTag(null)
        setRecoveryMsg('Restaurarea a eșuat — verifică conexiunea și reîncearcă.')
      })
  }

  // Tab „Amprente vocale” open → also the lock's state (armed or not).
  useEffect(() => {
    if (tab !== 'voiceprints') return
    fetch('/api/admin/unlock/status', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { armed?: boolean } | null) => {
        if (j) setLockArmed(!!j.armed)
      })
      .catch(() => {})
  }, [tab])

  const saveLockSecret = (): void => {
    const s = lockSecret.trim()
    if (s.length < 4) {
      setLockMsg('Secretul trebuie să aibă minim 4 caractere.')
      return
    }
    void fetch('/api/admin/unlock/secret', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ secret: s }),
    })
      .then((r) => {
        if (r.ok) {
          setLockArmed(true)
          setLockSecret('')
          setLockMsg('Salvat ✓ — lacătul e armat: butonul Admin cere de-acum vocea ta sau secretul.')
        } else setLockMsg('Nu s-a putut salva — reîncearcă.')
      })
      .catch(() => setLockMsg('Nu s-a putut salva — reîncearcă.'))
  }

  // Tab „Gesturi” open → loads the disabled list.
  useEffect(() => {
    if (tab !== 'gesturi') return
    void fetchDisabledGestures().then(setGestOff)
  }, [tab])

  // Check/uncheck a gesture → saves to the server. Checked = active (NOT on the
  // disabled list). What is not checked is NOT used anywhere in the app.
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

  // TEXTUL PANOULUI, in limba adminului (engleza implicit). Vezi lib/adminText.ts.
  const A = adminStrings()
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
              {A.tabMoney}
            </button>
            <button
              type="button"
              className={`admin-tab ${tab === 'users' ? 'sel' : ''}`}
              onClick={() => setTab('users')}
            >
              {A.tabUsers}{activity && activity.users.length > 0 ? ` (${activity.users.length})` : ''}
            </button>
            <button
              type="button"
              className={`admin-tab ${tab === 'visitors' ? 'sel' : ''}`}
              onClick={() => setTab('visitors')}
            >
              {A.tabVisitors}
              {/* The demo half of DemoStats is dead (nothing writes demo_uses
                  anymore) — the badge counts only REAL visits, not the
                  permanently-zero demo field. */}
              {demos && demos.visitsToday > 0 ? ` (${demos.visitsToday})` : ''}
            </button>
            <button
              type="button"
              className={`admin-tab ${tab === 'vchat' ? 'sel' : ''}`}
              onClick={() => setTab('vchat')}
            >
              {A.tabLiveChat}{vconvos.length > 0 ? ` (${vconvos.length})` : ''}
            </button>
            <button
              type="button"
              className={`admin-tab ${tab === 'history' ? 'sel' : ''}`}
              onClick={() => setTab('history')}
            >
              {A.tabChatHistory}
            </button>
            <button
              type="button"
              className={`admin-tab ${tab === 'share' ? 'sel' : ''}`}
              onClick={() => setTab('share')}
            >
              {A.tabShare}
            </button>
            <button
              type="button"
              className={`admin-tab ${tab === 'gaps' ? 'sel' : ''}`}
              onClick={() => setTab('gaps')}
            >
              {A.tabGaps}{gaps.length > 0 ? ` (${gaps.length})` : ''}
            </button>
            <button
              type="button"
              className={`admin-tab ${tab === 'stores' ? 'sel' : ''}`}
              onClick={() => setTab('stores')}
            >
              {A.tabStores}
            </button>
            <button
              type="button"
              className={`admin-tab ${tab === 'inbox' ? 'sel' : ''}`}
              onClick={() => setTab('inbox')}
            >
              {A.tabInbox}
            </button>
            <button
              type="button"
              className={`admin-tab ${tab === 'voiceprints' ? 'sel' : ''}`}
              onClick={() => setTab('voiceprints')}
            >
              {A.tabVoiceprints}{voiceprints.length > 0 ? ` (${voiceprints.length})` : ''}
            </button>
            <button
              type="button"
              className={`admin-tab ${tab === 'gesturi' ? 'sel' : ''}`}
              onClick={() => setTab('gesturi')}
            >
              {A.tabGestures}
            </button>
            <button
              type="button"
              className={`admin-tab ${tab === 'tokenuri' ? 'sel' : ''}`}
              onClick={() => setTab('tokenuri')}
            >
              {A.tabTokens}
            </button>
            <button
              type="button"
              className={`admin-tab ${tab === 'constructor' ? 'sel' : ''}`}
              onClick={() => setTab('constructor')}
            >
              {A.tabBuilder}
            </button>
            <button
              type="button"
              className={`admin-tab ${tab === 'recuperare' ? 'sel' : ''}`}
              onClick={() => setTab('recuperare')}
            >
              {A.tabRecovery}
            </button>
          </div>
          {/* „⚙ Setări" — moved here from the top bar (Adrian's order): for
          the owner, the bar shows only measurements; his settings live in the
          panel. */}
          {onOpenSettings && (
            <button type="button" className="ghost" onClick={onOpenSettings} title="Setările tale (voce, limbă, auto-alimentare)">
              ⚙ Setări
            </button>
          )}
          <BackLink onBack={onClose} />
        </header>
        {tab === 'finance' && (
          <section className="admin-finance">
            {!finance && <p className="chat-hint">{A.loading}</p>}
            {finance && (
              <>
                {/* ── THE MONEY PANEL, CLEANED (Adrian, Jul 30: „simplify the page,
                keep only what we use”) ─────────────────────────────────────────
                What it was: the same figures written two-three times. „Stripe —
                available” appeared both as a big card on top and as a row in the
                wallet. The brain's balance appeared twice — in dollars on top, in
                pounds below („Credit la creier”). The card wallet, likewise, in two
                places. And „Consumat la AI (real)” was exactly the sum of the
                „Cost per AI” table below. From 4 cards + 2 blocks, ONE single place
                remains, saying how much you have, each figure exactly once. */}
                <div className="pool-manage">
                  <div className="pool-manage-head">
                    {/* USD ONLY (Adrian: „Punga £7.99 vs header $9.99" — the
                    SAME wallet converted with a hand-written rate). The pocket
                    is now exactly what the provider measures, identical to the
                    pill in the bar. */}
                    Punga: ${finance.punga.total.toFixed(2)}
                    {!finance.punga.complete && ' — incomplet, o sursă nu răspunde'}
                  </div>
                  <div className="pool-parts">
                    {/* THE WALLET = ONLY WHAT CAN BE READ (Adrian, Jul 30: „Stripe goes
                    out completely and Pro comes in”). The three Stripe rows — available,
                    in transit, the virtual card — described money that no longer passes
                    through here: users pay on the Revolut link, straight into his
                    account, and the providers are paid with his card. The Revolut Pro
                    balance CANNOT be read (the accounts API is Business-only), so we
                    don't show it: either a measured figure or none. What remains is the
                    only balance we actually read. */}
                    {([
                      ['Credit la creier (OpenRouter)', finance.punga.parti.openrouter],
                    ] as [string, number | null][]).map(([eticheta, val]) => (
                      <div className="fin-row" key={eticheta}>
                        <span>{eticheta}</span>
                        <span>{val === null ? 'nu răspunde' : `$${val.toFixed(2)}`}</span>
                      </div>
                    ))}
                    {/* THE REAL OPENAI MONTH (the provider's costs API) — the
                    anchor against which the internal voice estimate below can
                    be checked. Unreadable → we say so, never a zero. */}
                    <div className="fin-row">
                      <span>OpenAI, luna asta (măsurat la furnizor)</span>
                      <span>
                        {finance.openai?.live
                          ? `$${(finance.openai.monthUsd ?? 0).toFixed(2)}`
                          : 'nu pot citi (cheie OPENAI_USAGE_KEY lipsă sau citire picată)'}
                      </span>
                    </div>
                  </div>
                  {/* HERE STOOD „Depune în pungă” and „Trage profitul”. Both went
                  through Stripe — Checkout for the deposit, `/v1/payouts` for the
                  withdrawal. With Stripe out they have nothing to move: the users'
                  money comes on the Revolut link, straight into his account, and the
                  profit no longer passes through us. A button that does nothing
                  anymore is worse than its absence — it looks like it works. */}
                </div>
                {/* THE BRAIN'S BALANCE shows in the wallet („Credit la creier”), so
                we don't repeat it here in dollars. It stays ONLY when there is
                something to do: below threshold or unreadable. */}
                {finance.openrouter && (!finance.openrouter.live || finance.openrouter.low) && (
                  <div className="or-wallet low">
                    {!finance.openrouter.live ? (
                      <span className="or-wallet-sub">
                        Nu pot citi soldul creierului (cheia OpenRouter lipsește sau contul e inaccesibil).
                      </span>
                    ) : (
                      <span className="or-wallet-sub">
                        ⚠️ Creierul are sub ${finance.openrouter.threshold} — depune ca să nu pice.{' '}
                        <a href={finance.openrouter.topup} target="_blank" rel="noreferrer">
                          Alimentează OpenRouter
                        </a>{' '}
                        · pornește „Auto Top-Up" acolo ca să se reîncarce singur.
                      </span>
                    )}
                  </div>
                )}
                {/* HERE STOOD „The money circuit: users → Stripe → AI” — the four
                links, the „What I can read from Stripe” block, the Issuing state,
                the virtual card creation and its number reveal. Removed on Jul 30:
                „Stripe goes out completely and Pro comes in”. The circuit no longer
                passes through the app — the user pays on the Revolut link, the money
                goes straight to the owner, and the providers are paid with his card.
                What remains useful here is the shortest path to where the card gets
                changed, at each provider. */}
                {(circuit?.expenses?.length ?? 0) > 0 && (
                  <div className="or-wallet">
                    <div className="or-wallet-main">
                      <span className="or-wallet-label">Furnizorii plătiți cu cardul tău</span>
                    </div>
                    {/* AUTOMATIC PAYMENT CREDITING (Adrian, Jul 30). Revolut Pro has no
                    webhook, so the app reads the transactions itself and matches the
                    unique code. The state is SHOWN, because „I can't read the account”
                    and „nobody paid” look identical if you stay silent — exactly the
                    confusion that cost a day. */}
                    {circuit?.citirePlati && (
                      <span className="or-wallet-sub" style={{ color: circuit.citirePlati.ok ? undefined : '#e6a23c' }}>
                        {circuit.citirePlati.ok ? '✅' : '⚠'} Citirea plăților Revolut:{' '}
                        {circuit.citirePlati.detaliu}
                      </span>
                    )}
                    {/* KELION STARTS BY HIMSELF (Adrian, Jul 30: „make him autonomous” ·
                    „his autonomy theme will be doing the whole part with Revolut”).
                    Here you see the loop's LAST pass: either it started something on
                    its own, or why not. Without this row, „he is autonomous” would be
                    just another claim of mine. */}
                    {/* THE COST IN PLAIN SIGHT (Adrian, Jul 30). It existed as a tool —
                    you had to ask to learn what it costs you. Now it's here, next to
                    the money. It cuts nothing: it shows. */}
                    {circuit?.costReal && (
                      <>
                      <span className="or-wallet-sub">
                        {/* IT SAID „How much it cost, REAL”. That was false for ~90% of the
                        sum: only the brain calls come with the money spelled out by the
                        provider (OpenRouter usage.cost). The rest — the voice minutes
                        especially — is MY fixed rate multiplied by how long the microphone
                        was on. Adrian, Jul 31: „where did the $504 figure come from?”
                        Exactly from there, and it had to be written on the figure, not
                        explained afterwards. */}
                        💷 Măsurat de furnizor: <b>${circuit.costReal.masurat.toFixed(2)}</b>
                        {' · '}estimat de mine (tarife fixe, NU facturi):{' '}
                        <b>${circuit.costReal.estimat.toFixed(2)}</b>
                        {' · '}azi ${circuit.costReal.today.toFixed(2)}
                        {Object.keys(circuit.costReal.byKind).length > 0 && (
                          <>
                            {' — '}
                            {Object.entries(circuit.costReal.byKind)
                              .sort((a, b) => b[1] - a[1])
                              .slice(0, 4)
                              .map(
                                ([k, v]) =>
                                  `${k} $${v.toFixed(2)}${circuit.costReal!.felul[k] === 'masurat' ? '' : '~'}`,
                              )
                              .join(' · ')}
                            {' — „~" = estimare'}
                          </>
                        )}
                      </span>
                      <span className="or-wallet-sub" style={{ opacity: 0.7 }}>
                        Minutele de voce se socotesc cât a fost microfonul PORNIT × $
                        {(circuit.voiceUsdPerMin ?? 0.35).toFixed(2)}/min — nu cât ți-a luat OpenAI. Suma exactă e doar în
                        contul tău OpenAI.
                      </span>
                      </>
                    )}
                    {/* YOUR LEVER (Adrian: „the 6 are needed, but not brakes”). The
                    „pauza-autonomie” command existed since Jul 27, but you had to know
                    it by heart. A limit YOU choose is not a barrier; one I impose on
                    you, is. */}
                    <span className="or-wallet-sub">
                      {circuit?.autonomiaOprita ? '⏸ Autonomia e OPRITĂ de tine' : '▶ Autonomia merge'}{' '}
                      <button
                        type="button"
                        className="ghost"
                        disabled={pauzaBusy}
                        onClick={() => void onPauzaAutonomie(!circuit?.autonomiaOprita)}
                      >
                        {circuit?.autonomiaOprita ? 'Repornește' : 'Oprește'}
                      </button>
                    </span>
                    {/* THE EIGHT PROOFS. Not a list written by me: each level looks for
                    its own trace in the database — an order, a PR, a measurement — and
                    says „proven” ONLY if it found it. What has no proof says what
                    exactly the proof would be. */}
                    {dovezi && (
                      <span className="or-wallet-sub">
                        🎯 Autonomia: <b>{dovezi.dovedite}/{dovezi.din} dovedite</b>
                        {dovezi.dovezi.map((d) => (
                          <span key={d.nivel} style={{ display: 'block', paddingLeft: 12, opacity: d.dovedit ? 1 : 0.65 }}>
                            {d.dovedit ? '✅' : '⬜'} <b>{d.nivel}.</b> {d.ce} —{' '}
                            {d.dovedit ? d.dovada : <i>{d.dovada || d.cum}</i>}
                          </span>
                        ))}
                      </span>
                    )}
                    {circuit?.autonomie && (
                      <span className="or-wallet-sub" style={{ color: circuit.autonomie.ok ? undefined : '#8a8f98' }}>
                        {circuit.autonomie.ok ? '🤖' : '·'} Kelion, de capul lui: {circuit.autonomie.detaliu}
                      </span>
                    )}
                    <span className="or-wallet-sub">
                      Unde se schimbă cardul, la fiecare:{' '}
                      {circuit!.expenses!
                        .filter((e) => e.configured)
                        .map((e, i) => (
                          <span key={e.name}>
                            {i > 0 && ' · '}
                            {/* WHAT WAS MEASURED on the provider's page, not what someone said:
                            🔁 = automatic top-up is on, 💳 = only a card on file (so NOT done).
                            A provider nobody touched has no sign at all — „I don't know” is
                            never written as „no”. */}
                            {e.platiAutomate ? '🔁 ' : e.cardPus ? '💳 ' : ''}
                            {e.billingUrl ? (
                              <a href={e.billingUrl} target="_blank" rel="noreferrer">
                                {e.name}
                              </a>
                            ) : (
                              `${e.name} (${e.billing.toLowerCase()})`
                            )}
                          </span>
                        ))}
                    </span>
                  </div>
                )}
                <div className="fin-breakdown">
                  <div className="fin-breakdown-head">
                    {/* ONE CURRENCY (USD) END TO END: the journal is kept in USD
                    (cost_events.cost_usd), and the tab no longer converts the
                    total to £ while "azi" stayed in $ — the mixed "total £163.66,
                    azi $0.02" Adrian flagged. The split "măsurat / estimare
                    internă" is written on the head too, so a number without its
                    kind is never read as an invoice. */}
                    Cost per AI — total ${finance.spentUsd.toFixed(2)}
                    {` (măsurat $${finance.masurat.toFixed(2)} · estimare internă $${finance.estimat.toFixed(2)})`}
                    , azi ${finance.today.toFixed(2)}
                    {/* RESETTING THE COUNTERS (Adrian, Jul 30). Deletes ONLY our
                        provider-cost journal. The users' wallets are NOT touched: spent
                        credits are never given back. The wallet has nothing to reset — it
                        is read live. */}
                    <button
                      type="button"
                      className="pool-btn withdraw"
                      style={{ marginLeft: 10, fontSize: 12, padding: '3px 9px' }}
                      disabled={resetBusy}
                      onClick={async () => {
                        if (!window.confirm(
                          'Pui pe 0 contoarele de consum?\n\n' +
                          'Se șterge doar jurnalul „cât ne-a costat pe noi la furnizori".\n' +
                          'NU se ating: creditele userilor, registrul plăților, istoricul de cumpărare.\n' +
                          'Creditele deja consumate NU se dau înapoi.',
                        )) return
                        setResetBusy(true)
                        await fetch('/api/admin/reset-counters', { method: 'POST', credentials: 'include' }).catch(() => null)
                        await fetchFinance().then(setFinance).catch(() => {})
                        setResetBusy(false)
                      }}
                    >
                      {resetBusy ? '…' : 'Pune pe 0'}
                    </button>
                  </div>
                  {aiParts.length === 0 && <div className="chat-hint">{A.noSpendYet}</div>}
                  {aiParts.map(([k, v]) => (
                    <div className="fin-row" key={k}>
                      <span>
                        {AI_LABELS[k] ?? k}
                        {/* THE GOLDEN RULE (Adrian: „REAL, stop fabricating"):
                        a shown figure is either MEASURED (the provider's own
                        number / DB recordCost from its response) or it says
                        „estimare internă" right next to it. The voice minutes
                        are the big one: mic-on seconds × a fixed rate — never
                        the OpenAI invoice. */}
                        {finance.felul[k] === 'estimat' && (
                          <span className="fin-sub" style={{ color: '#e6a23c' }}>
                            {' '}— estimare internă
                          </span>
                        )}
                      </span>
                      <span>${v.toFixed(4)}</span>
                    </div>
                  ))}
                </div>
                {/* THE STRIPE BLOCK — REMOVED (Adrian, Jul 31: „these don't exist
                    anymore” · „Stripe doesn't exist anymore” · „we only have Revolut”).
                    The only payment channel is Revolut, by card. The old Jul 24 rows
                    were his own tests, from his own accounts, paid with his own card —
                    not revenue from clients. They stay in the database (`transactions`),
                    but no longer belong in the panel: they showed a dead channel as if
                    it were alive. */}
              </>
            )}
          </section>
        )}
        {tab === 'stores' && (
          <section className="admin-finance">
            {!stores && <p className="chat-hint">{A.checkingStores}</p>}
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
                          <span className="store-missing">{A.notListedYet}</span>
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
                    <div className="fin-breakdown-head">{A.downloadsHead}</div>
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
              {mailboxLoading && <p className="chat-hint">{A.readingMailbox}</p>}
              {!mailboxLoading && mailboxLive.length === 0 && (
                <p className="chat-hint">{A.mailboxEmpty}</p>
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
                <p className="chat-hint">{A.noContactMessagesYet}</p>
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
                <p className="chat-hint">{A.noLettersYet}</p>
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
                      <b>{A.reply}</b> {m.reply.slice(0, 300)}
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
                <div className="chat-hint">{A.loading}</div>
              )}
              {!voiceprintsLoading && voiceprints.length === 0 && (
                <div className="chat-hint">{A.noVoiceprintsYet}</div>
              )}
              {voiceprints.map((v) => (
                <div className="fin-row" key={v.email}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {/* THE PAIRED FACE (Adrian, Aug 1: „voiceprint paired with an
                    image capture — why wasn't it done?”). It WAS — saved in
                    faceprints since Jul — only INVISIBLE. Now shown, so the pair
                    voice+face is seen at a glance. */}
                    {v.hasFace ? (
                      <img
                        src={v.facePhoto}
                        alt={`Fața lui ${v.name || v.email}`}
                        title="Captura de imagine împerecheată cu amprenta vocală"
                        style={{ width: 44, height: 44, borderRadius: 8, objectFit: 'cover', border: '1px solid rgba(255,255,255,0.15)' }}
                      />
                    ) : (
                      <span
                        className="muted"
                        title="Fără captură încă — se face singură la prima tură cu camera pornită"
                        style={{ width: 44, height: 44, borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: '1px dashed rgba(255,255,255,0.2)', fontSize: 18 }}
                      >
                        ?
                      </span>
                    )}
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
                        title={A.playVoiceSample}
                        onClick={() => void playVoiceprint(v.email)}
                      >
                        {playingVp === v.email ? '⏸ oprește' : '▶ ascultă'}
                      </button>
                    ) : (
                      <span className="muted" title={A.noVoiceSampleYet}>
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
            <div className="fin-breakdown" style={{ marginTop: 12 }}>
              <div className="fin-breakdown-head">
                Lacătul butonului Admin —{' '}
                {lockArmed
                  ? 'ARMAT ✓: butonul se deschide doar cu amprenta ta vocală sau cu secretul'
                  : 'nearmat: alege un secret ca să-l pornești'}
              </div>
              <form
                className="fin-row"
                onSubmit={(e) => {
                  e.preventDefault()
                  saveLockSecret()
                }}
              >
                <input
                  type="password"
                  value={lockSecret}
                  onChange={(e) => setLockSecret(e.target.value)}
                  placeholder={lockArmed ? 'Secret nou (îl schimbă pe cel vechi)' : 'Secretul de activare (min. 4 caractere)'}
                  autoComplete="new-password"
                  style={{ flex: 1, minWidth: 0 }}
                />
                <button type="submit" className="ghost">
                  {lockArmed ? 'Schimbă secretul' : 'Armează lacătul'}
                </button>
              </form>
              {lockMsg && <div className="chat-hint">{lockMsg}</div>}
              <div className="chat-hint">
                Odată armat: intrarea în admin cere vocea ta recunoscută în sesiune sau secretul
                tastat. Vocea străină nu poate deschide panoul, chiar logată pe contul tău.
              </div>
            </div>
          </section>
        )}
        {tab === 'recuperare' && (
          <section className="admin-finance">
            <div className="fin-breakdown">
              <div className="fin-breakdown-head">
                Recuperare — versiunile salvate ale aplicației (tag-uri git, oglindite pe serverul
                Linux ca .bundle + .tar.gz). Fiecare e recuperabilă integral.
              </div>
              <form
                className="fin-row"
                onSubmit={(e) => {
                  e.preventDefault()
                  saveRecoveryNow()
                }}
              >
                <input
                  value={recoveryNote}
                  onChange={(e) => setRecoveryNote(e.target.value)}
                  placeholder={A.versionNotePlaceholder}
                  style={{ flex: 1, minWidth: 0 }}
                />
                <button type="submit" className="ghost">
                  Salvează versiunea curentă
                </button>
              </form>
              {recoveryMsg && <div className="chat-hint">{recoveryMsg}</div>}
            </div>
            <div className="fin-breakdown" style={{ marginTop: 12 }}>
              <div className="fin-breakdown-head">Versiuni salvate ({recoveryPoints.length})</div>
              {recoveryLoading && recoveryPoints.length === 0 && <div className="chat-hint">{A.loading}</div>}
              {!recoveryLoading && recoveryPoints.length === 0 && (
                <div className="chat-hint">{A.noVersionsYet}</div>
              )}
              {recoveryPoints.map((p) => (
                <div className="fin-row" key={p.tag}>
                  <span>
                    <strong>
                      {p.date
                        ? new Date(p.date).toLocaleString('ro-RO', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : p.tag}
                    </strong>
                    {' · '}
                    <code>{p.sha}</code>
                    {p.note ? <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{p.note.split('\n')[0].slice(0, 140)}</div> : null}
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="muted" style={{ fontSize: 12 }}>{p.tag}</span>
                    <button
                      type="button"
                      className="ghost"
                      disabled={restoringTag !== null}
                      onClick={() => restoreFromPoint(p)}
                    >
                      {restoringTag === p.tag ? 'Restaurez…' : 'Restaurează'}
                    </button>
                  </span>
                </div>
              ))}
              <div className="chat-hint">
                „Restaurează" aduce aplicația EXACT la versiunea aleasă (commit nou pe master —
                nimic nu se pierde din istoric) și republică automat pe server. Rezerve manuale:
                bundle-urile din <code>/root/kelion/backups/</code>.
              </div>
            </div>
          </section>
        )}
        {tab === 'constructor' && (
          <section className="admin-finance">
            <div className="fin-breakdown">
              <div className="fin-breakdown-head">
                Constructorul — dai ordinul, Kelion construiește pe server (build + teste), deschide
                PR-ul, iar merge-ul îl dai tu. Poți ordona și prin voce/chat: „Kelion, construiește…".
              </div>
              <form
                className="fin-row"
                onSubmit={(e) => {
                  e.preventDefault()
                  sendBuildOrder()
                }}
              >
                <input
                  value={buildOrder}
                  onChange={(e) => setBuildOrder(e.target.value)}
                  placeholder={A.buildOrderPlaceholder}
                  style={{ flex: 1, minWidth: 0 }}
                />
                <button type="submit" className="ghost">
                  Trimite ordinul
                </button>
              </form>
              {buildMsg && <div className="chat-hint">{buildMsg}</div>}
            </div>
            <div className="fin-breakdown" style={{ marginTop: 12 }}>
              <div className="fin-breakdown-head">Coada ordinelor</div>
              {buildJobs.length === 0 && <div className="chat-hint">{A.noOrdersYet}</div>}
              {buildJobs.map((j) => (
                <div className="fin-row" key={j.id}>
                  <span>
                    <strong>#{j.id}</strong>{' '}
                    <span className={`vis-badge ${j.status === 'done' ? 'human' : j.status === 'failed' ? 'kind-demo' : ''}`}>
                      {j.status === 'queued' ? 'în coadă' : j.status === 'running' ? 'lucrează…' : j.status === 'done' ? 'GATA' : 'eșuat'}
                    </span>{' '}
                    {j.orderText.slice(0, 90)}
                    {j.orderText.length > 90 ? '…' : ''}
                  </span>
                  <span>
                    {j.prUrl && (
                      <a href={j.prUrl} target="_blank" rel="noreferrer">
                        PR ↗
                      </a>
                    )}
                    {j.tokens > 0 && ` · ${Math.round(j.tokens / 1000)}k tok`}
                    {' · '}
                    {new Date(j.updatedAt).toLocaleString('ro-RO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
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
            {/* WHAT THE SERVER SEES, BEFORE ANY NETWORK TEST (Adrian, Jul 30:
                „all the keys have been typed dozens of times”). A WRITTEN key does
                not automatically reach the running process: it can be in a
                different file than the one given to docker, written AFTER the
                container started, or set as a GitHub secret without running
                `vps-set-env`. This table separates „not written” from „written but
                never got here”. */}
            {envCheck && (
              <div className="fin-breakdown" style={{ marginBottom: 14 }}>
                <div className="fin-breakdown-head">
                  Ce chei vede serverul CHIAR ACUM — {envCheck.summary.total - envCheck.summary.lipsa - envCheck.summary.goale}/
                  {envCheck.summary.total} prezente
                </div>
                <div className="or-wallet-sub">
                  Procesul a pornit la{' '}
                  <strong>{new Date(envCheck.startedAt).toLocaleString('ro-RO')}</strong>. O cheie scrisă
                  DUPĂ ora asta nu e încărcată până la repornirea containerului — asta e capcana în care
                  „am scris-o de zeci de ori" și „nu o vede" sunt amândouă adevărate.
                </div>
                {envCheck.orphans.length > 0 && (
                  <div className="fin-row">
                    <span style={{ color: '#e6a23c', fontWeight: 600 }}>
                      ⚠ Chei pe care LE AI, dar sub alt nume:{' '}
                      {envCheck.orphans.map((n, i) => (
                        <span key={n}>
                          {i > 0 && ', '}
                          <code>{n}</code>
                        </span>
                      ))}
                    </span>
                    <span className="fin-sub">redenumește-le, sau spune-mi și le citesc și așa</span>
                  </div>
                )}
                {envCheck.vars
                  .filter((v) => !v.present || v.length === 0)
                  .map((v) => (
                    <div className="fin-row" key={v.name}>
                      <span style={{ color: '#e6a23c' }}>
                        ⚠ <code>{v.name}</code> — {v.what}
                      </span>
                      <span className="fin-sub" title={`Nume acceptate: ${v.accepts.join(', ')}`}>
                        {v.present ? 'prezentă dar GOALĂ' : 'nu e în proces'} · {v.breaks}
                      </span>
                    </div>
                  ))}
                {envCheck.summary.lipsa === 0 && envCheck.summary.goale === 0 && (
                  <div className="fin-row">
                    <span>✅ Toate cheile așteptate sunt în procesul care rulează.</span>
                  </div>
                )}
                {envCheck.vars
                  .filter((v) => v.present && v.length > 0)
                  .map((v) => (
                    <div className="fin-row" key={v.name}>
                      <span>
                        ✅ <code>{v.name}</code> — {v.what}
                      </span>
                      <span className="fin-sub" title={`Nume acceptate: ${v.accepts.join(', ')}`}>
                        {v.foundAs && v.foundAs !== v.name ? `găsită ca ${v.foundAs} · ` : ''}
                        {v.length} caractere
                      </span>
                    </div>
                  ))}
              </div>
            )}
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
            {!activity && <p className="chat-hint">{A.loading}</p>}
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
                      title={A.seeWhatTheyWrote}
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
                          title={A.seeWholeChat}
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
                  <div className="fin-breakdown-head">{A.recentSessions}</div>
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
              {leads.length === 0 && <div className="chat-hint">{A.noContactsYet}</div>}
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
            {!demos && <p className="chat-hint">{A.loading}</p>}
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
                    <span className="fin-label">{A.botsDetected}</span>
                    <span className="fin-val">{demos.bots}</span>
                  </div>
                </div>
                <div className="fin-breakdown">
                  <div className="fin-breakdown-head">{A.byCountry}</div>
                  {demos.byCountry.length === 0 && (
                    <div className="chat-hint">{A.noVisitorsYet}</div>
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
                {/* The demo probes are DEAD (nothing writes demo_uses anymore) — the
                list shows only the VISITS, no DEMO badge/flow. */}
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
                        {/* HIS timezone + how many times he has come (Adrian, Jul 31: „this
                        field must offer full information about the visit”). */}
                        {r.tz && (
                          <span>
                            {r.tz} · la el era{' '}
                            {new Date(r.started_at).toLocaleTimeString('ro-RO', {
                              timeZone: r.tz,
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        )}
                        <span>
                          {r.vizite_anterioare > 0
                            ? `a ${r.vizite_anterioare + 1}-a vizită`
                            : 'prima vizită'}
                        </span>
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
              <div className="fin-breakdown-head">{A.liveVisitorChats}</div>
              {vconvos.length === 0 && <div className="chat-hint">{A.noConversationsYet}</div>}
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
              {!vsel && <div className="chat-hint">{A.pickConversation}</div>}
              {vsel && (
                <>
                  <div className="vchat-admin-log">
                    {vLoading && <p className="chat-hint">{A.loading}</p>}
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
                      placeholder={A.replyToVisitor}
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
              // TRUTHFUL TEXT (Adrian, Aug 1 — button audit): it USED to promise
              // „3 minute free, no account” — the demo is dead (nothing writes
              // demo_uses, no trial endpoint exists). The truth: the account is
              // free, made in half a minute; credits are bought inside.
              const text =
                'Ți-l prezint pe Kelion — asistentul meu AI cu avatar și voce: vede, aude și vorbește, în orice limbă. Contul e gratuit și îl faci în 30 de secunde:'
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
                    <div className="fin-breakdown-head">{A.appLink}</div>
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
                  <ShareGrid title={A.shareOnSocial} items={links} />
                  <ShareGrid
                    title={A.videoPlatforms}
                    items={uploads}
                  />
                </>
              )
            })()}
          </section>
        )}
        {tab === 'gaps' && (
          <section className="admin-gaps">
            {/* AUTONOMOUS TRIAGE (Adrian, Jul 24): Kelion decides by himself —
            the valuable one stays „DE IMPLEMENTAT”, the rest auto-close with a reason. */}
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

            {/* THE OUTAGES AUDIT (Adrian, Jul 27: „here you must see all the
            audits and all the failures”): health + server errors + client
            errors + failed orders — EVERYTHING that went down, in this tab. */}
            <h3 style={{ marginTop: 22, marginBottom: 6 }}>
              Audit — toate căzutele{' '}
              <span style={{ fontWeight: 400, fontSize: 12, opacity: 0.7 }}>
                (sănătate sistem · erori server · erori F12 · construcții eșuate)
              </span>
            </h3>
            {!audit && <p className="chat-hint">{A.loadingAudit}</p>}
            {audit && (
              <>
                {(audit.health?.probleme?.length ?? 0) === 0 &&
                  (audit.serverErrors?.length ?? 0) === 0 &&
                  (audit.clientErrors?.length ?? 0) === 0 &&
                  (audit.failedJobs?.length ?? 0) === 0 && (
                    <p className="chat-hint">{A.nothingDown}</p>
                  )}
                {(audit.health?.probleme ?? []).map((p) => (
                  <div key={`h-${p.id}`} className="admin-gap">
                    <div className="admin-gap-main">
                      <span className="admin-gap-req" style={{ color: p.grav === 'critic' ? '#ff7a7a' : '#ffb86b' }}>
                        [{p.grav.toUpperCase()}] {p.desc}
                      </span>
                      <span className="admin-gap-meta">reparabil: {p.reparabil}</span>
                    </div>
                  </div>
                ))}
                {(audit.serverErrors ?? []).slice(-15).reverse().map((e, i) => (
                  <div key={`s-${i}`} className="admin-gap">
                    <div className="admin-gap-main">
                      <span className="admin-gap-req" style={{ color: e.level >= 50 ? '#ff7a7a' : '#ffb86b' }}>
                        [server {e.level >= 50 ? 'EROARE' : 'avert.'}] {e.msg}
                      </span>
                      <span className="admin-gap-meta">{new Date(e.t).toLocaleTimeString('ro-RO')}</span>
                    </div>
                  </div>
                ))}
                {(audit.clientErrors ?? []).slice(0, 15).map((e, i) => (
                  <div key={`c-${i}`} className="admin-gap">
                    <div className="admin-gap-main">
                      <span className="admin-gap-req" style={{ color: '#ffb86b' }}>[F12 client] {e.message}</span>
                      <span className="admin-gap-meta">
                        {Number(e.n) > 1 ? `de ${e.n} ori · ` : ''}
                        {e.user_email ?? 'anonim'} · {new Date(e.created_at).toLocaleString('ro-RO')}
                      </span>
                    </div>
                  </div>
                ))}
                {(audit.failedJobs ?? []).map((j) => (
                  <div key={`j-${j.id}`} className="admin-gap">
                    <div className="admin-gap-main">
                      <span className="admin-gap-req" style={{ color: '#ff7a7a' }}>[constructor EȘUAT] #{j.id} — {j.order}</span>
                      <span className="admin-gap-meta">{new Date(j.updated).toLocaleString('ro-RO')}</span>
                    </div>
                  </div>
                ))}
              </>
            )}
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
                  title={A.translateToRo}
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
                  title={A.translateToRo}
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
              {userConvoLoading && <p className="chat-hint">{A.loading}</p>}
              {!userConvoLoading && userConvo.rows.length === 0 && (
                <p className="chat-hint">{A.noMessagesYet}</p>
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
