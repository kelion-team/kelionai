import {
  Suspense,
  lazy,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import ChatPanel from '../components/ChatPanel'
import { DeployProgressBar } from '../components/DeployProgressBar'
import ContactModal from '../components/ContactModal'
import CustomerSettings from '../components/CustomerSettings'
import CvAdaptation from '../components/CvAdaptation'
import { WalletButton } from '../components/WalletButton'
import { CardView } from '../components/CardView'
import type { User } from '../lib/api'
import { usePolledJson } from '../lib/usePolledJson'
import { logout } from '../lib/api'
import { resolveLang, strings, uiStrings, type Lang } from '../lib/i18n'
import { adminStrings } from '../lib/adminText'
import {
  fetchCreditAI,
  clasaBec,
  isAdminTab,
  type AdminTab,
  type CreditAIFurnizor,
  type OpenAIHealthClass,
} from '../lib/admin'
import {
  getWorkspace,
  subscribeWorkspace,
  openWorkspace,
  closeTasksByKind,
  closeTask,
  closeAllTasks,
  switchToId,
  embedPolicy,
  documentFramePolicy,
  izoleazaHtmlPlayground,
  setMonitorWorking,
  setTaskStatus,
  setStareTranzactii,
  getStareExecutie,
  type PunctGrafic,
} from '../lib/workspace'
import { startRecording, type RecordingHandle } from '../lib/recorder'
import {
  loadServerPrefs,
  saveAvatarBox,
  loadLocalLang,
  saveSpeechLang,
  revendicaOglindaLimbii,
  mirrorLang,
} from '../lib/prefs'
import { keepScreenOn } from '../lib/wakelock'
import { renderMarkdown } from '../lib/markdown'
import { currentTheme, toggleTheme, type ThemeName } from '../lib/theme'
import { isCarMode, subscribeCarMode } from '../lib/carMode'
import { useConectat } from '../lib/conexiune'
import { reteaLenta } from '../lib/retea'
import ApelOverlay from '../components/ApelOverlay'
import { pornestePrezentaApel, oprestePrezentaApel } from '../lib/apel'
import { initiazaAudioSpatial, resumeAudioSpatial } from '../lib/audioSpatial'
import {
  pornesteMuzica,
  opresteMuzica,
  schimbaDispozitie,
  type DispozitieMuzicala,
} from '../lib/companionCreativ'
import { apiFetch } from '../lib/transport'
import { productConfig } from '../lib/productConfig'
import { scopedClientKey } from '../lib/clientState'
import { trustedTradingMessage } from '../lib/tradingBridge'
import {
  constructorCiText,
  constructorHasVerifiedLiveResult,
  constructorJobsFromSnapshot,
  constructorPersistentEventsText,
  isConstructorContinuity,
  isConstructorWorkCard,
  type ConstructorContinuity,
  type ConstructorJobStatus,
  type ConstructorWorkCard,
} from '../lib/constructorContract'

// linia aia pui butoanele astea") ────────────────────────────────────────────
// Un rând mic de becuri (unul per AI) în bara de admin, în locul lăsat liber de
// pastila VPS (mutată sub Admin). Verde/roșu/gri vine derivat de pe server
// (aceeași sursă ca panoul Bani — nicio logică dublată). Click = deschide Bani,
// unde e boardul întreg + reîncărcarea. Când ceva e roșu (fără credit), apare

function BecuriBara() {
  const [rows, setRows] = useState<CreditAIFurnizor[] | null>(null)
  useEffect(() => {
    let viu = true
    const citeste = (): void => {
      void fetchCreditAI().then((r) => {
        if (viu && r) setRows(r)
      })
    }
    citeste()
    const t = setInterval(citeste, 60_000)
    return () => {
      viu = false
      clearInterval(t)
    }
  }, [])
  if (!rows || rows.length === 0) return null
  const rosii = rows.filter((r) => r.bec === 'rosu').length
  const A = adminStrings()

  // DIRECT; să muți alea în aplicații"): fiecare bec e PROPRIUL link spre aplicația de
  // facturare a furnizorului — NU un buton comun spre panoul intern. Verde/roșu/gri vine
  // de pe server (fără logică dublată). Numărul roșu = câți sunt fără credit.
  const eticheta = (r: CreditAIFurnizor): string =>
    `${r.furnizor} — ${r.bec === 'rosu' ? A.becuriReincarca : r.bec === 'verde' ? A.becuriServeste : A.becuriNecunoscut}`
  return (
    <span
      className={`becuri-bara${rosii > 0 ? ' are-rosu' : ''}`}
      title={A.becuriBaraTitlu}
    >
      {rows.map((r) => {
        const nume = r.furnizor.split(' (')[0]
        return r.facturare ? (
          <a
            key={r.furnizor}
            className="becuri-bec-link"
            href={r.facturare}
            target="_blank"
            rel="noreferrer"
            title={eticheta(r)}
          >
            <span className={clasaBec(r.bec)} aria-hidden="true" />
            <span className="becuri-bec-nume">{nume}</span>
          </a>
        ) : (
          <span
            key={r.furnizor}
            className="becuri-bec-link becuri-bec-static"
            title={eticheta(r)}
          >
            <span className={clasaBec(r.bec)} aria-hidden="true" />
            <span className="becuri-bec-nume">{nume}</span>
          </span>
        )
      })}

      <span className={`becuri-bara-nr${rosii > 0 ? '' : ' toate-ok'}`}>
        {rosii > 0 ? `${rosii}/${rows.length}` : rows.length}
      </span>
    </span>
  )
}

const StageAvatar = lazy(() => import('../components/StageAvatar'))
const AdminPanel = lazy(() => import('../components/AdminPanel'))

function downloadContent(name: string, content: string, mime: string): boolean {
  try {
    const blob = new Blob([content], { type: mime })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 4000)
    return true
  } catch (e) {
    console.error('[doc] descărcarea a picat:', String(e).slice(0, 160))
    return false
  }
}

function DocFrame({
  title,
  src,
  taskId,
  sandbox,
}: {
  title: string
  src: string
  taskId: string
  sandbox: string
}): React.JSX.Element {
  return (
    <iframe
      title={title}
      src={src}
      className="workspace-frame"
      sandbox={sandbox}
      referrerPolicy="no-referrer"
      style={{ background: '#fff' }}
      onLoad={() => setTaskStatus(taskId, 'ok')}
      onError={() => setTaskStatus(taskId, 'error')}
    />
  )
}

function MonitorDocument({
  url,
  title,
  taskId,
  kind,
}: {
  url: string
  title: string
  taskId: string
  kind: 'pdf' | 'office'
}): React.JSX.Element {
  const policy = documentFramePolicy(url, kind)
  useEffect(() => {
    if (!policy) setTaskStatus(taskId, 'error')
  }, [policy, taskId])
  if (!policy) return <MonitorFileBlocked url={url} />
  return (
    <DocFrame
      title={title}
      src={policy.src}
      taskId={taskId}
      sandbox={policy.sandbox}
    />
  )
}

// ── One road from URL to content for EVERY file on the monitor ─────────────
// Text, markdown and saved-html all did the same dance — fetch, keep-alive
// guard, `ok`/`error` reported to get_monitor, identical failure screen —
// copied three times. Now the dance lives ONCE here; each format keeps only
// what really differs: its transform and its rendering.
function useMonitorFile(
  url: string,
  taskId: string,
  transform: (t: string) => string,
): { data: string | null; failed: boolean } {
  const [data, setData] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let alive = true
    setData(null)
    setFailed(false)
    apiFetch(url)
      .then((r) =>
        r.ok ? r.text() : Promise.reject(new Error(String(r.status))),
      )
      .then((t) => {
        if (alive) {
          setData(transform(t))
          setTaskStatus(taskId, 'ok')
        }
      })
      .catch(() => {
        if (alive) {
          setFailed(true)
          setTaskStatus(taskId, 'error')
        }
      })
    return () => {
      alive = false
    }
    // transform stays OUT of the deps on purpose: callers pass it inline, so
    // its identity changes every render — including it would refetch forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, taskId])
  return { data, failed }
}

function MonitorFileBlocked({ url }: { url: string }): React.JSX.Element {
  return (
    <div className="workspace-blocked">
      <p>{uiStrings().wsFileFailed}</p>
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="workspace-action"
      >
        {uiStrings().wsOpenFile}
      </a>
    </div>
  )
}

