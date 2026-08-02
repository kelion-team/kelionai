import { Suspense, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { AVATAR_ORBIT } from '../lib/avatarCamera'
import AvatarModel from '../components/AvatarModel'
import AvatarLoading from '../components/AvatarLoading'
import ChatPanel from '../components/ChatPanel'
import AdminPanel from '../components/AdminPanel'
import ContactModal from '../components/ContactModal'
import CustomerSettings from '../components/CustomerSettings'
import { WalletButton } from '../components/WalletButton'
import { CardView } from '../components/CardView'
import type { User } from '../lib/api'
import { usePolledJson } from '../lib/usePolledJson'
import { logout, startGoogleConnect } from '../lib/api'
import { resolveLang, strings, uiStrings } from '../lib/i18n'
import { adminStrings } from '../lib/adminText'
import {
  getWorkspace,
  subscribeWorkspace,
  closeTask,
  closeAllTasks,
  switchToId,
  normalizeEmbedUrl,
  isEmbeddable,
  setMonitorWorking,
  setTaskStatus,
} from '../lib/workspace'
import { startRecording, type RecordingHandle } from '../lib/recorder'
import { loadServerPrefs, saveAvatarBox, loadLocalLang } from '../lib/prefs'
import { keepScreenOn } from '../lib/wakelock'
import { deviceFingerprint } from '../lib/fingerprint'
import { renderMarkdown } from '../lib/markdown'
import { themeBg, currentTheme, toggleTheme, type ThemeName } from '../lib/theme'

// SAVING THE MONITOR CONTENT (Adrian, Jul 25: "you can't save what's on the
// monitor"). Downloads a text/HTML as a local file — a clean name from the title.
function downloadContent(name: string, content: string, mime: string): void {
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
  } catch {
    /* best-effort — the download must not break the monitor */
  }
}

// Code/text viewer on the monitor (Adrian, Jul 27): fetches the file's content
// (code, json, csv, log…) and shows it readable, monospaced. Simple fetch; on
// failure (cross-origin / private file) it offers the open link.
// ── One document on the monitor, once only (unique, no duplicates) ─────────
// The PDF (served directly) and Office files (through the online viewer) were shown through
// TWO identical frames — same class, same white background, same state
// reporting (`ok` / `error`, which Kelion reads with get_monitor). They differed only
// by `src`. Now: one component, two calls — if the state reporting changes,
// no stale half can remain.
function DocFrame({ title, src, taskId }: { title: string; src: string; taskId: string }): React.JSX.Element {
  return (
    <iframe
      title={title}
      src={src}
      className="workspace-frame"
      style={{ background: '#fff' }}
      onLoad={() => setTaskStatus(taskId, 'ok')}
      onError={() => setTaskStatus(taskId, 'error')}
    />
  )
}

