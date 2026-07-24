import { Suspense, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import AvatarModel from '../components/AvatarModel'
import AvatarLoading from '../components/AvatarLoading'
import ChatPanel from '../components/ChatPanel'
import AdminPanel from '../components/AdminPanel'
import ContactModal from '../components/ContactModal'
import CustomerSettings from '../components/CustomerSettings'
import { WalletButton } from '../components/WalletButton'
import { CardView } from '../components/CardView'
import type { User } from '../lib/api'
import { logout, startGoogleConnect } from '../lib/api'
import { resolveLang, strings } from '../lib/i18n'
import {
  getWorkspace,
  subscribeWorkspace,
  closeTask,
  closeAllTasks,
  switchToId,
  normalizeEmbedUrl,
  isEmbeddable,
  setMonitorWorking,
} from '../lib/workspace'
import { startRecording, type RecordingHandle } from '../lib/recorder'
import { loadServerPrefs, saveAvatarBox, loadLocalLang } from '../lib/prefs'
import { keepScreenOn } from '../lib/wakelock'
import { deviceFingerprint } from '../lib/fingerprint'

export default function Stage({ user }: { user: User }) {
  // OWNER-ul primește MEREU română (regula proiectului); restul după locale.
  // LIMBA UI (regula finală, Adrian 24 iul: „default ENGLEZĂ pentru toți; după
  // identificarea limbii se aplică procedura existentă"). Fără forțare pe rol,
  // fără locale de browser/cont: oglinda locală a limbii IDENTIFICATE de server
  // (scrisă de frame-ul {lang} → mirrorLang), altfel engleză.
  const lang = resolveLang(loadLocalLang() ?? 'en')
  const t = strings(lang)
  const [adminOpen, setAdminOpen] = useState(false)
  const [adminTab, setAdminTab] = useState<'finance' | 'users' | 'visitors' | 'vchat' | 'history' | 'gaps' | 'share' | 'stores' | 'inbox'>('finance')
  const [contactOpen, setContactOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [recording, setRecording] = useState(false)
  // Zoom/potrivire pentru textul de pe monitor (cererea #27): A− / A+ scalează
  // conținutul citibil (doc + consola live) ca să fie încadrat și lizibil.
  const [monZoom, setMonZoom] = useState(1)
  const zoomOut = (): void => setMonZoom((z) => Math.max(0.7, +(z - 0.1).toFixed(2)))
  const zoomIn = (): void => setMonZoom((z) => Math.min(1.8, +(z + 0.1).toFixed(2)))
  // Creierul e 100% OpenRouter (Kimi/GLM scoase). Un singur indicator: cheia e
  // configurată + fondul REAL al adminului (loaded − cost real), nu nelimitat.
  const [brainCredit, setBrainCredit] = useState<{
    active: string | null
    openrouter: {
      ok: boolean
      topup: string
      // Soldul REAL, exact din contul OpenRouter (USD) — „punga lui Kelion".
      balance?: number
      low?: boolean
      live?: boolean
    }
    // Punga Stripe REALĂ (banii userilor): disponibil + în tranzit.
    stripe?: { available: number; pending: number; currency: string } | null
    pool: { loaded: number; remaining: number; spent: number; profit: number }
  } | null>(null)
  useEffect(() => {
    if (user.role !== 'admin') return
    let alive = true
    const load = (): void => {
      fetch('/api/admin/brain-credit', { credentials: 'include' })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          if (alive && j && j.openrouter && j.pool) setBrainCredit(j)
        })
        .catch(() => {})
    }
    load()
    const id = window.setInterval(load, 30_000)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [user.role])
  // ACCES REAL LA APLICAȚIE PRIN VOCE/CHAT (Adrian, 24 iul: „Kelion trebuie să
  // poată intra în orice tab al aplicației, real"). Kelion cheamă unealta
  // `open_app_view` → ChatPanel emite `kelion:navigate` → aici deschidem chiar
  // panoul cerut. Adminul e gate-uit: un user obișnuit NU poate deschide adminul.
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
            // Secțiune VALIDATĂ (audit 24 iul): un string liber de la model
            // („bani", „finanțe") seta un tab inexistent → panou gol. Doar
            // secțiunile reale trec; altfel rămâne tabul curent.
            const VALID = ['finance', 'users', 'visitors', 'vchat', 'history', 'gaps', 'share', 'stores', 'inbox'] as const
            const sec = String(d?.section ?? '')
            if ((VALID as readonly string[]).includes(sec)) setAdminTab(sec as typeof adminTab)
            setAdminOpen(true)
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
  // CREDIT USER pe CERCUL-logo (Adrian, 13 iul): clientul își dă seama din cerc
  // — verde = are credit, ROȘU PULSÂND = i s-a terminat creditul. Doar clienți.
  const [userCreditOut, setUserCreditOut] = useState<boolean | null>(null)
  useEffect(() => {
    if (user.role !== 'customer') return
    let alive = true
    const load = (): void => {
      fetch('/api/billing/balance', { credentials: 'include' })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          if (alive && j && typeof j.credits === 'number') setUserCreditOut(j.credits <= 0)
        })
        .catch(() => {})
    }
    load()
    const id = window.setInterval(load, 30_000)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [user.role])
  // ARANJAREA AVATARULUI de către Adrian (11 iul): poziția (vw/vh) și scala
  // colțului, editate cu dublu-click pe avatar. SALVATĂ PE SERVER per
  // utilizator (11 iul seara: „salvează mărimea actuală a lui Kelion") —
  // localStorage rămâne doar oglinda pentru primul paint, sursa de adevăr
  // e /api/prefs, ca aranjarea să supraviețuiască oricărei curățări de browser.
  // Aranjarea manuală e DEZACTIVATĂ (Adrian, 24 iul) — rămâne doar starea
  // vizuală (fals mereu); poziția vine de pe server.
  const avatarEdit = false
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
        // MIGRARE INVERSĂ (11 iul noaptea): „avatar v2.3" mutase mărimea lui
        // Adrian din containerul CSS în scala modelului 3D (localStorage
        // kelion-avatar-scale) și resetase s la 0.42 — dar scalarea 3D taie
        // capul/tălpile din cadru la mărimi mari. Mărimea aleasă se aduce
        // ÎNAPOI în container și cheia veche se șterge.
        try {
          const old = Number(localStorage.getItem('kelion-avatar-scale'))
          if (Number.isFinite(old) && old > 0 && Math.abs(old - 1.65) > 0.01) {
            s = Math.min(0.9, Math.max(0.12, s * (old / 1.65)))
            localStorage.removeItem('kelion-avatar-scale')
          }
        } catch {
          /* fără cheia veche — nimic de migrat */
        }
        setAvatarBox({ x: v.x, y: v.y, s })
      }
    } catch {
      /* fără preferință salvată — folosim așezarea implicită */
    }
  }, [])
  // RING DE DANS (Adrian, 12 iul, prin Kelion: „la dansuri, avatarul se
  // repoziționează automat mai spre centrul ecranului cât durează clipul"):
  // pe un gest de dans, colțul se mută lin spre centru și crește; la finalul
  // clipului (kelion-gesture-done) revine exact în aranjarea lui Adrian.
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
  // Nu scriem la server ÎNAINTE să fi citit de la el — altfel implicitul local
  // ar călca peste aranjarea salvată. 'ready' abia după primul GET /api/prefs.
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
        // Prima sincronizare: aranjarea CURENTĂ (cea din browserul lui Adrian)
        // devine cea salvată pe server — exact „salvează mărimea actuală".
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
      /* stocarea locală poate lipsi — aranjarea rămâne doar pe sesiunea asta */
    }
    if (avatarSyncRef.current !== 'ready') return
    // Debounce: în timpul tragerii/rotiței vin zeci de valori pe secundă —
    // pe server pleacă doar așezarea finală, la 800ms după ultima mișcare.
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

  // VERSIUNE NOUĂ — NEintruziv (Adrian, 10 iul: „chat distrus, audio și scris").
  // App.tsx afișează bara „Update now" (watchForUpdate) și TU apeși când ești
  // gata — resetul dur rămâne, dar la comanda ta, nu peste chat.

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
  // Monitorul (suprafața din spatele avatarului) e deschis DOAR de o sarcină reală
  // (hartă, pagină, doc, imagine) — avatarul se micșorează în colț cât timp e ceva
  // pe ecran, altfel e prim-plan.
  const monitorOn = ws.open
  // Tell the chat when the monitor is busy so it collapses to the slim black
  // speech bar (Adrian's rule) când e o suprafață deschisă.
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
              <div className="ws-zoom" title="Potrivește textul (zoom)">
                <button type="button" className="ghost" onClick={zoomOut} aria-label="Micșorează">
                  A−
                </button>
                <span className="ws-zoom-val">{Math.round(monZoom * 100)}%</span>
                <button type="button" className="ghost" onClick={zoomIn} aria-label="Mărește">
                  A+
                </button>
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
                <pre className="doc-text" style={{ fontSize: `${monZoom}em` }}>{ws.text}</pre>
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
      {/* Avatar canvas — shrinks to the corner in monitor mode. ARANJAREA LUI
          ADRIAN (11 iul: „vreau acces să rescalez eu avatarul și să-l
          poziționez cum cred eu, dând dublu click pe el"): dublu-click pe
          avatar = mod de aranjare — tragi ca să-l muți, rotița ca să-l
          scalezi, dublu-click din nou = gata; se ține minte PE SERVER
          (/api/prefs, per utilizator) cu oglindă în localStorage. */}
      <div
        ref={stageRef}
        className={`stage-canvas ${monitorOn ? 'pip' : ''} ${avatarEdit ? 'editing' : ''}`}
        style={
          monitorOn
            ? {
                // În timpul unui dans, ringul e centrul ecranului (mai mare,
                // vizibil); altfel, exact aranjarea salvată a lui Adrian.
                transform: dancing
                  ? `translate(calc(30vw - 14px), calc(30vh - 180px)) scale(${Math.max(avatarBox.s, 0.62)})`
                  : `translate(calc(${avatarBox.x}vw - 14px), calc(${avatarBox.y}vh - 180px)) scale(${avatarBox.s})`,
              }
            : undefined
        }
      >
      {/* MODUL DE ARANJARE MANUALĂ DEZACTIVAT (Adrian, 24 iul: „dezactivează
          fereastra din rotiță pentru mutări și ajustări manuale") — dublu-click
          nu mai deschide fereastra de tras/scalat cu rotița; aranjarea salvată
          pe server rămâne exact cum e. */}
      {/* Adrian, 11 iul: „avatarul trebuie să se vadă complet" + „picioarele nu
          i se văd complet" — clipurile de mișcare leagănă șoldurile, deci sub
          tălpi (−1.65) trebuie aer real: camera centrată la y −0.25, distanța
          4.6 → cadrul acoperă −1.93…+1.43. Mărimea finală o decide Adrian cu
          dublu-click (modul de aranjare de mai jos). */}
      <Canvas shadows="percentage" camera={{ position: [0, -0.25, 4.6], fov: 40 }} dpr={[1, 2]} gl={{ alpha: true }}>
        {/* Solid backdrop full-screen; TRANSPARENT in presentation (pip) mode so
            Kelion floats over the monitor content instead of sitting in a black box. */}
        {!monitorOn && <color attach="background" args={['#0b0d12']} />}
        {/* Self-contained lighting (key + cool fill + rim) — NO remote HDR.
            `<Environment preset="city">` fetched a ~1MB HDR from an external CDN
            (githack/pmndrs) INSIDE the avatar's Suspense: on a fresh phone with a
            slow or blocked network that fetch could hang, so the Suspense never
            resolved and the avatar stayed BLACK forever (Adrian, 8 iul: „aplicația
            publicată și defectă"). The landing already dropped HDR for this exact
            reason; the in-app stage now matches — same look, zero external deps. */}
        <ambientLight intensity={0.75} />
        <directionalLight position={[2, 3, 2]} intensity={1.6} castShadow />
        <directionalLight position={[-2.5, 1.2, -2]} intensity={0.7} color="#8fb6ff" />
        <Suspense fallback={null}>
          <AvatarModel />
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
                  ? 'Credit epuizat — reîncarcă pentru a continua'
                  : userCreditOut === false
                    ? 'Ai credit'
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
            {/* PUNGA LUI KELION în bară (Adrian, 24 iul: „arată adminului
                realitatea"): SOLDUL REAL, exact din contul OpenRouter (USD) —
                creierul central. Roșu când e sub prag. Click → alimentare. */}
            {brainCredit && (
              <button
                type="button"
                className={`ghost ${brainCredit.openrouter.low ? 'blink-red' : ''}`}
                onClick={() => window.open(brainCredit.openrouter.topup, '_blank', 'noopener')}
                title={
                  brainCredit.openrouter.live
                    ? `OpenRouter (creierul central): $${(brainCredit.openrouter.balance ?? 0).toFixed(2)} real${brainCredit.openrouter.low ? ' — depune bani!' : ''} · click pentru alimentare`
                    : 'Nu pot citi soldul OpenRouter (cheie lipsă sau cont inaccesibil)'
                }
              >
                {brainCredit.openrouter.live
                  ? `OpenRouter $${(brainCredit.openrouter.balance ?? 0).toFixed(2)}`
                  : '⚠ OpenRouter'}
              </button>
            )}
            {/* PUNGA STRIPE (Adrian, 24 iul: „după OpenRouter — banii în Stripe,
                reali"): disponibil acum + în tranzit. Roșu pulsând sub zero.
                Click → tabul Bani din admin (circuitul complet). */}
            {brainCredit?.stripe && (
              <button
                type="button"
                className={`ghost ${brainCredit.stripe.available <= 0 ? 'blink-red' : ''}`}
                onClick={() => {
                  setAdminTab('finance')
                  setAdminOpen(true)
                }}
                title={`Punga Stripe (banii userilor): disponibil £${brainCredit.stripe.available.toFixed(2)}, în tranzit £${brainCredit.stripe.pending.toFixed(2)} · click pentru circuitul banilor`}
              >
                Stripe £{brainCredit.stripe.available.toFixed(2)}
                {brainCredit.stripe.pending > 0 && ` (+£${brainCredit.stripe.pending.toFixed(2)} în tranzit)`}
              </button>
            )}
          </>
        )}
        {/* Credit + reîncărcare pentru ORICE user logat (Adrian, 24 iul). Din
            meniul portofelului se ajunge și la Setări și la conectarea Gmail —
            bara nu mai are rotița ⚙ separată, nici butonul „Connect Google". */}
        <WalletButton
          onOpenSettings={() => setSettingsOpen(true)}
          googleConnected={user.googleConnected}
          onConnectGoogle={startGoogleConnect}
          isAdmin={user.role === 'admin'}
        />
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
          {!user.googleConnected && (
            <button
              type="button"
              className="ghost"
              onClick={startGoogleConnect}
              title="Grant Gmail, Calendar & Drive access so Kelion can act on them"
            >
              Connect Google
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

      <ChatPanel lang={lang} isAdmin={user.role === 'admin'} />

      {adminOpen && (
        <AdminPanel initialTab={adminTab} onClose={() => setAdminOpen(false)} />
      )}

      {contactOpen && <ContactModal onClose={() => setContactOpen(false)} />}

      {settingsOpen && <CustomerSettings user={user} onClose={() => setSettingsOpen(false)} />}

    </div>
  )
}