function MonitorTextFile({
  url,
  zoom,
  taskId,
}: {
  url: string
  zoom: number
  taskId: string
}) {
  const { data: text, failed } = useMonitorFile(url, taskId, (t) =>
    t.slice(0, 500_000),
  )
  if (failed) return <MonitorFileBlocked url={url} />
  return (
    <div className="workspace-doc">
      <pre
        className="doc-text"
        style={{
          fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
          fontSize: `${0.92 * zoom}em`,
        }}
      >
        {text ?? uiStrings().buildLoading}
      </pre>
    </div>
  )
}

function MonitorMarkdown({
  url,
  zoom,
  taskId,
}: {
  url: string
  zoom: number
  taskId: string
}) {
  const { data: html, failed } = useMonitorFile(url, taskId, (t) =>
    renderMarkdown(t.slice(0, 500_000)),
  )
  if (failed) return <MonitorFileBlocked url={url} />
  return (
    <div className="workspace-doc">
      {html === null ? (
        <pre className="doc-text">{uiStrings().buildLoading}</pre>
      ) : (
        // eslint-disable-next-line react/no-danger -- renderMarkdown escapes the source first
        <div
          className="doc-text md-view"
          style={{ fontSize: `${zoom}em` }}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
    </div>
  )
}

function MonitorHtmlFile({ url, taskId }: { url: string; taskId: string }) {
  const { data: doc, failed } = useMonitorFile(url, taskId, (t) => t)
  if (failed) return <MonitorFileBlocked url={url} />
  if (doc === null)
    return (
      <div className="workspace-doc">
        <pre className="doc-text">{uiStrings().buildLoading}</pre>
      </div>
    )
  return (
    <iframe
      title={url}
      srcDoc={izoleazaHtmlPlayground(doc)}
      className="workspace-frame"
      sandbox="allow-scripts allow-pointer-lock"
      referrerPolicy="no-referrer"
    />
  )
}

function MediaFailed({ url }: { url: string }) {
  const [cauza, setCauza] = useState<string | null>(null)
  useEffect(() => {
    let viu = true
    void apiFetch(url, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
    })
      .then((r) => {
        void r.body?.cancel()
        if (viu)
          setCauza(
            r.ok
              ? null
              : `HTTP ${r.status}${r.status === 404 || r.status === 410 ? ' — fișierul nu mai există' : ''}`,
          )
      })
      .catch(() => {
        if (viu) setCauza('rețea')
      })
    return () => {
      viu = false
    }
  }, [url])
  return (
    <div className="workspace-blocked">
      <p>
        {uiStrings().wsMediaFailed}
        {cauza ? ` (${cauza})` : ''}
      </p>
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="workspace-action"
      >
        {uiStrings().wsOpenFile}
      </a>
    </div>
  )
}

function useMediaFallback(
  url: string,
  taskId: string,
): { failed: boolean; onOk: () => void; onErr: () => void } {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [url])
  return {
    failed,
    onOk: () => setTaskStatus(taskId, 'ok'),
    onErr: () => {
      setFailed(true)
      setTaskStatus(taskId, 'error')
    },
  }
}

function MonitorImage({
  url,
  title,
  taskId,
}: {
  url: string
  title: string
  taskId: string
}) {
  const { failed, onOk, onErr } = useMediaFallback(url, taskId)
  if (failed) return <MediaFailed url={url} />
  return (
    <div
      className="workspace-doc"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--panel-solid)',
      }}
    >
      <img
        src={url}
        alt={title}
        style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
        onLoad={onOk}
        onError={onErr}
      />
    </div>
  )
}

function MonitorVideo({
  url,
  title,
  taskId,
}: {
  url: string
  title: string
  taskId: string
}) {
  const { failed, onOk, onErr } = useMediaFallback(url, taskId)
  if (failed) return <MediaFailed url={url} />

  const numeFisier = `${(title || 'Clip').replace(/[^\w-]+/g, '-')}.mp4`
  return (
    <div
      className="workspace-doc"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        background: '#000',
      }}
    >
      <video
        src={url}
        controls
        style={{ maxWidth: '100%', maxHeight: '90%' }}
        onLoadedData={onOk}
        onError={onErr}
      />
      <a
        className="workspace-action"
        href={url}
        download={numeFisier}
        style={{ textDecoration: 'none' }}
      >
        ⬇ Salvează în Download ({numeFisier})
      </a>
    </div>
  )
}

function MonitorAudio({ url, taskId }: { url: string; taskId: string }) {
  const { failed, onOk, onErr } = useMediaFallback(url, taskId)
  if (failed) return <MediaFailed url={url} />
  return (
    <div
      className="workspace-doc"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <audio
        src={url}
        controls
        style={{ width: '100%', maxWidth: 520 }}
        onLoadedData={onOk}
        onError={onErr}
      />
    </div>
  )
}

// Numai suprafețele din allowlist primesc iframe. Pentru orice altă pagină,
// serverul extrage textul cu garda SSRF a cititorului; dacă nu poate, monitorul
// oferă cinstit link extern și raportează starea de eroare.
function MonitorPagina({
  url,
  title,
  taskId,
  kind,
}: {
  url: string
  title: string
  taskId: string
  kind: string
}) {
  const [blocat, setBlocat] = useState(false)
  const [citita, setCitita] = useState<{ titlu: string; html: string } | null>(
    null,
  )
  const [citind, setCitind] = useState(false)
  const [motivNecitit, setMotivNecitit] = useState<string | null>(null)
  const policy = embedPolicy(url, kind)
  useEffect(() => {
    setBlocat(false)
    setCitita(null)
    setCitind(false)
    setMotivNecitit(null)
    if (embedPolicy(url, kind)) return
    setBlocat(true)
    setTaskStatus(taskId, 'error')
    if (!/^https?:\/\//i.test(url)) {
      setMotivNecitit('adresa nu este pe lista de suprafețe înrămabile')
      return
    }
    let viu = true
    setCitind(true)
    apiFetch('/api/citeste-pagina', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    })
      .then(async (r) => {
        if (!viu) return
        if (r.ok) {
          const j = (await r.json()) as { titlu?: string; text?: string }
          if (j.text) {
            setCitita({
              titlu: j.titlu ?? title,
              html: renderMarkdown(j.text.slice(0, 500_000)),
            })
            setTaskStatus(taskId, 'ok')
            return
          }
        }
        const j = (await r.json().catch(() => null)) as {
          motiv?: string
        } | null
        setMotivNecitit(j?.motiv ?? `serverul a răspuns ${r.status}`)
      })
      .catch(() => {
        if (viu) setMotivNecitit('cititorul server-side nu este disponibil')
      })
      .finally(() => {
        if (viu) setCitind(false)
      })
    return () => {
      viu = false
    }
  }, [url, kind, taskId, title])
  if (blocat) {
    return (
      <div className={citita ? 'workspace-doc' : 'workspace-blocked'}>
        <p style={{ marginBottom: 8 }}>
          {/^https?:\/\//i.test(url) && (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="workspace-action"
            >
              {uiStrings().wsOpenTab}
            </a>
          )}
        </p>
        {citita ? (
          <>
            <h2 style={{ marginTop: 0 }}>{citita.titlu}</h2>
            {/* eslint-disable-next-line react/no-danger -- renderMarkdown escapes the source first */}
            <div dangerouslySetInnerHTML={{ __html: citita.html }} />
          </>
        ) : citind ? (
          <p>⏳ {title}…</p>
        ) : (
          <>
            <p>{uiStrings().wsPageBlocked}</p>
            {motivNecitit && (
              <p style={{ opacity: 0.75, fontSize: 13 }}>({motivNecitit})</p>
            )}
          </>
        )}
      </div>
    )
  }
  if (!policy) return <></>
  return (
    <iframe
      title={title}
      src={policy.src}
      className="workspace-frame"
      data-kelion-kind={kind}
      sandbox={policy.sandbox}
      onLoad={() => setTaskStatus(taskId, 'ok')}
      onError={() => setTaskStatus(taskId, 'error')}
      allow={policy.allow}
    />
  )
}

interface BuildLiveJob {
  id: number
  status: ConstructorJobStatus
  stage: string
  order: string

  cerutDe?: string
  progress: string | null
  ci?: string | null
  prUrl: string | null
  attempts: number
  updatedAt: string

  pct?: number | null
  continuity?: ConstructorContinuity
  workCard?: ConstructorWorkCard | null
}

