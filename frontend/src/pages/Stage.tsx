import { Suspense, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Canvas } from '@react-three/fiber'
import { Environment, OrbitControls } from '@react-three/drei'
import AvatarModel from '../components/AvatarModel'
import ChatPanel from '../components/ChatPanel'
import AdminPanel from '../components/AdminPanel'
import ContactModal from '../components/ContactModal'
import { WalletButton } from '../components/WalletButton'
import { CardView } from '../components/CardView'
import type { User } from '../lib/api'
import { logout, startGoogleLogin } from '../lib/api'
import { resolveLang, strings } from '../lib/i18n'
import {
  getWorkspace,
  subscribeWorkspace,
  closeTask,
  closeAllTasks,
  switchToId,
  normalizeEmbedUrl,
  isEmbeddable,
} from '../lib/workspace'
import { startRecording, type RecordingHandle } from '../lib/recorder'
import { keepScreenOn } from '../lib/wakelock'
import { deviceFingerprint } from '../lib/fingerprint'

// Live-work feed shown ON KELION'S MONITOR. A line shaped "[NN%] text" is a
// WORK ITEM: it stays on the monitor permanently, its bar fills 0→100% in
// place (the same text at a new percent replaces the old line), and at 100%
// it is ticked off (dimmed + strikethrough) but remains listed. Plain lines
// are status notes — only the latest few stay; stale ones disappear.
interface LiveItem {
  key: string
  text: string
  pct: number
}
function parseLive(lines: string[]): { tasks: LiveItem[]; status: string[] } {
  const tasks: LiveItem[] = []
  const status: string[] = []
  const seen = new Set<string>()
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = /^\s*\[(\d{1,3})%\]\s*(.*)$/.exec(lines[i])
    const text = (m ? m[2] : lines[i]).trim()
    if (!text) continue
    const key = text.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    if (m) tasks.unshift({ key, text, pct: Math.min(100, Number(m[1])) })
    else if (status.length < 1) status.unshift(text)
  }
  return { tasks: tasks.slice(-30), status }
}