function MonitorTextFile({ url, zoom, taskId }: { url: string; zoom: number; taskId: string }) {
  const [text, setText] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let alive = true
    setText(null)
    setFailed(false)
    fetch(url)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((t) => {
        if (alive) {
          setText(t.slice(0, 500_000))
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
  }, [url, taskId])
  if (failed)
    return (
      <div className="workspace-blocked">
        <p>{uiStrings().wsFileFailed}</p>
        <a href={url} target="_blank" rel="noreferrer" className="composer-send">{uiStrings().wsOpenFile}</a>
      </div>
    )
  return (
    <div className="workspace-doc">
      <pre className="doc-text" style={{ fontFamily: 'ui-monospace, Menlo, Consolas, monospace', fontSize: `${0.92 * zoom}em` }}>
        {text ?? uiStrings().buildLoading}
      </pre>
    </div>
  )
}

// MARKDOWN on the monitor (Aug 2 — "the monitor must run every format the
// skills provide"): fetched like any text file, then rendered FORMATTED with
// the mini safe renderer (source escaped first — nothing injected executes).
function MonitorMarkdown({ url, zoom, taskId }: { url: string; zoom: number; taskId: string }) {
  const [html, setHtml] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let alive = true
    setHtml(null)
    setFailed(false)
    fetch(url)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((t) => {
        if (alive) {
          setHtml(renderMarkdown(t.slice(0, 500_000)))
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
  }, [url, taskId])
  if (failed)
    return (
      <div className="workspace-blocked">
        <p>{uiStrings().wsFileFailed}</p>
        <a href={url} target="_blank" rel="noreferrer" className="composer-send">{uiStrings().wsOpenFile}</a>
      </div>
    )
  return (
    <div className="workspace-doc">
      {html === null ? (
        <pre className="doc-text">{uiStrings().buildLoading}</pre>
      ) : (
        // eslint-disable-next-line react/no-danger -- renderMarkdown escapes the source first
        <div className="doc-text md-view" style={{ fontSize: `${zoom}em` }} dangerouslySetInnerHTML={{ __html: html }} />
      )}
    </div>
  )
}

// A SAVED .html PAGE on the monitor (Aug 2): runs like the playground 'app' —
// fetched, then srcDoc in a sandbox WITHOUT allow-same-origin, so the page can
// never reach the app's session (a plain <iframe src> could, same-origin).
function MonitorHtmlFile({ url, taskId }: { url: string; taskId: string }) {
  const [doc, setDoc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let alive = true
    setDoc(null)
    setFailed(false)
    fetch(url)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((t) => {
        if (alive) {
          setDoc(t)
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
  }, [url, taskId])
  if (failed)
    return (
      <div className="workspace-blocked">
        <p>{uiStrings().wsFileFailed}</p>
        <a href={url} target="_blank" rel="noreferrer" className="composer-send">{uiStrings().wsOpenFile}</a>
      </div>
    )
  if (doc === null)
    return (
      <div className="workspace-doc">
        <pre className="doc-text">{uiStrings().buildLoading}</pre>
      </div>
    )
  return (
    <iframe
      title={url}
      srcDoc={doc}
      className="workspace-frame"
      sandbox="allow-scripts allow-modals allow-forms allow-popups allow-pointer-lock"
    />
  )
}

// MEDIA WITH AN HONEST FALLBACK (Aug 2): a failed <img>/<video>/<audio> (a
// codec the browser lacks — .mkv/.avi — or an inaccessible file) used to leave
// a DEAD black box while Kelion claimed "it's on the monitor". Now the error
// swaps in a plain explanation + the open/download link, and get_monitor hears
// the truth through setTaskStatus('error').
function MediaFailed({ url }: { url: string }) {
  return (
    <div className="workspace-blocked">
      <p>{uiStrings().wsMediaFailed}</p>
      <a href={url} target="_blank" rel="noreferrer" className="composer-send">{uiStrings().wsOpenFile}</a>
    </div>
  )
}

function MonitorImage({ url, title, taskId }: { url: string; title: string; taskId: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) return <MediaFailed url={url} />
  return (
    <div className="workspace-doc" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--panel-solid)' }}>
      <img
        src={url}
        alt={title}
        style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
        onLoad={() => setTaskStatus(taskId, 'ok')}
        onError={() => {
          setFailed(true)
          setTaskStatus(taskId, 'error')
        }}
      />
    </div>
  )
}

function MonitorVideo({ url, taskId }: { url: string; taskId: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) return <MediaFailed url={url} />
  return (
    <div className="workspace-doc" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#000' }}>
      <video
        src={url}
        controls
        style={{ maxWidth: '100%', maxHeight: '100%' }}
        onLoadedData={() => setTaskStatus(taskId, 'ok')}
        onError={() => {
          setFailed(true)
          setTaskStatus(taskId, 'error')
        }}
      />
    </div>
  )
}

function MonitorAudio({ url, taskId }: { url: string; taskId: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) return <MediaFailed url={url} />
  return (
    <div className="workspace-doc" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <audio
        src={url}
        controls
        style={{ width: '100%', maxWidth: 520 }}
        onLoadedData={() => setTaskStatus(taskId, 'ok')}
        onError={() => {
          setFailed(true)
          setTaskStatus(taskId, 'error')
        }}
      />
    </div>
  )
}

// PANOUL CONSTRUCTORULUI pe monitor (Etapa 4b, Adrian: „sistem performant cu
// monitor display of requirement resolution"). It subscribes to
// /api/constructor/live (admin session) and shows each build order:
// the state ("În coadă" / "Lucrează" / "Gata" / "Eșuat"), the CURRENT STEP sent by the worker
// on the VPS (Stage 4), the attempts and the PR. No longer a black box between
// "Preluat" and "Gata": you see the road, step by step. Light 2.5s poll, stopped
// cleanly on unmount (no leaks, no polling while the panel is closed).
interface BuildLiveJob {
  id: number
  status: string
  order: string
  progress: string | null
  ci?: string | null
  prUrl: string | null
  attempts: number
  updatedAt?: string
}
// The status labels come from i18n (audit Aug 2 — they were Romanian for
// every user); built as a function so the CURRENT language is read per render.
const buildLabel = (status: string): string => {
  const t = uiStrings()
  const map: Record<string, string> = {
    queued: t.buildQueued,
    running: t.buildRunning,
    done: t.buildDone,
    failed: t.buildFailed,
  }
  return map[status] ?? status
}
function BuildSurface({ zoom }: { zoom: number }) {
  const [jobs, setJobs] = useState<BuildLiveJob[]>([])
  const [note, setNote] = useState('')
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    let alive = true
    let timer: number | undefined
    async function tick(): Promise<void> {
      try {
        const r = await fetch('/api/constructor/live', { credentials: 'include' })
        if (!alive) return
        if (r.status === 403) {
          setNote(uiStrings().buildOnlyAdmin)
          setJobs([])
        } else if (!r.ok) {
          setNote(uiStrings().buildUnavailable)
        } else {
          const j = (await r.json()) as { jobs?: BuildLiveJob[] }
          if (!alive) return
          setNote('')
          setJobs(Array.isArray(j.jobs) ? j.jobs : [])
        }
        setLoaded(true)
      } catch {
        if (alive) {
          setNote(uiStrings().buildNoServer)
          setLoaded(true)
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
    <div className="workspace-doc build-surface" style={{ fontSize: `${zoom}em` }}>
      <div className="build-head">{uiStrings().buildHead}</div>
      {!loaded ? (
        <p className="build-empty">{uiStrings().buildLoading}</p>
      ) : note ? (
        <p className="build-empty">{note}</p>
      ) : jobs.length === 0 ? (
        <p className="build-empty">{uiStrings().buildEmpty}</p>
      ) : (
        <ul className="build-list">
          {jobs.map((j) => (
            <li key={j.id} className={`build-item build-${j.status}`}>
              <div className="build-row">
                {/* THE QUOTA PAUSE, VISIBLE (D6): a postponed order stays „running” in
                the database — correct, it's not lost — but on screen it looked identical
                to a working one, with the step frozen for 40 minutes. The worker marks
                the pause with „⏳”; here it becomes its own badge. */}
                {j.progress?.startsWith('⏳') ? (
                  <span className="build-badge build-badge-queued">{uiStrings().buildThrottled}</span>
                ) : (
                  <span className={`build-badge build-badge-${j.status}`}>{buildLabel(j.status)}</span>
                )}
                {/* The INDEPENDENT verification's verdict (Stage 6): „Gata” proven by CI. */}
                {j.ci === 'verde' ? (
                  <span className="build-ci build-ci-ok" title={uiStrings().buildCiOk}>CI ✓</span>
                ) : j.ci === 'roșu' ? (
                  <span className="build-ci build-ci-bad" title={uiStrings().buildCiFailed}>CI ✗</span>
                ) : j.ci === 'în curs' ? (
                  <span className="build-ci build-ci-wait" title={uiStrings().buildCiRunning}>CI…</span>
                ) : null}
                <span className="build-order">#{j.id} — {j.order}</span>
              </div>
              {j.progress ? (
                <div className="build-progress">
                  {j.status === 'running' && <span className="build-spin" aria-hidden>●</span>}
                  {j.progress}
                </div>
              ) : j.status === 'queued' ? (
                <div className="build-progress build-progress-dim">{uiStrings().buildWaiting}</div>
              ) : null}
              {(j.attempts > 1 || j.prUrl) && (
                <div className="build-meta">
                  {j.attempts > 1 && <span>{uiStrings().buildAttempt.replace('{n}', String(j.attempts))}</span>}
                  {j.prUrl && (
                    <a href={j.prUrl} target="_blank" rel="noreferrer" className="build-pr">{uiStrings().buildSeePr}</a>
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

// Safe file name from the panel title (diacritics/spaces → dashes).
function safeFileName(title: string, ext: string): string {
  const base = (title || 'kelion')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'kelion'
  return `${base}.${ext}`
}

// ── THE SERPER CREDIT FORMAT ───────────────────────────────────────────────
// Thousands collapse to one-decimal "k" (49 875 → "49.9k"); under 1000 the raw
// number stays as-is. The tooltip always carries the EXACT figure, with the
// Romanian thousands separator (49.875).
function formatSerperK(credits: number): string {
  return credits >= 1000 ? `${(credits / 1000).toFixed(1)}k` : String(credits)
}

// The shape of the /api/admin/brain-credit response — named, so the shared polling
// (usePolledJson) can type it.
interface BrainCredit {
    active: string | null
    openrouter: {
      ok: boolean
      topup: string
      // Soldul REAL, exact din contul OpenRouter (USD) — „punga lui Kelion".
      balance?: number
      low?: boolean
      live?: boolean
    }
    /** The REAL OpenAI month-to-date spend (USD), from the provider's costs
     *  API. `live: false` = the read failed or OPENAI_USAGE_KEY is missing —
     *  the bar writes "⚠ OpenAI", NEVER "$0.00": a failed read is not a zero
     *  spend (the same rule as the OpenRouter pill). */
    openai?: {
      live: boolean
      monthUsd?: number
      error?: string
    }
    /** The REAL Serper search credit (searches left), from the provider's
     *  /account endpoint. `live: false` = the read failed or SERPER_API_KEY is
     *  missing — the bar writes "Serper ⚠", NEVER "Serper 0": a failed read is
     *  not an empty account (the same rule as the OpenAI pill). */
    serper?: {
      live: boolean
      balance?: number
      rateLimit?: number
      error?: string
    }
    /** The VPS resources (Adrian, Jul 31: "permanently show VPS on the interface
     *  in the top bar"). `null` = they couldn't be measured — the bar writes "⚠ VPS",
     *  NEVER zeros: "0.0 GB / 0%" would look identical to a dead server. */
    vps?: {
      totalGb: number
      liberGb: number
      liberPct: number
      procesoare: number
      incarcare: [number, number, number]
      incarcarePct: number
    } | null
    pool: { loaded: number; remaining: number; spent: number; profit: number }
  }

export default function Stage({ user }: { user: User }) {
  // The OWNER always gets Romanian (the project rule); the rest by locale.
  // THE UI LANGUAGE (the final rule, Adrian Jul 24: "default ENGLISH for everyone; after
  // language identification the existing procedure applies"). No role forcing,
  // no browser/account locale: the local mirror of the server-IDENTIFIED language
  // (written by the {lang} frame → mirrorLang), otherwise English.
  const lang = resolveLang(loadLocalLang() ?? 'en')
  const t = strings(lang)
  const [adminOpen, setAdminOpen] = useState(false)
  const [adminTab, setAdminTab] = useState<'finance' | 'users' | 'visitors' | 'vchat' | 'history' | 'gaps' | 'share' | 'stores' | 'inbox' | 'voiceprints' | 'gesturi' | 'tokenuri' | 'constructor' | 'recuperare'>('finance')
  // THE ADMIN BUTTON PADLOCK (Adrian, Jul 27: "if the voiceprint doesn't match, the
  // admin button must not activate either"). armed = the secret is set (in
  // Admin→Voiceprints); unlocked = the voiceprint matched in this session
  // OR the secret was typed. Locked → the button opens the code window,
  // not the panel; the server blocks all /api/admin/* anyway (423) — the button is
  // only the mirror, the real padlock is on the server.
  const [adminLock, setAdminLock] = useState<{ armed: boolean; unlocked: boolean } | null>(null)
  const adminLockRef = useRef(adminLock)
  adminLockRef.current = adminLock
  const [unlockOpen, setUnlockOpen] = useState(false)
  const [unlockCode, setUnlockCode] = useState('')
  const [unlockErr, setUnlockErr] = useState('')
  // "Save" on the monitor documents (Adrian, Jul 27: "the save button
  // isn't functional" — it silently downloaded a file, no trace in Kelion). Now:
  // the document enters PERMANENT STORAGE (notes, DB — Kelion finds it again
  // with his tools) + local download + visible confirmation on the button.
  const [docSaved, setDocSaved] = useState(false)
  const saveDocToKelion = (title: string, content: string, fileName: string, mime: string): void => {
    downloadContent(fileName, content, mime)
    void fetch('/api/notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ title, content }),
    })
      .then((r) => {
        if (r.ok) {
          setDocSaved(true)
          window.setTimeout(() => setDocSaved(false), 3000)
        }
      })
      .catch(() => {})
  }
  const [contactOpen, setContactOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  // THE THEME TOGGLE (Aug 2 — the lighter background): the light palette is the
  // default; this top-bar moon/sun flips back to the original dark identity
  // (persisted by lib/theme). Held in state so the click re-renders — which
  // also re-reads themeBg() for the avatar canvas behind.
  const [theme, setTheme] = useState<ThemeName>(currentTheme())
  const [recording, setRecording] = useState(false)
  // Zoom/fit for the monitor text (request #27): A− / A+ scales the
  // readable content (doc + live console) so it's framed and legible.
  const [monZoom, setMonZoom] = useState(1)
  const zoomOut = (): void => setMonZoom((z) => Math.max(0.7, +(z - 0.1).toFixed(2)))
  const zoomIn = (): void => setMonZoom((z) => Math.min(1.8, +(z + 0.1).toFixed(2)))
  // Creierul e 100% OpenRouter (Kimi/GLM scoase). Un singur indicator: cheia e
  // configured + the admin's REAL fund (loaded − real cost), not unlimited.
  const [brainCredit, setBrainCredit] = useState<BrainCredit | null>(null)
  // The padlock state at entry + the unlock coming from voice (the voiceprint
  // matched → realtimeVoice emits `kelion:admin-unlock`).
  useEffect(() => {
    if (user.role !== 'admin') return
    fetch('/api/admin/unlock/status', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { armed?: boolean; unlocked?: boolean } | null) => {
        if (j) setAdminLock({ armed: !!j.armed, unlocked: !!j.unlocked })
      })
      .catch(() => {})
    const onUnlock = (): void =>
      setAdminLock((s) => (s ? { ...s, unlocked: true } : { armed: true, unlocked: true }))
    window.addEventListener('kelion:admin-unlock', onUnlock)
    return () => window.removeEventListener('kelion:admin-unlock', onUnlock)
  }, [user.role])
  // The SINGLE gate to the admin panel: all roads (button, navigation from
  // voice/chat, the Stripe bag) pass through here — locked → the code window.
  const openAdmin = (tab?: typeof adminTab): void => {
    if (tab) setAdminTab(tab)
    const l = adminLockRef.current
    if (l?.armed && !l.unlocked) {
      setUnlockErr('')
      setUnlockCode('')
      setUnlockOpen(true)
      return
    }
    setAdminOpen(true)
  }
  const submitUnlock = (): void => {
    void fetch('/api/admin/unlock', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ secret: unlockCode }),
    })
      .then((r) => {
        if (r.ok) {
          setAdminLock((s) => (s ? { ...s, unlocked: true } : { armed: true, unlocked: true }))
          setUnlockOpen(false)
          setAdminOpen(true)
        } else setUnlockErr(r.status === 401 ? uiStrings().unlockWrongCode : uiStrings().unlockRetryError)
      })
      .catch(() => setUnlockErr(uiStrings().unlockNetError))
  }
  // Polling from the shared source (lib/usePolledJson) — the `alive` guard and the
  // interval stop are guaranteed there, once only.
  usePolledJson<BrainCredit>('/api/admin/brain-credit', user.role === 'admin', (j) => {
    if (j && j.openrouter && j.pool) setBrainCredit(j)
  })
  // REAL APP ACCESS VIA VOICE/CHAT (Adrian, Jul 24: "Kelion must be able to
  // enter any app tab, for real"). Kelion calls the tool
  // `open_app_view` → ChatPanel emite `kelion:navigate` → aici deschidem chiar
  // the requested panel. Admin is gated: an ordinary user CANNOT open the admin.
  useEffect(() => {
    const onNav = (e: Event): void => {
      const d = (e as CustomEvent).detail as { view?: string; section?: string } | undefined
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
        case 'admin':
          if (user.role === 'admin') {
            // VALIDATED section (Jul 24 audit): a free string from the model
            // ("bani", "finanțe") set a nonexistent tab → empty panel. Only
            // real sections pass; otherwise the current tab stays.
            const VALID = ['finance', 'users', 'visitors', 'vchat', 'history', 'gaps', 'share', 'stores', 'inbox', 'voiceprints', 'gesturi', 'tokenuri', 'constructor', 'recuperare'] as const
            const sec = String(d?.section ?? '')
            if ((VALID as readonly string[]).includes(sec)) setAdminTab(sec as typeof adminTab)
            openAdmin()
          }
          break
        case 'home':
          setSettingsOpen(false)
          setContactOpen(false)
          setAdminOpen(false)
          break
      }
    }
    window.addEventListener('kelion:navigate', onNav)
    return () => window.removeEventListener('kelion:navigate', onNav)
  }, [user.role])
  // USER CREDIT on the logo CIRCLE (Adrian, Jul 13): the client tells from the circle
  // — green = has credit, PULSING RED = out of credit. Clients only.
  const [userCreditOut, setUserCreditOut] = useState<boolean | null>(null)
  usePolledJson<{ credits?: number }>('/api/billing/balance', user.role === 'customer', (j) => {
    if (typeof j.credits === 'number') setUserCreditOut(j.credits <= 0)
  })
  // THE AVATAR ARRANGEMENT by Adrian (Jul 11): the corner position (vw/vh) and scale,
  // edited by double-clicking the avatar. SAVED ON THE SERVER per
  // user (Jul 11 evening: "save Kelion's current size") —
  // localStorage stays only the mirror for first paint, the source of truth
  // is /api/prefs, so the arrangement survives any browser cleanup.
  // Manual arrangement is DISABLED (Adrian, Jul 24); the position comes from
  // the server. (The `avatarEdit=false` flag + its 'editing' CSS class were
  // dead weight since then — removed in the Aug 2 dead-code audit.)
  const [avatarBox, setAvatarBox] = useState<{ x: number; y: number; s: number }>({ x: 58, y: 58, s: 0.42 })
  // Fix hydration: localStorage is client-only; read it after hydration.
  useEffect(() => {
    try {
      const v = JSON.parse(localStorage.getItem('avatar-box') || '') as {
        x?: number
        y?: number
        s?: number
      }
      if (typeof v?.x === 'number' && typeof v?.y === 'number' && typeof v?.s === 'number') {
        let s = v.s
        // REVERSE MIGRATION (Jul 11, night): "avatar v2.3" had moved Adrian's size
        // from the CSS container into the 3D model scale (localStorage
        // kelion-avatar-scale) and had reset s to 0.42 — but 3D scaling cuts
        // the head/soles out of frame at large sizes. The chosen size is brought
        // BACK into the container and the old key is deleted.
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
  // RING DE DANS (Adrian, 12 iul, prin Kelion: „la dansuri, avatarul se
  // automatically repositions toward the center of the screen while the clip lasts"):
  // on a dance gesture, the corner glides toward the center and grows; at the end
  // of the clip (kelion-gesture-done) it returns exactly to Adrian's arrangement.
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
    let alive = true
    void (async () => {
      const prefs = await loadServerPrefs()
      if (!alive) return
      const b = prefs?.avatarBox
      if (b && typeof b.x === 'number' && typeof b.y === 'number' && typeof b.s === 'number') {
        setAvatarBox({ x: b.x, y: b.y, s: b.s })
      } else if (prefs) {
        // First sync: the CURRENT arrangement (the one in Adrian's browser)
        // becomes the one saved on the server — exactly "save the current size".
        void saveAvatarBox(avatarBoxRef.current)
      }
      avatarSyncRef.current = 'ready'
    })()
    return () => {
      alive = false
    }
  }, [])
  useEffect(() => {
    avatarBoxRef.current = avatarBox
    try {
      localStorage.setItem('avatar-box', JSON.stringify(avatarBox))
    } catch {
      /* local storage may be missing — the arrangement stays only for this session */
    }
    if (avatarSyncRef.current !== 'ready') return
    // Debounce: during drag/wheel dozens of values arrive per second —
    // only the final placement goes to the server, 800ms after the last movement.
    const t = window.setTimeout(() => void saveAvatarBox(avatarBox), 800)
    return () => window.clearTimeout(t)
  }, [avatarBox])
  // Voice-armed recorder: "înregistrează" makes the Rec button pulse red — one
  // click starts (the browser demands a real click to pick the screen);
  // "oprește înregistrarea" stops fully hands-free.
  const [recArmed, setRecArmed] = useState(false)
  const recRef = useRef<RecordingHandle | null>(null)
  // Suggestive file name for the next clip (e.g. kelionai-cafenea-30s-20260702),
  // set by the promo pipeline; falls back to the timestamp name.
  const recNameRef = useRef<string | null>(null)
  const ws = useSyncExternalStore(subscribeWorkspace, getWorkspace)

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
      if (e.propertyName === 'transform') window.dispatchEvent(new Event('resize'))
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
    const id = requestAnimationFrame(() => window.dispatchEvent(new Event('resize')))
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
        // Clip finished — promo scenes still pending get cancelled, stage cleared.
        window.dispatchEvent(new Event('kelion:rec-stopped'))
      },
      () => setRecording(false),
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
      const d = (e as CustomEvent).detail as string | { action?: string; name?: string }
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

  // NEW VERSION — NON-intrusive (Adrian, Jul 10: "chat destroyed, audio and written").
  // App.tsx shows the "Update now" bar (watchForUpdate) and YOU press when you're
  // ready — the hard reset stays, but at your command, not over the chat.

  // Presence ping (every 60s): feeds the owner's per-USER analytics — who is
  // signed in, from what IP/place/device, and for how long they stayed.
  useEffect(() => {
    let stopped = false
    const ping = (): void => {
      void deviceFingerprint()
        .then((fp) => {
          if (stopped) return
          return fetch('/api/visit/ping', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fp }),
          })
        })
        .catch(() => {})
    }
    ping()
    const id = window.setInterval(ping, 60_000)
    return () => {
      stopped = true
      window.clearInterval(id)
    }
  }, [])
  // The monitor (the surface behind the avatar) is opened ONLY by a real task
  // (map, page, doc, image) — the avatar shrinks into the corner while something's up
  // pe ecran, altfel e prim-plan.
  const monitorOn = ws.open
  // CLOSING IN SYNC WITH THE FADE (fluidity #7, Jul 27: "the content disappears
  // instantly, the black panel persists 500ms more"): during the fade (500ms in
  // CSS) we render A SNAPSHOT of the last state — the panel fades WITH the content in it,
  // not empty. Sound sources aren't rendered from the snapshot (would restart the clip).
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
  // Tell the chat when the monitor is busy so it collapses to the slim black
  // speech bar (Adrian's rule) when a surface is open.
  useEffect(() => {
    setMonitorWorking(monitorOn)
  }, [monitorOn])
  return (
    // rec-clean: while a clip records, everything "admin" disappears (topbar,
    // chat bubbles) and the site address is watermarked into the frame.
    <div className={`stage ${recording ? 'rec-clean' : ''}`}>
      {recording && <div className="rec-watermark">kelionai.app</div>}
      {/* Skill monitor mode: the workspace surface behind the avatar. */}
      <div className={`workspace-bg ${monitorOn ? 'open' : ''}`}>
        {(wsv.open || wsFading) && (
          <div className="workspace-inner">
            <div className="workspace-head">
              <div className="workspace-tabs">
                {wsv.tasks.map((task) => (
                  <button
                    key={task.id}
                    type="button"
                    className={`ws-tab ${task.id === wsv.activeId ? 'active' : ''}`}
                    onClick={() => switchToId(task.id)}
                    title={task.title}
                  >
                    <span className="ws-tab-label">{task.title}</span>
                    <span
                      className="ws-tab-x"
                      role="button"
                      aria-label={t.wsClose}
                      onClick={(e) => {
                        e.stopPropagation()
                        closeTask(task.id)
                      }}
                    >
                      ✕
                    </span>
                  </button>
                ))}
              </div>
              <div className="ws-zoom" title={t.wsZoomFit}>
                <button type="button" className="ghost" onClick={zoomOut} aria-label={t.wsZoomOut}>
                  A−
                </button>
                <span className="ws-zoom-val">{Math.round(monZoom * 100)}%</span>
                <button type="button" className="ghost" onClick={zoomIn} aria-label={t.wsZoomIn}>
                  A+
                </button>
              </div>
              {wsv.tasks.length > 1 && (
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
            {/* LIVE TABS (fluidity #6, Jul 27: „the monitor tabs reload the page
            from scratch on every switch”): all surfaces stay MOUNTED — switching
            only hides/shows them, no reload, no lost scroll/state. EXCEPTION:
            SOUND sources (youtube/video/audio) mount ONLY when active, otherwise
            a hidden clip would play over Kelion's voice. */}
            {wsv.tasks.map((task) => {
              const active = task.id === wsv.activeId
              const sonor = task.kind === 'youtube' || task.kind === 'video' || task.kind === 'audio'
              if (sonor && (!active || !ws.open)) return null
              return (
                <div key={task.id} style={active ? { display: 'contents' } : { display: 'none' }}>
                {task.kind === 'build' ? (
                  // THE CONSTRUCTOR PANEL (Stage 4b) — own poller, no url/text.
                  <BuildSurface zoom={monZoom} />
                ) : task.html ? (
                  // PLAYGROUND: the page written by Kelion runs live in an isolated
                  // iframe (srcdoc + sandbox, no same-origin → it can't reach
                  // the session/app). The button saves the page as .html on disc.
                  <div className="workspace-doc">
                    <button
                      type="button"
                      className="doc-copy"
                      onClick={() => saveDocToKelion(task.title, task.html ?? '', safeFileName(task.title, 'html'), 'text/html')}
                      title={t.wsSaveHtml}
                    >
                      {docSaved ? t.wsSaved : t.wsSave}
                    </button>
                    <iframe
                      title={task.title}
                      srcDoc={task.html}
                      className="workspace-frame"
                      sandbox="allow-scripts allow-modals allow-forms allow-popups allow-pointer-lock"
                    />
                  </div>
                ) : task.text ? (
                  <div className="workspace-doc">
                    <button
                      type="button"
                      className="doc-copy"
                      onClick={() => void navigator.clipboard?.writeText(task.text ?? '')}
                      title={t.wsCopy}
                    >
                      {t.wsCopy}
                    </button>
                    <button
                      type="button"
                      className="doc-copy"
                      style={{ right: '6.5rem' }}
                      onClick={() => saveDocToKelion(task.title, task.text ?? '', safeFileName(task.title, 'txt'), 'text/plain')}
                      title={t.wsSaveTxt}
                    >
                      {docSaved ? t.wsSaved : t.wsSave}
                    </button>
                    <pre className="doc-text" style={{ fontSize: `${monZoom}em` }}>{task.text}</pre>
                  </div>
                ) : task.card ? (
                  <CardView card={task.card} />
                ) : task.url && task.kind === 'image' ? (
                  // ORICE IMAGINE (Adrian, 27 iul: „pe monitor orice tip de date").
                  // onLoad/onError → the real state, so Kelion factually sees it.
                  <MonitorImage url={task.url} title={task.title} taskId={task.id} />
                ) : task.url && task.kind === 'video' ? (
                  <MonitorVideo url={task.url} taskId={task.id} />
                ) : task.url && task.kind === 'audio' ? (
                  <MonitorAudio url={task.url} taskId={task.id} />
                ) : task.url && task.kind === 'pdf' ? (
                  // PDF: the browser's native viewer, in a frame.
                  <DocFrame title={task.title} src={task.url} taskId={task.id} />
                ) : task.url && task.kind === 'office' ? (
                  // XLS/DOC/PPT: the Microsoft Office online viewer (the file must
                  // be at a public URL — the ones served by kelionai.app are).
                  <DocFrame
                    title={task.title}
                    src={`https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(task.url)}`}
                    taskId={task.id}
                  />
                ) : task.url && task.kind === 'markdown' ? (
                  // MARKDOWN (Aug 2): rendered formatted, not raw text.
                  <MonitorMarkdown url={task.url} zoom={monZoom} taskId={task.id} />
                ) : task.url && task.kind === 'htmlfile' ? (
                  // A saved .html page: runs sandboxed like the playground 'app'.
                  <MonitorHtmlFile url={task.url} taskId={task.id} />
                ) : task.url && task.kind === 'textfile' ? (
                  // Code / text / json / csv: we fetch the content and show it readable.
                  <MonitorTextFile url={task.url} zoom={monZoom} taskId={task.id} />
                ) : task.url && task.kind === 'archive' ? (
                  // Archives: the browser can't open them in page — we offer
                  // the download, honestly (a zip's content doesn't render natively).
                  <div className="workspace-blocked">
                    <p>{t.wsArchiveNote.replace('{name}', task.title)}</p>
                    <a href={task.url} download className="composer-send">{t.wsDownloadArchive}</a>
                  </div>
                ) : task.url && task.kind === 'file' ? (
                  // BINARIES without an in-page viewer (Aug 2 — epub/exe/apk/dmg/
                  // fonts): an honest panel + download instead of a dead frame.
                  <div className="workspace-blocked">
                    <p>{task.title} — {t.wsFileNoPreview}</p>
                    <a href={task.url} download className="composer-send">{t.wsDownloadFile}</a>
                  </div>
                ) : task.url && isEmbeddable(task.url) ? (
                  <iframe
                    title={task.title}
                    src={normalizeEmbedUrl(task.url)}
                    className="workspace-frame"
                    sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                    onLoad={() => setTaskStatus(task.id, 'ok')}
                    onError={() => setTaskStatus(task.id, 'error')}
                    // ONE voice — Kelion's. Surfaces stay SILENT (no autoplay audio):
                    // only a YouTube clip the user chose to watch may play sound. The
                    // route map gets geolocation (no audio) so it can follow the car.
                    allow={
                      task.kind === 'youtube'
                        ? 'autoplay; encrypted-media; picture-in-picture; fullscreen'
                        : task.kind === 'map'
                          ? 'geolocation'
                          : ''
                    }
                  />
                ) : task.url ? (
                  <div className="workspace-blocked">
                    <p>{t.wsPageBlocked}</p>
                    {/^https?:\/\//i.test(task.url) && (
                      <a href={task.url} target="_blank" rel="noreferrer" className="composer-send">
                        {t.wsOpenTab}
                      </a>
                    )}
                  </div>
                ) : null}
                </div>
              )
            })}
          </div>
        )}
      </div>
      {/* Avatar canvas — shrinks to the corner in monitor mode. ADRIAN'S
      LAYOUT (Jul 11: „I want access to rescale the avatar myself and position
      it as I see fit, by double-clicking it”): double-click on the avatar =
      layout mode — drag to move it, the wheel to scale it, double-click again
      = done; remembered ON THE SERVER (/api/prefs, per user) with a
      localStorage mirror. */}
      <div
        ref={stageRef}
        className={`stage-canvas ${monitorOn ? 'pip' : ''}`}
        style={
          monitorOn
            ? {
                // During a dance, the ring is the center of the screen (bigger,
                // visible); otherwise, exactly Adrian's saved arrangement.
                transform: dancing
                  ? `translate(calc(30vw - 14px), calc(30vh - 180px)) scale(${Math.max(avatarBox.s, 0.62)})`
                  : `translate(calc(${avatarBox.x}vw - 14px), calc(${avatarBox.y}vh - 180px)) scale(${avatarBox.s})`,
              }
            : undefined
        }
      >
      {/* MANUAL LAYOUT MODE DISABLED (Adrian, Jul 24: „disable the wheel
      window for manual moves and adjustments”) — double-click no longer
      opens the drag/scale-with-wheel window; the layout saved on the server
      stays exactly as it is. */}
      {/* Adrian, Jul 11: „the avatar must be fully visible” + „his feet are
      not fully seen” — the motion clips sway the hips, so below the soles
      (−1.65) there must be real air: camera centered at y −0.25, distance
      4.6 → the frame covers −1.93…+1.43. The final size is decided by Adrian
      with a double-click (the layout mode below). */}
      <Canvas shadows="percentage" camera={{ position: [0, -0.25, 4.6], fov: 40 }} dpr={[1, 2]} gl={{ alpha: true }}>
        {/* Solid backdrop full-screen; TRANSPARENT in presentation (pip) mode so
            Kelion floats over the monitor content instead of sitting in a black box. */}
        {!monitorOn && <color attach="background" args={[themeBg()]} />}
        {/* Self-contained lighting (key + cool fill + rim) — NO remote HDR.
            `<Environment preset="city">` fetched a ~1MB HDR from an external CDN
            (githack/pmndrs) INSIDE the avatar's Suspense: on a fresh phone with a
            slow or blocked network that fetch could hang, so the Suspense never
            resolved and the avatar stayed BLACK forever (Adrian, Jul 8: „the app
            published and broken”). The landing already dropped HDR for this exact
            reason; the in-app stage now matches — same look, zero external deps. */}
        <ambientLight intensity={0.75} />
        <directionalLight position={[2, 3, 2]} intensity={1.6} castShadow />
        <directionalLight position={[-2.5, 1.2, -2]} intensity={0.7} color="#8fb6ff" />
        <Suspense fallback={null}>
          <AvatarModel />
        </Suspense>
        {/* The camera limits come from the shared source (lib/avatarCamera) —
        the same on the landing and in the app, so Kelion is framed identically. */}
        <OrbitControls {...AVATAR_ORBIT} />
      </Canvas>
      <AvatarLoading />
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
        {/* Adrian's ALWAYS-ON status (admin, top-left): shows what's being worked
            on when there's live work, else the real Linux server load — so the
            server status + current task never vanish (they used to hide when the
            work console closed). */}
        {user.role === 'admin' && (
          <>
            {/* KELION'S WALLET in the bar (Adrian, Jul 24: „show the admin the
            reality”): the REAL BALANCE, exactly from the OpenRouter account (USD) —
            the central brain. Red when below threshold. Click → top-up. */}
            {brainCredit && (
              <button
                type="button"
                className={`ghost ${brainCredit.openrouter.low ? 'blink-red' : ''}`}
                onClick={() => window.open(brainCredit.openrouter.topup, '_blank', 'noopener')}
                title={
                  brainCredit.openrouter.live
                    ? adminStrings()
                        .orPillLive.replace('{n}', (brainCredit.openrouter.balance ?? 0).toFixed(2))
                        .replace('{low}', brainCredit.openrouter.low ? adminStrings().orPillLow : '')
                    : adminStrings().orPillDead
                }
              >
                {brainCredit.openrouter.live
                  ? `OpenRouter $${(brainCredit.openrouter.balance ?? 0).toFixed(2)}`
                  : '⚠ OpenRouter'}
              </button>
            )}
            {/* THE OPENAI PILL (Adrian: "REAL everywhere, zero fabrications"),
            IMMEDIATELY to the right of the OpenRouter one: the REAL month-to-date
            spend read from OpenAI's own costs API — the figure the "voice_minutes"
            estimate in the Money tab can be checked against. Key missing or read
            failed → "⚠ OpenAI", never "$0.00". */}
            {brainCredit && (
              <button
                type="button"
                className="ghost"
                onClick={() => window.open('https://platform.openai.com/usage', '_blank', 'noopener')}
                title={
                  brainCredit.openai?.live
                    ? adminStrings().oaPillLive.replace('{n}', (brainCredit.openai.monthUsd ?? 0).toFixed(2))
                    : adminStrings().oaPillDead
                }
              >
                {brainCredit.openai?.live
                  ? `OpenAI $${(brainCredit.openai.monthUsd ?? 0).toFixed(2)}`
                  : '⚠ OpenAI'}
              </button>
            )}
            {/* THE SERPER PILL (same "REAL everywhere" rule), IMMEDIATELY to
            the right of the OpenAI one: the REAL remaining search credit read
            from Serper's own /account endpoint — the wallet the web search
            skill spends from. Key missing or read failed → "Serper ⚠", never
            "Serper 0": a failed read is not an empty account. Click → the
            provider's dashboard. */}
            {brainCredit && (
              <button
                type="button"
                className="ghost"
                onClick={() => window.open('https://serper.dev/dashboard', '_blank', 'noopener')}
                title={
                  brainCredit.serper?.live
                    ? adminStrings().serperPillLive.replace('{n}', (brainCredit.serper.balance ?? 0).toLocaleString())
                    : adminStrings().serperPillDead
                }
              >
                {brainCredit.serper?.live
                  ? `Serper ${formatSerperK(brainCredit.serper.balance ?? 0)}`
                  : 'Serper ⚠'}
              </button>
            )}
            {/* THE VPS, PERMANENT IN THE BAR (Adrian, Jul 31: „show the VPS
            permanently on the interface in the top bar”). Two figures, because they
            answer two different questions: RAM = does anything else FIT on the
            machine, CPU = can it still COPE. Red when memory drops under 10% free
            or the load passes 200% — the same thresholds as the sentinel's email
            alarm, so the bar and the mail never contradict. When it can't be
            measured it writes „⚠ VPS”, not zeros (see the type). */}
            {brainCredit && (
              <button
                type="button"
                className={`ghost ${
                  brainCredit.vps && (brainCredit.vps.liberPct <= 10 || brainCredit.vps.incarcarePct >= 200)
                    ? 'blink-red'
                    : ''
                }`}
                onClick={() => openAdmin()}
                title={
                  brainCredit.vps
                    ? adminStrings()
                        .vpsPillLive.replace('{free}', brainCredit.vps.liberGb.toFixed(1))
                        .replace('{total}', brainCredit.vps.totalGb.toFixed(1))
                        .replace('{load}', String(brainCredit.vps.incarcarePct))
                        .replace('{cpus}', String(brainCredit.vps.procesoare))
                        .replace('{avg}', brainCredit.vps.incarcare.map((n) => n.toFixed(2)).join(' / '))
                    : adminStrings().vpsPillDead
                }
              >
                {brainCredit.vps
                  ? `VPS ${brainCredit.vps.liberGb.toFixed(1)}GB · ${brainCredit.vps.incarcarePct}%`
                  : '⚠ VPS'}
              </button>
            )}
            {/* HERE STOOD THE „Stripe £0.00” PILL from the top bar. Removed on
            Jul 30, together with Stripe: the users' money no longer passes through
            it — they pay on the Revolut link, straight into Adrian's account. The
            figure left there would have never shown anything but zero — exactly
            the kind of „0” that means nothing and scares for no reason. What
            remains in the bar is the brain's balance (OpenRouter), the only one
            the app can actually read. */}
          </>
        )}
        {/* Credit + top-up for regular users (Adrian, Jul 24). From the
        wallet menu you also reach Settings and the Gmail connection — the bar
        no longer has the separate ⚙ wheel, nor the „Connect Google” button.
        THE ADMIN NO LONGER HAS THE „⚙ Setări" PILL HERE (Adrian's order):
        his settings live in the Admin panel now, so the header keeps only
        measurements (OpenRouter / OpenAI / Serper / VPS). */}
        {user.role !== 'admin' && (
          <WalletButton
            onOpenSettings={() => setSettingsOpen(true)}
            googleConnected={user.googleConnected}
            onConnectGoogle={startGoogleConnect}
          />
        )}
        {/* „Add credits" for regular users (Adrian's order — the exact label,
        English for all users): opens the existing credits panel (the wallet
        menu with the 75/150/375 packs + custom amount ×5). */}
        {user.role !== 'admin' && (
          <button
            type="button"
            className="ghost"
            onClick={() => window.dispatchEvent(new Event('kelion:wallet-open'))}
            title="Add credits — pick a pack or type an amount"
          >
            Add credits
          </button>
        )}
        <div className="who">
          {/* App downloads live ONLY on the landing page now — four QR codes,
              click-to-enlarge. The topbar stays clean for signed-in users. */}
          {user.picture && <img src={user.picture} alt="" className="avatar-pic" />}
          <span>{user.name}</span>
          {user.role === 'admin' && <span className="badge">admin</span>}
          {user.role === 'admin' && (
            <button
              type="button"
              className={`ghost ${recording ? 'rec-on' : ''} ${recArmed && !recording ? 'rec-armed' : ''}`}
              onClick={() => {
                setRecArmed(false)
                void toggleRecording()
              }}
              title={recording ? t.recStopTitle : t.recStartTitle}
            >
              {recording ? '■ Rec' : '● Rec'}
            </button>
          )}
          {user.role === 'admin' && (
            <button
              type="button"
              className="ghost"
              onClick={() => openAdmin()}
              title={adminLock?.armed && !adminLock.unlocked ? t.lockedTitle : undefined}
            >
              {adminLock?.armed && !adminLock.unlocked ? '🔒 Admin' : 'Admin'}
            </button>
          )}
          {!user.googleConnected && (
            <button
              type="button"
              className="ghost"
              onClick={startGoogleConnect}
              title={t.connectGoogleTitle}
            >
              {t.connectGoogle}
            </button>
          )}
          <button
            type="button"
            className="ghost"
            onClick={() => setTheme(toggleTheme())}
            title={theme === 'light' ? t.themeToDark : t.themeToLight}
            aria-label={theme === 'light' ? t.themeToDark : t.themeToLight}
          >
            {theme === 'light' ? '☾' : '☀'}
          </button>
          <button type="button" className="ghost" onClick={() => setContactOpen(true)}>
            {t.contactLabel}
          </button>
          <button type="button" className="ghost" onClick={() => void logout()}>
            {t.signOut}
          </button>
        </div>
      </header>

      <ChatPanel lang={lang} isAdmin={user.role === 'admin'} />

      {unlockOpen && (
        <div className="unlock-overlay" onClick={() => setUnlockOpen(false)}>
          <div className="unlock-card" onClick={(e) => e.stopPropagation()}>
            <h3>{t.adminLocked}</h3>
            <p>{t.adminLockedHint}</p>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                submitUnlock()
              }}
            >
              <input
                type="password"
                autoFocus
                value={unlockCode}
                onChange={(e) => setUnlockCode(e.target.value)}
                placeholder={t.unlockPlaceholder}
                autoComplete="current-password"
              />
              <button type="submit">{t.adminUnlock}</button>
            </form>
            {unlockErr && <p className="unlock-err">{unlockErr}</p>}
          </div>
        </div>
      )}
      {adminOpen && (
        <AdminPanel
          initialTab={adminTab}
          onClose={() => setAdminOpen(false)}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      )}

      {contactOpen && <ContactModal onClose={() => setContactOpen(false)} />}

      {settingsOpen && <CustomerSettings user={user} onClose={() => setSettingsOpen(false)} />}

    </div>
  )
}
