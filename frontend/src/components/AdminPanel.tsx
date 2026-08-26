import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  GESTURE_CATALOG,
  GESTURE_CATEGORIES,
  previewGesture,
  fetchDisabledGestures,
  saveDisabledGesturesCanonical,
} from '../lib/gestures'
import BackLink from './BackLink'
import { adminStrings } from '../lib/adminText'
import {
  starePush,
  activeazaPush,
  dezactiveazaPush,
  type StarePush,
} from '../lib/pushTelefon'
import type { BrainCredit } from '../pages/Stage'
import {
  fetchHistory,
  type HistoryRow,
  translateToRo,
  fetchFinance,
  manageUser,
  fetchMoneyCircuit,
  type MoneyCircuit,
  fetchActivity,
  type Finance,
  type UserActivity,
  type UserActivityRow,
  fetchStores,
  type StoresData,
  fetchInbound,
  fetchMailboxLive,
  type MailboxLiveResult,
  type InboundEmail,
  fetchContactMessages,
  type ContactMessage,
  fetchTokenChecks,
  fetchEnvCheck,
  type EnvCheckResult,
  type TokenChecksResult,
  fetchErori,
  type EroriAdmin,
  fetchNotificari,
  markNotificareCitit,
  type NotificareAdmin,
  fetchCreier,
  type CreierAdmin,
  fetchCodexAdmin,
  codexTaskUrl,
  type CodexAdmin,
  fetchCreditAI,
  type CreditAIFurnizor,
  evalueazaOrdinConstructor,
  type EvalConstructor,
  clasaBec,
  ADMIN_TABS,
  type AdminTab,
} from '../lib/admin'
import {
  fetchBalance,
  formatMinorMoney,
  majorToMinor,
  type WalletStatus,
} from '../lib/billing'
import { productConfig } from '../lib/productConfig'
import { apiFetch } from '../lib/transport'
import {
  constructorAvailabilityFromSnapshot,
  constructorFinalResultText,
  constructorHasVerifiedLiveResult,
  constructorJobCanBeCancelled,
  constructorPersistentEventsText,
  type ConstructorWorkerSummary,
} from '../lib/constructorContract'
import {
  adminContractText,
  adminMutationAcknowledged,
  adminReleaseActionAcknowledged,
  parseAdminArchiveAcknowledgement,
  parseAdminBuildArchive,
  parseAdminConstructorDiagnostic,
  parseAdminConstructorIntake,
  parseAdminConstructorSnapshot,
  parseAdminReleaseSnapshot,
  parseAdminRestoreAcknowledgement,
  type AdminConstructorDiagnostic,
  type AdminReleaseSnapshot,
  type BuildArchiveCursor,
  type BuildJobRow,
} from '../lib/adminConstructorContract'

// "cât a stat" — human-readable duration from seconds: 45s / 7m / 2h 13m.
function fmtDur(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

// Un rând din lista de erori: pastilă de gravitate (culoare + categorie, nu doar
// culoare — pentru accesibilitate), explicația „ce este", apoi textul brut.
function ErrRow({
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
    <div
      style={{
        padding: '8px 0',
        borderTop: '1px solid rgba(128,128,128,0.18)',
      }}
    >
      <div
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'baseline',
          flexWrap: 'wrap',
        }}
      >
        <span
          aria-hidden
          style={{
            width: 8,
            height: 8,
            borderRadius: 4,
            background: culoare,
            display: 'inline-block',
            flex: '0 0 auto',
          }}
        />
        <span style={{ fontWeight: 600 }}>{cat}</span>
        <span className="chat-hint" style={{ fontSize: 12 }}>
          {sev}
          {meta ? ` · ${meta}` : ''}
        </span>
      </div>
      <div style={{ marginTop: 3 }}>{ceEste}</div>
      <div
        className="chat-hint"
        style={{
          marginTop: 2,
          fontFamily: 'monospace',
          fontSize: 12,
          wordBreak: 'break-word',
        }}
      >
        {text}
      </div>
    </div>
  )
}

interface RandAudit {
  la: string
  actor: string
  actiune: string
  tabel: string
  cheie: string
  vechi: string
  nou: string
}

type VerdictFunctie = 'merge' | 'stricat' | 'nu_pot_verifica'
interface VerificareFunctie {
  functie: string
  categorie: string
  face: string
  tip: 'citire' | 'efect'
  verdict: VerdictFunctie
  deCe: string
  recomandare: string
  dovada: string
}
interface RaportAutoverificare {
  total: number
  merg: number
  stricate: number
  nepotverifica: number
  functii: VerificareFunctie[]
}
// Ordinea în listă: întâi ce nu merge (stricate), apoi nesigurele, apoi ce merge.
function rangVerdict(v: VerdictFunctie): number {
  return v === 'stricat' ? 0 : v === 'nu_pot_verifica' ? 1 : 2
}