export default function Stage({ user }: { user: User }) {
  const lang = resolveLang(user.locale)
  const t = strings(lang)
  const [adminOpen, setAdminOpen] = useState(false)
  const [contactOpen, setContactOpen] = useState(false)
  const [recording, setRecording] = useState(false)
  // Lit ORANGE when the laptop Claude Code session is actively writing code, so
  // the owner sees when Claude is working on his behalf (admin only). The live
  // work steps are shown on the monitor while active.
  const [claudeActive, setClaudeActive] = useState(false)
  // TWO LIGHTS, one per link in the chain. "Bridge" = Claude's bridge worker
  // (lit = reachable, pulsing = writing code, OFF = down — the watchdog
  // restarts it and the light re-lights by itself). "Server" = kelionai.app
  // itself (poll failing = OFF; Railway auto-restarts it, light comes back).
  const [claudeBridge, setClaudeBridge] = useState(false)
  const [serverUp, setServerUp] = useState(true)
  const [claudeActivity, setClaudeActivity] = useState<string[]>([])
  // Real Linux server load (posted by the VPS paznic) — bottom-left readout.
  const [srvLoad, setSrvLoad] = useState('')
  // The CURRENT process, 0→100%, from intake to finish (his real requirement:
  // the bar tracks what's being executed, start to end — not server resources).
  const [progress, setProgress] = useState<{ pct: number; label: string; file: string } | null>(
    null,
  )
  // The live-work console is NOT permanent on the owner's monitor — the AIs
  // see the journal server-side regardless. He opens it only when he wants:
  // one click on the "● Bridge" light shows/hides it.
  const [showWork, setShowWork] = useState(false)
  // Voice-armed recorder: "înregistrează" makes the Rec button pulse red — one
  // click starts (the browser demands a real click to pick the screen);
  // "oprește înregistrarea" stops fully hands-free.
  const [recArmed, setRecArmed] = useState(false)
  const recRef = useRef<RecordingHandle | null>(null)
  // Suggestive file name for the next clip (e.g. kelionai-cafenea-30s-20260702),
  // set by the promo pipeline; falls back to the timestamp name.
  const recNameRef = useRef<string | null>(null)
  const ws = useSyncExternalStore(subscribeWorkspace, getWorkspace)

  // Free-trial countdown: for a demo session, tick to zero, then show the
  // conversion overlay (sign in + buy credit).
  const [demoLeft, setDemoLeft] = useState(() =>
    user.role === 'demo' && user.demoUntil
      ? Math.max(0, Math.ceil((user.demoUntil - Date.now()) / 1000))
      : 0,
  )
  useEffect(() => {
    if (user.role !== 'demo' || !user.demoUntil) return
    const id = window.setInterval(() => {
      setDemoLeft(Math.max(0, Math.ceil(((user.demoUntil ?? 0) - Date.now()) / 1000)))
    }, 1000)
    return () => window.clearInterval(id)
  }, [user.role, user.demoUntil])
  const demoOver = user.role === 'demo' && !!user.demoUntil && demoLeft <= 0
  const mmss = `${Math.floor(demoLeft / 60)}:${String(demoLeft % 60).padStart(2, '0')}`

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

  // Poll whether the laptop Claude Code session is actively writing code.
  useEffect(() => {
    if (user.role !== 'admin') return
    const check = (): void => {
      void fetch('/api/dev/status', { credentials: 'include' })
        .then((r) => {
          // 429 = rate-limited, NOT down. A transient throttle must never
          // flicker the lights — keep the last known state and move on.
          if (r.status === 429) return null
          if (!r.ok) throw new Error('server')
          return r.json()
        })
        .then(
          (j: {
            active?: boolean
            bridge?: boolean
            activity?: string[]
            srv?: string
            progress?: { pct?: number; label?: string; file?: string }
          } | null) => {
            if (!j) return // 429 — state unchanged
            setServerUp(true)
            setClaudeActive(!!j.active)
            setClaudeBridge(!!j.bridge)
            setClaudeActivity(Array.isArray(j.activity) ? j.activity : [])
            setSrvLoad(typeof j.srv === 'string' ? j.srv : '')
            const p = j.progress
            setProgress(
              p && typeof p.pct === 'number'
                ? { pct: Number(p.pct), label: String(p.label ?? ''), file: String(p.file ?? '') }
                : null,
            )
          },
        )
        .catch(() => {
          // A real failure (network / 5xx) → the SERVER light goes off (and with
          // it the bridge). Transient 429s are handled above and never reach here.
          setServerUp(false)
          setClaudeBridge(false)
          setClaudeActive(false)
        })
    }
    check()
    // 2s cadence: the paznic posts real numbers every ~2s, so the bars move
    // smoothly and live (CSS eases each change over the gap).
    const id = window.setInterval(check, 2_000)
    return () => window.clearInterval(id)
  }, [user.role])

  // AUTO-REFRESH on release: when the served bundle name changes (a deploy
  // landed), the page reloads ITSELF — nobody has to press F5 ever again.
  useEffect(() => {
    const current = document.querySelector('script[src*="index-"]')?.getAttribute('src') ?? ''
    if (!current) return
    const id = window.setInterval(() => {
      void fetch('/index.html', { cache: 'no-store' })
        .then((r) => r.text())
        .then((html) => {
          const m = html.match(/index-[A-Za-z0-9_-]+\.js/)
          if (m && !current.includes(m[0])) {
            // Release refresh — mark it so ChatPanel restores the conversation
            // (a plain login/new visit starts clean instead).
            sessionStorage.setItem('kelion_restore_chat', '1')
            window.location.reload()
          }
        })
        .catch(() => {})
    }, 45_000)
    return () => window.clearInterval(id)
  }, [])

  // AUTO-WAKE THE BUILDER: the instant the app confirms an ADMIN user, it sets
  // the server wake flag the laptop wake-agent polls. The old second channel —
  // a hidden iframe firing kelionai:// every 90s — was THE source of the
  // visible cmd flashes (Chrome launched the .cmd launcher with a console
  // window at exactly 90s intervals; trapped and proven 4 iul). The builder now
  // pulls its own work orders, so the protocol launch is gone for good.
  useEffect(() => {
    if (user.role !== 'admin') return
    const wake = (): void => {
      void fetch('/api/bridge/request-wake', { method: 'POST', credentials: 'include' }).catch(
        () => {},
      )
    }
    wake()
    const id = window.setInterval(wake, 90_000)
    return () => window.clearInterval(id)
  }, [user.role])

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
  // Claude's live work shows on Kelion's MONITOR (the workspace surface) ONLY
  // when the owner opens it (click on the ● Bridge light) and code is being
  // written: the avatar shrinks to its corner and the monitor lists every work
  // item with its live 0→100% bar. A real task (map, page, doc) always wins
  // the monitor back; nothing is displayed permanently.
  // OBLIGATORY: while there is active work, the monitor shows it BY ITSELF (no
  // click). The Bridge-light click only lets the owner FORCE it open when idle.
  const claudeShow =
    user.role === 'admin' &&
    !recording &&
    ((claudeActive && claudeActivity.length > 0) || showWork)
  const live = claudeShow && !ws.open ? parseLive(claudeActivity) : null
  const monitorOn = ws.open || (claudeShow && claudeActivity.length > 0)
  return (
    // rec-clean: while a clip records, everything "admin" disappears (topbar,
    // chat bubbles) and the site address is watermarked into the frame.
    <div className={`stage ${recording ? 'rec-clean' : ''}`}>
      {recording && <div className="rec-watermark">kelionai.app</div>}
      {/* Skill monitor mode: the workspace surface behind the avatar. */}
      <div className={`workspace-bg ${monitorOn ? 'open' : ''}`}>
        {!ws.open && live && (
          <div className="workspace-inner claude-console">
            <div className="claude-console-head">
              ● Creierul Linux — execuție în direct
              <span className={`live-dot ${claudeActive ? 'on' : ''}`}>
                {claudeActive ? 'LIVE' : 'în așteptare'}
              </span>
            </div>
            {/* BARA PROCESULUI 0→100% — CE SE EXECUTĂ acum, de la început
                (preluare) până la final (live/gata). Se umple fluid pe măsură ce
                procesul trece prin etape; arată și fișierul la care se lucrează.
                Asta a cerut Adrian: procesul de la început la sfârșit, nu resurse. */}
            {progress && progress.pct > 0 && (
              <div className="proc-progress">
                <div className="proc-top">
                  <span className="proc-label">
                    {progress.label || 'În lucru'}
                    {progress.file ? <span className="proc-file"> · {progress.file}</span> : null}
                  </span>
                  <span className="proc-pct">{progress.pct}%</span>
                </div>
                <div className="proc-track">
                  <div
                    className={`proc-fill ${progress.pct >= 100 ? 'done' : ''}`}
                    style={{ width: `${Math.max(0, Math.min(100, progress.pct))}%` }}
                  />
                </div>
              </div>
            )}
            {/* JURNAL LIVE: fiecare pas al creierului, în ordine, nu o singură
                linie. Progres cu bară pentru pașii cu procent; restul ca log. */}
            <div className="claude-rows">
              {claudeActivity.length === 0 && (
                <div className="claude-status-line">În așteptare…</div>
              )}
              {claudeActivity.slice(-14).map((raw, i) => {
                const m = /^(?:\[\d{1,2}:\d{2}\]\s*)?\[(\d{1,3})%\]\s*(.*)$/.exec(raw)
                if (m) {
                  const pct = Math.min(100, Number(m[1]))
                  return (
                    <div key={i} className={`claude-row ${pct >= 100 ? 'done' : ''}`}>
                      <span className="claude-row-text">{m[2]}</span>
                      <span className="claude-row-bar">
                        <span className="claude-row-fill" style={{ width: `${pct}%` }} />
                      </span>
                      <span className="claude-row-pct">{pct >= 100 ? '✓' : `${pct}%`}</span>
                    </div>
                  )
                }
                return (
                  <div key={i} className="claude-log-line">
                    {raw}
                  </div>
                )
              })}
            </div>
            {/* Bottom-left: the REAL Linux server load in percentages (posted
                by the VPS paznic every minute) — replaces the old status line
                that duplicated the top-bar work ticker. */}
            {srvLoad && (
              <div className="claude-status">
                <div className="claude-status-line srv-load">Serv. Linux — {srvLoad}</div>
              </div>
            )}
          </div>
        )}
        {ws.open && (
          <div className="workspace-inner">
            <div className="workspace-head">
              <div className="workspace-tabs">
                {ws.tasks.map((task) => (
                  <button
                    key={task.id}
                    type="button"
                    className={`ws-tab ${task.id === ws.activeId ? 'active' : ''}`}
                    onClick={() => switchToId(task.id)}
                    title={task.title}
                  >
                    <span className="ws-tab-label">{task.title}</span>
                    <span
                      className="ws-tab-x"
                      role="button"
                      aria-label="Închide"
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
              {ws.tasks.length > 1 && (
                <button
                  type="button"
                  className="ghost"
                  onClick={closeAllTasks}
                  title="Închide tot"
                >
                  Închide tot
                </button>
              )}
            </div>
            {ws.text ? (
              <div className="workspace-doc">
                <button
                  type="button"
                  className="doc-copy"
                  onClick={() => void navigator.clipboard?.writeText(ws.text ?? '')}
                  title="Copiază"
                >
                  Copiază
                </button>
                <pre className="doc-text">{ws.text}</pre>
              </div>
            ) : ws.card ? (
              <CardView card={ws.card} />
            ) : ws.url && isEmbeddable(ws.url) ? (
              <iframe
                title={ws.title}
                src={normalizeEmbedUrl(ws.url)}
                className="workspace-frame"
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                // ONE voice — Kelion's. Surfaces stay SILENT (no autoplay audio):
                // only a YouTube clip the user chose to watch may play sound. The
                // route map gets geolocation (no audio) so it can follow the car.
                allow={
                  ws.kind === 'youtube'
                    ? 'autoplay; encrypted-media; picture-in-picture; fullscreen'
                    : ws.kind === 'map'
                      ? 'geolocation'
                      : ''
                }
              />
            ) : ws.url ? (
              <div className="workspace-blocked">
                <p>Această pagină nu poate fi afișată aici.</p>
                {/^https?:\/\//i.test(ws.url) && (
                  <a href={ws.url} target="_blank" rel="noreferrer" className="composer-send">
                    Deschide într-un tab nou ↗
                  </a>
                )}
              </div>
            ) : null}
          </div>
        )}
      </div>
      {/* Avatar canvas — shrinks to the top-right corner in monitor mode. */}
      <div ref={stageRef} className={`stage-canvas ${monitorOn ? 'pip' : ''}`}>
      <Canvas shadows camera={{ position: [0, 0.7, 2.4], fov: 40 }} dpr={[1, 2]} gl={{ alpha: true }}>
        {/* Solid backdrop full-screen; TRANSPARENT in presentation (pip) mode so
            Kelion floats over the monitor content instead of sitting in a black box. */}
        {!monitorOn && <color attach="background" args={['#0b0d12']} />}
        <ambientLight intensity={0.6} />
        <directionalLight position={[2, 3, 2]} intensity={1.4} castShadow />
        <Suspense fallback={null}>
          <AvatarModel />
          <Environment preset="city" />
        </Suspense>
        <OrbitControls
          enablePan={false}
          enableZoom={false}
          minPolarAngle={Math.PI / 2.3}
          maxPolarAngle={Math.PI / 1.95}
          // Kelion may only be turned ±3° around its axis (left/right).
          minAzimuthAngle={-Math.PI / 60}
          maxAzimuthAngle={Math.PI / 60}
          target={[0, 0.7, 0]}
        />
      </Canvas>
      </div>

      <header className="topbar">
        <span className="brand">
          <img src="/kelion-logo.png" className="brand-logo" alt="" />
          Kelionai
        </span>
        {/* Adrian's ALWAYS-ON status (admin, top-left): shows what's being worked
            on when there's live work, else the real Linux server load — so the
            server status + current task never vanish (they used to hide when the
            work console closed). */}
        {user.role === 'admin' && (
          <span
            className={`work-ticker ${claudeActivity.length > 0 ? 'busy' : ''}`}
            title={claudeActivity.length > 0 ? claudeActivity.join('\n') : `Serverul Linux — ${srvLoad || 'se conectează…'}`}
          >
            {claudeActivity.length > 0
              ? claudeActivity[claudeActivity.length - 1]
              : `🟢 Linux ${srvLoad || '…'} · liniște`}
          </span>
        )}
        {user.role === 'customer' && <WalletButton />}
        {user.role === 'demo' && !demoOver && (
          <span className="trial-pill">
            {t.trialLabel} · {mmss}
          </span>
        )}
        <div className="who">
          {/* App downloads live ONLY on the landing page now — four QR codes,
              click-to-enlarge. The topbar stays clean for signed-in users. */}
          {user.picture && <img src={user.picture} alt="" className="avatar-pic" />}
          <span>{user.name}</span>
          {user.role === 'admin' && <span className="badge">admin</span>}
          {user.role === 'admin' && (
            <span
              className={`claude-ind clickable ${claudeBridge ? 'on' : ''} ${claudeActive ? 'work' : ''}`}
              onClick={() => setShowWork((v) => !v)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') setShowWork((v) => !v)
              }}
              title={
                claudeBridge
                  ? claudeActive
                    ? 'Claude is writing code — click to show/hide the live work monitor'
                    : 'Bridge up — Claude is reachable in chat'
                  : 'BRIDGE DOWN — auto-restarting (watchdog), light returns by itself'
              }
            >
              ● Bridge
            </span>
          )}
          {user.role === 'admin' && (
            <span
              className={`claude-ind ${serverUp ? 'on' : ''}`}
              title={
                serverUp
                  ? 'Server up — kelionai.app is running'
                  : 'SERVER DOWN — Railway restarts it automatically, light returns by itself'
              }
            >
              ● Server
            </span>
          )}
          {user.role === 'admin' && (
            <span
              className={`claude-ind ${srvLoad ? 'on' : ''}`}
              title={
                srvLoad
                  ? `Serverul Linux e viu — ${srvLoad}`
                  : 'SERVERUL LINUX nu raportează — verifică paznicul pe VPS'
              }
            >
              ● Linux
            </span>
          )}
          {user.role === 'admin' && (
            <button
              type="button"
              className={`ghost ${recording ? 'rec-on' : ''} ${recArmed && !recording ? 'rec-armed' : ''}`}
              onClick={() => {
                setRecArmed(false)
                void toggleRecording()
              }}
              title={recording ? 'Stop recording' : 'Record a promo clip'}
            >
              {recording ? '■ Rec' : '● Rec'}
            </button>
          )}
          {user.role === 'admin' && (
            <button type="button" className="ghost" onClick={() => setAdminOpen(true)}>
              Admin
            </button>
          )}
          <button type="button" className="ghost" onClick={() => setContactOpen(true)}>
            Contact
          </button>
          <button type="button" className="ghost" onClick={() => void logout()}>
            {t.signOut}
          </button>
        </div>
      </header>

      {/* FULL-MONITOR live work feed (admin only): every step Claude executes on
          the laptop is mirrored here in real time. Floats over the whole monitor
          but never blocks clicks (pointer-events: none), so the owner keeps
          talking to Kelion while WATCHING the work happen. */}
      <ChatPanel lang={lang} isAdmin={user.role === 'admin'} isDemo={user.role === 'demo'} />

      {adminOpen && <AdminPanel onClose={() => setAdminOpen(false)} />}

      {contactOpen && <ContactModal onClose={() => setContactOpen(false)} />}

      {demoOver && (
        <div className="demo-over">
          <div className="demo-over-card">
            <span className="brand-lg">Kelionai</span>
            <h2>{t.trialOverTitle}</h2>
            <p>{t.trialOverBody}</p>
            <button type="button" className="google-btn" onClick={startGoogleLogin}>
              <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="#FFC107"
                  d="M43.6 20.5H42V20H24v8h11.3C33.7 32.9 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 6.1 29.6 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.3-.4-3.5z"
                />
                <path
                  fill="#FF3D00"
                  d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 6.1 29.6 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
                />
                <path
                  fill="#4CAF50"
                  d="M24 44c5.2 0 10-2 13.6-5.2l-6.3-5.2C29.2 35 26.7 36 24 36c-5.3 0-9.7-3.1-11.3-7.6l-6.6 5.1C9.6 39.6 16.2 44 24 44z"
                />
                <path
                  fill="#1976D2"
                  d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4 5.5l6.3 5.2C41.4 36.5 44 31 44 24c0-1.3-.1-2.3-.4-3.5z"
                />
              </svg>
              {t.buyCreditCta}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