const isBuildLiveJob = (input: unknown): input is BuildLiveJob => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false
  const value = input as Record<string, unknown>
  return Number.isSafeInteger(value.id)
    && Number(value.id) > 0
    && ['queued', 'running', 'done', 'failed', 'cancelled'].includes(String(value.status ?? ''))
    && typeof value.stage === 'string'
    && typeof value.order === 'string'
    && (value.cerutDe === undefined || typeof value.cerutDe === 'string')
    && (value.progress === null || typeof value.progress === 'string')
    && (value.ci === undefined || value.ci === null || typeof value.ci === 'string')
    && (value.prUrl === null || typeof value.prUrl === 'string')
    && Number.isSafeInteger(value.attempts)
    && Number(value.attempts) >= 0
    && typeof value.updatedAt === 'string'
    && Number.isFinite(Date.parse(value.updatedAt))
    && (value.pct === undefined || value.pct === null || (typeof value.pct === 'number'
      && Number.isFinite(value.pct) && value.pct >= 0 && value.pct <= 100))
    && (value.continuity === undefined || isConstructorContinuity(value.continuity))
    && (value.workCard === undefined || value.workCard === null || isConstructorWorkCard(value.workCard))
}

const buildLabel = (status: string): string => {
  const t = uiStrings()
  const map: Record<string, string> = {
    queued: t.buildQueued,
    running: t.buildRunning,
    done: t.buildDone,
    failed: t.buildFailed,
    cancelled: t.buildCancelled,
  }
  return map[status] ?? status
}
function BuildSurface({ zoom }: { zoom: number }) {
  const [jobs, setJobs] = useState<BuildLiveJob[]>([])
  const [note, setNote] = useState('')
  const [readState, setReadState] = useState<'loading' | 'ready' | 'error'>('loading')

  const [opresc, setOpresc] = useState<ReadonlySet<number>>(new Set())
  const oprescRef = useRef(new Set<number>())
  const opreste = async (job: BuildLiveJob): Promise<void> => {
    const id = job.id
    if (oprescRef.current.has(id)) return
    if (
      !window.confirm(uiStrings().buildStopConfirm.replace('{n}', String(id)))
    )
      return
    oprescRef.current.add(id)
    setOpresc(new Set(oprescRef.current))
    try {
      const r = await apiFetch(`/api/admin/constructor/${id}/anuleaza`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ expectedStatus: job.status, expectedUpdatedAt: job.updatedAt }),
      })
      const body = await r.json().catch(() => null) as { ok?: boolean } | null
      if (r.ok && body?.ok === true) {
        setJobs((js) =>
          js.map((j) =>
            j.id === id
              ? { ...j, status: 'cancelled', progress: 'cancelled_by_admin' }
              : j,
          ),
        )
      } else {
        setNote(uiStrings().buildUnavailable)
      }
    } catch {
      setNote(uiStrings().buildNoServer)
    } finally {
      oprescRef.current.delete(id)
      setOpresc(new Set(oprescRef.current))
    }
  }
  useEffect(() => {
    let alive = true
    let timer: number | undefined
    async function tick(): Promise<void> {
      try {
        const r = await apiFetch('/api/constructor/live', {
          credentials: 'include',
        })
        if (!alive) return
        if (r.status === 401) {
          setNote(uiStrings().sessionExpired)
          setReadState('error')
        } else if (r.status === 403) {
          setNote(uiStrings().buildOnlyAdmin)
          setReadState('error')
        } else if (!r.ok) {
          setNote(uiStrings().buildUnavailable)
          setReadState('error')
        } else {
          const snapshotJobs = constructorJobsFromSnapshot<BuildLiveJob>(
            await r.json(),
            isBuildLiveJob,
          )
          if (!alive) return
          if (snapshotJobs === null) {
            setNote(uiStrings().buildUnavailable)
            setReadState('error')
          } else {
            setNote('')
            setJobs(snapshotJobs)
            setReadState('ready')
          }
        }
      } catch {
        if (alive) {
          setNote(uiStrings().buildNoServer)
          setReadState('error')
        }
      } finally {
        if (alive) timer = window.setTimeout(() => void tick(), 2500)
      }
    }
    void tick()
    return () => {
      alive = false
      if (timer) window.clearTimeout(timer)
    }
  }, [])
  return (
    <div
      className="workspace-doc build-surface"
      style={{ fontSize: `${zoom}em` }}
    >
      <div className="build-head">{uiStrings().buildHead}</div>
      {readState === 'loading' ? (
        <p className="build-empty">{uiStrings().buildLoading}</p>
      ) : note ? (
        <p className="build-empty">{note}</p>
      ) : readState === 'error' ? (
        <p className="build-empty">{uiStrings().buildUnavailable}</p>
      ) : jobs.length === 0 ? (
        <p className="build-empty">{uiStrings().buildEmpty}</p>
      ) : (
        <ul className="build-list">
          {jobs.map((j) => (
            <li key={j.id} className={`build-item build-${j.status === 'done' && !constructorHasVerifiedLiveResult(j.status, j.continuity) ? 'unverified' : j.status}`}>
              <div className="build-row">
                {/* THE QUOTA PAUSE, VISIBLE (D6): a postponed order stays „running” in
                the database — correct, it's not lost — but on screen it looked identical
                to a working one, with the step frozen for 40 minutes. The worker marks
                the pause with „⏳”; here it becomes its own badge. */}
                {j.progress?.startsWith('⏳') ? (
                  <span className="build-badge build-badge-queued">
                    {uiStrings().buildThrottled}
                  </span>
                ) : (
                  <span className={`build-badge build-badge-${j.status === 'done' && !constructorHasVerifiedLiveResult(j.status, j.continuity) ? 'unverified' : j.status}`}>
                    {j.status === 'done' && !constructorHasVerifiedLiveResult(j.status, j.continuity)
                      ? uiStrings().buildDoneUnverified
                      : buildLabel(j.status)}
                  </span>
                )}
                {/* The INDEPENDENT verification's verdict (Stage 6): „Gata” proven by CI. */}
                {j.ci === 'green' ? (
                  <span
                    className="build-ci build-ci-ok"
                    title={uiStrings().buildCiOk}
                  >
                    CI ✓
                  </span>
                ) : j.ci === 'pr_checks_green' ? (
                  <span
                    className="build-ci build-ci-wait"
                    title="Verificările PR sunt verzi; push CI și artefactul release nu sunt încă dovedite"
                  >
                    PR ✓
                  </span>
                ) : j.ci === 'red' ? (
                  <span
                    className="build-ci build-ci-bad"
                    title={uiStrings().buildCiFailed}
                  >
                    CI ✗
                  </span>
                ) : j.ci === 'in_progress' ? (
                  <span
                    className="build-ci build-ci-wait"
                    title={uiStrings().buildCiRunning}
                  >
                    CI…
                  </span>
                ) : j.ci === 'local_gates' ? (
                  <span
                    className="build-ci build-ci-wait"
                    title="Porțile locale au trecut; verificările independente GitHub urmează."
                  >
                    porți locale ✓
                  </span>
                ) : null}
                <span className="build-order">
                  #{j.id} — {j.order}
                </span>

                {j.cerutDe && (
                  <span className="build-ci" title="cine a cerut ordinul">
                    {j.cerutDe}
                  </span>
                )}

                {((j.status === 'queued' && j.stage === 'queued')
                  || (j.status === 'running'
                    && ['claimed', 'accepted', 'working'].includes(j.stage))) && (
                  <button
                    type="button"
                    className="build-stop"
                    onClick={() => void opreste(j)}
                    disabled={opresc.has(j.id)}
                    aria-label={uiStrings().buildStop}
                    title={uiStrings().buildStop}
                  >
                    ×
                  </button>
                )}
              </div>

              {j.workCard && (
                <section id={`constructor-work-card-${j.id}`} className="build-progress" aria-label={`Fisa de lucru ${j.workCard.id}`}>
                  <a href={j.workCard.canonicalLink}><strong>{j.workCard.id}</strong></a>
                  {j.workCard.currentStep && <span> · {j.workCard.currentStep}</span>}
                  {j.workCard.heartbeatAt && <time dateTime={j.workCard.heartbeatAt}> · heartbeat {new Date(j.workCard.heartbeatAt).toLocaleTimeString()}</time>}
                  <details>
                    <summary>Fisa canonica de lucru</summary>
                    <div>Actor: {j.workCard.actor ?? 'in asteptare'}</div>
                    <div>Acceptare: {j.workCard.acceptanceCriteria.join(' · ')}</div>
                    <div>Plan: {j.workCard.plan.map((step) => `${step.label} [${step.state}]`).join(' · ')}</div>
                    {j.workCard.contextLinks.map((link) => <div key={link}><a href={link} target="_blank" rel="noreferrer">Sursa</a></div>)}
                    <div>Dovezi: evenimente {constructorPersistentEventsText(j.workCard.progress, j.workCard.evidence.eventCount)}{j.workCard.evidence.prUrl ? ' · PR atasat' : ''}{constructorCiText(j.workCard.evidence.ci) ? ` · ${constructorCiText(j.workCard.evidence.ci)}` : ''}</div>
                    {j.workCard.risks.length > 0 && <div>Riscuri: {j.workCard.risks.join(' · ')}</div>}
                    {j.workCard.dependencies.length > 0 && <div>Dependente: {j.workCard.dependencies.join(' · ')}</div>}
                    <div>Escaladare: {j.workCard.escalationCondition}</div>
                  </details>
                </section>
              )}
              {j.status === 'failed' ? (
                <div className="build-fail">
                  ✗ Eșuat{j.progress ? ` — ${j.progress}` : ''}
                </div>
              ) : j.status === 'cancelled' ? (
                <div className="build-progress">■ {uiStrings().buildCancelled}</div>
              ) : (
                <>
                  {typeof j.pct === 'number' && (
                    <div
                      className="build-bar"
                      role="progressbar"
                      aria-valuenow={j.pct}
                      aria-valuemin={0}
                      aria-valuemax={100}
                    >
                      <div
                        className="build-bar-fill"
                        style={{ width: `${j.pct}%` }}
                      />
                      <span className="build-bar-num">{j.pct}%</span>
                    </div>
                  )}
                  {j.continuity?.activity && j.continuity.activity.length > 0 && (
                    <ol className="build-faze" aria-label="Istoricul real al executiei">
                      {j.continuity.activity.map((event) => (
                        <li
                          key={event.id}
                          className={`build-faza ${event.state === 'completed' || event.state === 'resolved' ? 'ok' : ''} ${event.state === 'current' || event.state === 'recovery' ? 'activ' : ''}`}
                        >
                          <span>{event.label}</span>
                          {typeof event.percent === 'number' && <span> {event.percent}%</span>}
                          <time dateTime={event.at}> {new Date(event.at).toLocaleTimeString()}</time>
                        </li>
                      ))}
                    </ol>
                  )}
                </>
              )}
              {j.progress && j.status !== 'failed' && j.status !== 'cancelled' ? (
                <div className="build-progress">
                  {j.status === 'running' && (
                    <span className="build-spin" aria-hidden>
                      ●
                    </span>
                  )}
                  {j.progress}
                </div>
              ) : !j.progress && j.status === 'queued' ? (
                <div className="build-progress build-progress-dim">
                  {uiStrings().buildWaiting}
                </div>
              ) : null}
              {(j.attempts > 1 || j.prUrl) && (
                <div className="build-meta">
                  {j.attempts > 1 && (
                    <span>
                      {uiStrings().buildAttempt.replace(
                        '{n}',
                        String(j.attempts),
                      )}
                    </span>
                  )}
                  {j.prUrl && (
                    <a
                      href={j.prUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="build-pr"
                    >
                      {uiStrings().buildSeePr}
                    </a>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

const PUNCTE_TOTAL = 200
const PUNCTE_PE_GRUP = 25
function ExecutieSurface({ zoom }: { zoom: number }) {
  const stare = useSyncExternalStore(subscribeWorkspace, getStareExecutie)
  const t = uiStrings()
  const procent = stare?.procent ?? 0
  const aprinse = Math.round(procent / 0.5) // fiecare punct = 0,5%
  const grupuri = Array.from(
    { length: PUNCTE_TOTAL / PUNCTE_PE_GRUP },
    (_, g) => g,
  )
  return (
    <div
      className="workspace-doc exec-surface"
      style={{ fontSize: `${zoom}em` }}
    >
      <div className="build-head">{t.execTitle}</div>
      <div
        className="exec-bar"
        role="progressbar"
        aria-valuenow={procent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${procent}%`}
      >
        {grupuri.map((g) => (
          <span key={g} className="exec-grup" aria-hidden>
            {Array.from({ length: PUNCTE_PE_GRUP }, (_, i) => {
              const idx = g * PUNCTE_PE_GRUP + i
              return (
                <span
                  key={idx}
                  className={`exec-punct ${idx < aprinse ? 'plin' : ''}`}
                />
              )
            })}
          </span>
        ))}
        <span className="exec-procent">{procent}%</span>
      </div>
      <ul className="exec-pasi">
        {(stare?.pasi ?? []).map((p) => (
          <li key={p.la + p.text} className="exec-pas">
            <span className="exec-pas-ora">
              {new Date(p.la).toLocaleTimeString()}
            </span>{' '}
            {p.text}
          </li>
        ))}
      </ul>
      {stare?.gata && <div className="exec-gata">✓ 100%</div>}
    </div>
  )
}

// Safe file name from the panel title (diacritics/spaces → dashes).
function safeFileName(title: string, ext: string): string {
  const base =
    (title || 'kelion')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'kelion'
  return `${base}.${ext}`
}

export interface BrainCredit {
  active: string | null

  serper?: {
    live: boolean
    balance?: number
    rateLimit?: number
    error?: string
  }

  openai?: {
    checked: boolean
    serving: boolean
    status: number | null
    class: OpenAIHealthClass
    action?: string
    monthUsd?: number
    sold?: number
    soldMoneda?: string
    soldMotiv?: string
  }

  vps?: {
    totalGb: number
    liberGb: number
    liberPct: number
    procesoare: number
    incarcare: [number, number, number]
    incarcarePct: number
    pragMemoriePct?: number
    pragIncarcarePct?: number
  } | null
}

export default function Stage({
  user,
  offline = false,
}: {
  user: User
  offline?: boolean
}) {
  revendicaOglindaLimbii()
  const [lang, setLangState] = useState<Lang>(() =>
    resolveLang(loadLocalLang() ?? 'en'),
  )
  const t = strings(lang)
  const handleAdminLangChange = (nouaLimba: Lang) => {
    mirrorLang(nouaLimba)
    setLangState(nouaLimba)
    void saveSpeechLang(nouaLimba)
  }

  const online = useConectat() && !offline
  const isAdmin = !offline && user.role === 'admin'
  const [adminOpen, setAdminOpen] = useState(false)

  useEffect(() => {
    if (!online) setAppsOpen(false)
  }, [online])
  const [adminTab, setAdminTab] = useState<AdminTab>('finance')

  const [docSaved, setDocSaved] = useState(false)

  const [docCopied, setDocCopied] = useState(false)

  const [docActiune, setDocActiune] = useState<'' | 'copy-err' | 'save-err'>('')
  const copyDocText = (text: string): void => {
    const arata = (): void => {
      setDocActiune('')
      setDocCopied(true)
      window.setTimeout(() => setDocCopied(false), 2000)
    }
    const esec = (e: unknown): void => {
      console.error('[doc] copierea a picat:', String(e).slice(0, 160))
      setDocActiune('copy-err')
      window.setTimeout(() => setDocActiune(''), 3000)
    }
    const fallback = (): void => {
      try {
        const ta = document.createElement('textarea')
        ta.value = text
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        const ok = document.execCommand('copy')
        document.body.removeChild(ta)
        if (ok) arata()
        else esec('execCommand a refuzat')
      } catch (e) {
        esec(e)
      }
    }
    if (navigator.clipboard?.writeText)
      navigator.clipboard.writeText(text).then(arata).catch(fallback)
    else fallback()
  }
  const saveDocToKelion = (
    title: string,
    content: string,
    fileName: string,
    mime: string,
  ): void => {
    if (!downloadContent(fileName, content, mime)) {
      setDocActiune('save-err')
      window.setTimeout(() => setDocActiune(''), 3000)
      return
    }
    // Descărcarea e fapta vizibilă și LOCALĂ → confirmarea vine imediat, nu
    // după rețea. Nota în Kelion rămâne best-effort, în fundal.
    setDocSaved(true)
    window.setTimeout(() => setDocSaved(false), 3000)
    if (online) {
      void apiFetch('/api/notes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ title, content }),
      }).catch(() => {})
    }
  }
  const [contactOpen, setContactOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [cvAdaptationOpen, setCvAdaptationOpen] = useState(false)

  const [appsOpen, setAppsOpen] = useState(false)

  const [scenariuGata, setScenariuGata] = useState<{
    videoPrompt: string
    nume: string
    cale: 'openai'
    la: number
  } | null>(() => {
    try {
      const key = scopedClientKey('kelion_scenariu')
      const brut = key ? localStorage.getItem(key) : null
      if (!brut) return null
      const j = JSON.parse(brut) as {
        videoPrompt?: string
        nume?: string
        cale?: string
        la?: number
      }
      return j.cale === 'openai' && j.videoPrompt
        ? {
            videoPrompt: j.videoPrompt,
            nume: j.nume ?? 'Clip',
            cale: 'openai',
            la: j.la ?? 0,
          }
        : null
    } catch {
      return null
    }
  })
  useEffect(() => {
    const onScenariu = (e: Event): void => {
      const d = (e as CustomEvent).detail as {
        videoPrompt?: string
        nume?: string
        cale?: string
      }
      if (d?.cale === 'openai' && d.videoPrompt)
        setScenariuGata({
          videoPrompt: d.videoPrompt,
          nume: d.nume ?? 'Clip',
          cale: 'openai',
          la: Date.now(),
        })
    }
    window.addEventListener('kelion:scenariu', onScenariu)
    return () => window.removeEventListener('kelion:scenariu', onScenariu)
  }, [])
  const scenariuProaspat =
    scenariuGata && Date.now() - scenariuGata.la < 30 * 60 * 1000
      ? scenariuGata
      : null

  const [langOpen, setLangOpen] = useState(false)

  const [theme, setTheme] = useState<ThemeName>(currentTheme())
  const [recording, setRecording] = useState(false)

  const [recErr, setRecErr] = useState('')

  const [monZoom, setMonZoom] = useState(1)
  const zoomOut = (): void =>
    setMonZoom((z) => Math.max(0.7, +(z - 0.1).toFixed(2)))
  const zoomIn = (): void =>
    setMonZoom((z) => Math.min(1.8, +(z + 0.1).toFixed(2)))
  // Creierul cloud este OpenAI; pastilele arată starea măsurată + Serper + VPS.
  const [brainCredit, setBrainCredit] = useState<BrainCredit | null>(null)
  // EȘECUL POLLING-ULUI SE DECLARĂ: de la 3 eșecuri consecutive (~90s),
  // pastilele trec pe ⚠ „citire veche",
  // în loc să rămână verzi pe valori înghețate prezentate ca actuale.
  const [brainFails, setBrainFails] = useState(0)
  const brainOkAtRef = useRef<number | null>(null)

  const openAdmin = (tab?: typeof adminTab): void => {
    if (tab) setAdminTab(tab)
    setAdminOpen(true)
  }

  usePolledJson<BrainCredit>(
    '/api/admin/brain-credit',
    isAdmin && online,
    (j) => {
      if (j && j.active === 'openai') {
        setBrainCredit(j)
        setBrainFails(0)
        brainOkAtRef.current = Date.now()
      }
    },
    30_000,
    () => {
      setBrainFails((n) => n + 1)
    },
  )

  const brainStaleMin =
    brainOkAtRef.current != null
      ? Math.max(1, Math.round((Date.now() - brainOkAtRef.current) / 60_000))
      : null
  const brainStale = brainFails >= 3 && brainCredit != null

  useEffect(() => {
    const onNav = (e: Event): void => {
      const d = (e as CustomEvent).detail as
        | { view?: string; section?: string }
        | undefined
      const view = String(d?.view ?? '').toLowerCase()
      switch (view) {
        case 'settings':
          setSettingsOpen(true)
          break
        case 'wallet':
          window.dispatchEvent(new Event('kelion:wallet-open'))
          break
        case 'contact':
          setContactOpen(true)
          break
        case 'cv':
        case 'cv-adaptation':
        case 'adaptare':
          setCvAdaptationOpen(true)
          break
        case 'admin':
          if (isAdmin) {
            const sec = String(d?.section ?? '')
            if (isAdminTab(sec)) setAdminTab(sec)
            openAdmin()
          }
          break
        case 'trading':
          if (isAdmin && !closeTasksByKind('tranzactii'))
            openWorkspace('📈 Tranzacții', '/api/tranzactii')
          break
        case 'home':
          setSettingsOpen(false)
          setContactOpen(false)
          setAdminOpen(false)
          closeAllTasks()
          break
      }
    }
    window.addEventListener('kelion:navigate', onNav)
    return () => window.removeEventListener('kelion:navigate', onNav)
  }, [isAdmin])

  const [userCreditOut, setUserCreditOut] = useState<boolean | null>(null)
  usePolledJson<{ credits?: number }>(
    '/api/billing/balance',
    !offline && online && user.role === 'customer',
    (j) => {
      if (typeof j.credits === 'number') setUserCreditOut(j.credits <= 0)
    },
  )

  const [avatarBox, setAvatarBox] = useState<{
    x: number
    y: number
    s: number
  }>({ x: 58, y: 58, s: 0.42 })

  const [analizaChat, setAnalizaChat] = useState(false)
  useEffect(() => {
    const h = (e: Event): void =>
      setAnalizaChat(!!(e as CustomEvent).detail?.activ)
    window.addEventListener('kelion:analiza-vizibila', h)
    return () => window.removeEventListener('kelion:analiza-vizibila', h)
  }, [])
  // Fix hydration: localStorage is client-only; read it after hydration.
  useEffect(() => {
    try {
      const v = JSON.parse(localStorage.getItem('avatar-box') || '') as {
        x?: number
        y?: number
        s?: number
      }
      if (
        typeof v?.x === 'number' &&
        typeof v?.y === 'number' &&
        typeof v?.s === 'number'
      ) {
        let s = v.s

        try {
          const old = Number(localStorage.getItem('kelion-avatar-scale'))
          if (Number.isFinite(old) && old > 0 && Math.abs(old - 1.65) > 0.01) {
            s = Math.min(0.9, Math.max(0.12, s * (old / 1.65)))
            localStorage.removeItem('kelion-avatar-scale')
          }
        } catch {
          /* no old key — nothing to migrate */
        }
        setAvatarBox({ x: v.x, y: v.y, s })
      }
    } catch {
      /* no saved preference — we use the default placement */
    }
  }, [])

  const [dancing, setDancing] = useState(false)
  useEffect(() => {
    const onGest = (e: Event): void => {
      const name = String((e as CustomEvent).detail ?? '')
      if (/^dans/.test(name)) setDancing(true)
    }
    const onDone = (): void => setDancing(false)
    window.addEventListener('kelion-gesture', onGest)
    window.addEventListener('kelion-gesture-done', onDone)
    return () => {
      window.removeEventListener('kelion-gesture', onGest)
      window.removeEventListener('kelion-gesture-done', onDone)
    }
  }, [])
  // We don't write to the server BEFORE reading from it — otherwise the local default
  // would trample the saved arrangement. 'ready' only after the first GET /api/prefs.
  const avatarSyncRef = useRef<'pending' | 'ready'>('pending')
  const avatarBoxRef = useRef(avatarBox)
  useEffect(() => {
    if (!online) {
      avatarSyncRef.current = 'pending'
      return
    }
    let alive = true
    void (async () => {
      const prefs = await loadServerPrefs()
      if (!alive) return
      const b = prefs?.avatarBox
      if (
        b &&
        typeof b.x === 'number' &&
        typeof b.y === 'number' &&
        typeof b.s === 'number'
      ) {
        setAvatarBox({ x: b.x, y: b.y, s: b.s })
      } else if (prefs) {
        void saveAvatarBox(avatarBoxRef.current)
      }
      avatarSyncRef.current = 'ready'
    })()
    return () => {
      alive = false
    }
  }, [online])
  useEffect(() => {
    avatarBoxRef.current = avatarBox
    try {
      localStorage.setItem('avatar-box', JSON.stringify(avatarBox))
    } catch {
      /* local storage may be missing — the arrangement stays only for this session */
    }
    if (avatarSyncRef.current !== 'ready') return

    const t = window.setTimeout(() => void saveAvatarBox(avatarBox), 800)
    return () => window.clearTimeout(t)
  }, [avatarBox])

  const [recArmed, setRecArmed] = useState(false)
  const recRef = useRef<RecordingHandle | null>(null)

  const recNameRef = useRef<string | null>(null)
  const ws = useSyncExternalStore(subscribeWorkspace, getWorkspace)

  const carOn = useSyncExternalStore(subscribeCarMode, isCarMode)

  const [reteaSlaba] = useState(reteaLenta)
  const [reteaNotaInchisa, setReteaNotaInchisa] = useState(false)

  useEffect(() => {
    if (!online) return
    pornestePrezentaApel()
    return () => oprestePrezentaApel()
  }, [online])
  // #7 AUDIO SPAȚIAL: inițializează la primul gest (necesar pe mobil)
  useEffect(() => {
    const onFirstGesture = (): void => {
      resumeAudioSpatial()
      initiazaAudioSpatial()
      document.removeEventListener('click', onFirstGesture)
      document.removeEventListener('touchstart', onFirstGesture)
    }
    document.addEventListener('click', onFirstGesture)
    document.addEventListener('touchstart', onFirstGesture)
    return () => {
      document.removeEventListener('click', onFirstGesture)
      document.removeEventListener('touchstart', onFirstGesture)
    }
  }, [])
  // #8 COMPANION CREATIV: muzică după dispoziție (manual — buton)
  const [muzicaPornita, setMuzicaPornita] = useState(false)
  const [dispozitieMuzica, setDispozitieMuzica] =
    useState<DispozitieMuzicala>('calm')
  const comutaMuzica = (): void => {
    if (muzicaPornita) {
      opresteMuzica()
      setMuzicaPornita(false)
    } else {
      pornesteMuzica(dispozitieMuzica)
      setMuzicaPornita(true)
    }
  }

  useEffect(() => {
    const laMesaj = (ev: MessageEvent): void => {
      if (!trustedTradingMessage(ev, window.location.origin)) return
      const d = ev.data as {
        kelion?: string
        simbol?: unknown
        pret?: unknown
        interval?: unknown
        sursa?: unknown
        peste?: unknown
      } | null
      if (d?.kelion === 'inchide-tranzactii') closeTasksByKind('tranzactii')
      // Orice suprafață poate cere închiderea întregului monitor.
      else if (d?.kelion === 'inchide-monitorul') closeAllTasks()
      // Starea vizibilă a tranzacțiilor intră în contextul turei curente.
      else if (d?.kelion === 'tranzactii-stare')
        setStareTranzactii({
          simbol: String(d.simbol ?? ''),
          pret: Number(d.pret) || null,
          interval: String(d.interval ?? ''),
          sursa: String(d.sursa ?? ''),
          // Punctul exact de sub cursor pe grafic (null = mouse-ul nu e pe o lumânare).
          peste:
            d.peste && typeof d.peste === 'object'
              ? (d.peste as PunctGrafic)
              : null,
          la: Date.now(),
        })
    }
    window.addEventListener('message', laMesaj)
    return () => window.removeEventListener('message', laMesaj)
  }, [])

  // Keep the screen awake while a map/route is on the monitor, so navigation
  // never freezes when the browser would otherwise throttle the tab.
  useEffect(() => {
    keepScreenOn(ws.open)
    return () => keepScreenOn(false)
  }, [ws.open])

  // The avatar canvas animates (corner PiP ⇄ full) via a CSS transform transition
  // whenever a task opens or closes. Re-fit R3F EXACTLY when that transition ends
  // (deterministic — event-driven, not guessed timers) so the camera always
  // matches the final size and the avatar never stays stuck small in the corner.
  const stageRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const onEnd = (e: TransitionEvent): void => {
      if (e.propertyName === 'transform')
        window.dispatchEvent(new Event('resize'))
    }
    el.addEventListener('transitionend', onEnd)
    return () => el.removeEventListener('transitionend', onEnd)
  }, [])
  // Also re-fit on the very next frame after the PiP state flips: R3F's buffer
  // can lag the canvas element (it collapses to the 300×150 default), so we tell
  // R3F to re-measure as soon as the class changes — event-driven off ws.open,
  // then again at transitionend above. The forced 100% canvas CSS keeps the
  // element full meanwhile, so the avatar is never tiny.
  useEffect(() => {
    const id = requestAnimationFrame(() =>
      window.dispatchEvent(new Event('resize')),
    )
    return () => cancelAnimationFrame(id)
  }, [ws.open])

  // Admin-only: record the screen + Kelion's voice + mic to an MP4 in Downloads,
  // for promo clips (TikTok / Instagram / Facebook).
  async function toggleRecording(): Promise<void> {
    if (recording) {
      recRef.current?.stop()
      recRef.current = null
      return
    }
    const handle = await startRecording(
      () => {
        setRecording(false)
        recRef.current = null
        recNameRef.current = null

        window.dispatchEvent(new Event('kelion:rec-stopped'))
      },
      (reason) => {
        setRecording(false)
        setRecErr(
          reason === 'unsupported'
            ? 'Browserul nu suportă captura de ecran (getDisplayMedia/MediaRecorder lipsesc).'
            : 'Înregistrarea a fost refuzată (ai închis fereastra de alegere sau ai blocat permisiunea).',
        )
        window.setTimeout(() => setRecErr(''), 3000)
      },
      recNameRef.current ?? undefined,
    )
    if (handle) {
      recRef.current = handle
      setRecording(true)
      // Recording is rolling — the promo pipeline performs its script on this.
      window.dispatchEvent(new Event('kelion:rec-started'))
    }
  }

  // Voice commands from the chat ("înregistrează" / "oprește înregistrarea"):
  // arm the button (optionally with a suggestive clip name from the promo
  // pipeline), or stop the running recording hands-free.
  useEffect(() => {
    const onRec = (e: Event): void => {
      const d = (e as CustomEvent).detail as
        | string
        | { action?: string; name?: string }
      const action = typeof d === 'string' ? d : d?.action
      if (action === 'stop') {
        recRef.current?.stop()
        recRef.current = null
        setRecArmed(false)
      } else if (action === 'arm' && !recording) {
        if (typeof d === 'object' && d?.name) recNameRef.current = d.name
        setRecArmed(true)
      }
    }
    window.addEventListener('kelion:rec', onRec)
    return () => window.removeEventListener('kelion:rec', onRec)
  }, [recording])

  useEffect(() => {
    if (!online) return
    let stopped = false
    const ping = (): void => {
      if (stopped) return
      void apiFetch('/api/visit/ping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'aplicație' }),
      }).catch(() => {})
    }
    ping()
    const id = window.setInterval(ping, 60_000)
    return () => {
      stopped = true
      window.clearInterval(id)
    }
  }, [online])

  const monitorOn = ws.open

  const lastWsRef = useRef(ws)
  if (ws.open) lastWsRef.current = ws
  const [wsFading, setWsFading] = useState(false)
  useEffect(() => {
    if (ws.open) {
      setWsFading(false)
      return
    }
    setWsFading(true)
    const id = window.setTimeout(() => setWsFading(false), 520)
    return () => window.clearTimeout(id)
  }, [ws.open])
  const wsv = ws.open ? ws : lastWsRef.current

  useEffect(() => {
    setMonitorWorking(monitorOn)
  }, [monitorOn])
  return (
    <div className={`stage ${recording ? 'rec-clean' : ''}`}>
      {recording && (
        <div className="rec-watermark">{productConfig.publicAppHost}</div>
      )}

      {reteaSlaba && !reteaNotaInchisa && !recording && (
        <div
          role="status"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            zIndex: 60,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            justifyContent: 'center',
            padding: '6px 12px',
            background: 'rgba(18,18,22,0.92)',
            color: '#ffd27a',
            font: '500 12px/1.35 system-ui, -apple-system, sans-serif',
            textAlign: 'center',
          }}
        >
          <span>{t.retea4g}</span>
          <button
            type="button"
            onClick={() => setReteaNotaInchisa(true)}
            aria-label="×"
            style={{
              background: 'transparent',
              border: 0,
              color: 'inherit',
              cursor: 'pointer',
              fontSize: 16,
              lineHeight: 1,
              padding: '0 4px',
            }}
          >
            ×
          </button>
        </div>
      )}

      <div className={`workspace-bg ${monitorOn ? 'open' : ''}`}>
        {(ws.open || wsFading) && (
          <div
            className={`workspace-inner ${wsv.kind === 'tranzactii' ? 'plin' : ''}`}
          >
            <div className="workspace-head">
              <div className="workspace-tabs">
                {ws.tasks.map((task) => (
                  <div
                    key={task.id}
                    className={`ws-tab ${task.id === ws.activeId ? 'active' : ''}`}
                    title={task.title}
                  >
                    <button
                      type="button"
                      className="ws-tab-label"
                      onClick={() => switchToId(task.id)}
                    >
                      {task.title}
                    </button>
                    <button
                      type="button"
                      className="ws-tab-x"
                      aria-label={t.wsClose}
                      onClick={(e) => {
                        e.stopPropagation()
                        closeTask(task.id)
                      }}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>

              {(() => {
                const activ = ws.tasks.find((x) => x.id === ws.activeId)
                return activ?.url && /^https?:\/\//i.test(activ.url) ? (
                  <a
                    className="ghost ws-open-tab"
                    href={activ.url}
                    target="_blank"
                    rel="noreferrer"
                    title={t.wsOpenTab}
                    aria-label={t.wsOpenTab}
                  >
                    ↗
                  </a>
                ) : null
              })()}
              <div className="ws-zoom" title={t.wsZoomFit}>
                <button
                  type="button"
                  className="ghost"
                  onClick={zoomOut}
                  aria-label={t.wsZoomOut}
                >
                  A−
                </button>
                <span className="ws-zoom-val">
                  {Math.round(monZoom * 100)}%
                </span>
                <button
                  type="button"
                  className="ghost"
                  onClick={zoomIn}
                  aria-label={t.wsZoomIn}
                >
                  A+
                </button>
              </div>
              {ws.tasks.length > 1 && (
                <button
                  type="button"
                  className="ghost"
                  onClick={closeAllTasks}
                  title={t.wsCloseAll}
                >
                  {t.wsCloseAll}
                </button>
              )}
            </div>

            {wsv.tasks.map((task) => {
              const active = task.id === wsv.activeId
              const sonor =
                task.kind === 'youtube' ||
                task.kind === 'video' ||
                task.kind === 'audio'
              if (sonor && (!active || !ws.open)) return null
              return (
                <div
                  key={task.id}
                  style={active ? { display: 'contents' } : { display: 'none' }}
                >
                  {task.kind === 'build' ? (
                    <BuildSurface zoom={monZoom} />
                  ) : task.kind === 'executie' ? (
                    <ExecutieSurface zoom={monZoom} />
                  ) : task.kind === 'deploy' ? (
                    <div
                      style={{
                        padding: 24,
                        display: 'flex',
                        justifyContent: 'center',
                        alignItems: 'center',
                        height: '100%',
                      }}
                    >
                      <DeployProgressBar />
                    </div>
                  ) : task.html ? (
                    // PLAYGROUND: the page written by Kelion runs live in an isolated
                    // iframe (srcdoc + sandbox, no same-origin → it can't reach
                    // the session/app). The button saves the page as .html on disc.
                    <div className="workspace-doc">
                      <button
                        type="button"
                        className="doc-copy"
                        onClick={() =>
                          saveDocToKelion(
                            task.title,
                            task.html ?? '',
                            safeFileName(task.title, 'html'),
                            'text/html',
                          )
                        }
                        title={t.wsSaveHtml}
                      >
                        {docSaved ? t.wsSaved : t.wsSave}
                      </button>
                      <iframe
                        title={task.title}
                        srcDoc={izoleazaHtmlPlayground(task.html)}
                        className="workspace-frame"
                        sandbox="allow-scripts allow-pointer-lock"
                        referrerPolicy="no-referrer"
                      />
                    </div>
                  ) : task.text ? (
                    <div className="workspace-doc">
                      <button
                        type="button"
                        className="doc-copy"
                        onClick={() => copyDocText(task.text ?? '')}
                        title={t.wsCopy}
                      >
                        {docActiune === 'copy-err'
                          ? '✗ refuzat'
                          : docCopied
                            ? '✓ copiat'
                            : t.wsCopy}
                      </button>
                      <button
                        type="button"
                        className="doc-copy"
                        style={{ right: '6.5rem' }}
                        onClick={() =>
                          saveDocToKelion(
                            task.title,
                            task.text ?? '',
                            safeFileName(task.title, 'txt'),
                            'text/plain',
                          )
                        }
                        title={t.wsSaveTxt}
                      >
                        {docActiune === 'save-err'
                          ? '✗ refuzat'
                          : docSaved
                            ? t.wsSaved
                            : t.wsSave}
                      </button>
                      <pre
                        className="doc-text"
                        style={{ fontSize: `${monZoom}em` }}
                      >
                        {task.text}
                      </pre>
                    </div>
                  ) : task.card ? (
                    <CardView card={task.card} />
                  ) : task.url && task.kind === 'image' ? (
                    <MonitorImage
                      url={task.url}
                      title={task.title}
                      taskId={task.id}
                    />
                  ) : task.url && task.kind === 'video' ? (
                    <MonitorVideo
                      url={task.url}
                      title={task.title}
                      taskId={task.id}
                    />
                  ) : task.url && task.kind === 'audio' ? (
                    <MonitorAudio url={task.url} taskId={task.id} />
                  ) : task.url && task.kind === 'pdf' ? (
                    // PDF local/aplicație: vizorul nativ rulează fără scripturi.
                    <MonitorDocument
                      url={task.url}
                      title={task.title}
                      taskId={task.id}
                      kind="pdf"
                    />
                  ) : task.url && task.kind === 'office' ? (
                    // Fără viewer extern implicit: documentul rămâne pe originul lui.
                    <MonitorDocument
                      url={task.url}
                      title={task.title}
                      taskId={task.id}
                      kind="office"
                    />
                  ) : task.url && task.kind === 'markdown' ? (
                    <MonitorMarkdown
                      url={task.url}
                      zoom={monZoom}
                      taskId={task.id}
                    />
                  ) : task.url && task.kind === 'htmlfile' ? (
                    <MonitorHtmlFile url={task.url} taskId={task.id} />
                  ) : task.url && task.kind === 'textfile' ? (
                    <MonitorTextFile
                      url={task.url}
                      zoom={monZoom}
                      taskId={task.id}
                    />
                  ) : task.url && task.kind === 'archive' ? (
                    // Archives: the browser can't open them in page — we offer
                    // the download, honestly (a zip's content doesn't render natively).
                    <div className="workspace-blocked">
                      <p>{t.wsArchiveNote.replace('{name}', task.title)}</p>
                      <a href={task.url} download className="workspace-action">
                        {t.wsDownloadArchive}
                      </a>
                    </div>
                  ) : task.url && task.kind === 'file' ? (
                    <div className="workspace-blocked">
                      <p>
                        {task.title} — {t.wsFileNoPreview}
                      </p>
                      <a href={task.url} download className="workspace-action">
                        {t.wsDownloadFile}
                      </a>
                    </div>
                  ) : task.url ? (
                    // Doar suprafețele validate explicit primesc iframe. Orice altă
                    // pagină trece prin cititorul server-side sau link extern.
                    <MonitorPagina
                      url={task.url}
                      title={task.title}
                      taskId={task.id}
                      kind={task.kind}
                    />
                  ) : null}
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div
        ref={stageRef}
        className={`stage-canvas ${monitorOn || analizaChat ? 'pip' : ''}`}
        style={
          monitorOn
            ? {
                transform: dancing
                  ? `translate(calc(30vw - 14px), calc(30vh - 180px)) scale(${Math.max(avatarBox.s, 0.62)})`
                  : wsv.kind === 'tranzactii'
                    ? 'translate(calc(72vw - 14px), calc(66vh - 180px)) scale(0.3)'
                    : `translate(calc(${avatarBox.x}vw - 14px), calc(${avatarBox.y}vh - 180px)) scale(${avatarBox.s})`,
              }
            : undefined
        }
      >
        {!carOn && (
          <Suspense fallback={null}>
            <StageAvatar monitorOn={monitorOn} />
          </Suspense>
        )}
      </div>

      <header className="topbar">
        <span className="brand">
          <img
            src="/kelion-logo.png"
            className={`brand-logo${
              user.role === 'customer' && userCreditOut === true
                ? ' credit-out'
                : user.role === 'customer' && userCreditOut === false
                  ? ' credit-ok'
                  : ''
            }`}
            title={
              user.role === 'customer'
                ? userCreditOut
                  ? uiStrings().creditOut
                  : userCreditOut === false
                    ? uiStrings().creditOk
                    : ''
                : ''
            }
            alt=""
          />
          Kelionai
        </span>

        {online && (
          <div className="apps-wrap">
            <button
              type="button"
              className="ghost"
              onClick={() => setAppsOpen((v) => !v)}
              aria-expanded={appsOpen}
              title="Aplicații"
            >
              ▦ Aplicații ▾
            </button>
            {appsOpen && (
              <>
                <div
                  className="apps-backdrop"
                  onClick={() => setAppsOpen(false)}
                />
                <div className="apps-menu">
                  {isAdmin && (
                    <button
                      type="button"
                      className="apps-item"
                      onClick={() => {
                        setAppsOpen(false)
                        if (!closeTasksByKind('tranzactii'))
                          window.dispatchEvent(
                            new CustomEvent('kelion:comanda', {
                              detail:
                                'Deschide-mi Centrul de Tranzacționare și spune-mi pe scurt starea lui.',
                            }),
                          )
                      }}
                    >
                      📈 Tranzacții
                    </button>
                  )}
                  <button
                    type="button"
                    className="apps-item"
                    onClick={() => {
                      setAppsOpen(false)
                      window.dispatchEvent(
                        new CustomEvent('kelion:comanda', {
                          detail:
                            'Deschide-mi panoul de adaptare CV și spune-mi pe scurt cum funcționează.',
                        }),
                      )
                    }}
                  >
                    📄 {t.cvTitle}
                  </button>

                  {[
                    ['✉️ Gmail', 'Arată-mi ultimele emailuri primite.'],

                    [
                      '📅 Calendar',
                      'Arată-mi ce am în calendar săptămâna asta.',
                    ],
                    ['📁 Drive', 'Arată-mi ultimele fișiere din Drive.'],
                    ['📝 Docs', 'Fă-mi un document Google nou.'],
                    ['📊 Sheets', 'Fă-mi un tabel Google nou.'],
                    ['✅ Tasks', 'Arată-mi lista mea de sarcini.'],
                    ['🗺 Hărți', 'Arată-mi pe hartă unde sunt.'],
                    ['🔎 Căutare', 'Caută pe web ultimele știri.'],
                    [
                      '▶️ YouTube',
                      'Caută pe YouTube un clip și pune-l pe monitor.',
                    ],
                    [
                      '🎨 Imagini',
                      'Generează o imagine cu un răsărit peste mare.',
                    ],

                    [
                      '📽 Prezentări',
                      'Fă-mi o prezentare Google Slides despre un subiect — întreabă-mă întâi subiectul.',
                    ],
                    [
                      '📹 Meet',
                      'Fă-mi o întâlnire în calendar cu link Google Meet — întreabă-mă întâi când și cu cine.',
                    ],
                    [
                      '📋 Formulare',
                      'Fă-mi un formular Google — întreabă-mă întâi ce întrebări să conțină.',
                    ],
                    [
                      '📷 Photos',
                      'Vreau să aleg niște poze din Google Photos — pornește alegerea și pune-mi linkul pe monitor.',
                    ],
                    [
                      '▶️ YouTube upload',
                      'Urcă un clip de-al meu pe YouTube — întreabă-mă întâi care clip și ce titlu.',
                    ],
                    [
                      '🏪 Profilul firmei',
                      'Arată-mi profilul firmei mele din Google (Business Profile) — contul și locațiile.',
                    ],
                  ].map(([eticheta, comanda]) => (
                    <button
                      key={eticheta}
                      type="button"
                      className="apps-item"
                      onClick={() => {
                        setAppsOpen(false)
                        window.dispatchEvent(
                          new CustomEvent('kelion:comanda', {
                            detail: comanda,
                          }),
                        )
                      }}
                    >
                      {eticheta}
                    </button>
                  ))}
                  {/* Un scenariu pregătit poate fi copiat local; nu pornește un furnizor video. */}
                  {scenariuProaspat && (
                    <button
                      type="button"
                      className="apps-item"
                      onClick={() => {
                        setAppsOpen(false)
                        void navigator.clipboard
                          ?.writeText(scenariuProaspat.videoPrompt)
                          .catch(() => {})
                      }}
                    >
                      📋 Copiază scenariul pregătit
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {isAdmin && (
          <>
            {brainStale && (
              <span
                className="ghost"
                style={{ opacity: 0.9, color: '#e6a23c' }}
                title={adminStrings().pillsStale.replace(
                  '{min}',
                  String(brainStaleMin ?? '?'),
                )}
              >
                ⚠ {brainStaleMin != null ? `${brainStaleMin}m` : ''}
              </span>
            )}

            <BecuriBara />
          </>
        )}

        {online && (
          <WalletButton onOpenSettings={() => setSettingsOpen(true)} />
        )}

        <div className="who">
          {user.picture && (
            <img src={user.picture} alt="" className="avatar-pic" />
          )}
          <span>{user.name}</span>
          {isAdmin && <span className="badge">admin</span>}
          {isAdmin && (
            <button
              type="button"
              className={`ghost ${recording ? 'rec-on' : ''} ${recArmed && !recording ? 'rec-armed' : ''}`}
              onClick={() => {
                setRecArmed(false)
                void toggleRecording()
              }}
              title={recErr || (recording ? t.recStopTitle : t.recStartTitle)}
            >
              {recErr ? 'Rec ⚠' : recording ? '■ Rec' : '● Rec'}
            </button>
          )}
          {isAdmin && (
            <button type="button" className="ghost" onClick={() => openAdmin()}>
              Admin
            </button>
          )}

          <div className="lang-wrap">
            <button
              type="button"
              className="ghost"
              onClick={() => setLangOpen((v) => !v)}
              aria-expanded={langOpen}
              title={t.langPickTitle}
              aria-label={t.langPickTitle}
            >
              🌐 {lang.toUpperCase()} ▾
            </button>
            {langOpen && (
              <>
                <div
                  className="apps-backdrop"
                  onClick={() => setLangOpen(false)}
                />
                <div className="apps-menu lang-menu">
                  {(
                    [
                      { code: 'ro', label: 'Română', flag: '🇷🇴' },
                      { code: 'en', label: 'English', flag: '🇬🇧' },
                      { code: 'es', label: 'Español', flag: '🇪🇸' },
                      { code: 'fr', label: 'Français', flag: '🇫🇷' },
                      { code: 'de', label: 'Deutsch', flag: '🇩🇪' },
                      { code: 'it', label: 'Italiano', flag: '🇮🇹' },
                      // B6 (marea verificare): 'ru' NU există în Lang/dict — la
                      // click, UI-ul cădea pe engleză cu insigna „RU" activă
                      // (stare care minte); iar 'pt' (tradus, în Lang) LIPSEA.
                      { code: 'pt', label: 'Português', flag: '🇵🇹' },
                    ] as const
                  ).map((l) => (
                    <button
                      key={l.code}
                      type="button"
                      className={`apps-item${lang === l.code ? ' lang-activ' : ''}`}
                      onClick={() => {
                        setLangOpen(false)
                        handleAdminLangChange(l.code as Lang)
                      }}
                    >
                      <span>{l.flag}</span>
                      <span>{l.label}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          <button
            type="button"
            className="ghost"
            onClick={() => setTheme(toggleTheme())}
            title={theme === 'light' ? t.themeToDark : t.themeToLight}
            aria-label={theme === 'light' ? t.themeToDark : t.themeToLight}
          >
            {theme === 'light' ? '☾' : '☀'}
          </button>

          <a
            className="ghost"
            href={`/manual?lang=${lang}`}
            target="_blank"
            rel="noreferrer"
          >
            {t.manualLabel}
          </a>
          <button
            type="button"
            className="ghost"
            onClick={() => setContactOpen(true)}
          >
            {t.contactLabel}
          </button>
          <button type="button" className="ghost" onClick={() => void logout()}>
            {t.signOut}
          </button>
        </div>
      </header>

      <ChatPanel lang={lang} isAdmin={isAdmin} forceOffline={offline} />

      {online && <ApelOverlay lang={lang} />}

      <div
        style={{
          position: 'fixed',
          bottom: 'max(8px, env(safe-area-inset-bottom, 8px))',
          left: 8,
          zIndex: 9996,
          display: 'flex',
          gap: 4,
        }}
      >
        <button
          onClick={comutaMuzica}
          style={{
            background: muzicaPornita ? '#2e7d32' : 'rgba(0,0,0,0.6)',
            border: 'none',
            color: '#fff',
            borderRadius: 20,
            width: 40,
            height: 40,
            cursor: 'pointer',
            fontSize: 18,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {muzicaPornita ? '⏸' : '🎵'}
        </button>
        {muzicaPornita && (
          <select
            value={dispozitieMuzica}
            onChange={(e) => {
              const d = e.target.value as DispozitieMuzicala
              setDispozitieMuzica(d)
              schimbaDispozitie(d)
            }}
            style={{
              background: 'rgba(0,0,0,0.6)',
              color: '#fff',
              border: 'none',
              borderRadius: 20,
              padding: '0 10px',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            <option value="calm">Calm</option>
            <option value="trist">Trist</option>
            <option value="vesel">Vesel</option>
            <option value="energic">Energic</option>
            <option value="pensive">Pensive</option>
          </select>
        )}
      </div>

      {adminOpen && (
        <Suspense fallback={null}>
          <AdminPanel
            initialTab={adminTab}
            onClose={() => setAdminOpen(false)}
            brainCredit={brainCredit}
          />
        </Suspense>
      )}

      {contactOpen && <ContactModal onClose={() => setContactOpen(false)} />}

      {settingsOpen && (
        <CustomerSettings user={user} offline={!online} onClose={() => setSettingsOpen(false)} />
      )}

      {cvAdaptationOpen && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
          }}
        >
          <div style={{ width: '100%', maxWidth: '1200px' }}>
            <CvAdaptation onClose={() => setCvAdaptationOpen(false)} />
          </div>
        </div>
      )}
    </div>
  )
}