function RegistruAudit() {
  const [date, setDate] = useState<
    | {
        randuri: RandAudit[]
        backup: { fisier: string; la: string; octeti: number } | null
      }
    | null
    | 'eroare'
  >(null)
  useEffect(() => {
    let viu = true
    void apiFetch('/api/admin/registru-audit', { credentials: 'include' })
      .then((r) =>
        r.ok ? r.json() : Promise.reject(new Error(String(r.status))),
      )
      .then((j) => {
        if (viu) setDate(j)
      })
      .catch(() => {
        if (viu) setDate('eroare')
      })
    return () => {
      viu = false
    }
  }, [])
  if (date === null)
    return <div className="chat-hint">registrul se încarcă…</div>
  if (date === 'eroare')
    return (
      <div className="chat-hint">⚠ Registrul de audit nu s-a putut citi.</div>
    )
  return (
    <div className="fin-breakdown">
      <div className="fin-breakdown-head">
        Registrul modificărilor (audit — cine, când, ce)
      </div>
      <div className="chat-hint">
        {date.backup
          ? `Ultimul backup: ${date.backup.fisier} · ${new Date(date.backup.la).toLocaleString('ro-RO')} · ${(date.backup.octeti / 1024 / 1024).toFixed(1)} MB`
          : 'Backup: nemăsurabil de aici (directorul de backup nu e pe mașina asta sau e gol) — de verificat pe VPS.'}
      </div>
      {date.randuri.length === 0 && (
        <div className="chat-hint">
          — încă nicio modificare înregistrată (registrul pornește de la
          publicarea asta)
        </div>
      )}
      {date.randuri.slice(0, 60).map((r, i) => (
        <div className="vis-meta" key={i} style={{ padding: '3px 0' }}>
          <span className="vis-time">
            {new Date(r.la).toLocaleString('ro-RO', {
              day: 'numeric',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
          <span>
            <strong>{r.actor || '—'}</strong>
          </span>
          <span>{r.actiune}</span>
          <span className="muted">
            {r.tabel}
            {r.cheie ? ` · ${r.cheie}` : ''}
          </span>
          {(r.vechi || r.nou) && (
            <span>
              {r.vechi ? `${r.vechi} → ` : ''}
              {r.nou}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}

const AI_LABELS: Record<string, string> = {
  openai: 'Creier (OpenAI)',
  chat: 'Creier (istoric)',
  correct: 'OpenAI (verificare)',
  image: 'Imagini (OpenAI)',
  image_est: 'Images (estimare internă)',
  video: 'Video (cost reconciliat)',
  asr: 'Hearing (STT)',
  search: 'Căutare web',
  memory: 'Memorie',
  memory_est: 'Memorie (estimare internă)',
  // The live-voice minutes — an INTERNAL ESTIMATE (mic-on seconds × a fixed
  // rate), never the provider's invoice. Labeled as such wherever it shows.
  voice_minutes: 'Minute voce',
}

// Jurnalul scrie vocea ca 'tts:<motor>' (tts.ts) — vechea cheie fixă 'tts'
// nu se potrivea niciodată, deci rândul apărea cu cheia brută.
function aiLabel(k: string): string {
  if (AI_LABELS[k]) return AI_LABELS[k]
  if (k.startsWith('tts:')) return `Voice (TTS ${k.slice(4)})`
  return k
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
  return d.toLocaleDateString('ro-RO', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

function groupByDay(
  rows: HistoryRow[],
): { header: string; rows: HistoryRow[] }[] {
  const sorted = [...rows].sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
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
function ShareGrid({
  title,
  items,
}: {
  title: string
  items: { name: string; href: string }[]
}): React.JSX.Element {
  return (
    <div className="fin-breakdown">
      <div className="fin-breakdown-head">{title}</div>
      <div className="share-grid">
        {items.map((l) => (
          <a
            key={l.name}
            className="share-btn"
            href={l.href}
            target="_blank"
            rel="noreferrer"
          >
            {l.name}
          </a>
        ))}
      </div>
    </div>
  )
}

function BecuriCredit() {
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
    return () => {
      viu = false
    }
  }, [])
  if (err)
    return <div className="becuri-credit becuri-stare">{A.becuriEroare}</div>
  if (!rows)
    return <div className="becuri-credit becuri-stare">{A.becuriLoad}</div>
  return (
    <div className="becuri-credit">
      <div className="becuri-titlu">{A.becuriTitlu}</div>
      <div className="becuri-lista">
        {rows.map((f) => {
          // ROȘUL SPUNE CAUZA MĂSURATĂ, NU PRESUPUNEREA: dacă proba «servește»
          // are un motiv, îl arătăm; genericul „fără credit" rămâne doar când
          // serverul chiar nu poate determina cauza.
          const motivRosu =
            f.serveste?.masurat &&
            f.serveste.valoare &&
            !f.serveste.valoare.da &&
            f.serveste.valoare.detaliu
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
          const titlu =
            f.bec === 'rosu'
              ? (motivRosu ?? A.becuriReincarca)
              : A.becuriDeschideFactura
          const continut = (
            <>
              <span className={clasaBec(f.bec)} aria-hidden="true" />
              <span className="bec-nume">{f.furnizor}</span>
              <span className="bec-alim">{f.alimenteaza}</span>
              <span className="bec-stare">{stare}</span>
            </>
          )
          return f.facturare ? (
            <a
              key={f.furnizor}
              className={`bec-rand bec-rand-${f.bec}`}
              href={f.facturare}
              target="_blank"
              rel="noreferrer"
              title={titlu}
            >
              {continut}
            </a>
          ) : (
            <div
              key={f.furnizor}
              className={`bec-rand bec-rand-${f.bec}`}
              title={titlu}
            >
              {continut}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function CreditAICard({ brainCredit }: { brainCredit?: BrainCredit | null }) {
  if (!brainCredit) return null
  const o = brainCredit.openai
  const s = brainCredit.serper
  const serperK = (n: number): string =>
    n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
  const openaiEticheta =
    o?.sold != null
      ? `${o.sold.toFixed(2)} ${o.soldMoneda ?? ''}`.trim()
      : o?.serving
        ? '✓'
        : '·'
  const openaiTitlu = [
    o?.sold != null
      ? `sold măsurat: ${o.sold.toFixed(2)} ${o.soldMoneda ?? ''}`
      : `sold necitit: ${o?.soldMotiv ?? 'motiv necunoscut'}`,
    o?.monthUsd != null
      ? `cheltuit luna asta: $${o.monthUsd.toFixed(2)}`
      : 'cheltuiala lunii necitibilă',
  ].join(' · ')
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 12,
        padding: '10px 14px',
        margin: '10px 0',
        background: 'color-mix(in srgb, var(--text) 4%, transparent)',
        border: '1px solid var(--border)',
        borderRadius: 10,
      }}
    >
      <strong style={{ fontSize: 13, opacity: 0.8 }}>Credite AI</strong>
      <span
        title={
          s?.live && typeof s.balance === 'number'
            ? `${s.balance.toLocaleString()} căutări rămase (Serper)`
            : 'citirea Serper a eșuat'
        }
      >
        Serper{' '}
        {s?.live && typeof s.balance === 'number' ? serperK(s.balance) : '⚠'}
      </span>
      <span title={openaiTitlu}>OpenAI {openaiEticheta}</span>
    </div>
  )
}

export default function AdminPanel({
  onClose,
  initialTab,
  brainCredit,
}: {
  readonly onClose: () => void
  readonly initialTab?: AdminTab
  readonly brainCredit?: BrainCredit | null
}) {
  const [tab, setTab] = useState<AdminTab>(initialTab ?? 'finance')

  const [push, setPush] = useState<StarePush>('inactiv')
  const [pushBusy, setPushBusy] = useState(false)

  const [avBusy, setAvBusy] = useState(false)
  const [avRaport, setAvRaport] = useState<RaportAutoverificare | null>(null)
  const [avEroare, setAvEroare] = useState('')
  useEffect(() => {
    void starePush().then(setPush)
  }, [])
  const comutaPush = async (): Promise<void> => {
    setPushBusy(true)
    try {
      setPush(
        push === 'activ' ? await dezactiveazaPush() : await activeazaPush(),
      )
    } finally {
      setPushBusy(false)
    }
  }

  const [gestOff, setGestOff] = useState<string[] | null | 'necitit'>('necitit')
  const [gestSaved, setGestSaved] = useState(false)
  const [gestSaving, setGestSaving] = useState(false)
  const gestSavePendingRef = useRef(false)

  const [gestErr, setGestErr] = useState('')

  const [peek, setPeek] = useState(false)

  const [resetBusy, setResetBusy] = useState(false)

  const [erori, setErori] = useState<EroriAdmin | null | 'necitit'>('necitit')
  const [eroriBusy, setEroriBusy] = useState(false)

  const [notificari, setNotificari] = useState<
    NotificareAdmin[] | null | 'necitit'
  >('necitit')

  const [creier, setCreierState] = useState<CreierAdmin | null | 'necitit'>(
    'necitit',
  )
  const [codex, setCodex] = useState<CodexAdmin | null | 'necitit'>('necitit')
  const previewAndPeek = (clip: string): void => {
    previewGesture(clip)
    setPeek(true)
    window.setTimeout(() => setPeek(false), 3500)
  }

  const [inbound, setInbound] = useState<InboundEmail[] | null | 'necitit'>(
    'necitit',
  )
  const [mailboxLive, setMailboxLive] = useState<
    MailboxLiveResult | null | 'necitit'
  >('necitit')
  const [mailboxLoading, setMailboxLoading] = useState(false)

  const [mailSel, setMailSel] = useState<Set<number>>(new Set())
  const [mailDelMsg, setMailDelMsg] = useState('')
  const [mailDelBusy, setMailDelBusy] = useState(false)
  const toggleMailSel = (uid: number): void =>
    setMailSel((prev) => {
      const n = new Set(prev)
      if (n.has(uid)) n.delete(uid)
      else n.add(uid)
      return n
    })
  const stergeMailuri = (uids: number[]): void => {
    if (!uids.length || mailDelBusy) return
    if (!window.confirm(A.confirmDeleteInboxMsg(uids.length))) return
    setMailDelBusy(true)
    void apiFetch('/api/admin/mailbox-delete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ uids }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { sterse?: number; detaliu?: string } | null) => {
        setMailDelMsg(
          j
            ? A.mailDeleteResult(j.sterse ?? 0, j.detaliu ?? '')
            : A.mailDeleteFailed,
        )
        setMailSel(new Set())
        // Reîncarcă lista REALĂ de pe server — nu scoatem optimist rânduri
        // pe care poate nu le-am șters (cifra vine din ce s-a întâmplat).
        setMailboxLoading(true)
        void fetchMailboxLive().then((m) => {
          setMailboxLive(m)
          setMailboxLoading(false)
        })
      })
      // Lista și selecția urmează numai starea confirmată de server.
      .catch(() => setMailDelMsg(A.mailDeleteFailed))
      .finally(() => setMailDelBusy(false))
  }
  const [contactMsgs, setContactMsgs] = useState<
    ContactMessage[] | null | 'necitit'
  >('necitit')
  const [copied, setCopied] = useState(false)

  const SHARE_TEXT_IMPLICIT =
    'Ți-l prezint pe Kelion — asistentul meu AI cu avatar și voce: vede, aude și vorbește, în orice limbă. Contul e gratuit și îl faci în 30 de secunde:'
  const [shareText, setShareText] = useState<string>(() => {
    try {
      return (
        window.localStorage.getItem('kelionai:share-text') ||
        SHARE_TEXT_IMPLICIT
      )
    } catch {
      return SHARE_TEXT_IMPLICIT
    }
  })
  const salveazaShareText = (t: string): void => {
    setShareText(t)
    try {
      window.localStorage.setItem('kelionai:share-text', t)
    } catch {
      /* privat/incognito — rămâne doar în sesiune */
    }
  }

  const [finance, setFinance] = useState<Finance | null>(null)

  const [financeFailed, setFinanceFailed] = useState(false)

  const [circuit, setCircuit] = useState<MoneyCircuit | null>(null)
  const [circuitFailed, setCircuitFailed] = useState(false)

  const [resetMsg, setResetMsg] = useState('')

  const [activity, setActivity] = useState<UserActivity | null | 'necitit'>(
    'necitit',
  )
  const [billingUnit, setBillingUnit] = useState<{
    currency: string
    minorUnit: number
  } | null>(null)
  const [adminBilling, setAdminBilling] = useState<
    WalletStatus | null | 'necitit'
  >('necitit')
  const [stores, setStores] = useState<StoresData | null | 'necitit'>('necitit')

  const [buildJobs, setBuildJobs] = useState<BuildJobRow[] | null | 'necitit'>(
    'necitit',
  )
  const [buildArchive, setBuildArchive] = useState<{
    status: 'idle' | 'loading' | 'ready' | 'error'
    jobs: BuildJobRow[]
    nextCursor: BuildArchiveCursor | null
    appendError: boolean
  }>({ status: 'idle', jobs: [], nextCursor: null, appendError: false })
  const [archiveOpen, setArchiveOpen] = useState(false)

  const [constructorAcceptingWork, setConstructorAcceptingWork] = useState<boolean | null>(null)
  const [constructorWorkerCanStartNow, setConstructorWorkerCanStartNow] = useState<boolean | null>(null)

  const [constructorId, setConstructorId] =
    useState<ConstructorWorkerSummary | null>(null)

  const [diagnostic, setDiagnostic] = useState<AdminConstructorDiagnostic | null>(null)
  const [release, setRelease] = useState<AdminReleaseSnapshot | null>(null)
  const [releaseBusy, setReleaseBusy] = useState(false)
  const [buildOrder, setBuildOrder] = useState('')
  const [buildMsg, setBuildMsg] = useState('')
  const [buildSubmitBusy, setBuildSubmitBusy] = useState(false)
  const buildRefreshRef = useRef<{ generation: number; controller: AbortController | null }>({ generation: 0, controller: null })
  const archiveRefreshRef = useRef<{ generation: number; controller: AbortController | null }>({ generation: 0, controller: null })
  const evalGenerationRef = useRef(0)
  const pendingBuildMutationRef = useRef(new Set<number>())
  const [pendingBuildMutations, setPendingBuildMutations] = useState<Set<number>>(new Set())
  const [agentName, setAgentName] = useState('')
  const [agentRole, setAgentRole] = useState('')
  const [agentDeep, setAgentDeep] = useState(false)
  const [agentAdminOnly, setAgentAdminOnly] = useState(false)
  const [agentBusy, setAgentBusy] = useState(false)
  const [agentMsg, setAgentMsg] = useState('')

  const [evalOrdin, setEvalOrdin] = useState<EvalConstructor | null>(null)
  useEffect(() => {
    const generation = ++evalGenerationRef.current
    if (tab !== 'constructor') return
    const text = buildOrder.trim()
    if (text.length < 3) {
      setEvalOrdin(null)
      return
    }
    // Debounce: nu lovim serverul la fiecare tastă.
    const id = window.setTimeout(() => {
      void evalueazaOrdinConstructor(text).then((evaluation) => {
        if (evalGenerationRef.current === generation) setEvalOrdin(evaluation)
      })
    }, 400)
    return () => {
      window.clearTimeout(id)
      if (evalGenerationRef.current === generation) evalGenerationRef.current += 1
    }
  }, [buildOrder, tab])

  async function addCustomAgent(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault()
    if (
      agentBusy ||
      agentName.trim().length < 3 ||
      agentRole.trim().length < 10
    )
      return
    setAgentBusy(true)
    setAgentMsg('')
    try {
      const response = await apiFetch('/api/enterprise/agent-nou', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          nume: agentName.trim(),
          rol: agentRole.trim(),
          efort: agentDeep ? 'high' : undefined,
          doarAdmin: agentAdminOnly || undefined,
        }),
      })
      const body = (await response.json().catch(() => null)) as {
        id?: string
        error?: string
      } | null
      if (!response.ok || !body?.id) {
        setAgentMsg(
          body?.error ?? `Agentul nu a fost creat (HTTP ${response.status}).`,
        )
      } else {
        setAgentMsg(`Agentul ${body.id} este disponibil în aplicație.`)
        setAgentName('')
        setAgentRole('')
        setAgentDeep(false)
        setAgentAdminOnly(false)
      }
    } catch {
      setAgentMsg('Agentul nu a fost creat: conexiunea cu serverul a eșuat.')
    } finally {
      setAgentBusy(false)
    }
  }

  interface RecoveryRow {
    tag: string
    sha: string
    date: string
    note: string
  }
  const [recoveryPoints, setRecoveryPoints] = useState<RecoveryRow[]>([])

  const [recoveryFailed, setRecoveryFailed] = useState(false)
  const [recoveryLoading, setRecoveryLoading] = useState(false)
  const [recoveryNote, setRecoveryNote] = useState('')
  const [recoveryMsg, setRecoveryMsg] = useState('')

  const [restoringTag, setRestoringTag] = useState<string | null>(null)
  const [tokenChecks, setTokenChecks] = useState<TokenChecksResult | null>(null)
  const [tokenChecksLoading, setTokenChecksLoading] = useState(false)

  const [envCheck, setEnvCheck] = useState<EnvCheckResult | null | 'necitit'>(
    'necitit',
  )

  const [userConvo, setUserConvo] = useState<{
    u: UserActivityRow
    rows: HistoryRow[] | null
  } | null>(null)
  const [userConvoLoading, setUserConvoLoading] = useState(false)

  const [roOn, setRoOn] = useState(false)
  const [roMap, setRoMap] = useState<Record<string, string>>({})
  const [roBusy, setRoBusy] = useState(false)
  // How many messages could NOT be translated (shown as the original text) —
  // the admin must SEE that the "translation" is partial, not believe a
  // silently half-failed one.
  const [roFailed, setRoFailed] = useState(0)

  async function toggleRo(rows: HistoryRow[]): Promise<void> {
    if (roOn) {
      setRoOn(false)
      return
    }
    const missing = Array.from(
      new Set(rows.map((r) => r.content).filter((c) => c && !(c in roMap))),
    )
    if (missing.length > 0) {
      setRoBusy(true)
      const { translations: translated, failed } = await translateToRo(missing)
      setRoMap((m) => {
        const next = { ...m }
        missing.forEach((src, i) => (next[src] = translated[i] ?? src))
        return next
      })
      setRoFailed(failed)
      setRoBusy(false)
    }
    setRoOn(true)
  }
  // Opening a new conversation always starts on the original language.
  const showMsg = (content: string): string =>
    roOn ? (roMap[content] ?? content) : content

  async function openUserConvo(u: UserActivityRow): Promise<void> {
    setUserConvoLoading(true)
    setRoOn(false)
    setRoFailed(0)
    setUserConvo({ u, rows: [] })

    const rows = await fetchHistory(u.email)
    setUserConvo({ u, rows })
    setUserConvoLoading(false)
  }

  const closeUserConvo = (): void => {
    setUserConvo(null)
    setRoOn(false)
    setRoFailed(0)
  }

  useEffect(() => {
    void fetchFinance().then((f) => {
      if (f) setFinance(f)
      setFinanceFailed(!f)
    })
    void fetchMoneyCircuit().then((c) => {
      if (c) setCircuit(c)
      setCircuitFailed(!c)
    })
    void fetchActivity().then(setActivity)
    void fetchBalance().then((balance) => {
      setAdminBilling(balance)
      if (
        balance &&
        typeof balance.currency === 'string' &&
        Number.isSafeInteger(balance.minorUnit)
      ) {
        setBillingUnit({
          currency: balance.currency,
          minorUnit: balance.minorUnit as number,
        })
      }
    })
  }, [])

  useEffect(() => {
    if (initialTab) setTab(initialTab)
  }, [initialTab])

  useEffect(() => {
    if (tab === 'stores') {
      setStores('necitit')
      void fetchStores().then(setStores)
    } else if (tab === 'inbox') {
      setMailSel(new Set())
      setMailDelMsg('')
      void fetchInbound().then(setInbound)
      void fetchContactMessages().then(setContactMsgs)
      setMailboxLoading(true)
      void fetchMailboxLive().then((m) => {
        setMailboxLive(m)
        setMailboxLoading(false)
      })
    } else if (tab === 'tokenuri') {
      void fetchEnvCheck().then(setEnvCheck)
      setTokenChecksLoading(true)
      void fetchTokenChecks().then((r) => {
        setTokenChecks(r)
        setTokenChecksLoading(false)
      })
    } else if (tab === 'creier') {
      setCreierState('necitit')
      void fetchCreier().then(setCreierState)
      setCodex('necitit')
      void fetchCodexAdmin().then(setCodex)
    } else if (tab === 'users') {
      void fetchActivity().then(setActivity)
    }
  }, [tab])

  useEffect(() => {
    if (tab !== 'creier') return
    const id = window.setInterval(() => {
      void fetchCodexAdmin().then(setCodex)
    }, 15_000)
    return () => window.clearInterval(id)
  }, [tab])

  useEffect(() => {
    if (tab !== 'finance') return
    const id = window.setInterval(() => {
      void fetchFinance().then((f) => {
        if (f) setFinance(f)
        setFinanceFailed(!f)
      })
    }, 15_000)
    return () => window.clearInterval(id)
  }, [tab])

  const refreshBuildJobs = (): void => {
    buildRefreshRef.current.controller?.abort()
    const controller = new AbortController()
    const generation = buildRefreshRef.current.generation + 1
    buildRefreshRef.current = { generation, controller }
    const isCurrent = (): boolean => buildRefreshRef.current.generation === generation
    apiFetch('/api/admin/constructor', { credentials: 'include', signal: controller.signal })
      .then(async (response) => response.ok
        ? parseAdminConstructorSnapshot(await response.json())
        : null)
      .then((snapshot) => {
        if (!isCurrent()) return
        if (snapshot) {
          const availability = constructorAvailabilityFromSnapshot(snapshot)
          setBuildJobs(snapshot.jobs)
          setConstructorAcceptingWork(availability.acceptingWork)
          setConstructorWorkerCanStartNow(availability.workerCanStartNow)
          setConstructorId(snapshot.constructor)
        } else {
          setBuildJobs(null)
          setConstructorAcceptingWork(false)
          setConstructorWorkerCanStartNow(false)
          setConstructorId({
            cine: 'unavailable',
            state: 'unknown',
            motiv: 'starea Constructorului nu a putut fi citită',
            lastHeartbeat: null,
          })
        }
      })
      .catch(() => {
        if (!isCurrent()) return
        setBuildJobs(null)
        setConstructorAcceptingWork(false)
        setConstructorWorkerCanStartNow(false)
        setConstructorId({
          cine: 'unavailable',
          state: 'unknown',
          motiv: 'starea Constructorului nu a putut fi citită',
          lastHeartbeat: null,
        })
      })
    // DIAGNOSTICUL AUTONOM: de ce (nu) repară, măsurat pe server (regula #1 — pe
    // eșec îl afișăm explicit; absența unui diagnostic nu înseamnă sănătate.
    apiFetch('/api/admin/constructor/diagnostic', { credentials: 'include', signal: controller.signal })
      .then(async (response) => response.ok
        ? parseAdminConstructorDiagnostic(await response.json())
        : null)
      .then((d) => {
        if (!isCurrent()) return
        setDiagnostic(d ?? {
          sanatos: false,
          verdict: 'Diagnosticul Constructor nu poate fi citit.',
          probleme: [{ cod: 'diagnostic_unavailable', severitate: 'critic', ce: 'Citirea diagnosticului a eșuat.', recomandare: 'Reîncearcă și verifică backendul și baza de date.' }],
          masuratori: null,
        })
      })
      .catch(() => {
        if (!isCurrent()) return
        setDiagnostic({
          sanatos: false,
          verdict: 'Diagnosticul Constructor nu poate fi citit.',
          probleme: [{ cod: 'diagnostic_unavailable', severitate: 'critic', ce: 'Conexiunea pentru diagnostic a eșuat.', recomandare: 'Reîncearcă și verifică serviciul backend.' }],
          masuratori: null,
        })
      })
    apiFetch('/api/admin/constructor/release', { credentials: 'include', cache: 'no-store', signal: controller.signal })
      .then(async (response) => response.ok
        ? parseAdminReleaseSnapshot(await response.json())
        : null)
      .then((snapshot) => {
        if (!isCurrent()) return
        setRelease(snapshot ?? {
          jobId: null, integration: 'unavailable', setupInstructions: null, pr: null,
          checks: 'unknown', approval: 'unknown', merge: 'unknown',
          nextAction: 'Starea integrării GitHub nu a putut fi citită.',
        })
      })
      .catch(() => {
        if (!isCurrent()) return
        setRelease({
          jobId: null, integration: 'unavailable', setupInstructions: null, pr: null,
          checks: 'unknown', approval: 'unknown', merge: 'unknown',
          nextAction: 'Conexiunea către starea de publicare a eșuat.',
        })
      })
  }

  const releaseAction = (): void => {
    if (!release?.jobId || !release.pr || releaseBusy) return
    setReleaseBusy(true)
    setBuildMsg('')
    void apiFetch('/api/admin/constructor/release/action', {
      method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ jobId: release.jobId, action: 'approve', prNumber: release.pr.number, headSha: release.pr.headSha }),
    })
      .then(async (response) => {
        const body: unknown = await response.json().catch(() => null)
        if (response.ok && adminReleaseActionAcknowledged(body)) {
          setBuildMsg('Aprobarea a fost înregistrată; publisherul separat va integra schimbarea după verificările obligatorii.')
          return
        }
        const error = adminContractText(body, 'error')
        setBuildMsg(`Acțiunea de publicare a eșuat${error ? `: ${error}` : '.'}`)
      })
      .catch(() => setBuildMsg('Acțiunea de publicare a eșuat: conexiunea cu serverul a căzut.'))
      .finally(() => {
        setReleaseBusy(false)
        refreshBuildJobs()
      })
  }
  // Tab „Constructor” open → the orders queue, refreshed every 10s.
  useEffect(() => {
    if (tab !== 'constructor') return
    refreshBuildJobs()
    const id = window.setInterval(() => {
      refreshBuildJobs()
    }, 10_000)
    return () => window.clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refreshBuildJobs e stabil funcțional (doar fetch+set)
  }, [tab])

  const sendBuildOrder = (): void => {
    if (buildSubmitBusy) return
    const text = buildOrder.trim()
    if (text.length < 8) {
      setBuildMsg(A.writeCompleteOrder)
      return
    }
    const order = text
    setBuildSubmitBusy(true)
    setBuildMsg('')
    void apiFetch('/api/admin/constructor', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ order }),
    })
      .then(async (response) => ({
        ok: response.ok,
        body: await response.json().catch(() => null) as unknown,
      }))
      .then(({ ok, body }) => {
        const intake = ok ? parseAdminConstructorIntake(body) : null
        if (intake) {
          const availability = constructorAvailabilityFromSnapshot(intake)
          setConstructorAcceptingWork(availability.acceptingWork)
          setConstructorWorkerCanStartNow(availability.workerCanStartNow)
          setConstructorId(intake.constructor)
          setBuildOrder((current) => current.trim() === order ? '' : current)
          setEvalOrdin(null)

          setBuildMsg(
            intake.deduplicated
              ? `Ordinul #${intake.id} era deja activ; am reutilizat aceeași execuție fără dublură.`
              : availability.workerCanStartNow
              ? A.orderEnqueuedActive(intake.id)
              : A.orderEnqueuedWaiting(intake.id),
          )
        } else if (adminContractText(body, 'error') === 'ordin_respins') {
          setBuildMsg(`Ordin respins: ${adminContractText(body, 'motiv') ?? 'cerință neclară'}`)
        } else {
          setBuildMsg(A.orderSendFailed)
          // Intake-ul poate fi deja persistat dacă numai ACK-ul a fost corupt.
          // Reîmprospătarea arată adevărul serverului înainte de o retrimitere.
          refreshBuildJobs()
        }
      })
      .catch(() => setBuildMsg(A.orderSendFailed))
      .finally(() => setBuildSubmitBusy(false))
  }

  const beginBuildMutation = (id: number): boolean => {
    if (pendingBuildMutationRef.current.has(id)) return false
    pendingBuildMutationRef.current.add(id)
    setPendingBuildMutations(new Set(pendingBuildMutationRef.current))
    return true
  }
  const endBuildMutation = (id: number): void => {
    pendingBuildMutationRef.current.delete(id)
    setPendingBuildMutations(new Set(pendingBuildMutationRef.current))
  }
  const deleteBuildOrder = (job: BuildJobRow): void => {
    if (!window.confirm(A.confirmDeleteBuildOrder(job.id)) || !beginBuildMutation(job.id)) return
    const query = new URLSearchParams({ expectedStatus: job.status, expectedUpdatedAt: job.updatedAt })
    void apiFetch(`/api/admin/constructor/${job.id}?${query.toString()}`, { method: 'DELETE', credentials: 'include' })
      .then(async (response) => ({ httpOk: response.ok, body: await response.json().catch(() => null) as unknown }))
      .then(({ httpOk, body }) => {
      if (httpOk && adminMutationAcknowledged(body)) {
        setBuildJobs((prev) =>
          Array.isArray(prev) ? prev.filter((x) => x.id !== job.id) : prev,
        )
        setBuildMsg(A.orderDeleted(job.id))
      } else setBuildMsg(adminContractText(body, 'error') === 'stale_job_state' ? 'Starea ordinului s-a schimbat; lista a fost reîmprospătată.' : A.orderDeleteFailed)
    })
      .catch(() => setBuildMsg(A.orderDeleteFailed))
      .finally(() => {
        endBuildMutation(job.id)
        refreshBuildJobs()
      })
  }

  const cancelBuildOrder = (job: BuildJobRow): void => {
    if (!window.confirm(A.confirmStopBuildOrder(job.id)) || !beginBuildMutation(job.id)) return
    void apiFetch(`/api/admin/constructor/${job.id}/anuleaza`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ expectedStatus: job.status, expectedUpdatedAt: job.updatedAt }),
    })
      .then(async (response) => ({ httpOk: response.ok, body: await response.json().catch(() => null) as unknown }))
      .then(({ httpOk, body }) => {
        setBuildMsg(httpOk && adminMutationAcknowledged(body) ? A.orderStopped(job.id) : adminContractText(body, 'error') === 'stale_job_state' ? 'Starea ordinului s-a schimbat; oprirea nu a fost aplicată.' : A.orderStopFailed)
      })
      .catch(() => setBuildMsg(A.orderStopFailed))
      .finally(() => {
        endBuildMutation(job.id)
        refreshBuildJobs()
      })
  }
  const cleanBuildOrders = (): void => {
    if (!window.confirm(A.confirmClearFailedJobs)) return
    const jobs = (buildJobsData ?? [])
      .filter((job) => ['failed', 'done', 'cancelled'].includes(job.status))
      .map((job) => ({ id: job.id, status: job.status, updatedAt: job.updatedAt }))
    void apiFetch('/api/admin/constructor/curata', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ scope: 'failed_done', jobs }),
    })
      .then(async (response) => {
        const body: unknown = await response.json().catch(() => null)
        return {
          archived: response.ok ? parseAdminArchiveAcknowledgement(body) : null,
          error: adminContractText(body, 'error'),
        }
      })
      .then(({ archived, error }) => {
        refreshBuildJobs()
        if (archiveOpen) loadBuildArchive()
        setBuildMsg(archived !== null
          ? A.ordersCleaned(archived)
          : error === 'stale_job_state'
            ? 'Starea ordinelor s-a schimbat; lista a fost reîmprospătată.'
            : A.ordersCleanFailed)
      })
      .catch(() => setBuildMsg(A.ordersCleanFailed))
  }
  const retryBuildOrder = (job: BuildJobRow): void => {
    if (!beginBuildMutation(job.id)) return
    void apiFetch(`/api/admin/constructor/${job.id}/reia`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ expectedStatus: job.status, expectedUpdatedAt: job.updatedAt }),
    })
      .then(async (response) => ({ httpOk: response.ok, body: await response.json().catch(() => null) as unknown }))
      .then(({ httpOk, body }) => {
        setBuildMsg(httpOk && adminMutationAcknowledged(body) ? A.orderResumed(job.id) : adminContractText(body, 'error') === 'stale_job_state' ? 'Starea ordinului s-a schimbat; reluarea nu a fost aplicată.' : A.orderResumeFailed)
      })
      .catch(() => setBuildMsg(A.orderResumeFailed))
      .finally(() => {
        endBuildMutation(job.id)
        refreshBuildJobs()
      })
  }

  const loadBuildArchive = (cursor: BuildArchiveCursor | null = null, append = false): void => {
    archiveRefreshRef.current.controller?.abort()
    const controller = new AbortController()
    const generation = archiveRefreshRef.current.generation + 1
    archiveRefreshRef.current = { generation, controller }
    const isCurrent = (): boolean => archiveRefreshRef.current.generation === generation
    const query = cursor
      ? `?cursorUpdatedAt=${encodeURIComponent(cursor.updatedAt)}&cursorId=${cursor.id}`
      : ''
    setBuildArchive((previous) => ({
      status: 'loading',
      jobs: append ? previous.jobs : [],
      nextCursor: append ? previous.nextCursor : null,
      appendError: false,
    }))
    void apiFetch(`/api/admin/constructor/arhiva${query}`, { credentials: 'include', cache: 'no-store', signal: controller.signal })
      .then(async (response) => response.ok ? parseAdminBuildArchive(await response.json().catch(() => null)) : null)
      .then((body) => {
        if (!isCurrent()) return
        if (!body) throw new Error('archive_unreadable')
        setBuildArchive((previous) => {
          const combined = append ? [...previous.jobs, ...body.jobs] : body.jobs
          return {
            status: 'ready',
            jobs: [...new Map(combined.map((job) => [job.id, job])).values()],
            nextCursor: body.nextCursor,
            appendError: false,
          }
        })
      })
      .catch(() => {
        if (!isCurrent()) return
        setBuildArchive((previous) => append && previous.jobs.length > 0
          ? { ...previous, status: 'ready', appendError: true }
          : { ...previous, status: 'error', appendError: false })
      })
  }
  const restoreBuildOrder = (job: BuildJobRow): void => {
    if (!beginBuildMutation(job.id)) return
    void apiFetch(`/api/admin/constructor/${job.id}/restaureaza`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ expectedStatus: job.status, expectedUpdatedAt: job.updatedAt }),
    })
      .then(async (response) => ({ httpOk: response.ok, body: await response.json().catch(() => null) as unknown }))
      .then(({ httpOk, body }) => setBuildMsg(
        httpOk && parseAdminRestoreAcknowledgement(body) !== null
          ? `Ordinul #${job.id} a fost restaurat în istoricul vizibil.`
          : adminContractText(body, 'error') === 'stale_job_state'
            ? 'Arhiva s-a schimbat; reîncarc lista.'
            : 'Ordinul nu a putut fi restaurat.',
      ))
      .catch(() => setBuildMsg('Arhiva nu a putut fi actualizată: conexiunea a eșuat.'))
      .finally(() => {
        endBuildMutation(job.id)
        loadBuildArchive()
        refreshBuildJobs()
      })
  }

  // Tab „Recuperare” open → loads the saved recovery points.
  const loadRecovery = (): void => {
    setRecoveryLoading(true)
    apiFetch('/api/admin/backups', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { points?: RecoveryRow[] } | null) => {
        if (j?.points) {
          setRecoveryPoints(j.points)
          setRecoveryFailed(false)
        } else setRecoveryFailed(true)
        setRecoveryLoading(false)
      })
      .catch(() => {
        setRecoveryFailed(true)
        setRecoveryLoading(false)
      })
  }
  useEffect(() => {
    if (tab !== 'recuperare') return
    loadRecovery()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  // Tab „Erori" deschis → încarcă lista (erori browser + defecte de sistem, cu
  // „ce este") și o reîmprospătează cât stă deschis. null = citirea a EȘUAT.
  const loadErori = (): void => {
    setEroriBusy(true)
    fetchErori()
      .then((e) => setErori(e))
      .finally(() => setEroriBusy(false))
  }
  useEffect(() => {
    if (tab !== 'erori') return
    loadErori()
    const id = window.setInterval(loadErori, 20000)
    return () => window.clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  // Tab „Notificări" deschis → încarcă cererile noi și reîmprospătează la 20s.
  const loadNotificari = (): void => {
    fetchNotificari().then((n) => setNotificari(n))
  }
  useEffect(() => {
    if (tab !== 'notificari') return
    loadNotificari()
    const id = window.setInterval(loadNotificari, 20000)
    return () => window.clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  useEffect(() => {
    loadNotificari()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const saveRecoveryNow = (): void => {
    setRecoveryMsg(A.savingRecovery)
    void apiFetch('/api/admin/backups', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ note: recoveryNote.trim() }),
    })
      // Corpul erorii păstrează cauza măsurată pentru feedback acționabil.
      .then((r) =>
        r.json().then((j: { ok?: boolean; tag?: string; error?: string }) => ({
          ok: r.ok,
          j,
        })),
      )
      .then(({ ok, j }) => {
        if (ok && j.tag != null) {
          setRecoveryMsg(A.recoverySaved(j.tag))
          setRecoveryNote('')
          loadRecovery()
        } else
          setRecoveryMsg(A.recoverySaveFailed(j.error ?? 'eroare necunoscută'))
      })
      .catch(() => setRecoveryMsg(A.recoverySaveNetworkError))
  }

  // Restores the app to a saved point: double confirmation (heavy action —
  // production changes), then the server brings master to the tag's state and
  // the publish starts by itself. The button shows progress and result, with proof.
  const restoreFromPoint = (p: RecoveryRow): void => {
    const when = p.date ? new Date(p.date).toLocaleString('ro-RO') : p.tag
    if (!window.confirm(A.confirmRestoreApp(when, p.sha))) return
    if (
      !window.confirm(
        A.confirmRestoreAppSure(p.note.split('\n')[0].slice(0, 80), p.tag),
      )
    )
      return
    setRestoringTag(p.tag)
    setRecoveryMsg(A.restoringApp(p.tag))
    void apiFetch('/api/admin/backups/restore', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ tag: p.tag }),
    })
      .then((r) =>
        r.json().then((j: { ok?: boolean; sha?: string; error?: string }) => ({
          ok: r.ok,
          j,
        })),
      )
      .then(({ ok, j }) => {
        setRestoringTag(null)
        if (ok && j.ok) setRecoveryMsg(A.restoreSuccess(j.sha ?? p.sha))
        else setRecoveryMsg(A.restoreFailed(j.error ?? 'eroare necunoscută'))
      })
      .catch(() => {
        setRestoringTag(null)
        setRecoveryMsg(A.restoreNetworkError)
      })
  }

  useEffect(() => {
    if (tab !== 'gesturi') return
    setGestOff('necitit')
    void fetchDisabledGestures().then(setGestOff)
  }, [tab])

  const toggleGesture = (clip: string): void => {
    if (!Array.isArray(gestOff) || gestSavePendingRef.current) return
    const next = gestOff.includes(clip)
      ? gestOff.filter((c) => c !== clip)
      : [...gestOff, clip]
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

  const A = adminStrings()

  const activityData =
    typeof activity === 'object' && activity !== null ? activity : null
  const mailboxData =
    typeof mailboxLive === 'object' && mailboxLive !== null ? mailboxLive : null
  const inboundData = Array.isArray(inbound) ? inbound : null
  const contactData = Array.isArray(contactMsgs) ? contactMsgs : null
  const storesData =
    typeof stores === 'object' && stores !== null ? stores : null
  const envCheckData =
    typeof envCheck === 'object' && envCheck !== null ? envCheck : null
  const buildJobsData = Array.isArray(buildJobs) ? buildJobs : null
  const gestOffData = Array.isArray(gestOff) ? gestOff : null
  const sym = finance?.currency === 'usd' ? '$' : '£'
  const aiParts = finance
    ? Object.entries(finance.byKind)
        .filter(([, v]) => v > 0)
        .sort((a, b) => b[1] - a[1])
    : []
  const tabLabels: Record<AdminTab, string> = {
    finance: A.tabMoney,
    users: `${A.tabUsers}${activityData && activityData.users.length > 0 ? ` (${activityData.users.length})` : ''}`,
    share: A.tabShare,
    stores: A.tabStores,
    inbox: A.tabInbox,
    gesturi: A.tabGestures,
    tokenuri: A.tabTokens,
    constructor: A.tabBuilder,
    recuperare: A.tabRecovery,
    sistem: A.tabSystem,
    erori: A.tabErrors,
    notificari: A.tabNotifications,
    creier: A.tabBrain,
  }
  const adminKelionCost =
    adminBilling !== 'necitit' &&
    adminBilling !== null &&
    adminBilling.scutit === true &&
    adminBilling.debitMinor === 0 &&
    adminBilling.creditsUsed === 0 &&
    typeof adminBilling.minorUnit === 'number'
      ? formatMinorMoney(
          adminBilling.debitMinor,
          adminBilling.currency,
          adminBilling.minorUnit,
          'ro-RO',
        )
      : null
  const adminCreditsUsed =
    adminKelionCost &&
    adminBilling !== 'necitit' &&
    adminBilling !== null &&
    typeof adminBilling.creditsUsed === 'number'
      ? adminBilling.creditsUsed
      : null

  return (
    <div className={`admin-overlay ${peek ? 'peek' : ''}`}>
      <div className="admin-panel">
        <header className="admin-head">
          <div className="admin-tabs">
            {ADMIN_TABS.map((tabId) => (
              <button
                key={tabId}
                type="button"
                className={`admin-tab ${tab === tabId ? 'sel' : ''}`}
                onClick={() => setTab(tabId)}
              >
                {tabLabels[tabId]}
              </button>
            ))}
          </div>

          <button
            type="button"
            className="ghost"
            disabled={pushBusy || push === 'nesuportat' || push === 'refuzat'}
            title={
              push === 'refuzat'
                ? 'Notificările sunt blocate din setările browserului — deblochează-le acolo întâi.'
                : push === 'nesuportat'
                  ? 'Browserul ăsta nu știe Web Push.'
                  : 'Anunțurile de panou (PR gata, alarme) vin și pe telefonul ăsta.'
            }
            onClick={() => void comutaPush()}
          >
            {pushBusy
              ? '🔔 …'
              : push === 'activ'
                ? '🔔 Pe telefon: pornit'
                : push === 'refuzat'
                  ? '🔕 blocat din browser'
                  : push === 'nesuportat'
                    ? '🔕 indisponibil aici'
                    : '🔔 Pornește pe telefon'}
          </button>
          <BackLink onBack={onClose} />
        </header>

        <CreditAICard brainCredit={brainCredit} />
        {tab === 'finance' && (
          <section className="admin-finance">
            <BecuriCredit />

            {!finance && !financeFailed && (
              <p className="chat-hint">{A.loading}</p>
            )}
            {!finance && financeFailed && (
              <p className="chat-hint" style={{ color: '#e6a23c' }}>
                ⚠ Nu pot citi datele de bani — citirea a eșuat (nu e o
                încărcare). Reîncerc automat la 15s.
              </p>
            )}
            {finance && financeFailed && (
              <p className="chat-hint" style={{ color: '#e6a23c' }}>
                ⚠ Ultima reîmprospătare a picat — cifrele de mai jos sunt
                ultimele citite cu succes.
              </p>
            )}
            {finance && (
              <>
                {circuit && (
                  <div className="or-wallet">
                    <div className="or-wallet-main">
                      <span className="or-wallet-label">
                        Furnizorii plătiți cu cardul tău
                      </span>
                    </div>
                    {circuit.paymentCollection?.status === 'active' &&
                    circuit.paymentCollection.automaticCredit ? (
                      <span className="or-wallet-sub">
                        Revolut Merchant activ: clientul confirmă checkout-ul,
                        iar creditarea se face automat numai după webhook-ul
                        semnat și verificat. Nu există debit automat fără
                        mandatul clientului.
                      </span>
                    ) : circuit.paymentCollection?.status ===
                      'setup_required' ? (
                      <span
                        className="or-wallet-sub"
                        style={{ color: '#e6a23c' }}
                      >
                        ⚠ Plățile sunt indisponibile până la configurarea
                        integrării Merchant externe. Checkout-ul rămâne închis
                        și nu există credit anticipat sau verificare manuală
                        prezentată ca flux de produs.
                      </span>
                    ) : (
                      <span
                        className="or-wallet-sub"
                        style={{ color: '#e6a23c' }}
                      >
                        ⚠ Starea Merchant nu poate fi verificată; checkout-ul
                        nu este considerat activ.
                      </span>
                    )}

                    {circuit?.costReal && (
                      <span className="or-wallet-sub">
                        💷 Cost furnizor reconciliat:{' '}
                        <b>${circuit.costReal.total.toFixed(2)}</b>
                        {' · '}azi ${circuit.costReal.today.toFixed(2)}
                        {Object.keys(circuit.costReal.byKind).length > 0 && (
                          <>
                            {' — '}
                            {Object.entries(circuit.costReal.byKind)
                              .sort((a, b) => b[1] - a[1])
                              .slice(0, 4)
                              .map(([k, v]) => `${k} $${v.toFixed(2)}`)
                              .join(' · ')}
                          </>
                        )}
                      </span>
                    )}

                    {circuit && !circuit.costReal && (
                      <span className="or-wallet-sub">
                        💷 nu pot citi jurnalul de cost
                        {circuit.costRealMotiv
                          ? `: ${circuit.costRealMotiv}`
                          : ''}
                      </span>
                    )}

                    <span className="or-wallet-sub">
                      ▶ Autonomia: PORNITĂ PERMANENT (LEGE, 16 aug) — fără
                      buton de oprire. Frânele tale reale: plafonul zilnic de
                      bani, oprirea pe erori permanente (P27), cheile timerului
                      de promovare.
                    </span>
                    {circuit?.autonomie && (
                      <span
                        className="or-wallet-sub"
                        style={{
                          color: circuit.autonomie.ok ? undefined : '#8a8f98',
                        }}
                      >
                        {circuit.autonomie.ok ? '🤖' : '·'} Kelion, de capul
                        lui: {circuit.autonomie.detaliu}
                      </span>
                    )}
                    {(circuit.expenses?.length ?? 0) > 0 && (
                      <span className="or-wallet-sub">
                        Unde se schimbă cardul, la fiecare:{' '}
                        {(circuit.expenses ?? [])
                          .filter((e) => e.configured)
                          .map((e, i) => (
                            <span key={e.name}>
                              {i > 0 && ' · '}

                              {e.platiAutomate ? '🔁 ' : e.cardPus ? '💳 ' : ''}
                              {e.billingUrl ? (
                                <a
                                  href={e.billingUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  {e.name}
                                </a>
                              ) : (
                                `${e.name} (${e.billing.toLowerCase()})`
                              )}
                            </span>
                          ))}
                      </span>
                    )}
                  </div>
                )}

                {!circuit && circuitFailed && (
                  <div className="or-wallet">
                    <span
                      className="or-wallet-sub"
                      style={{ color: '#e6a23c' }}
                    >
                      ⚠ Nu pot citi circuitul banilor (starea plăților, costul,
                      autonomia) — citirea a eșuat.
                    </span>
                  </div>
                )}
                <div className="fin-breakdown">
                  <div className="fin-breakdown-head">
                    Cost per AI — total ${finance.spentUsd.toFixed(2)}
                    {` (măsurat $${finance.masurat.toFixed(2)} · estimare internă $${finance.estimat.toFixed(2)})`}
                    , azi ${finance.today.toFixed(2)}
                    <button
                      type="button"
                      className="pool-btn withdraw"
                      style={{
                        marginLeft: 10,
                        fontSize: 12,
                        padding: '3px 9px',
                      }}
                      disabled={resetBusy}
                      onClick={async () => {
                        if (!window.confirm(A.confirmResetCounters)) return
                        setResetBusy(true)

                        const r = await apiFetch('/api/admin/reset-counters', {
                          method: 'POST',
                          credentials: 'include',
                        }).catch(() => null)

                        // 200 cu `{ok:false, sterse:0}`, deci `r.ok` era true și
                        // aici scria „Resetat ✓" peste contoare neatinse. Acum
                        // serverul dă 502 la eșec, iar aici se citește cifra.
                        const j = (await r?.json().catch(() => null)) as {
                          ok?: boolean
                          sterse?: number
                          error?: string
                        } | null
                        setResetMsg(
                          r?.ok && j?.ok === true
                            ? `Resetat ✓ (${j.sterse ?? 0} înregistrări șterse)`
                            : `Nu s-a putut reseta${j?.error ? ` — ${j.error}` : ''} — reîncearcă.`,
                        )
                        await fetchFinance()
                          .then((f) => {
                            if (f) setFinance(f)
                          })
                          .catch(() => {})
                        setResetBusy(false)
                      }}
                    >
                      {resetBusy ? '…' : 'Pune pe 0'}
                    </button>
                    {resetMsg && (
                      <span
                        className="fin-sub"
                        style={{
                          marginLeft: 8,
                          color: resetMsg.startsWith('Resetat')
                            ? undefined
                            : '#e6a23c',
                        }}
                      >
                        {resetMsg}
                      </span>
                    )}
                  </div>
                  {aiParts.length === 0 && (
                    <div className="chat-hint">{A.noSpendYet}</div>
                  )}
                  {aiParts.map(([k, v]) => (
                    <div className="fin-row" key={k}>
                      <span>
                        {aiLabel(k)}

                        {finance.felul[k] === 'estimat' && (
                          <span
                            className="fin-sub"
                            style={{ color: '#e6a23c' }}
                          >
                            {' '}
                            — estimare internă
                          </span>
                        )}
                      </span>
                      <span>${v.toFixed(4)}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>
        )}
        {tab === 'stores' && (
          <section className="admin-finance">
            {stores === 'necitit' && (
              <p className="chat-hint">{A.checkingStores}</p>
            )}
            {stores === null && (
              <p className="chat-hint" style={{ color: '#e6a23c' }}>
                ⚠ Nu am putut citi magazinele — citire eșuată, nu magazine
                lipsă.{' '}
                <button
                  type="button"
                  className="ghost"
                  onClick={() => {
                    setStores('necitit')
                    void fetchStores().then(setStores)
                  }}
                >
                  Reîncearcă
                </button>
              </p>
            )}
            {storesData && (
              <div className="fin-breakdown">
                <div className="fin-breakdown-head">
                  Magazine — verificare LIVE pe paginile publice (nu pe
                  promisiunile dashboard-urilor), la maxim 5 minute vechime.
                </div>
                {storesData.stores.map((s) => (
                  <div className="fin-row" key={s.key}>
                    <span>
                      {s.name} — {s.store}
                    </span>
                    <span>
                      {s.listed ? (
                        <a
                          href={s.url}
                          target="_blank"
                          rel="noreferrer"
                          className="store-live"
                        >
                          ● LISTAT — deschide
                        </a>
                      ) : (
                        <span className="store-missing">
                          {A.notListedYet}
                        </span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
        {tab === 'inbox' && (
          <section className="admin-finance">
            <div className="fin-breakdown">
              <div
                className="fin-breakdown-head"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  flexWrap: 'wrap',
                }}
              >
                <span>
                  📬 Cutia {productConfig.supportEmail} — DOAR folderul INBOX,
                  citit direct din server (ultimele 40, citite sau nu). Mesajele
                  deja procesate de Secretar stau în folderele Kelion-Answered /
                  Kelion-ToAnswer / Kelion-Automated (vizibile în clientul de
                  mail). Bifează și șterge — una sau mai multe odată; serverul
                  le mută în coșul căsuței când acesta există.
                </span>
                <span
                  style={{
                    display: 'inline-flex',
                    gap: 8,
                    alignItems: 'center',
                  }}
                >
                  {mailboxData && mailboxData.emails.length > 0 && (
                    <button
                      type="button"
                      className="ghost"
                      style={{ fontSize: 12 }}
                      onClick={() =>
                        setMailSel((prev) =>
                          prev.size === mailboxData.emails.length
                            ? new Set()
                            : new Set(mailboxData.emails.map((m) => m.uid)),
                        )
                      }
                    >
                      {mailboxData &&
                      mailSel.size === mailboxData.emails.length &&
                      mailboxData.emails.length > 0
                        ? 'Deselectează tot'
                        : 'Selectează tot'}
                    </button>
                  )}
                  {mailSel.size > 0 && (
                    <button
                      type="button"
                      className="ghost"
                      style={{ fontSize: 12, color: '#ff7a7a' }}
                      disabled={mailDelBusy}
                      onClick={() => stergeMailuri([...mailSel])}
                    >
                      {mailDelBusy ? '…' : `Șterge selectate (${mailSel.size})`}
                    </button>
                  )}
                </span>
              </div>
              {mailDelMsg && <div className="chat-hint">{mailDelMsg}</div>}
              {mailboxLoading && (
                <p className="chat-hint">{A.readingMailbox}</p>
              )}

              {!mailboxLoading && mailboxLive === null && (
                <p className="chat-hint" style={{ color: '#e6a23c' }}>
                  ⚠{' '}
                  {A.mailboxReadFail.replace(
                    '{motiv}',
                    'ruta serverului nu a răspuns',
                  )}
                </p>
              )}
              {!mailboxLoading && mailboxData && !mailboxData.ok && (
                <p className="chat-hint" style={{ color: '#e6a23c' }}>
                  ⚠{' '}
                  {mailboxData.motiv === 'mail_neconfigurat'
                    ? A.mailboxNotConfigured
                    : A.mailboxReadFail.replace(
                        '{motiv}',
                        mailboxData.motiv ?? 'motiv necunoscut',
                      )}
                </p>
              )}
              {!mailboxLoading &&
                mailboxData?.ok &&
                mailboxData.emails.length === 0 && (
                  <p className="chat-hint">{A.mailboxEmpty}</p>
                )}
              {(mailboxData?.emails ?? []).map((m) => (
                <div className="inbox-item" key={m.uid}>
                  <div className="inbox-top">
                    <span
                      className="inbox-from"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 8,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={mailSel.has(m.uid)}
                        onChange={() => toggleMailSel(m.uid)}
                        title="Selectează pentru ștergere"
                      />
                      {m.fromName
                        ? `${m.fromName} <${m.from}>`
                        : m.from || '(expeditor necunoscut)'}
                    </span>
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 8,
                      }}
                    >
                      <span className={`inbox-flag ${m.seen ? 'ok' : 'wait'}`}>
                        {m.seen ? 'citit' : '● necitit'}
                      </span>
                      <button
                        type="button"
                        className="ghost"
                        style={{ fontSize: 12, color: '#ff7a7a' }}
                        disabled={mailDelBusy}
                        onClick={() => stergeMailuri([m.uid])}
                        title="Șterge acest mesaj"
                      >
                        ✕
                      </button>
                    </span>
                  </div>
                  <div className="inbox-subj">
                    {m.subject || '(fără subiect)'}
                  </div>
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
                emailul (MAIL_PASS) nu e configurat. Niciun mesaj nu se mai
                pierde.
              </div>
              {contactMsgs === 'necitit' && (
                <p className="chat-hint">{A.loading}</p>
              )}
              {contactMsgs === null && (
                <p className="chat-hint" style={{ color: '#e6a23c' }}>
                  ⚠ Nu am putut citi mesajele de contact — citire eșuată
                  (posibil sesiune expirată), nu listă goală.
                </p>
              )}
              {contactData && contactData.length === 0 && (
                <p className="chat-hint">{A.noContactMessagesYet}</p>
              )}
              {(contactData ?? []).map((m) => (
                <div className="inbox-item" key={m.id}>
                  <div className="inbox-top">
                    <span className="inbox-from">
                      {m.name || '(fără nume)'} &lt;{m.email}&gt;
                    </span>

                    <span className={`inbox-flag ${m.emailed ? 'ok' : 'wait'}`}>
                      {m.emailed
                        ? '✉️ redirecționat pe email'
                        : '📥 doar salvat (trimiterea a picat sau email off)'}
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
                Inbox {productConfig.supportEmail} — emailurile PRIMITE și
                răspunsul redactat automat de Secretar (row 19). Se citesc la
                fiecare 3 minute.
              </div>
              {inbound === 'necitit' && (
                <p className="chat-hint">{A.loading}</p>
              )}
              {inbound === null && (
                <p className="chat-hint" style={{ color: '#e6a23c' }}>
                  ⚠ Nu am putut citi scrisorile — citire eșuată (posibil
                  sesiune expirată), nu listă goală.
                </p>
              )}
              {inboundData && inboundData.length === 0 && (
                <p className="chat-hint">{A.noLettersYet}</p>
              )}
              {(inboundData ?? []).map((m) => (
                <div className="inbox-item" key={m.id}>
                  <div className="inbox-top">
                    <span className="inbox-from">
                      {m.from_name || m.from_addr}
                    </span>
                    <span className={`inbox-flag ${m.replied ? 'ok' : 'wait'}`}>
                      {m.replied ? '✅ răspuns trimis' : '⏳ fără răspuns'}
                    </span>
                  </div>
                  <div className="inbox-subj">
                    {m.subject || '(fără subiect)'}
                  </div>
                  {m.body && (
                    <div className="inbox-body">{m.body.slice(0, 300)}</div>
                  )}
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
        {tab === 'recuperare' && (
          <section className="admin-finance">
            <div className="fin-breakdown">
              <div className="fin-breakdown-head">
                Recuperare — versiunile salvate ale aplicației (tag-uri git,
                oglindite pe serverul Linux ca .bundle + .tar.gz). Fiecare e
                recuperabilă integral.
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
              <div className="fin-breakdown-head">
                Versiuni salvate ({recoveryPoints.length})
              </div>
              {recoveryLoading && recoveryPoints.length === 0 && (
                <div className="chat-hint">{A.loading}</div>
              )}

              {!recoveryLoading && recoveryFailed && (
                <div className="chat-hint" style={{ color: '#e6a23c' }}>
                  ⚠ Nu am putut citi versiunile — citire eșuată (GITHUB_TOKEN
                  lipsă sau GitHub n-a răspuns), NU listă goală.{' '}
                  <button
                    type="button"
                    className="ghost"
                    onClick={loadRecovery}
                  >
                    Reîncearcă
                  </button>
                </div>
              )}
              {!recoveryLoading &&
                !recoveryFailed &&
                recoveryPoints.length === 0 && (
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
                    {p.note ? (
                      <div
                        className="muted"
                        style={{ fontSize: 12, marginTop: 2 }}
                      >
                        {p.note.split('\n')[0].slice(0, 140)}
                      </div>
                    ) : null}
                  </span>
                  <span
                    style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                  >
                    <span className="muted" style={{ fontSize: 12 }}>
                      {p.tag}
                    </span>
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
                „Restaurează" aduce aplicația EXACT la versiunea aleasă (commit
                nou pe master — nimic nu se pierde din istoric) și republică
                automat pe server. Rezerve manuale: bundle-urile din{' '}
                <code>/root/kelion/backups/</code>.
              </div>
            </div>
          </section>
        )}
        {tab === 'sistem' && (
          <section className="admin-finance">
            <div className="fin-breakdown">
              <div className="fin-breakdown-head">Sistem (VPS)</div>

              {brainCredit?.vps ? (
                (() => {
                  const v = brainCredit.vps
                  const critic =
                    v.liberPct <= (v.pragMemoriePct ?? 10) ||
                    v.incarcarePct >= (v.pragIncarcarePct ?? 200)
                  return (
                    <div
                      className={`vps-resurse${critic ? ' vps-critic' : ''}`}
                    >
                      <span className="vps-cifra">
                        RAM liber: <b>{v.liberGb.toFixed(1)}GB</b> /{' '}
                        {v.totalGb.toFixed(1)}GB
                      </span>
                      <span className="vps-cifra">
                        Încărcare: <b>{(v.incarcarePct / 100).toFixed(1)}×</b>{' '}
                        pe {v.procesoare} nuclee
                      </span>
                      <span className="vps-cifra vps-load">
                        load: {v.incarcare.map((n) => n.toFixed(2)).join(' / ')}
                      </span>
                      {critic && <span className="vps-alarma">⚠ critic</span>}
                    </div>
                  )
                })()
              ) : (
                <div className="vps-resurse">
                  <span className="vps-cifra">
                    ⚠ VPS necitibil (nu s-au putut măsura RAM/încărcarea acum)
                  </span>
                </div>
              )}
              <p className="chat-hint" style={{ marginTop: 8 }}>
                Monitorizare doar în citire. Operațiunile asupra serverului se
                execută exclusiv prin infrastructura separată, nu din aplicația
                web.
              </p>
            </div>

            <div className="fin-breakdown" style={{ marginTop: 16 }}>
              <div className="fin-breakdown-head">
                Autoverificare inteligentă
              </div>
              <p className="chat-hint" style={{ marginTop: 8 }}>
                Kelion se testează pe el însuși pe toate funcțiile și spune,
                pentru fiecare care nu merge, <b>de ce</b> și ce e de făcut.
                Durează câteva secunde (probează real citirile).
              </p>
              <button
                className="ghost"
                style={{ marginTop: 12 }}
                disabled={avBusy}
                onClick={async () => {
                  setAvBusy(true)
                  setAvEroare('')
                  try {
                    const res = await apiFetch('/api/admin/autoverificare', {
                      method: 'POST',
                      credentials: 'include',
                    })
                    if (!res.ok) {
                      setAvEroare(
                        `Autoverificarea NU a pornit: HTTP ${res.status}`,
                      )
                      setAvRaport(null)
                      return
                    }
                    const j = (await res
                      .json()
                      .catch(() => null)) as RaportAutoverificare | null
                    if (!j || typeof j.total !== 'number') {
                      setAvEroare(
                        'Răspuns necitibil de la server (nu pot afișa un raport pe care nu l-am măsurat).',
                      )
                      setAvRaport(null)
                      return
                    }
                    setAvRaport(j)
                  } catch (e) {
                    // Regula #1: eroarea reală ajunge la om, nu o mascăm.
                    const motiv = e instanceof Error ? e.message : String(e)
                    console.error('[autoverificare]', e)
                    setAvEroare(`Eroare la autoverificare: ${motiv}`)
                    setAvRaport(null)
                  } finally {
                    setAvBusy(false)
                  }
                }}
              >
                {avBusy
                  ? 'Verific toate funcțiile…'
                  : '🧪 Verifică toate funcțiile'}
              </button>

              {avEroare && (
                <p
                  className="chat-hint"
                  style={{ marginTop: 10, color: '#e0603a' }}
                >
                  ⚠ {avEroare}
                </p>
              )}

              {avRaport && (
                <div style={{ marginTop: 12 }}>
                  <div
                    style={{
                      display: 'flex',
                      gap: 14,
                      flexWrap: 'wrap',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    <span>
                      Total: <b>{avRaport.total}</b>
                    </span>
                    <span style={{ color: '#2e9e5b' }}>
                      Merg: <b>{avRaport.merg}</b>
                    </span>
                    <span style={{ color: '#e0603a' }}>
                      Stricate: <b>{avRaport.stricate}</b>
                    </span>
                    <span style={{ color: '#c79218' }}>
                      Nu pot verifica: <b>{avRaport.nepotverifica}</b>
                    </span>
                  </div>
                  <ul
                    style={{
                      listStyle: 'none',
                      padding: 0,
                      marginTop: 10,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                    }}
                  >
                    {avRaport.functii
                      // Întâi ce nu merge (stricate, apoi nu-pot-verifica), apoi ce merge.
                      .slice()
                      .sort(
                        (a, b) =>
                          rangVerdict(a.verdict) - rangVerdict(b.verdict),
                      )
                      .map((f) => {
                        const c =
                          f.verdict === 'merge'
                            ? '#2e9e5b'
                            : f.verdict === 'stricat'
                              ? '#e0603a'
                              : '#c79218'
                        const et =
                          f.verdict === 'merge'
                            ? '✓ merge'
                            : f.verdict === 'stricat'
                              ? '✗ stricat'
                              : '… nu pot verifica'
                        return (
                          <li
                            key={f.functie}
                            style={{
                              borderLeft: `3px solid ${c}`,
                              paddingLeft: 10,
                            }}
                          >
                            <div
                              style={{
                                display: 'flex',
                                gap: 8,
                                alignItems: 'baseline',
                                flexWrap: 'wrap',
                              }}
                            >
                              <b>{f.functie}</b>
                              <span style={{ color: c, fontSize: '0.85em' }}>
                                {et}
                              </span>
                              <span
                                className="chat-hint"
                                style={{ fontSize: '0.8em' }}
                              >
                                {f.tip === 'efect'
                                  ? '(cu efect — dry-run)'
                                  : '(citire — probat real)'}
                              </span>
                            </div>
                            <div
                              className="chat-hint"
                              style={{ fontSize: '0.85em' }}
                            >
                              {f.face}
                            </div>
                            {f.verdict !== 'merge' && (
                              <div style={{ fontSize: '0.85em', marginTop: 2 }}>
                                <span style={{ color: c }}>De ce:</span>{' '}
                                {f.deCe}
                                {f.recomandare && (
                                  <>
                                    {' '}
                                    <span style={{ color: c }}>→</span>{' '}
                                    <b>{f.recomandare}</b>
                                  </>
                                )}
                              </div>
                            )}
                          </li>
                        )
                      })}
                  </ul>
                </div>
              )}
            </div>
          </section>
        )}
        {tab === 'erori' && (
          <section className="admin-finance">
            <div className="fin-breakdown">
              <div className="fin-breakdown-head">
                Erori — ce e fiecare, în clar. Kelion le vede și el în creier
                (le poți întreba în chat: „ce e eroarea asta?").
                {eroriBusy && <span className="chat-hint"> · se încarcă…</span>}
              </div>
              {erori === 'necitit' && <p className="chat-hint">Se încarcă…</p>}
              {erori === null && (
                <p className="chat-hint" style={{ color: '#e6a23c' }}>
                  ⚠ Nu pot citi erorile — citirea a eșuat (NU înseamnă „zero
                  erori"). Reîncerc automat la 20s.
                </p>
              )}
              {erori && erori !== 'necitit' && (
                <>
                  {erori.sistem.length === 0 && erori.browser.length === 0 && (
                    <p className="chat-hint" style={{ marginTop: 8 }}>
                      Nicio eroare în ultimele 48h. 🎉
                    </p>
                  )}
                  {erori.sistem.length > 0 && (
                    <div style={{ marginTop: 10 }}>
                      <div style={{ fontWeight: 600, marginBottom: 4 }}>
                        Sistem (server + ordine de build)
                      </div>
                      {erori.sistem.map((p, i) => (
                        <ErrRow
                          key={`s${i}`}
                          sev={p.severitate}
                          cat={p.categorie}
                          text={p.text}
                          ceEste={p.ceEste}
                        />
                      ))}
                    </div>
                  )}
                  {erori.browser.length > 0 && (
                    <div style={{ marginTop: 14 }}>
                      <div style={{ fontWeight: 600, marginBottom: 4 }}>
                        Browser (F12 la utilizatori, ultimele 48h)
                      </div>
                      {erori.browser.map((e, i) => (
                        <ErrRow
                          key={`b${i}`}
                          sev={e.severitate}
                          cat={e.categorie}
                          text={e.text}
                          ceEste={e.ceEste}
                          meta={`×${e.cate}${e.cine ? ` · ${e.cine}` : ''}`}
                        />
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </section>
        )}
        {tab === 'creier' && (
          <section className="admin-finance">
            <div className="fin-breakdown">
              <div className="fin-breakdown-head">Creier OpenAI</div>

              <div
                style={{
                  marginTop: 12,
                  padding: 12,
                  border: '1px solid var(--border)',
                  borderRadius: 10,
                }}
              >
                <div style={{ fontWeight: 650 }}>
                  Codex — worker privat separat
                </div>
                {codex === 'necitit' && (
                  <p className="chat-hint">Se citește configurația…</p>
                )}
                {codex === null && (
                  <p className="chat-hint" style={{ color: '#e6a23c' }}>
                    ⚠ Codex: setup_required. Metadata workerului nu poate fi
                    verificată; această pagină nu pornește autentificarea și nu
                    afișează coduri sau tokenuri.
                  </p>
                )}
                {typeof codex === 'object' && codex !== null && (
                  <>
                    <p className="chat-hint">
                      Worker:{' '}
                      <b>
                        {codex.worker.state === 'ready'
                          ? 'pregătit'
                          : codex.worker.state === 'busy'
                            ? 'ocupat'
                            : codex.worker.state === 'offline'
                              ? 'offline'
                              : codex.worker.state === 'setup_required'
                                ? 'necesită configurare'
                                : codex.worker.state === 'degraded'
                                  ? 'degradat'
                                  : 'stare necunoscută'}
                      </b>
                      .{codex.status ? ` ${codex.status}` : ''}
                    </p>
                    <p className="chat-hint">
                      Ultimul heartbeat:{' '}
                      {codex.worker.lastHeartbeat
                        ? new Date(codex.worker.lastHeartbeat).toLocaleString(
                            'ro-RO',
                          )
                        : 'neînregistrat'}
                    </p>
                    {(codex.worker.state === 'setup_required' ||
                      codex.worker.state === 'unknown') && (
                      <p className="chat-hint">
                        Configurarea se face exclusiv în workerul privat: într-un
                        worker cu browser se rulează <code>codex login</code>, iar
                        într-un worker headless se poate folosi fluxul oficial{' '}
                        <code>codex login --device-auth</code>. Codul unic se
                        introduce numai în pagina oficială ChatGPT; nu în
                        Kelionai, API-ul aplicației, baza de date sau loguri.
                      </p>
                    )}
                    {codex.worker.state === 'offline' && (
                      <p className="chat-hint">
                        Workerul nu răspunde. Kelionai nu încearcă să refacă
                        autentificarea Codex în browser.
                      </p>
                    )}
                    {codex.worker.state === 'degraded' && (
                      <p className="chat-hint" style={{ color: '#8a6d1a' }}>
                        Workerul răspunde, dar a raportat o stare degradată. Cauza
                        afișată mai sus trebuie rezolvată înainte ca panoul să-l
                        considere pregătit.
                      </p>
                    )}
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {codex.taskUrl ? (
                        <a
                          className="ghost"
                          href={codex.taskUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Deschide în Codex
                        </a>
                      ) : (
                        <button type="button" className="ghost" disabled>
                          Deschide în Codex
                        </button>
                      )}
                    </div>
                    <p className="chat-hint" style={{ marginTop: 8 }}>
                      {adminKelionCost && adminCreditsUsed !== null
                        ? <><b>Cost Kelion admin: {adminKelionCost} · {adminCreditsUsed.toLocaleString('ro-RO')} credite consumate</b>.</>
                        : <><b>Starea debitului Kelion pentru admin nu poate fi verificată.</b></>}
                      {' '}Cost OpenAI intern:{' '}
                      <b>
                        {codex.internalCostUsd == null
                          ? 'necitit'
                          : new Intl.NumberFormat('en-US', {
                              style: 'currency',
                              currency: 'USD',
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 6,
                            }).format(codex.internalCostUsd)}
                      </b>
                      .
                    </p>
                    <p className="chat-hint" style={{ marginTop: 8 }}>
                      Abonamentul ChatGPT poate alimenta Codex pentru text,
                      reasoning și Constructor numai în worker. Realtime, TTS,
                      imaginea și video folosesc separat OpenAI API pe server;
                      abonamentul ChatGPT nu este o cheie API. Aceste costuri
                      rămân cheltuieli interne și nu debitează portofelul admin.
                    </p>
                  </>
                )}
              </div>

              {creier === 'necitit' && (
                <p className="chat-hint">Se încarcă modelele…</p>
              )}
              {creier === null && (
                <p className="chat-hint">
                  Nu s-a putut citi configurația OpenAI.
                </p>
              )}
              {typeof creier === 'object' &&
                creier !== null &&
                (() => {
                  const modele = creier.modele
                  return (
                    <>
                      <p className="chat-hint">
                        Provider: <b>OpenAI</b> · selecție automată
                      </p>
                      {creier.catalogEroare && (
                        <p className="chat-hint" style={{ marginTop: 8 }}>
                          Catalog OpenAI: {creier.catalogEroare}
                        </p>
                      )}
                      <div className="chat-hint" style={{ marginTop: 12 }}>
                        Trepte configurate de server:{' '}
                        {modele
                          .filter((model) => !model.isAuto)
                          .map((model) => `${model.validat ? '✓' : '⚠'} ${model.nume}`)
                          .join(' → ')}
                        . Configurația este read-only în browser.
                      </div>
                    </>
                  )
                })()}
            </div>
          </section>
        )}
        {tab === 'notificari' && (
          <section className="admin-finance">
            <div className="fin-breakdown">
              <div className="fin-breakdown-head">
                Notificări — cereri noi care cer atenția ta (plată neatribuită,
                cerere neacoperită).
              </div>
              {notificari === 'necitit' && (
                <p className="chat-hint">Se încarcă…</p>
              )}
              {notificari === null && (
                <p className="chat-hint" style={{ color: '#e6a23c' }}>
                  ⚠ Nu pot citi notificările — citirea a eșuat (NU înseamnă
                  „zero"). Reîncerc automat la 20s.
                </p>
              )}
              {Array.isArray(notificari) && notificari.length === 0 && (
                <p className="chat-hint" style={{ marginTop: 8 }}>
                  Nicio cerere nouă. 🎉
                </p>
              )}
              {Array.isArray(notificari) &&
                notificari.map((n) => (
                  <div
                    key={n.id}
                    style={{
                      padding: '8px 0',
                      borderTop: '1px solid rgba(128,128,128,0.18)',
                      opacity: n.read ? 0.55 : 1,
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        gap: 8,
                        alignItems: 'baseline',
                        flexWrap: 'wrap',
                      }}
                    >
                      {!n.read && (
                        <span
                          aria-hidden
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: 4,
                            background: '#4aa3ff',
                            display: 'inline-block',
                            flex: '0 0 auto',
                          }}
                        />
                      )}
                      <span style={{ fontWeight: 600 }}>{n.title}</span>
                      <span className="chat-hint" style={{ fontSize: 12 }}>
                        {n.type}
                      </span>
                      {!n.read && (
                        <button
                          type="button"
                          className="ghost"
                          style={{
                            marginLeft: 'auto',
                            fontSize: 12,
                            padding: '2px 8px',
                          }}
                          onClick={async () => {
                            if (await markNotificareCitit(n.id))
                              loadNotificari()
                          }}
                        >
                          Marchează citit
                        </button>
                      )}
                    </div>
                    <div style={{ marginTop: 3 }}>{n.message}</div>
                  </div>
                ))}
            </div>
          </section>
        )}
        {tab === 'constructor' && (
          <section className="admin-finance">
            <div className="fin-breakdown">
              <div className="fin-breakdown-head">
                Constructorul — dai ordinul, Kelion construiește pe server
                (build + teste), deschide PR-ul; după verificări și aprobarea ta,
                publisherul separat îl îmbină. Poți ordona și prin voce/chat:
                „Kelion, construiește…".
              </div>
              <div
                style={{
                  marginTop: 10,
                  padding: '8px 10px',
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  background: 'color-mix(in srgb, var(--text) 3%, transparent)',
                }}
              >
                {/* Workerul vine din starea reală a serverului, nu dintr-o etichetă locală. */}
                <span
                  className="chat-hint"
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color:
                      constructorId == null
                        ? undefined
                        : constructorWorkerCanStartNow === true
                          ? '#1a7f37'
                          : constructorAcceptingWork === true
                            ? '#2563eb'
                            : constructorId.state === 'degraded'
                              ? '#8a6d1a'
                              : '#c1121f',
                  }}
                  title={
                    constructorId?.motiv ??
                    'identitatea constructorului încă nu s-a citit'
                  }
                >
                  {constructorId == null
                    ? 'Constructor: se citește…'
                    : constructorWorkerCanStartNow === true
                      ? '🟢 Lanțul Constructor este pregătit: worker + publisher + release'
                      : constructorAcceptingWork === true
                        ? '🔵 Lanțul Constructor execută o etapă verificată'
                        : constructorId.state === 'degraded'
                          ? `🟠 Constructor degradat — ${constructorId.motiv}`
                          : `🔴 Constructor indisponibil — ${constructorId.motiv}`}
                </span>
                {diagnostic &&
                  (diagnostic.probleme.length > 0 || !diagnostic.sanatos) && (
                    <div
                      style={{
                        marginTop: 8,
                        padding: 10,
                        borderRadius: 8,
                        border: '1px solid',
                        borderColor: diagnostic.sanatos
                          ? '#d0a92066'
                          : '#c1121f66',
                        background: diagnostic.sanatos
                          ? '#d0a92014'
                          : '#c1121f10',
                      }}
                    >
                      <div
                        style={{
                          fontSize: 12.5,
                          fontWeight: 700,
                          color: diagnostic.sanatos ? '#8a6d1a' : '#c1121f',
                        }}
                      >
                        {diagnostic.sanatos ? '⚠ ' : '🔴 '}
                        {diagnostic.verdict}
                      </div>
                      {diagnostic.probleme.map((p) => (
                        <div key={p.cod} style={{ fontSize: 12, marginTop: 6 }}>
                          <span style={{ fontWeight: 600 }}>
                            {p.severitate === 'critic' ? '🔴' : '⚠'} {p.ce}
                          </span>
                          <br />
                          <span
                            className="chat-hint"
                            style={{ fontSize: 11.5 }}
                          >
                            → {p.recomandare}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                {release && (
                  <div style={{ marginTop: 10, padding: 10, border: '1px solid #8884', borderRadius: 8, fontSize: 12 }}>
                    <div style={{ fontWeight: 700 }}>Publicare GitHub</div>
                    {release.integration !== 'ready' ? (
                      <>
                        <div style={{ color: release.integration === 'setup_required' ? '#8a6d1a' : '#c1121f', marginTop: 5 }}>
                          {release.integration === 'setup_required' ? '⚠ Integrarea GitHub nu este configurată' : '🔴 Integrarea GitHub nu poate fi citită'}
                        </div>
                        {release.setupInstructions && <div className="chat-hint" style={{ marginTop: 5 }}>{release.setupInstructions}</div>}
                      </>
                    ) : !release.pr ? (
                      <div className="chat-hint" style={{ marginTop: 5 }}>Nu există încă un PR Constructor de urmărit.</div>
                    ) : (
                      <>
                        <div style={{ marginTop: 5 }}><b>PR:</b>{' '}<a href={release.pr.url} target="_blank" rel="noreferrer">{release.pr.title}</a></div>
                        <div className="chat-hint" style={{ marginTop: 4 }}>Verificări: {release.checks} · Review: {release.approval} · Merge: {release.merge}</div>
                        <div style={{ marginTop: 5 }}>{release.nextAction}</div>
                        {!release.pr.merged && release.pr.state === 'open' && release.pr.baseRef === 'master' && release.checks === 'passed' && release.approval === 'required' && <button className="ghost" type="button" disabled={releaseBusy} style={{ marginTop: 7 }} onClick={releaseAction}>{releaseBusy ? 'Se procesează…' : 'Aprobă în Kelion'}</button>}
                      </>
                    )}
                  </div>
                )}
                <div
                  style={{
                    marginTop: 10,
                    padding: 10,
                    border: '1px solid #8884',
                    borderRadius: 8,
                    fontSize: 11,
                    opacity: 0.75,
                  }}
                >
                  Creier cloud: <b>OpenAI</b>. Constructor:{' '}
                  {constructorId == null ? (
                    'se citește de pe server…'
                  ) : constructorAcceptingWork === true ? (
                    <>
                      <b>Codex worker</b> — {constructorId.motiv}
                    </>
                  ) : (
                    <>{constructorId.motiv}</>
                  )}
                </div>
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
                  disabled={buildSubmitBusy}
                  style={{ flex: 1, minWidth: 0 }}
                />
                <button type="submit" className="ghost" disabled={buildSubmitBusy}>
                  {buildSubmitBusy ? 'Se trimite…' : 'Trimite ordinul'}
                </button>
              </form>
              {buildMsg && <div className="chat-hint">{buildMsg}</div>}
              {/* Evaluarea vine din aceeași politică OpenAI/Codex a serverului. */}
              {evalOrdin && (
                <div className="eval-ordin">
                  <div
                    className={`eval-verdict ${evalOrdin.trece ? 'ok' : 'stop'}`}
                  >
                    {evalOrdin.trece ? '✓ ' : '✕ '}
                    {evalOrdin.motiv}
                  </div>
                  {evalOrdin.capacitatiNecesare.length > 0 && (
                    <div className="eval-caps">
                      Cerință:{' '}
                      {evalOrdin.capacitatiNecesare.map((c) => (
                        <span className="eval-cap" key={c}>
                          {c}
                        </span>
                      ))}
                    </div>
                  )}
                  {evalOrdin.trece && evalOrdin.clasament.length > 0 && (
                    <div className="eval-ai-lista">
                      {evalOrdin.clasament.map((ai) => (
                        <div
                          className={`eval-ai ${ai.cheie === evalOrdin.aiRecomandat ? 'recomandat' : ''}`}
                          key={ai.cheie}
                        >
                          <span
                            className={clasaBec(ai.bec ?? 'gri')}
                            title={
                              ai.bec ? `credit: ${ai.bec}` : 'credit necunoscut'
                            }
                          />
                          <div className="eval-ai-text">
                            <div className="eval-ai-cap">
                              <strong>{ai.nume}</strong>
                              {ai.cheie === evalOrdin.aiRecomandat && (
                                <span className="eval-badge">recomandat</span>
                              )}
                              <span className="eval-potrivire">
                                {ai.potrivire}
                              </span>
                            </div>
                            <div className="eval-ai-desc">{ai.descriere}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="fin-breakdown" style={{ marginTop: 12 }}>
              <div className="fin-breakdown-head">Agent specializat</div>
              <p className="chat-hint">
                Creează un agent prin același sistem A2A și aceeași sesiune
                admin, fără o consolă paralelă.
              </p>
              <form onSubmit={(event) => void addCustomAgent(event)}>
                <div className="fin-row" style={{ flexWrap: 'wrap' }}>
                  <input
                    value={agentName}
                    onChange={(event) => setAgentName(event.target.value)}
                    placeholder="Numele agentului"
                    minLength={3}
                    maxLength={80}
                    required
                  />
                  <textarea
                    value={agentRole}
                    onChange={(event) => setAgentRole(event.target.value)}
                    placeholder="Rolul și limitele agentului"
                    minLength={10}
                    required
                    rows={3}
                    style={{ flex: 1, minWidth: 240 }}
                  />
                </div>
                <label
                  className="chat-hint"
                  style={{ display: 'block', marginTop: 8 }}
                >
                  <input
                    type="checkbox"
                    checked={agentDeep}
                    onChange={(event) => setAgentDeep(event.target.checked)}
                  />{' '}
                  Raționament aprofundat pentru sarcini complexe
                </label>
                <label
                  className="chat-hint"
                  style={{ display: 'block', marginTop: 6 }}
                >
                  <input
                    type="checkbox"
                    checked={agentAdminOnly}
                    onChange={(event) =>
                      setAgentAdminOnly(event.target.checked)
                    }
                  />{' '}
                  Disponibil numai adminului
                </label>
                <button
                  type="submit"
                  className="ghost"
                  disabled={agentBusy}
                  style={{ marginTop: 10 }}
                >
                  {agentBusy ? 'Se creează…' : 'Creează agentul'}
                </button>
              </form>
              {agentMsg && (
                <div className="chat-hint" role="status">
                  {agentMsg}
                </div>
              )}
            </div>
            <div className="fin-breakdown" style={{ marginTop: 12 }}>
              <div
                className="fin-breakdown-head"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                }}
              >
                <span>Coada ordinelor</span>
                <span style={{ display: 'inline-flex', gap: 6 }}>
                  <button
                    type="button"
                    className="ghost"
                    style={{ fontSize: 12 }}
                    onClick={() => {
                      const next = !archiveOpen
                      setArchiveOpen(next)
                      if (next) loadBuildArchive()
                    }}
                  >
                    {archiveOpen ? 'Închide arhiva' : 'Arhivă'}
                  </button>
                  {buildJobsData?.some(
                    (j) => j.status === 'failed' || j.status === 'done' || j.status === 'cancelled',
                  ) && (
                    <button
                      type="button"
                      className="ghost"
                      style={{ fontSize: 12 }}
                      onClick={cleanBuildOrders}
                      title="Arhivează recuperabil numai rândurile terminale vizibile în snapshotul curent"
                    >
                      Curăță rândurile vizibile
                    </button>
                  )}
                </span>
              </div>

              {archiveOpen && (
                <div style={{ margin: '8px 0', padding: 8, border: '1px solid #8884', borderRadius: 8 }}>
                  <b style={{ fontSize: 12 }}>Arhivă recuperabilă</b>
                  {(buildArchive.status === 'idle' || (buildArchive.status === 'loading' && buildArchive.jobs.length === 0)) ? (
                    <div className="chat-hint">Se încarcă arhiva…</div>
                  ) : buildArchive.status === 'error' ? (
                    <div className="chat-hint">Arhiva nu poate fi citită acum.</div>
                  ) : buildArchive.jobs.length === 0 ? (
                    <div className="chat-hint">Arhiva este goală.</div>
                  ) : buildArchive.jobs.map((job) => (
                    <div className="fin-row" key={`archived-${job.id}`} style={{ fontSize: 12 }}>
                      <span>#{job.id} · {job.status} · {job.orderText.slice(0, 90)}</span>
                      <button
                        type="button"
                        className="ghost"
                        disabled={pendingBuildMutations.has(job.id)}
                        onClick={() => restoreBuildOrder(job)}
                      >
                        Restaurează
                      </button>
                    </div>
                  ))}
                  {buildArchive.nextCursor && (
                    <button
                      type="button"
                      className="ghost"
                      disabled={buildArchive.status === 'loading'}
                      onClick={() => loadBuildArchive(buildArchive.nextCursor, true)}
                    >
                      {buildArchive.status === 'loading' ? 'Se încarcă…' : 'Mai vechi'}
                    </button>
                  )}
                  {buildArchive.appendError && (
                    <div className="chat-hint">Pagina următoare nu a putut fi citită; rândurile deja încărcate au fost păstrate.</div>
                  )}
                </div>
              )}

              {constructorWorkerCanStartNow === false && (
                <div className="chat-hint" style={{ color: '#e6a23c' }}>
                  {constructorAcceptingWork
                    ? '⏳ Lanțul Constructor execută deja altă etapă — ordinele noi așteaptă în coadă, fără termen garantat.'
                    : '⏸ Lanțul Constructor nu acceptă lucru acum — ordinele rămân în coadă până când workerul, publisherul și releaserul redevin disponibile.'}
                  {' '}
                  Stare: {constructorId?.state ?? 'unknown'} · {constructorId?.motiv ?? 'stare necitibilă'}
                </div>
              )}

              {buildJobs === 'necitit' && (
                <div className="chat-hint">{A.loading}</div>
              )}
              {buildJobs === null && (
                <div className="chat-hint" style={{ color: '#e6a23c' }}>
                  ⚠ Nu am putut citi coada — citire eșuată, nu coadă goală
                  (reîncerc la 10s).
                </div>
              )}
              {buildJobsData && buildJobsData.length === 0 && (
                <div className="chat-hint">{A.noOrdersYet}</div>
              )}
              {(buildJobsData ?? []).map((j) => (
                <div
                  className="fin-row"
                  key={j.id}
                  style={{ flexWrap: 'wrap' }}
                >
                  <span>
                    <strong>#{j.id}</strong>{' '}
                    <span
                      className={`vis-badge ${constructorHasVerifiedLiveResult(j.status, j.continuity) ? 'human' : ['done', 'failed'].includes(j.status) ? 'kind-demo' : ''}`}
                    >
                       {j.status === 'queued'
                          ? 'în coadă'
                          : j.status === 'running'
                            ? 'lucrează…'
                            : j.status === 'done'
                              ? constructorHasVerifiedLiveResult(j.status, j.continuity)
                                ? 'live și verificat'
                                : 'terminat fără dovadă live'
                              : j.status === 'cancelled'
                                ? 'anulat'
                                : 'eșuat'}
                    </span>{' '}
                    {j.workerTaskUrl && codexTaskUrl(j.workerTaskUrl) ? (
                      <a
                        className="vis-badge human"
                        href={codexTaskUrl(j.workerTaskUrl) ?? undefined}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Codex ↗
                      </a>
                    ) : null}{' '}
                    {j.nume || j.orderText.slice(0, 90)}
                    {(j.nume ?? j.orderText).length > 90 ? '…' : ''}
                  </span>
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    {j.prUrl && (
                      <a href={j.prUrl} target="_blank" rel="noreferrer">
                        PR ↗
                      </a>
                    )}
                    {j.tokens > 0 && (
                      <span>{`· ${Math.round(j.tokens / 1000)}k tok`}</span>
                    )}
                    <span style={{ opacity: 0.7 }}>
                      ·{' '}
                      {new Date(j.updatedAt).toLocaleString('ro-RO', {
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                    {/* REIA — numai rezultate terminale; un ordin deja în coadă nu se resetează. */}
                    {j.retryable && (
                      <button
                        type="button"
                        className="ghost"
                        style={{ fontSize: 12 }}
                        onClick={() => retryBuildOrder(j)}
                        disabled={pendingBuildMutations.has(j.id)}
                        title="Repune ordinul în coadă (îl reia de la zero)"
                      >
                        ↻ reia
                      </button>
                    )}

                    {j.deletable && (
                      <button
                        type="button"
                        className="ghost"
                        style={{ fontSize: 12, color: '#ff7a7a' }}
                        onClick={() => deleteBuildOrder(j)}
                        disabled={pendingBuildMutations.has(j.id)}
                        title="Șterge definitiv ordinul"
                      >
                        ✕
                      </button>
                    )}

                    {constructorJobCanBeCancelled(j.status, j.constructorStage) && (
                      <button
                        type="button"
                        className="ghost"
                        style={{ fontSize: 12, color: '#ff7a7a' }}
                        onClick={() => cancelBuildOrder(j)}
                        disabled={pendingBuildMutations.has(j.id)}
                        title={
                          j.status === 'queued'
                            ? 'Anulează ordinul aflat în coadă'
                            : 'Oprește ordinul aflat în lucru (devine „anulat”)'
                        }
                      >
                        ⏹ oprește
                      </button>
                    )}
                  </span>

                  {j.pct != null && (
                    <div
                      style={{
                        flexBasis: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        marginTop: 4,
                      }}
                    >
                      <div
                        style={{
                          flex: 1,
                          height: 6,
                          borderRadius: 999,
                          background:
                            'color-mix(in srgb, currentColor 12%, transparent)',
                          overflow: 'hidden',
                        }}
                        title={
                          j.progress ||
                          (j.status === 'queued' ? 'în coadă' : '')
                        }
                      >
                        <div
                          style={{
                            width: `${j.pct}%`,
                            height: '100%',
                            borderRadius: 999,
                           background:
                              constructorHasVerifiedLiveResult(j.status, j.continuity)
                                ? '#38b26e'
                                : j.status === 'cancelled'
                                  ? '#7a7a7a'
                                  : '#4a8df0',
                            transition: 'width 0.6s ease',
                          }}
                        />
                      </div>
                      <span
                        style={{
                          fontSize: 11,
                          opacity: 0.8,
                          minWidth: 34,
                          textAlign: 'right',
                        }}
                      >
                        {j.pct}%
                      </span>
                      {j.status === 'running' && j.progress && (
                        <span
                          className="chat-hint"
                          style={{
                            fontSize: 11,
                            maxWidth: '46%',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {j.progress}
                        </span>
                      )}
                    </div>
                  )}
                  {j.continuity && (
                    <div className="chat-hint" style={{ flexBasis: '100%', fontSize: 11, marginTop: 2 }}>
                      <b>
                        {j.continuity.state === 'completed'
                          ? '✓ Dovadă live'
                          : j.continuity.state === 'cancelled'
                            ? 'Cerere anulată'
                            : `Checkpoint: ${j.continuity.checkpoint}`}
                      </b>
                      {' · '}{j.continuity.message}
                      {j.continuity.finalProof.complete && j.continuity.finalProof.liveVersion
                        ? ` · versiune live ${j.continuity.finalProof.liveVersion}`
                        : ''}
                      {j.continuity.nextAction && (
                        <><br />Acțiune necesară: {j.continuity.nextAction}</>
                      )}
                    </div>
                  )}
                  {j.workCard && (
                    <details
                      id={`constructor-work-card-${j.id}`}
                      className="build-progress"
                      style={{ flexBasis: '100%', marginTop: 8 }}
                    >
                      <summary>
                        <b>Fișa canonică {j.workCard.id}</b>
                        {' · '}
                        {j.workCard.progress.source === 'unavailable'
                          ? 'cronologie necitibilă'
                          : j.workCard.currentStep ?? 'pas nepublicat'}
                      </summary>
                      <div className="chat-hint" style={{ marginTop: 6 }}>
                        <b>Obiectiv:</b> {j.workCard.objective}
                        <br />
                        <b>Owner / actor:</b>{' '}
                        {j.workCard.owner ?? 'neatribuit'} / {j.workCard.actor ?? 'în așteptare'}
                        <br />
                        <b>Heartbeat:</b>{' '}
                        {j.workCard.heartbeatAt
                          ? new Date(j.workCard.heartbeatAt).toLocaleString('ro-RO')
                          : 'nepublicat'}
                        {' · '}
                        <b>Evenimente persistente:</b>{' '}
                        {constructorPersistentEventsText(j.workCard.progress, j.workCard.evidence.eventCount)}
                        {j.workCard.escalationCondition && (
                          <><br /><b>Escaladare:</b> {j.workCard.escalationCondition}</>
                        )}
                        {constructorFinalResultText(j.workCard.finalResult) && (
                          <><br /><b>Rezultat:</b> {constructorFinalResultText(j.workCard.finalResult)}</>
                        )}
                      </div>
                      {j.workCard.progress.source === 'unavailable' && (
                        <div className="chat-hint" style={{ color: '#c1121f', marginTop: 6 }}>
                          ⚠ Cronologia persistentă nu poate fi citită; lipsa evenimentelor din această fișă nu este un zero măsurat.
                        </div>
                      )}
                      {j.workCard.acceptanceCriteria.length > 0 && (
                        <ul className="chat-hint">
                          {j.workCard.acceptanceCriteria.map((criterion) => (
                            <li key={criterion}>{criterion}</li>
                          ))}
                        </ul>
                      )}
                      {(j.continuity?.activity ?? []).length > 0 && (
                        <ol className="chat-hint" aria-label={`Cronologia ${j.workCard.id}`}>
                          {(j.continuity?.activity ?? []).map((event) => (
                            <li key={event.id}>
                              <b>{event.label}</b> · {event.percent}% · {event.state}
                              {event.at
                                ? ` · ${new Date(event.at).toLocaleString('ro-RO')}`
                                : ''}
                            </li>
                          ))}
                        </ol>
                      )}
                      {j.workCard.contextLinks.some((link) => /^https?:\/\//.test(link)) && (
                        <div className="chat-hint">
                          {j.workCard.contextLinks
                            .filter((link) => /^https?:\/\//.test(link))
                            .map((link) => (
                              <a key={link} href={link} target="_blank" rel="noreferrer">
                                Dovadă ↗
                              </a>
                            ))}
                        </div>
                      )}
                    </details>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}
        {tab === 'gesturi' && (
          <section className="admin-finance">
            <div className="fin-breakdown">
              <div className="fin-breakdown-head">
                Gesturile lui Kelion — apasă „▶ Arată" ca să-l vezi făcând
                gestul; bifează ce are voie să folosească pe logică/context. Ce
                NU e bifat NU se folosește deloc în aplicație.
                {gestSaved ? ' · salvat ✓' : ''}
                {gestErr && (
                  <span style={{ color: '#ff7a7a' }}> · {gestErr}</span>
                )}
              </div>
              {gestOff === 'necitit' && (
                <div className="chat-hint">{A.loading}</div>
              )}

              {gestOff === null && (
                <div className="chat-hint" style={{ color: '#e6a23c' }}>
                  ⚠ Nu am putut citi starea gesturilor — bifele sunt blocate ca
                  să nu salvez peste o listă necitită. Redeschide tabul.
                </div>
              )}
              {GESTURE_CATEGORIES.map((cat) => (
                <div key={cat}>
                  <div
                    className="fin-breakdown-head"
                    style={{ opacity: 0.7, marginTop: 12 }}
                  >
                    {cat}
                  </div>
                  {GESTURE_CATALOG.filter((g) => g.category === cat).map(
                    (g) => {
                      const on = gestOffData
                        ? !gestOffData.includes(g.clip)
                        : false
                      return (
                        <div className="fin-row" key={g.clip}>
                          <label
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 8,
                              cursor: gestOffData && !gestSaving ? 'pointer' : 'not-allowed',
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={on}
                              disabled={!gestOffData || gestSaving}
                              onChange={() => toggleGesture(g.clip)}
                            />
                            <span style={{ opacity: on ? 1 : 0.5 }}>
                              {g.label}
                            </span>
                          </label>
                          <button
                            type="button"
                            className="ghost"
                            onClick={() => previewAndPeek(g.clip)}
                          >
                            ▶ Arată
                          </button>
                        </div>
                      )
                    },
                  )}
                </div>
              ))}
            </div>
          </section>
        )}
        {tab === 'tokenuri' && (
          <section className="admin-finance">
            {envCheck === 'necitit' && <p className="chat-hint">{A.loading}</p>}
            {envCheck === null && (
              <p className="chat-hint" style={{ color: '#e6a23c' }}>
                ⚠ Nu am putut citi cheile procesului — citire eșuată, NU
                înseamnă că lipsesc. Apasă „Reîmprospătează".
              </p>
            )}
            {envCheckData && (
              <div className="fin-breakdown" style={{ marginBottom: 14 }}>
                <div className="fin-breakdown-head">
                  Ce chei vede serverul CHIAR ACUM —{' '}
                  {envCheckData.summary.total -
                    envCheckData.summary.lipsa -
                    envCheckData.summary.goale}
                  /{envCheckData.summary.total} prezente
                </div>
                <div className="or-wallet-sub">
                  Procesul a pornit la{' '}
                  <strong>
                    {new Date(envCheckData.startedAt).toLocaleString('ro-RO')}
                  </strong>
                  . O cheie scrisă DUPĂ ora asta nu e încărcată până la
                  repornirea containerului — asta e capcana în care „am scris-o
                  de zeci de ori" și „nu o vede" sunt amândouă adevărate.
                </div>
                {envCheckData.orphans.length > 0 && (
                  <div className="fin-row">
                    <span style={{ color: '#e6a23c', fontWeight: 600 }}>
                      ⚠ Chei pe care LE AI, dar sub alt nume:{' '}
                      {envCheckData.orphans.map((n, i) => (
                        <span key={n}>
                          {i > 0 && ', '}
                          <code>{n}</code>
                        </span>
                      ))}
                    </span>
                    <span className="fin-sub">
                      redenumește-le, sau spune-mi și le citesc și așa
                    </span>
                  </div>
                )}
                {envCheckData.vars
                  .filter((v) => !v.present || v.length === 0)
                  .map((v) => (
                    <div className="fin-row" key={v.name}>
                      <span style={{ color: '#e6a23c' }}>
                        ⚠ <code>{v.name}</code> — {v.what}
                      </span>
                      <span
                        className="fin-sub"
                        title={`Nume acceptate: ${v.accepts.join(', ')}`}
                      >
                        {v.present ? 'prezentă dar GOALĂ' : 'nu e în proces'} ·{' '}
                        {v.breaks}
                      </span>
                    </div>
                  ))}
                {envCheckData.summary.lipsa === 0 &&
                  envCheckData.summary.goale === 0 && (
                    <div className="fin-row">
                      <span>
                        ✅ Toate cheile așteptate sunt în procesul care rulează.
                      </span>
                    </div>
                  )}
                {envCheckData.vars
                  .filter((v) => v.present && v.length > 0)
                  .map((v) => (
                    <div className="fin-row" key={v.name}>
                      <span>
                        ✅ <code>{v.name}</code> — {v.what}
                      </span>
                      <span
                        className="fin-sub"
                        title={`Nume acceptate: ${v.accepts.join(', ')}`}
                      >
                        {v.foundAs && v.foundAs !== v.name
                          ? `găsită ca ${v.foundAs} · `
                          : ''}
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
                    void fetchEnvCheck().then(setEnvCheck)
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
              {tokenChecksLoading && (
                <p className="chat-hint">{A.checkingTokens}</p>
              )}
              {!tokenChecksLoading && !tokenChecks && (
                <p className="chat-hint">{A.tokensFailed}</p>
              )}
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
                        {c.status === 'ok'
                          ? '✅'
                          : c.status === 'not_configured'
                            ? '⚪'
                            : '🔴'}{' '}
                        {c.name}
                        {c.detail ? ` — ${c.detail}` : ''}
                      </span>
                      <span
                        className="fin-sub"
                        title={`Drepturi necesare: ${c.requiredScope ?? 'n/a'}`}
                      >
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
            {activity === 'necitit' && <p className="chat-hint">{A.loading}</p>}
            {activity === null && (
              <p className="chat-hint" style={{ color: '#e6a23c' }}>
                ⚠ Nu pot citi activitatea — citirea a eșuat, nu e cont fără
                activitate.{' '}
                <button
                  type="button"
                  className="ghost"
                  onClick={() => void fetchActivity().then(setActivity)}
                >
                  Reîncearcă
                </button>
              </p>
            )}
            <RegistruAudit />
            {activityData && activityData.users.length === 0 && (
              <p className="chat-hint">
                Încă nu s-a strâns activitate pe conturi — se adună de la prima
                intrare a fiecărui utilizator după această actualizare.
              </p>
            )}
            {activityData && activityData.users.length > 0 && (
              <>
                <div className="fin-breakdown">
                  <div className="fin-breakdown-head">
                    Pe utilizator — ultima intrare și cât a stat în total
                  </div>
                  {activityData.users.map((u) => (
                    <div
                      className="vis-row vis-clickable"
                      key={u.email}
                      role="button"
                      tabIndex={0}
                      onClick={() => void openUserConvo(u)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ')
                          void openUserConvo(u)
                      }}
                      title={A.seeWhatTheyWrote}
                    >
                      <div className="vis-main">
                        <span className="vis-flagline">
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
                        <span>{u.sessions} sesiuni</span>
                        <span>timp total {fmtDur(u.seconds)}</span>
                        <span>{u.messages} mesaje</span>
                        <span
                          title={
                            u.scutit
                              ? 'Ownerul e scutit de taxare peste tot — soldul negativ e istoric, dinaintea scutirilor, și nu se mai mișcă. Îl poți aduce la zero din Admin → user → credit (butonul e al tău, mișcă bani).'
                              : undefined
                          }
                        >
                          sold {sym}
                          {u.balance.toFixed(2)}
                          {u.scutit ? ' (scutit — sold istoric)' : ''}
                        </span>

                        <span
                          style={
                            typeof u.consumedUsd === 'number' &&
                            u.consumedUsd > 0 &&
                            u.balance <= 0
                              ? { color: '#e5484d', fontWeight: 600 }
                              : undefined
                          }
                        >
                          consum{' '}
                          {typeof u.consumedUsd === 'number'
                            ? `$${u.consumedUsd.toFixed(2)}`
                            : '—'}
                        </span>
                        {u.blocked && (
                          <span className="user-badge blocked">BLOCAT</span>
                        )}
                      </div>
                      <div
                        className="vis-actions"
                        onClick={(e) => e.stopPropagation()}
                      >
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
                            const r = await manageUser(
                              u.email,
                              u.blocked ? 'unblock' : 'block',
                            )
                            if (r) setActivity(r)
                            else window.alert(A.alertCouldNotPerf)
                          }}
                        >
                          {u.blocked ? 'Deblochează' : 'Blochează'}
                        </button>
                        <button
                          type="button"
                          className="user-act"
                          disabled={!billingUnit}
                          onClick={async () => {
                            if (!billingUnit) return
                            const s = window.prompt(
                              A.promptManualCreditAmount(
                                u.email,
                                billingUnit.currency,
                              ),
                            )
                            if (s == null) return
                            const amount = Number(s.replace(',', '.').trim())
                            const amountMinor = majorToMinor(
                              amount,
                              billingUnit.minorUnit,
                            )
                            if (amountMinor === null || amountMinor <= 0) {
                              window.alert(A.alertInvalidAmount(s))
                              return
                            }
                            const r = await manageUser(
                              u.email,
                              'credit',
                              amountMinor,
                            )
                            if (r) setActivity(r)
                            else window.alert(A.alertNotCredited)
                          }}
                        >
                          Credit
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>
        )}
        {tab === 'share' && (
          <section className="admin-finance">
            {(() => {
              const url = productConfig.publicAppOrigin

              const text = shareText.trim() || SHARE_TEXT_IMPLICIT
              const enc = encodeURIComponent
              const links: { name: string; href: string }[] = [
                {
                  name: 'X (Twitter)',
                  href: `https://twitter.com/intent/tweet?text=${enc(text)}&url=${enc(url)}`,
                },
                {
                  name: 'Facebook',
                  href: `https://www.facebook.com/sharer/sharer.php?u=${enc(url)}&quote=${enc(text)}`,
                },
                {
                  name: 'WhatsApp',
                  href: `https://wa.me/?text=${enc(`${text} ${url}`)}`,
                },
                {
                  name: 'Telegram',
                  href: `https://t.me/share/url?url=${enc(url)}&text=${enc(text)}`,
                },
                // LinkedIn NU acceptă text pre-completat pe share-offsite — doar
                // linkul. Scris pe buton, ca să nu pară stricat când textul „dispare".
                {
                  name: 'LinkedIn (doar linkul)',
                  href: `https://www.linkedin.com/sharing/share-offsite/?url=${enc(url)}`,
                },
                {
                  name: 'Reddit',
                  href: `https://www.reddit.com/submit?url=${enc(url)}&title=${enc(text)}`,
                },
              ]
              const uploads: { name: string; href: string }[] = [
                {
                  name: 'TikTok — încarcă clip',
                  href: 'https://www.tiktok.com/tiktokstudio/upload',
                },
                { name: 'Instagram', href: 'https://www.instagram.com/' },
                { name: 'YouTube Studio', href: 'https://studio.youtube.com/' },
                {
                  name: 'Facebook Reels',
                  href: 'https://www.facebook.com/reels/create',
                },
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
                          void navigator.clipboard
                            .writeText(`${text} ${url}`)
                            .then(() => {
                              setCopied(true)
                              window.setTimeout(() => setCopied(false), 1800)
                            })
                            .catch(() => {
                              setCopied(false)
                              window.alert(
                                'Nu s-a putut copia (browserul a refuzat clipboard-ul) — copiază manual textul.',
                              )
                            })
                        }}
                      >
                        {copied ? 'Copiat ✓' : 'Copiază text + link'}
                      </button>
                      {'share' in navigator && (
                        <button
                          type="button"
                          className="ghost"
                          onClick={() =>
                            void navigator
                              .share({ title: 'Kelionai', text, url })
                              .catch(() => {})
                          }
                        >
                          Distribuie…
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="fin-breakdown">
                    <div className="fin-breakdown-head">
                      Mesajul tău de prezentare — îl scrii o dată, îl folosesc
                      toate butoanele de mai jos. Se salvează în browserul ăsta.
                    </div>
                    <textarea
                      className="admin-input"
                      style={{
                        width: '100%',
                        minHeight: 64,
                        resize: 'vertical',
                      }}
                      value={shareText}
                      onChange={(e) => salveazaShareText(e.target.value)}
                      placeholder={SHARE_TEXT_IMPLICIT}
                    />
                    {shareText !== SHARE_TEXT_IMPLICIT && (
                      <button
                        type="button"
                        className="ghost"
                        style={{ fontSize: 12, marginTop: 6 }}
                        onClick={() => salveazaShareText(SHARE_TEXT_IMPLICIT)}
                      >
                        Revino la mesajul standard
                      </button>
                    )}
                  </div>
                  <ShareGrid title={A.shareOnSocial} items={links} />
                  <div className="fin-breakdown">
                    <div className="fin-breakdown-head">
                      Clipul promo — fluxul real, pas cu pas: (1) îi ceri lui
                      Kelion în chat „pregătește clipul promo" — îl compune și
                      ți-l salvează în Downloads; (2) deschizi studioul
                      platformei de mai jos; (3) urci clipul din Downloads
                      acolo. Butoanele DOAR deschid studiourile — nicio
                      platformă nu permite încărcare automată din afară.
                    </div>
                  </div>
                  <ShareGrid title={A.videoPlatforms} items={uploads} />
                </>
              )
            })()}
          </section>
        )}
      </div>
      {userConvo && (
        <div className="convo-overlay" onClick={closeUserConvo}>
          <div className="convo-panel" onClick={(e) => e.stopPropagation()}>
            <header className="admin-head">
              <div className="convo-title">
                <strong>{userConvo.u.email}</strong>
                <span className="convo-sub">
                  {userConvo.u.sessions} sesiuni · timp total{' '}
                  {fmtDur(userConvo.u.seconds)} · {userConvo.u.messages} mesaje
                </span>
              </div>
              <div className="convo-head-actions">
                <button
                  type="button"
                  className="user-act"
                  disabled={roBusy || (userConvo.rows?.length ?? 0) === 0}
                  title={A.translateToRo}
                  onClick={() => void toggleRo(userConvo.rows ?? [])}
                >
                  {roBusy
                    ? 'Traduc…'
                    : roOn
                      ? 'Arată originalul'
                      : '🌐 Tradu în română'}
                </button>
                {roOn && roFailed > 0 && (
                  <span className="chat-hint" style={{ color: '#d97706' }}>
                    ⚠ {roFailed} netraduse
                  </span>
                )}

                <button
                  type="button"
                  className="ghost"
                  onClick={closeUserConvo}
                >
                  Închide
                </button>
              </div>
            </header>
            <div className="admin-history convo-body">
              {userConvoLoading && <p className="chat-hint">{A.loading}</p>}

              {!userConvoLoading && userConvo.rows === null && (
                <p className="chat-hint" style={{ color: '#e6a23c' }}>
                  ⚠ {A.historyReadFail}
                </p>
              )}
              {!userConvoLoading &&
                userConvo.rows !== null &&
                userConvo.rows.length === 0 && (
                  <p className="chat-hint">{A.noMessagesYet}</p>
                )}
              {!userConvoLoading &&
                groupByDay(userConvo.rows ?? []).map((g) => (
                  <div key={g.header} className="admin-day">
                    <div className="admin-day-header">{g.header}</div>
                    {g.rows.map((h, i) => (
                      <div
                        key={i}
                        className={`bubble ${h.role === 'user' ? 'user' : 'assistant'}`}
                      >
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
