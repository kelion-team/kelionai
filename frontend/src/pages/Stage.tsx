import { Suspense, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Canvas } from '@react-three/fiber'
import { Environment, OrbitControls } from '@react-three/drei'
import AvatarModel from '../components/AvatarModel'
import ChatPanel from '../components/ChatPanel'
import AdminPanel from '../components/AdminPanel'
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

export default function Stage({ user }: { user: User }) {
  const lang = resolveLang(user.locale)
  const t = strings(lang)
  const [adminOpen, setAdminOpen] = useState(false)
  const [recording, setRecording] = useState(false)
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
  return (
    // rec-clean: while a clip records, everything "admin" disappears (topbar,
    // chat bubbles) and the site address is watermarked into the frame.
    <div className={`stage ${recording ? 'rec-clean' : ''}`}>
      {recording && <div className="rec-watermark">kelionai.app</div>}
      {/* Skill monitor mode: the workspace surface behind the avatar. */}
      <div className={`workspace-bg ${ws.open ? 'open' : ''}`}>
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
      <div ref={stageRef} className={`stage-canvas ${ws.open ? 'pip' : ''}`}>
      <Canvas shadows camera={{ position: [0, 0.7, 2.4], fov: 40 }} dpr={[1, 2]}>
        <color attach="background" args={['#0b0d12']} />
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
        {user.role === 'customer' && <WalletButton />}
        {user.role === 'demo' && !demoOver && (
          <span className="trial-pill">
            {t.trialLabel} · {mmss}
          </span>
        )}
        <div className="who">
          {/* Signed-in users can grab the native apps right from the interface;
              both are thin shells around this same app, always up to date. */}
          {user.role !== 'demo' && (
            <span className="app-dl">
              <a href="/dl/Kelionai-Setup.exe" download title={t.downloadWin}>
                ⊞
              </a>
              <a href="/dl/Kelionai.apk" download title={t.downloadAndroid}>
                🤖
              </a>
            </span>
          )}
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
          <button type="button" className="ghost" onClick={() => void logout()}>
            {t.signOut}
          </button>
        </div>
      </header>

      <ChatPanel lang={lang} isAdmin={user.role === 'admin'} isDemo={user.role === 'demo'} />

      {adminOpen && <AdminPanel onClose={() => setAdminOpen(false)} />}

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
