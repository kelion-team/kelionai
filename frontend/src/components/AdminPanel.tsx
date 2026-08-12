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
import type { BrainCredit } from '../pages/Stage'
import {
  fetchHistory,
  type HistoryRow,
  translateToRo,
  fetchFinance,
  manageUser,
  fetchMoneyCircuit,
  pauzaAutonomie,
  fetchDoveziAutonomie,
  fetchPlati,
  atribuiePlata,
  ignoraPlata,
  type PlatiAdmin,
  type DovadaAutonomie,
  type MoneyCircuit,
  fetchLeads,
  emailLead,
  type Lead,
  fetchDemos,
  fetchActivity,
  type Finance,
  type DemoStats,
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
  fetchVoiceprints,
  fetchVoiceprintAudio,
  deleteVoiceprint,
  type VoiceprintRow,
  fetchTokenChecks,
  fetchEnvCheck,
  type EnvCheckResult,
  type TokenChecksResult,
  fetchErori,
  type EroriAdmin,
  fetchNotificari,
  markNotificareCitit,
  type NotificareAdmin,
} from '../lib/admin'

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
  const culoare = sev === 'critic' ? '#e5484d' : sev === 'important' ? '#e6a23c' : '#8a8f98'
  return (
    <div style={{ padding: '8px 0', borderTop: '1px solid rgba(128,128,128,0.18)' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <span
          aria-hidden
          style={{ width: 8, height: 8, borderRadius: 4, background: culoare, display: 'inline-block', flex: '0 0 auto' }}
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
        style={{ marginTop: 2, fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-word' }}
      >
        {text}
      </div>
    </div>
  )
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
  // ETICHETELE ALINIATE LA JURNAL (auditul admin, 3 aug): creierul CURENT
  // scrie sub kind 'gemini' (chat.ts, google-direct) — rândul lui apărea cu
  // cheia brută, în timp ce „Creier" stătea pe 'chat' (istoricul OpenRouter).
  // Un admin care citea „Creier $X" credea că vede costul creierului de acum.
  gemini: 'Creier (Gemini)',
  chat: 'Creier (istoric OpenRouter)',
  correct: 'Gemini (correct)',
  image: 'Images (Gemini)',
  image_est: 'Images (estimare internă)',
  video: 'Video (Veo)',
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

// PASTILELE AI, MUTATE ÎN ADMIN (10 aug) — self-contained, cu starea proprie de
// editare. Creditul Gemini declarat se salvează pe /api/admin/gemini-credit (același
// endpoint ca vechea pastilă); următorul poll din Stage aduce cifra nouă înapoi.
function CreditAICard({ brainCredit }: { brainCredit?: BrainCredit | null }) {
  const [edit, setEdit] = useState(false)
  const [val, setVal] = useState('')
  const [msg, setMsg] = useState('')
  if (!brainCredit) return null
  const g = brainCredit.gemini
  const s = brainCredit.serper
  const r = brainCredit.runpod
  const serperK = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))
  const geminiEticheta =
    g?.serving && g?.creditGbp != null
      ? `£${(g.creditRamasGbp ?? g.creditGbp).toFixed(2)}`
      : g?.serving
        ? '✓'
        : g?.reason === 'depleted'
          ? '£0 ⚠'
          : '⚠'
  const salveaza = (): void => {
    const t = val.trim()
    const gbp = t === '-' ? null : Number(t.replace(',', '.'))
    if (t !== '-' && (!Number.isFinite(gbp) || (gbp as number) < 0)) { setMsg('cifră invalidă'); return }
    setMsg('se salvează…')
    void fetch('/api/admin/gemini-credit', {
      method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ gbp }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { setMsg(j?.ok ? 'salvat — se actualizează la următorul refresh' : 'salvarea a eșuat'); if (j?.ok) setEdit(false) })
      .catch(() => setMsg('salvarea a eșuat'))
  }
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, padding: '10px 14px', margin: '10px 0', background: 'color-mix(in srgb, var(--text) 4%, transparent)', border: '1px solid var(--border)', borderRadius: 10 }}>
      <strong style={{ fontSize: 13, opacity: 0.8 }}>Credite AI</strong>
      <span title={s?.live ? `${(s.balance ?? 0).toLocaleString()} căutări rămase (Serper)` : 'citirea Serper a eșuat'}>
        Serper {s?.live ? serperK(s.balance ?? 0) : '⚠'}
      </span>
      <span title={g?.monthUsd != null ? `cheltuit luna asta: $${g.monthUsd.toFixed(2)}` : 'cheltuiala Gemini necitibilă'}>
        Gemini {geminiEticheta}
      </span>
      {r && (
        <span title={r.live
          ? `sold RunPod (placa lucrătorului): $${(r.balanceUsd ?? 0).toFixed(2)} · rată acum $${(r.ratePerHr ?? 0).toFixed(3)}/h · plafon $${r.limitPerHr ?? '?'}/h`
          : `soldul RunPod nu se poate citi (${r.error ?? 'necunoscut'})`}>
          RunPod {r.live ? `$${(r.balanceUsd ?? 0).toFixed(2)}` : '⚠'}
        </span>
      )}
      {edit ? (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <input
            autoFocus value={val} onChange={(e) => setVal(e.target.value)} placeholder="ex: 10.88 („-” șterge)"
            style={{ width: 130 }}
            onKeyDown={(e) => { if (e.key === 'Enter') salveaza(); if (e.key === 'Escape') { setEdit(false); setMsg('') } }}
          />
          <button type="button" onClick={salveaza}>Salvează</button>
          <button type="button" onClick={() => { setEdit(false); setMsg('') }}>Renunț</button>
        </span>
      ) : (
        <button type="button" onClick={() => { setVal(g?.creditGbp != null ? String(g.creditGbp) : ''); setMsg(''); setEdit(true) }} title="Editează creditul Gemini declarat (cifra din AI Studio)">
          ✎ credit Gemini
        </button>
      )}
      <a href="https://aistudio.google.com/billing" target="_blank" rel="noreferrer" style={{ fontSize: 12, opacity: 0.75 }}>alimentează Gemini</a>
      {msg && <span style={{ fontSize: 12, opacity: 0.8 }}>{msg}</span>}
    </div>
  )
}

export default function AdminPanel({
  onClose,
  initialTab,
  brainCredit,
}: {
  readonly onClose: () => void
  readonly initialTab?: 'finance' | 'users' | 'visitors' | 'share' | 'stores' | 'inbox' | 'voiceprints' | 'gesturi' | 'tokenuri' | 'constructor' | 'recuperare' | 'sistem' | 'erori' | 'notificari'
  readonly brainCredit?: BrainCredit | null
}) {
  const [tab, setTab] = useState<
    'finance' | 'users' | 'visitors' | 'share' | 'stores' | 'inbox' | 'voiceprints' | 'gesturi' | 'tokenuri' | 'constructor' | 'recuperare' | 'sistem' | 'erori' | 'notificari'
  >(initialTab ?? 'finance')
  // GESTURES (Adrian, Jul 13): the disabled list — what is NOT checked is NOT used.
  // Tri-stat (auditul admin, 3 aug): pe o citire EȘUATĂ nu desenăm „toate
  // active" și mai ales nu lăsăm un toggle să salveze peste o bază necitită
  // (ștergea dezactivările reale de pe server).
  const [gestOff, setGestOff] = useState<string[] | null | 'necitit'>('necitit')
  const [gestSaved, setGestSaved] = useState(false)
  // „NU s-a salvat" — simetric cu „salvat ✓" (auditul admin, 3 aug: pe eșec
  // checkbox-ul rămânea întors și nimeni nu afla).
  const [gestErr, setGestErr] = useState('')
  // On preview the panel goes transparent for ~3.5s, so you see the avatar behind.
  const [peek, setPeek] = useState(false)
  // The „Pune pe 0” button in the Money tab: while it runs, it can't be pressed twice.
  const [resetBusy, setResetBusy] = useState(false)
  // Lista de erori (tab „Erori"): erori browser + defecte de sistem, fiecare cu
  // „ce este". 'necitit' = n-am întrebat încă; null = citirea a EȘUAT (nu „zero
  // erori"); obiect = citit real.
  const [erori, setErori] = useState<EroriAdmin | null | 'necitit'>('necitit')
  const [eroriBusy, setEroriBusy] = useState(false)
  // Notificări pentru owner (K14): cereri noi (plată neatribuită / cerere
  // neacoperită). 'necitit' = n-am întrebat; null = citirea a EȘUAT; listă = citit.
  const [notificari, setNotificari] = useState<NotificareAdmin[] | null | 'necitit'>('necitit')
  const previewAndPeek = (clip: string): void => {
    previewGesture(clip)
    setPeek(true)
    window.setTimeout(() => setPeek(false), 3500)
  }
  // Live chat with visitors (owner inbox): conversations, the selected one, the reply.
  // TRI-STAT peste tot (auditul admin, 3 aug): 'necitit' = încă n-am întrebat;
  // null = citirea a EȘUAT (se scrie ca eșec); [] = serverul chiar a răspuns gol.
  const [inbound, setInbound] = useState<InboundEmail[] | null | 'necitit'>('necitit')
  const [mailboxLive, setMailboxLive] = useState<MailboxLiveResult | null | 'necitit'>('necitit')
  const [mailboxLoading, setMailboxLoading] = useState(false)
  // ȘTERGEREA DIN INBOX (Adrian, 3 aug: „să șterg de aici câte una sau prin
  // selecție toate"): selecția pe UID + ștergerea (una sau grupul selectat).
  // Serverul mută în coșul REAL al căsuței când există; mesajul de confirmare
  // spune ce s-a întâmplat DE FAPT (câte, și unde au ajuns).
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
    void fetch('/api/admin/mailbox-delete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ uids }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { sterse?: number; detaliu?: string } | null) => {
        setMailDelMsg(j ? A.mailDeleteResult(j.sterse ?? 0, j.detaliu ?? '') : A.mailDeleteFailed)
        setMailSel(new Set())
        // Reîncarcă lista REALĂ de pe server — nu scoatem optimist rânduri
        // pe care poate nu le-am șters (cifra vine din ce s-a întâmplat).
        setMailboxLoading(true)
        void fetchMailboxLive().then((m) => {
          setMailboxLive(m)
          setMailboxLoading(false)
        })
      })
      // (setMailSel(new Set()) de mai sus golește selecția, deci nu poate
      // rămâne un „Șterge selectate (N)" cu UID-uri moarte — auditul, 3 aug.)
      .catch(() => setMailDelMsg(A.mailDeleteFailed))
      .finally(() => setMailDelBusy(false))
  }
  const [contactMsgs, setContactMsgs] = useState<ContactMessage[] | null | 'necitit'>('necitit')
  const [copied, setCopied] = useState(false)
  // TEXTUL DE DISTRIBUIRE, AL OWNERULUI (Adrian, 3 aug: „rescrie corect tot
  // tabul"): mesajul nu mai e bătut în cuie în cod — îl scrii/ajustezi aici și
  // rămâne salvat local (localStorage), iar toate butoanele îl folosesc pe AL TĂU.
  const SHARE_TEXT_IMPLICIT =
    'Ți-l prezint pe Kelion — asistentul meu AI cu avatar și voce: vede, aude și vorbește, în orice limbă. Contul e gratuit și îl faci în 30 de secunde:'
  const [shareText, setShareText] = useState<string>(() => {
    try {
      return window.localStorage.getItem('kelionai:share-text') || SHARE_TEXT_IMPLICIT
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
  // null = citirea listei a EȘUAT (auditul admin, 3 aug) — nu „No history yet".
  // null = fetchHistory a picat — se scrie ca eșec, nu ca chat gol.
  // THE OUTAGES AUDIT (Adrian, Jul 27): everything that went down, in the same tab as gaps.
  // un blip ștergea problemele critice de pe ecran) — auditFailedAt spune de când.
  const [finance, setFinance] = useState<Finance | null>(null)
  // financeFailed = ultima citire a picat: fără date → mesaj de eșec (nu
  // „Se încarcă…" pe veci); cu date vechi → notă că cifrele sunt ultimele bune.
  const [financeFailed, setFinanceFailed] = useState(false)
  // The money circuit, managed FROM admin (Adrian, Jul 24).
  const [circuit, setCircuit] = useState<MoneyCircuit | null>(null)
  const [circuitFailed, setCircuitFailed] = useState(false)
  // Mesajul butonului „Pune pe 0" (auditul admin, 3 aug: r.ok nu era verificat
  // — eșecul arăta identic cu succesul).
  const [resetMsg, setResetMsg] = useState('')
  // Legarea contului Revolut (PSD2) — starea celor două butoane noi.
  const [legMsg, setLegMsg] = useState('')
  // HERE STOOD `cardBusy` and `cardDeschis` — the state of the „Creează cardul”
  // button and of the window that showed the Stripe virtual card number. The
  // Issuing card left with Stripe (Jul 30): providers are paid with Adrian's card.
  // Stripe transactions were REMOVED from the panel on Jul 31 with the channel —
  // they are no longer read, so their state is no longer kept (nor requested
  // from the server on every tab load).
  // AI pool — how much you add/remove (typed value) + the buttons' state.
  // Leads — visitors who left their email. Tri-stat (auditul admin, 3 aug).
  const [leads, setLeads] = useState<Lead[] | null | 'necitit'>('necitit')
  const [demos, setDemos] = useState<DemoStats | null | 'necitit'>('necitit')
  const [activity, setActivity] = useState<UserActivity | null | 'necitit'>('necitit')
  const [stores, setStores] = useState<StoresData | null | 'necitit'>('necitit')
  const [voiceprints, setVoiceprints] = useState<VoiceprintRow[] | null>([])
  const [voiceprintsLoading, setVoiceprintsLoading] = useState(false)
  // Mesajele acțiunilor pe amprente (ștergere/ascultare picate — nu mai tac).
  const [vpMsg, setVpMsg] = useState('')
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
    // Aug 2: 'fable-5' when the order ran on the expressly requested paid
    // brain, 'free' otherwise (null until the worker reports).
    brain: string | null
    updatedAt: string
    // BARA 0–100% (Adrian, 3 aug): etapa REALĂ raportată de lucrător + harta
    // ei în procent (serverul o calculează din progres — progresOrdin.ts).
    // null = eșuat (eticheta spune adevărul, fără procent inventat).
    progress?: string | null
    pct?: number | null
  }
  // null = coada nu s-a putut citi (auditul admin, 3 aug) — nu „Niciun ordin".
  const [buildJobs, setBuildJobs] = useState<BuildJobRow[] | null | 'necitit'>('necitit')
  // Pauza de autonomie, VIZIBILĂ și aici (auditul admin, 3 aug): cu pauza
  // pornită lucrătorul nu ia nimic — ordinul stătea „în coadă · 0%" la
  // nesfârșit după promisiunea „max. 2 minute", fără nicio explicație.
  const [buildPaused, setBuildPaused] = useState(false)
  const [buildOrder, setBuildOrder] = useState('')
  const [buildMsg, setBuildMsg] = useState('')
  // THE PAID BRAIN TOGGLE (Adrian, Aug 2: "Everything FREE. The admin can
  // EXPRESSLY request the paid Fable 5 brain for the CONSTRUCTOR only"). Off by
  // default; when on, the order text carries the "Fable 5" marker that the VPS
  // constructor parses.
  // (Toggle-ul „Use Fable 5 brain (paid)" a fost SCOS, 3 aug — extirparea
  // OpenRouter: creierul plătit Fable 5 mergea prin OpenRouter, care nu mai
  // există. Constructorul e Gemini-only; marcajul 'fable-5' rămâne acceptat
  // doar în API-ul workerului, pentru compatibilitate cu rapoartele vechi.)
  // RECOVERY (Adrian, Jul 27): saved versions + saving the current version.
  interface RecoveryRow {
    tag: string
    sha: string
    date: string
    note: string
  }
  const [recoveryPoints, setRecoveryPoints] = useState<RecoveryRow[]>([])
  // recoveryFailed = citirea versiunilor a picat (403/503/rețea) — se scrie ca
  // eșec, nu ca „Nicio versiune salvată încă" (auditul admin, 3 aug).
  const [recoveryFailed, setRecoveryFailed] = useState(false)
  const [recoveryLoading, setRecoveryLoading] = useState(false)
  const [recoveryNote, setRecoveryNote] = useState('')
  const [recoveryMsg, setRecoveryMsg] = useState('')
  // Restore BY BUTTON (Adrian, Jul 27: „the admin must be able to select it”).
  // While a restore runs, every restore button is locked.
  const [restoringTag, setRestoringTag] = useState<string | null>(null)
  // THE ADMIN BUTTON LOCK (Adrian, Jul 27): the activation secret is set HERE
  // (next to the voiceprints — both lock factors stay together).
  // ATENȚIE (auditul admin, 3 aug): lacătul e DEZARMAT hard în backend
  // (adminLock.ts, LACAT_DEZARMAT=true, la cererea ownerului din 31 iul) —
  // serverul răspunde mereu armed:false, deci UI-ul spune starea REALĂ, nu
  // mai vinde armarea ca funcțională. 'necitit' = n-am întrebat încă;
  // null = citirea stării a picat (nu „nearmat"!).
  const [lockArmed, setLockArmed] = useState<boolean | null | 'necitit'>('necitit')
  const [lockSecret, setLockSecret] = useState('')
  const [lockMsg, setLockMsg] = useState('')
  // Playing a voiceprint's audio sample (the „play” button): we remember who is
  // playing now, to show ⏸ and never start two at once.
  const [playingVp, setPlayingVp] = useState<string | null>(null)
  const vpAudioRef = useRef<HTMLAudioElement | null>(null)
  // Ocupat ÎNTRE click și rezolvarea fetch-ului (auditul admin, 3 aug): două
  // clickuri rapide porneau două obiecte Audio în paralel — primul nu mai
  // putea fi oprit decât din pauza globală.
  const vpBusyRef = useRef(false)
  const playVoiceprint = async (email: string): Promise<void> => {
    if (vpBusyRef.current) return
    // A second click on the same row stops playback.
    if (vpAudioRef.current) {
      vpAudioRef.current.pause()
      vpAudioRef.current = null
    }
    if (playingVp === email) {
      setPlayingVp(null)
      return
    }
    vpBusyRef.current = true
    const clip = await fetchVoiceprintAudio(email)
    vpBusyRef.current = false
    if (!clip) {
      setPlayingVp(null)
      // ▶ nu mai tace la eșec (auditul admin, 3 aug): apăsarea primea NIMIC.
      setVpMsg(A.voiceprintFetchError(email))
      return
    }
    setVpMsg('')
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
  // Tri-stat (auditul admin, 3 aug): tabelul-vedetă dispărea MUT când citirea
  // pica — ownerul vedea tabul fără tabel și nu știa dacă e stricat sau așa
  // trebuie. null = citire eșuată, spusă ca atare.
  const [envCheck, setEnvCheck] = useState<EnvCheckResult | null | 'necitit'>('necitit')

  // The conversation + testing profile of a clicked user (tab "Utilizatori") —
  // what he wrote (the chat) and how he tested (browser/device/IP/sessions/time),
  // in one click, without going through the separate "Istoric chat" tab.
  // rows: null = citirea conversației a PICAT (auditul admin, 3 aug) — se
  // scrie ca eșec, nu ca „Nu a scris niciun mesaj încă".
  const [userConvo, setUserConvo] = useState<{ u: UserActivityRow; rows: HistoryRow[] | null } | null>(null)
  const [userConvoLoading, setUserConvoLoading] = useState(false)
  // „Tradu în română” in the conversation view: roOn = show the translation;
  // roMap = original-text → translation cache (one request per new message).
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
    const missing = Array.from(new Set(rows.map((r) => r.content).filter((c) => c && !(c in roMap))))
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
  const showMsg = (content: string): string => (roOn ? (roMap[content] ?? content) : content)

  async function openUserConvo(u: UserActivityRow): Promise<void> {
    setUserConvoLoading(true)
    setRoOn(false)
    setRoFailed(0)
    setUserConvo({ u, rows: [] })
    // fetchHistory nu mai aruncă (auditul admin, 3 aug): null = citire picată,
    // iar loading se închide ORICUM — overlay-ul nu mai rămâne pe veci pe
    // „Se încarcă…".
    const rows = await fetchHistory(u.email)
    setUserConvo({ u, rows })
    setUserConvoLoading(false)
  }

  // Închiderea overlay-ului RESETEAZĂ starea traducerii (auditul admin, 3 aug):
  // roOn/roFailed se scurgeau în tabul Istoric chat — butonul arăta „Arată
  // originalul" și „⚠ N netraduse" pentru ALTĂ conversație.
  const closeUserConvo = (): void => {
    setUserConvo(null)
    setRoOn(false)
    setRoFailed(0)
  }

  // THE OWNER'S LEVER: stops / restarts autonomy in one click. After the press
  // we re-read the state from the server — we don't assume it worked.
  const [pauzaBusy, setPauzaBusy] = useState(false)
  // THE EIGHT PROOFS (Adrian, Jul 31: „there must be 8 out of 8 proofs”).
  const [dovezi, setDovezi] = useState<{ dovedite: number; din: number; dovezi: DovadaAutonomie[] } | null>(null)
  // THE PAYMENTS PANEL (M3, Aug 2): 'necitit' until the read lands; null = the
  // read FAILED (shown as failure, never as an empty ledger — rule no. 1).
  const [plati, setPlati] = useState<PlatiAdmin | null | 'necitit'>('necitit')
  async function onPauzaAutonomie(oprit: boolean): Promise<void> {
    setPauzaBusy(true)
    await pauzaAutonomie(oprit)
    // Păstrăm ultimele date bune dacă recitirea pică (auditul admin, 3 aug).
    const c = await fetchMoneyCircuit()
    if (c) setCircuit(c)
    setCircuitFailed(!c)
    setPauzaBusy(false)
  }

  useEffect(() => {
    // gaps: la eșec PĂSTRĂM lista (aici încă goală) și ridicăm doar flagul —
    // Legătură cereri neacoperite (plăți neatribuite + cereri useri)
    void fetchFinance().then((f) => {
      if (f) setFinance(f)
      setFinanceFailed(!f)
    })
    void fetchMoneyCircuit().then((c) => {
      if (c) setCircuit(c)
      setCircuitFailed(!c)
    })
    void fetchDoveziAutonomie().then(setDovezi)
    void fetchPlati().then(setPlati)
    void fetchDemos().then(setDemos)
    void fetchLeads().then(setLeads)
    void fetchActivity().then(setActivity)
  }, [])


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
      setStores('necitit')
      void fetchStores().then(setStores)
    } else if (tab === 'inbox') {
      // SELECȚIA SE RESETEAZĂ la fiecare intrare în tab (auditul admin, 3 aug):
      // mailSel/mailDelMsg rămâneau stătute — „Șterge selectate (3)" pentru
      // mesaje care nu mai existau în listă, plus un „Șterse: …" vechi afișat
      // ca și cum tocmai s-ar fi întâmplat.
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
      // The „Ce chei vede serverul CHIAR ACUM” table loads together with the tab.
      // This call had ended up by mistake at the tail of the `inbox` branch, so the
      // table NEVER appeared in Tokens — caught by Adrian from a screenshot.
      void fetchEnvCheck().then(setEnvCheck)
      setTokenChecksLoading(true)
      void fetchTokenChecks().then((r) => {
        setTokenChecks(r)
        setTokenChecksLoading(false)
      })
    } else if (tab === 'users') {
      // REÎNCĂRCARE LA DESCHIDEREA TABULUI (auditul admin, 3 aug): activitatea
      // se citea O SINGURĂ dată, la montare — un eșec lăsa „Se încarcă…" pe
      // veci, fără nicio a doua șansă.
      void fetchActivity().then(setActivity)
    }
  }, [tab])

  // Tab „Vizitatori" deschis → reîncarcă și REÎMPROSPĂTEAZĂ cât stă deschis
  // (auditul admin, 3 aug: datele veneau doar la montare — „Vizite azi"
  // îngheța la valoarea de la deschidere, iar un eșec inițial lăsa
  // „Se încarcă…" pe veci, fără retry).
  useEffect(() => {
    if (tab !== 'visitors') return
    const load = (): void => {
      void fetchDemos().then(setDemos)
      void fetchLeads().then(setLeads)
    }
    load()
    const id = window.setInterval(load, 30_000)
    return () => window.clearInterval(id)
  }, [tab])

  // MONEY IN REAL TIME (Adrian, Jul 24: „all credits show in real time, the real
  // value”): while the Money tab is open we refresh the balances and the profit
  // every 15s — LIVE values.
  useEffect(() => {
    if (tab !== 'finance') return
    const id = window.setInterval(() => {
      // PĂSTREAZĂ ultimele date bune (auditul admin, 3 aug): pollul scria null
      // peste datele afișate la un blip de rețea, golind tabul înapoi în
      // „Se încarcă…". Eșecul se declară prin financeFailed, nu prin golire.
      void fetchFinance().then((f) => {
        if (f) setFinance(f)
        setFinanceFailed(!f)
      })
    }, 15_000)
    return () => window.clearInterval(id)
  }, [tab])

  // Live visitor chat: refresh the conversation list while the tab is open, and
  // poll the OPEN conversation for new visitor lines (both every few seconds).




  // Tab „Amprente vocale” open → loads the list and refreshes every 10s.
  useEffect(() => {
    if (tab !== 'voiceprints') return
    const load = async (): Promise<void> => {
      setVoiceprintsLoading(true)
      // null = citirea a picat (auditul admin, 3 aug) — se afișează ca eșec,
      // nu ca „Nicio amprentă înregistrată încă".
      const rows = await fetchVoiceprints()
      setVoiceprints(rows)
      setVoiceprintsLoading(false)
    }
    void load()
    const id = window.setInterval(() => void load(), 10_000)
    return () => window.clearInterval(id)
  }, [tab])

  // Reîncarcă coada ordinelor — UN SINGUR loc (jscpd, 3 aug): efectul de tab și
  // butoanele de ștergere/reia foloseau două copii identice ale aceluiași fetch.
  const refreshBuildJobs = (): void => {
    fetch('/api/admin/constructor', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { jobs?: BuildJobRow[]; paused?: boolean } | null) => {
        // null/eșec = coada NU s-a citit (auditul admin, 3 aug) — se spune,
        // nu se lasă „Niciun ordin încă" peste o citire picată.
        if (j?.jobs) {
          setBuildJobs(j.jobs)
          setBuildPaused(!!j.paused)
        } else setBuildJobs(null)
      })
      .catch(() => setBuildJobs(null))
  }
  // Tab „Constructor” open → the orders queue, refreshed every 10s.
  useEffect(() => {
    if (tab !== 'constructor') return
    refreshBuildJobs()
    const id = window.setInterval(refreshBuildJobs, 10_000)
    return () => window.clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refreshBuildJobs e stabil funcțional (doar fetch+set)
  }, [tab])

  const sendBuildOrder = (): void => {
    const text = buildOrder.trim()
    if (text.length < 8) {
      setBuildMsg(A.writeCompleteOrder)
      return
    }
    const order = text
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
          // PROMISIUNEA ONESTĂ (auditul admin, 3 aug): cu autonomia pe pauză
          // lucrătorul NU ia nimic — „max. 2 minute" ar fi fost o minciună.
          setBuildMsg(
            buildPaused
              ? A.orderEnqueuedPaused(j.id)
              : A.orderEnqueuedActive(j.id),
          )
        } else setBuildMsg(A.orderSendFailed)
      })
      .catch(() => setBuildMsg(A.orderSendFailed))
  }

  // ── ȘTERGE / CURĂȚĂ / REIA un ordin din coadă (Adrian, 3 aug: „scoate 30/31
  //    dacă nu le poate face … aici nu apar butoane de ștergere"). Rutele existau
  //    (db.ts → constructor.ts); aici sunt butoanele care le cheamă.
  //    Reîncărcarea = refreshBuildJobs, definit sus lângă efectul de tab.
  // ȘTERGERE CU VERDICT, o singură implementare (jscpd + auditul admin, 3 aug):
  // DELETE + citirea lui {ok} din CORP — serverul răspunde 200 cu {ok:false}
  // când rândul nu există sau DB pică, iar vechiul cod care se uita doar la
  // status raporta „șters" pentru o ștergere care nu s-a întâmplat.
  const stergeCuVerdict = (url: string): Promise<boolean> =>
    fetch(url, { method: 'DELETE', credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { ok?: boolean } | null) => j?.ok === true)
      .catch(() => false)
  const deleteBuildOrder = (id: number): void => {
    if (!window.confirm(A.confirmDeleteBuildOrder(id))) return
    void stergeCuVerdict(`/api/admin/constructor/${id}`).then((ok) => {
      if (ok) {
        setBuildJobs((prev) => (Array.isArray(prev) ? prev.filter((x) => x.id !== id) : prev))
        setBuildMsg(A.orderDeleted(id))
      } else setBuildMsg(A.orderDeleteFailed)
    })
  }
  // OPREȘTE un ordin în curs (auditul admin, 3 aug): cancelBuildJob exista în
  // backend, dar panoul n-avea niciun buton spre el — un 'running' nu putea fi
  // oprit decât din chat.
  const cancelBuildOrder = (id: number): void => {
    if (!window.confirm(A.confirmStopBuildOrder(id))) return
    void fetch(`/api/admin/constructor/${id}/anuleaza`, { method: 'POST', credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { ok?: boolean } | null) => {
        refreshBuildJobs()
        setBuildMsg(j?.ok ? A.orderStopped(id) : A.orderStopFailed)
      })
      .catch(() => setBuildMsg(A.orderStopFailed))
  }
  const cleanBuildOrders = (): void => {
    if (!window.confirm(A.confirmClearFailedJobs)) return
    void fetch('/api/admin/constructor/curata', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ scope: 'failed_done' }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { sterse?: number } | null) => {
        refreshBuildJobs()
        setBuildMsg(j ? A.ordersCleaned(j.sterse ?? 0) : A.ordersCleanFailed)
      })
      .catch(() => setBuildMsg(A.ordersCleanFailed))
  }
  const retryBuildOrder = (id: number): void => {
    void fetch(`/api/admin/constructor/${id}/reia`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({}),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { ok?: boolean } | null) => {
        refreshBuildJobs()
        setBuildMsg(j?.ok ? A.orderResumed(id) : A.orderResumeFailed)
      })
      .catch(() => setBuildMsg(A.orderResumeFailed))
  }

  // Tab „Recuperare” open → loads the saved recovery points.
  const loadRecovery = (): void => {
    setRecoveryLoading(true)
    fetch('/api/admin/backups', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { points?: RecoveryRow[] } | null) => {
        // Eșecul se DECLARĂ (auditul admin, 3 aug): 503/403/rețea nu mai
        // arată ca „Nicio versiune salvată încă" — în panoul de siguranță
        // unde ownerul decide dacă are la ce să se întoarcă.
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
  // O încărcare la montare, pentru badge-ul de necitite (owner vede „(3)" fără să
  // deschidă tabul — asta e „anunțul" din K14).
  useEffect(() => {
    loadNotificari()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const saveRecoveryNow = (): void => {
    setRecoveryMsg(A.savingRecovery)
    void fetch('/api/admin/backups', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ note: recoveryNote.trim() }),
    })
      // CITEȘTE CORPUL ȘI LA EȘEC (auditul admin, 3 aug): serverul trimite
      // cauza măsurată ({error:'github_token_missing'} etc.) — genericul
      // „reîncearcă" trimitea ownerul să repete o operație condamnată.
      // Același tipar ca restoreFromPoint, două funcții mai jos.
      .then((r) => r.json().then((j: { ok?: boolean; tag?: string; error?: string }) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (ok && j.tag != null) {
          setRecoveryMsg(A.recoverySaved(j.tag))
          setRecoveryNote('')
          loadRecovery()
        } else setRecoveryMsg(A.recoverySaveFailed(j.error ?? 'eroare necunoscută'))
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
            A.restoreSuccess(j.sha ?? p.sha),
          )
        else setRecoveryMsg(A.restoreFailed(j.error ?? 'eroare necunoscută'))
      })
      .catch(() => {
        setRestoringTag(null)
        setRecoveryMsg(A.restoreNetworkError)
      })
  }

  // Tab „Amprente vocale” open → also the lock's state (armed or not).
  // null = citirea a PICAT (auditul admin, 3 aug) — nu se mai afișează ca
  // „nearmat": o valoare nemăsurată nu e un verdict (regula #1).
  useEffect(() => {
    if (tab !== 'voiceprints') return
    fetch('/api/admin/unlock/status', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { armed?: boolean } | null) => setLockArmed(j ? !!j.armed : null))
      .catch(() => setLockArmed(null))
  }, [tab])

  const saveLockSecret = (): void => {
    const s = lockSecret.trim()
    if (s.length < 4) {
      setLockMsg(A.lockSecretMinLength)
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
          setLockSecret('')
          // FĂRĂ AFIRMAȚII (auditul admin, 3 aug): vechiul setLockArmed(true) +
          // „lacătul e armat" era o pretenție, nu o măsurătoare — backend-ul e
          // DEZARMAT hard (adminLock.ts, la cererea ownerului din 31 iul), deci
          // butonul Admin nu cerea nimic. Spunem ce s-a întâmplat DE FAPT și
          // recitim starea de la server.
          setLockMsg(A.lockSecretSaved)
          fetch('/api/admin/unlock/status', { credentials: 'include' })
            .then((r2) => (r2.ok ? r2.json() : null))
            .then((j: { armed?: boolean } | null) => setLockArmed(j ? !!j.armed : null))
            .catch(() => setLockArmed(null))
        } else setLockMsg(A.lockSecretSaveFailed)
      })
      .catch(() => setLockMsg(A.lockSecretSaveFailed))
  }

  // Tab „Gesturi” open → loads the disabled list.
  useEffect(() => {
    if (tab !== 'gesturi') return
    setGestOff('necitit')
    void fetchDisabledGestures().then(setGestOff)
  }, [tab])

  // Check/uncheck a gesture → saves to the server. Checked = active (NOT on the
  // disabled list). What is not checked is NOT used anywhere in the app.
  // NU se salvează peste o bază necitită (auditul admin, 3 aug): pe o citire
  // eșuată, un singur toggle ar fi ȘTERS toate dezactivările reale de pe server.
  const toggleGesture = (clip: string): void => {
    if (!Array.isArray(gestOff)) return
    const inainte = gestOff
    const next = gestOff.includes(clip) ? gestOff.filter((c) => c !== clip) : [...gestOff, clip]
    setGestOff(next)
    setGestErr('')
    void saveDisabledGestures(next).then((ok) => {
      if (ok) {
        setGestSaved(true)
        window.setTimeout(() => setGestSaved(false), 1500)
      } else {
        // REVERT + mesaj (auditul admin, 3 aug): fără el, checkbox-ul rămânea
        // întors pe o stare pe care serverul nu o are, iar bifele „săreau
        // înapoi" inexplicabil la următoarea deschidere.
        setGestOff(inainte)
        setGestErr(A.gestureSaveFailed)
      }
    })
  }

  // TEXTUL PANOULUI, in limba adminului (engleza implicit). Vezi lib/adminText.ts.
  const A = adminStrings()
  // Formele „doar date" ale stărilor tri-valente (auditul admin, 3 aug):
  // 'necitit'/null nu sunt liste — render-ul le tratează explicit.
  const activityData = typeof activity === 'object' && activity !== null ? activity : null
  const demosData = typeof demos === 'object' && demos !== null ? demos : null
  const leadsData = Array.isArray(leads) ? leads : null
  const mailboxData = typeof mailboxLive === 'object' && mailboxLive !== null ? mailboxLive : null
  const inboundData = Array.isArray(inbound) ? inbound : null
  const contactData = Array.isArray(contactMsgs) ? contactMsgs : null
  const storesData = typeof stores === 'object' && stores !== null ? stores : null
  const envCheckData = typeof envCheck === 'object' && envCheck !== null ? envCheck : null
  const buildJobsData = Array.isArray(buildJobs) ? buildJobs : null
  const gestOffData = Array.isArray(gestOff) ? gestOff : null
  const sym = finance?.currency === 'usd' ? '$' : '£'
  const aiParts = finance
    ? Object.entries(finance.byKind)
        .filter(([, v]) => v > 0)
        .sort((a, b) => b[1] - a[1])
    : []



  return (
    <div className={`admin-overlay ${peek ? 'peek' : ''}`}>
      <div className="admin-panel">
        <header className="admin-head">
          <div className="admin-tabs">
            {/* Deschide pagina de adăugat agenți manual (+ temele iscoadelor).
                Crearea în consola Google Enterprise a fost SCOASĂ pe ordinul
                ownerului (8 aug) — agenții lucrează în aplicație, la /api/a2a. */}
            <button
              type="button"
              className="admin-tab"
              onClick={() => window.open('/api/enterprise/creeaza', '_blank', 'noopener')}
            >
              {A.tabEnterprise}
            </button>
            {/* Panoul de tranzacționare (Adrian, 4 aug: „buton separat în
                admin"): date reale + analiza agentului Tranzacții, doar owner. */}
            <button
              type="button"
              className="admin-tab"
              onClick={() => window.open('/api/tranzactii', '_blank', 'noopener')}
            >
              {A.tabTrading}
            </button>
            {/* Adaptare CV — funcție de plătitor, chiar după Tranzacționare
                (Adrian, 10 aug: „adaptare cv după tranzacții"). Deschide panoul
                de adaptare prin evenimentul de navigare pe care Stage îl ascultă. */}
            <button
              type="button"
              className="admin-tab"
              onClick={() => window.dispatchEvent(new CustomEvent('kelion:navigate', { detail: { view: 'cv' } }))}
            >
              📄 Adaptare CV
            </button>
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
              {A.tabUsers}{activityData && activityData.users.length > 0 ? ` (${activityData.users.length})` : ''}
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
              {demosData && demosData.visitsToday > 0 ? ` (${demosData.visitsToday})` : ''}
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
              {A.tabVoiceprints}{Array.isArray(voiceprints) && voiceprints.length > 0 ? ` (${voiceprints.length})` : ''}
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
            <button
              type="button"
              className={`admin-tab ${tab === 'sistem' ? 'sel' : ''}`}
              onClick={() => setTab('sistem')}
            >
              Sistem (VPS)
            </button>
            <button
              type="button"
              className={`admin-tab ${tab === 'erori' ? 'sel' : ''}`}
              onClick={() => setTab('erori')}
            >
              Erori
            </button>
            <button
              type="button"
              className={`admin-tab ${tab === 'notificari' ? 'sel' : ''}`}
              onClick={() => setTab('notificari')}
            >
              Notificări
              {Array.isArray(notificari) && notificari.some((n) => !n.read)
                ? ` (${notificari.filter((n) => !n.read).length})`
                : ''}
            </button>
          </div>
          {/* „⚙ Setări" SCOS din panou (Adrian, 4 aug: „asta nu mai îl afișa").
          onOpenSettings rămâne în props (fereastra CustomerSettings poate fi
          redeschisă de altundeva la nevoie), dar butonul nu se mai arată. */}
          <BackLink onBack={onClose} />
        </header>
        {/* CREDITELE AI, SUS ÎN ADMIN (Adrian, 10 aug: „mută pastilele AI sub
            admin"): Serper + Gemini + editarea creditului Gemini declarat — mutate
            din bara de sus. Bara ține doar VPS-ul. */}
        <CreditAICard brainCredit={brainCredit} />
        {tab === 'finance' && (
          <section className="admin-finance">
            {/* TREI STĂRI, NU DOUĂ (auditul admin, 3 aug): o citire EȘUATĂ nu
            mai e deghizată în „Se încarcă…" fără sfârșit — se declară. */}
            {!finance && !financeFailed && <p className="chat-hint">{A.loading}</p>}
            {!finance && financeFailed && (
              <p className="chat-hint" style={{ color: '#e6a23c' }}>
                ⚠ Nu pot citi datele de bani — citirea a eșuat (nu e o încărcare). Reîncerc automat la 15s.
              </p>
            )}
            {finance && financeFailed && (
              <p className="chat-hint" style={{ color: '#e6a23c' }}>
                ⚠ Ultima reîmprospătare a picat — cifrele de mai jos sunt ultimele citite cu succes.
              </p>
            )}
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
                {/* „PUNGA" A MURIT DE TOT (3 aug — extirparea totală): punga ERA
                soldul contului OpenRouter, iar furnizorul a fost scos din
                aplicație cu totul. Nu mai există un sold de citit, deci nici o
                cifră de desenat — o pastilă cu un „$0.00" fabricat ar fi exact
                minciuna interzisă de regula #1. Starea creierului (Gemini) se
                vede pe pastila Gemini din bară. */}
                {/* HERE STOOD „Depune în pungă” and „Trage profitul”. Both went
                through Stripe — Checkout for the deposit, `/v1/payouts` for the
                withdrawal. With Stripe out they have nothing to move: the users'
                money comes on the Revolut link, straight into his account, and the
                profit no longer passes through us. A button that does nothing
                anymore is worse than its absence — it looks like it works. */}
                {/* HERE STOOD „The money circuit: users → Stripe → AI” — the four
                links, the „What I can read from Stripe” block, the Issuing state,
                the virtual card creation and its number reveal. Removed on Jul 30:
                „Stripe goes out completely and Pro comes in”. The circuit no longer
                passes through the app — the user pays on the Revolut link, the money
                goes straight to the owner, and the providers are paid with his card.
                What remains useful here is the shortest path to where the card gets
                changed, at each provider. */}
                {/* THE GUARD THAT KILLED THE PANEL (Adrian, Aug 2: „mai jos nu
                mai e nimic"): this block was gated on `expenses` — a field
                built in stripe.ts that silently DIED when Stripe was removed
                (#624). Since Aug 1 the payment reader, the autonomy row, the
                proofs and the pause were ALL invisible. The status readings
                gate on `circuit` now; only the provider row needs expenses. */}
                {circuit && (
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
                    {/* CALEA REALĂ pe Pro (auditul admin, 3 aug): serverul trimitea
                    citirePlatiEmail — cititorul mailurilor „Ai primit …" din Gmail,
                    calea de creditare care CHIAR merge din 3 aug — dar nimeni n-o
                    desena: ownerul nu putea deosebi „nimeni n-a plătit" de „nu pot
                    citi inboxul". Aceleași reguli de culoare ca rândul de sus. */}
                    {circuit?.citirePlatiEmail && (
                      <span className="or-wallet-sub" style={{ color: circuit.citirePlatiEmail.ok ? undefined : '#e6a23c' }}>
                        {circuit.citirePlatiEmail.ok ? '✅' : '⚠'} Citirea plăților din email (Gmail „Ai primit…"):{' '}
                        {circuit.citirePlatiEmail.detaliu}
                      </span>
                    )}
                    {/* LEGAREA CONTULUI REVOLUT (auditul admin, 3 aug): detaliul de
                    mai sus trimitea la „Admin → Money", dar butoanele nu existau —
                    rutele /plati/legatura/* n-aveau niciun apelant. Consimțământul
                    PSD2 (max 90 zile) se pornește/reînnoiește acum de AICI. */}
                    <span className="or-wallet-sub">
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => {
                          setLegMsg(A.revolutLinkStarting)
                          void fetch('/api/admin/plati/legatura/start', { method: 'POST', credentials: 'include' })
                            .then((r) => r.json().then((j: { url?: string; error?: string }) => ({ ok: r.ok, j })))
                            .then(({ ok, j }) => {
                              if (ok && j.url) {
                                window.open(j.url, '_blank', 'noopener')
                                setLegMsg(A.revolutLinkApprovePrompt)
                              } else setLegMsg(A.revolutLinkStartFailed(j.error ?? 'eroare necunoscută'))
                            })
                            .catch(() => setLegMsg(A.revolutLinkNetworkError))
                        }}
                      >
                        Leagă contul Revolut (PSD2)
                      </button>{' '}
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => {
                          const cod = window.prompt(A.revolutLinkPromptCode)
                          if (!cod?.trim()) return
                          setLegMsg(A.revolutLinkFinalizing)
                          void fetch('/api/admin/plati/legatura/finalizeaza', {
                            method: 'POST',
                            headers: { 'content-type': 'application/json' },
                            credentials: 'include',
                            body: JSON.stringify({ code: cod.trim() }),
                          })
                            .then((r) => r.json().then((j: { conturi?: number; error?: string }) => ({ ok: r.ok, j })))
                            .then(({ ok, j }) => {
                              if (ok && j.conturi != null) setLegMsg(A.revolutLinkSuccess(j.conturi))
                              else setLegMsg(A.revolutLinkFailed(j.error ?? 'eroare necunoscută'))
                            })
                            .catch(() => setLegMsg(A.revolutLinkNetworkError))
                        }}
                      >
                        Am codul din retur
                      </button>
                      {legMsg && <i> {legMsg}</i>}
                    </span>
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
                      {/* FĂRĂ FALLBACK DE MÂNĂ (auditul admin, 3 aug): vechiul
                      „?? 0.35" afișa o cifră scrisă în cod cu aerul uneia citite —
                      exact minciuna pe care câmpul voiceUsdPerMin există s-o
                      împiedice. Câmp absent → fraza spune că tariful nu s-a citit. */}
                      <span className="or-wallet-sub" style={{ opacity: 0.7 }}>
                        {circuit.voiceUsdPerMin != null
                          ? `Minutele de voce se socotesc cât a fost microfonul PORNIT × $${circuit.voiceUsdPerMin.toFixed(2)}/min — estimare internă, nu factura furnizorului de voce. Suma exactă e doar în contul furnizorului.`
                          : 'Minutele de voce: tariful pe minut nu s-a putut citi de la server — nu afișez o cifră din cod.'}
                      </span>
                      </>
                    )}
                    {/* M7b (8 aug): costul necitit se SPUNE, nu se ascunde — înainte,
                    costReal null făcea blocul să dispară tăcut, fix „£0.00"-ul invers. */}
                    {circuit && !circuit.costReal && (
                      <span className="or-wallet-sub">
                        💷 nu pot citi jurnalul de cost{circuit.costRealMotiv ? `: ${circuit.costRealMotiv}` : ''}
                      </span>
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
                    {circuit?.autonomie && (
                      <span className="or-wallet-sub" style={{ color: circuit.autonomie.ok ? undefined : '#8a8f98' }}>
                        {circuit.autonomie.ok ? '🤖' : '·'} Kelion, de capul lui: {circuit.autonomie.detaliu}
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
                    )}
                  </div>
                )}
                {/* GARDUL NU MAI OMOARĂ TOT (auditul admin, 3 aug): când
                money-circuit pică, o spunem — nu dispare tăcut jumătate de tab
                (fix tiparul „the guard that killed the panel" din 2 aug, cu
                `circuit` în locul lui `expenses`). */}
                {!circuit && circuitFailed && (
                  <div className="or-wallet">
                    <span className="or-wallet-sub" style={{ color: '#e6a23c' }}>
                      ⚠ Nu pot citi circuitul banilor (starea plăților, costul, autonomia) — citirea a eșuat.
                    </span>
                  </div>
                )}
                {/* DOVEZILE + PLĂȚILE, ÎN AFARA gardului {circuit && …} (auditul
                admin, 3 aug): au surse PROPRII de date (fetchDoveziAutonomie,
                fetchPlati) — un money-circuit picat nu are voie să le ascundă. */}
                {(dovezi !== null || plati !== 'necitit') && (
                  <div className="or-wallet">
                    {/* THE EIGHT PROOFS. Not a list written by me: each level looks
                    for its own trace in the database — an order, a PR, a measurement
                    — and says „proven” ONLY if it found it. What has no proof says
                    what exactly the proof would be. */}
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
                    {/* Tablou Plăți & Încasări */}
                    {plati !== 'necitit' && (
                      <span className="or-wallet-sub">
                        💳 <b>Tablou Plăți & Încasări:</b>
                        
                        {/* 1. TOTALURI */}
                        <span style={{ display: 'block', marginTop: 8, marginBottom: 8 }}>
                          <b>💰 Totaluri Încasate:</b>{' '}
                          {plati === null || !plati.totaluri ? (
                            <i style={{ color: 'red' }}>nu pot verifica</i>
                          ) : (
                            <span>
                              Azi: <b>{plati.totaluri.totalAzi} {plati.totaluri.moneda}</b> · Luna asta: <b>{plati.totaluri.totalLunaAsta} {plati.totaluri.moneda}</b>
                            </span>
                          )}
                        </span>

                        {/* 2. CODURI EMISE ȘI NEPLĂTITE */}
                        <span style={{ display: 'block', marginTop: 8, marginBottom: 8 }}>
                          <b>⏳ Coduri Emise și Neplătite:</b>
                          {plati === null || plati.coduriNeplatite === null ? (
                            <span style={{ display: 'block', paddingLeft: 12, color: 'red' }}><i>nu pot verifica</i></span>
                          ) : plati.coduriNeplatite.length === 0 ? (
                            <span style={{ display: 'block', paddingLeft: 12, opacity: 0.8 }}>Niciun cod neplătit în așteptare.</span>
                          ) : (
                            plati.coduriNeplatite.map((c) => (
                              <span key={c.code} style={{ display: 'block', paddingLeft: 12, marginTop: 2 }}>
                                {c.expirata ? '🔴 [Expirat]' : '⏳ [În așteptare]'} <b>{c.code}</b> · User: {c.email} · Sumă: {c.amount} {c.currency} · De când: {new Date(c.createdAt).toLocaleString()}
                              </span>
                            ))
                          )}
                        </span>

                        {/* 3. PLĂȚI ÎNCASATE ȘI CREDITATE */}
                        <span style={{ display: 'block', marginTop: 8, marginBottom: 8 }}>
                          <b>✅ Plăți Încasate și Creditate:</b>
                          {plati === null || plati.platiIncasate === null ? (
                            <span style={{ display: 'block', paddingLeft: 12, color: 'red' }}><i>nu pot verifica</i></span>
                          ) : plati.platiIncasate.length === 0 ? (
                            <span style={{ display: 'block', paddingLeft: 12, opacity: 0.8 }}>Nicio plată încasată.</span>
                          ) : (
                            plati.platiIncasate.map((p) => (
                              <span key={p.code} style={{ display: 'block', paddingLeft: 12, marginTop: 2 }}>
                                ✅ <b>{p.code}</b> · User: {p.email} · Sumă: {p.amount} {p.currency} · Data: {new Date(p.paidAt).toLocaleString()} · Ref bancară: {p.bankRef || '—'}
                              </span>
                            ))
                          )}
                        </span>

                        {/* 4. PLĂȚI NEATRIBUITE (PLASA) */}
                        <span style={{ display: 'block', marginTop: 8, marginBottom: 8 }}>
                          <b>🕸 Plăți Neatribuite (în plasă):</b>
                          {plati === null || plati.neatribuite === null ? (
                            <span style={{ display: 'block', paddingLeft: 12, color: 'red' }}><i>nu pot verifica</i></span>
                          ) : plati.neatribuite.length === 0 ? (
                            <span style={{ display: 'block', paddingLeft: 12, opacity: 0.8 }}>Nimic în plasă (nicio plată neatribuită).</span>
                          ) : (
                            plati.neatribuite.map((p) => (
                              <span key={p.id} style={{ display: 'block', paddingLeft: 12, marginTop: 2 }}>
                                £{p.amount} · „{p.referinta || p.bankRef || '—'}” · Văzut la: {new Date(p.seenAt).toLocaleString()}{' '}
                                <button
                                  type="button"
                                  className="ghost"
                                  onClick={() => {
                                    const email = window.prompt(A.revolutPromptAssign(p.amount))
                                    if (!email) return
                                    void atribuiePlata(p.id, email).then((rezultat) => {
                                      window.alert(A.alertResult(rezultat))
                                      void fetchPlati().then(setPlati)
                                    })
                                  }}
                                >
                                  atribuie userului X
                                </button>{' '}
                                <button
                                  type="button"
                                  className="ghost"
                                  onClick={() => void ignoraPlata(p.id).then(() => void fetchPlati().then(setPlati))}
                                >
                                  {A.payIgnore}
                                </button>
                              </span>
                            ))
                          )}
                        </span>
                      </span>
                    )}
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
                        if (!window.confirm(A.confirmResetCounters)) return
                        setResetBusy(true)
                        // r.ok VERIFICAT (auditul admin, 3 aug): la 500/423
                        // butonul ieșea tăcut din „…" și adminul nu afla că
                        // resetarea NU s-a făcut.
                        const r = await fetch('/api/admin/reset-counters', { method: 'POST', credentials: 'include' }).catch(() => null)
                        // ȘI CORPUL (măsurat 8 aug): un DELETE picat răspundea
                        // 200 cu `{ok:false, sterse:0}`, deci `r.ok` era true și
                        // aici scria „Resetat ✓" peste contoare neatinse. Acum
                        // serverul dă 502 la eșec, iar aici se citește cifra.
                        const j = (await r?.json().catch(() => null)) as
                          | { ok?: boolean; sterse?: number; error?: string }
                          | null
                        setResetMsg(
                          r?.ok && j?.ok === true
                            ? `Resetat ✓ (${j.sterse ?? 0} înregistrări șterse)`
                            : `Nu s-a putut reseta${j?.error ? ` — ${j.error}` : ''} — reîncearcă.`,
                        )
                        await fetchFinance().then((f) => { if (f) setFinance(f) }).catch(() => {})
                        setResetBusy(false)
                      }}
                    >
                      {resetBusy ? '…' : 'Pune pe 0'}
                    </button>
                    {resetMsg && (
                      <span className="fin-sub" style={{ marginLeft: 8, color: resetMsg.startsWith('Resetat') ? undefined : '#e6a23c' }}>
                        {resetMsg}
                      </span>
                    )}
                  </div>
                  {aiParts.length === 0 && <div className="chat-hint">{A.noSpendYet}</div>}
                  {aiParts.map(([k, v]) => (
                    <div className="fin-row" key={k}>
                      <span>
                        {aiLabel(k)}
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
            {/* TREI STĂRI (auditul admin, 3 aug): citirea picată nu mai stă
            deghizată în „Se verifică magazinele live…" pe veci. */}
            {stores === 'necitit' && <p className="chat-hint">{A.checkingStores}</p>}
            {stores === null && (
              <p className="chat-hint" style={{ color: '#e6a23c' }}>
                ⚠ Nu am putut citi magazinele — citire eșuată, nu magazine lipsă.{' '}
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
              <>
                <div className="fin-breakdown">
                  <div className="fin-breakdown-head">
                    Magazine — verificare LIVE pe paginile publice (nu pe promisiunile
                    dashboard-urilor), la maxim 5 minute vechime.
                  </div>
                  {storesData.stores.map((s) => (
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
                    {/* TEXT CORECTAT (auditul admin, 3 aug): vechiul „prin
                    API-urile lor" sugera că aplicația citește instalările din
                    magazine — niciun cod nu cheamă vreun API de magazin. */}
                    Descărcări directe de pe site (numărate de serverul nostru — cifre reale).
                    Magazinele își arată instalările doar agregat, în propriile dashboard-uri;
                    aplicația NU le citește — aici sunt numărate doar descărcările directe.
                  </div>
                  {/* dbOk=false = jurnalul NU s-a citit (auditul admin, 3 aug) —
                  nu se afișează zeroul fals „nicio descărcare". */}
                  {!storesData.downloads.dbOk && (
                    <div className="chat-hint" style={{ color: '#e6a23c' }}>
                      ⚠ Nu pot citi jurnalul de descărcări — baza de date nu răspunde (NU înseamnă zero descărcări).
                    </div>
                  )}
                  {storesData.downloads.dbOk && storesData.downloads.counts.length === 0 && (
                    <div className="chat-hint">
                      Nicio descărcare înregistrată încă (jurnalul pornește de la acest release).
                    </div>
                  )}
                  {storesData.downloads.counts.map((c) => (
                    <div className="fin-row" key={c.file}>
                      <span>{c.file}</span>
                      <span>{c.total} descărcări</span>
                    </div>
                  ))}
                </div>
                {storesData.downloads.recent.length > 0 && (
                  <div className="fin-breakdown">
                    <div className="fin-breakdown-head">{A.downloadsHead}</div>
                    {storesData.downloads.recent.map((d, i) => (
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
              <div className="fin-breakdown-head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <span>
                  {/* TEXT CORECTAT (auditul admin, 3 aug): vechiul „toate mesajele"
                  era fals — aici se citește DOAR folderul INBOX, iar pollerul
                  rândului 19 (MAIL_ORGANIZE) mută mesajele procesate în
                  Kelion-Answered / Kelion-ToAnswer / Kelion-Automated în ~3 min.
                  Un mesaj „dispărut" de aici e de regulă ARHIVAT acolo, nu pierdut
                  (defectul din 10 iul, reintrodus de organizare). */}
                  📬 Cutia contact@kelionai.app — DOAR folderul INBOX, citit direct din
                  server (ultimele 40, citite sau nu). Mesajele deja procesate de Secretar
                  stau în folderele Kelion-Answered / Kelion-ToAnswer / Kelion-Automated
                  (vizibile în clientul de mail). Bifează și șterge — una sau mai multe
                  odată; serverul le mută în coșul căsuței când acesta există.
                </span>
                <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
                  {mailboxData && mailboxData.emails.length > 0 && (
                    <button
                      type="button"
                      className="ghost"
                      style={{ fontSize: 12 }}
                      onClick={() =>
                        setMailSel((prev) =>
                          prev.size === mailboxData.emails.length ? new Set() : new Set(mailboxData.emails.map((m) => m.uid)),
                        )
                      }
                    >
                      {mailboxData && mailSel.size === mailboxData.emails.length && mailboxData.emails.length > 0 ? 'Deselectează tot' : 'Selectează tot'}
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
              {mailboxLoading && <p className="chat-hint">{A.readingMailbox}</p>}
              {/* TREI STĂRI DISTINCTE (auditul admin, 3 aug): „goală", „IMAP a
              picat: {motiv}" și „MAIL_PASS nesetat" nu mai sunt un singur text. */}
              {!mailboxLoading && mailboxLive === null && (
                <p className="chat-hint" style={{ color: '#e6a23c' }}>
                  ⚠ {A.mailboxReadFail.replace('{motiv}', 'ruta serverului nu a răspuns')}
                </p>
              )}
              {!mailboxLoading && mailboxData && !mailboxData.ok && (
                <p className="chat-hint" style={{ color: '#e6a23c' }}>
                  ⚠{' '}
                  {mailboxData.motiv === 'mail_neconfigurat'
                    ? A.mailboxNotConfigured
                    : A.mailboxReadFail.replace('{motiv}', mailboxData.motiv ?? 'motiv necunoscut')}
                </p>
              )}
              {!mailboxLoading && mailboxData?.ok && mailboxData.emails.length === 0 && (
                <p className="chat-hint">{A.mailboxEmpty}</p>
              )}
              {(mailboxData?.emails ?? []).map((m) => (
                <div className="inbox-item" key={m.uid}>
                  <div className="inbox-top">
                    <span className="inbox-from" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      <input
                        type="checkbox"
                        checked={mailSel.has(m.uid)}
                        onChange={() => toggleMailSel(m.uid)}
                        title="Selectează pentru ștergere"
                      />
                      {m.fromName ? `${m.fromName} <${m.from}>` : m.from || '(expeditor necunoscut)'}
                    </span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
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
              {contactMsgs === 'necitit' && <p className="chat-hint">{A.loading}</p>}
              {contactMsgs === null && (
                <p className="chat-hint" style={{ color: '#e6a23c' }}>
                  ⚠ Nu am putut citi mesajele de contact — citire eșuată (posibil sesiune expirată), nu listă goală.
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
                    {/* `emailed` e acum MĂSURAT (auditul admin, 3 aug): devine
                    true doar după ce sendMail chiar a raportat succes — vechea
                    etichetă ✉️ se scria înainte de orice trimitere. */}
                    <span className={`inbox-flag ${m.emailed ? 'ok' : 'wait'}`}>
                      {m.emailed ? '✉️ redirecționat pe email' : '📥 doar salvat (trimiterea a picat sau email off)'}
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
              {inbound === 'necitit' && <p className="chat-hint">{A.loading}</p>}
              {inbound === null && (
                <p className="chat-hint" style={{ color: '#e6a23c' }}>
                  ⚠ Nu am putut citi scrisorile — citire eșuată (posibil sesiune expirată), nu listă goală.
                </p>
              )}
              {inboundData && inboundData.length === 0 && (
                <p className="chat-hint">{A.noLettersYet}</p>
              )}
              {(inboundData ?? []).map((m) => (
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
              {voiceprintsLoading && (voiceprints?.length ?? 0) === 0 && (
                <div className="chat-hint">{A.loading}</div>
              )}
              {/* null = citirea a PICAT (auditul admin, 3 aug) — nu se afișează
              „Nicio amprentă": ownerul ar crede că amprenta lui a dispărut. */}
              {!voiceprintsLoading && voiceprints === null && (
                <div className="chat-hint" style={{ color: '#e6a23c' }}>
                  ⚠ Nu am putut citi lista amprentelor — citire eșuată, nu listă goală (reîncerc la 10s).
                </div>
              )}
              {!voiceprintsLoading && voiceprints !== null && voiceprints.length === 0 && (
                <div className="chat-hint">{A.noVoiceprintsYet}</div>
              )}
              {vpMsg && <div className="chat-hint" style={{ color: '#e6a23c' }}>{vpMsg}</div>}
              {(voiceprints ?? []).map((v) => (
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
                      onClick={() => {
                        // CONFIRMARE + verdict măsurat (auditul admin, 3 aug):
                        // era SINGURUL buton distructiv fără confirmare, iar pe
                        // {ok:false} rândul „dispărea" și reapărea la refresh.
                        if (!window.confirm(A.confirmDeleteVoiceprint(v.name || v.email))) return
                        void deleteVoiceprint(v.email).then((ok) => {
                          if (ok) {
                            setVoiceprints((cur) => (cur ? cur.filter((x) => x.email !== v.email) : cur))
                            setVpMsg('')
                          } else setVpMsg(A.voiceprintDeleteFailed(v.email))
                        })
                      }}
                    >
                      șterge
                    </button>
                  </span>
                </div>
              ))}
            </div>
            <div className="fin-breakdown" style={{ marginTop: 12 }}>
              {/* STAREA REALĂ, NU RECLAMA (auditul admin, 3 aug): backend-ul e
              DEZARMAT hard (adminLock.ts, LACAT_DEZARMAT=true — cererea
              ownerului, 31 iul), deci serverul răspunde mereu armed:false.
              Vechiul formular promitea „Armează lacătul … butonul Admin cere
              de-acum vocea ta sau secretul" — fals: nu cerea nimic, niciodată.
              Acum: starea citită se afișează CUM E, iar null (citire picată)
              nu se mai preface „nearmat". */}
              <div className="fin-breakdown-head">
                Lacătul butonului Admin —{' '}
                {lockArmed === 'necitit'
                  ? 'se citește starea…'
                  : lockArmed === null
                    ? 'nu am putut citi starea (citire eșuată — redeschide tabul)'
                    : lockArmed
                      ? 'ARMAT ✓: butonul se deschide doar cu amprenta ta vocală sau cu secretul'
                      : 'DEZARMAT la cererea ta (31 iul): butonul Admin intră direct, fără voce/secret'}
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
                  placeholder="Secretul de activare (min. 4 caractere) — păstrat pentru rearmare"
                  autoComplete="new-password"
                  style={{ flex: 1, minWidth: 0 }}
                />
                <button type="submit" className="ghost">
                  Salvează secretul
                </button>
              </form>
              {lockMsg && <div className="chat-hint">{lockMsg}</div>}
              <div className="chat-hint">
                Dezarmarea e o constantă în cod (decizia ta din 31 iul: „scoate aprobarea complet").
                Secretul salvat aici rămâne pregătit; ca să REARMEZI lacătul, cere-mi în chat
                „repornește lacătul admin" — e o linie de cod + deploy. Cât e dezarmat, sesiunea
                de admin e singurul factor de acces.
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
              {/* EȘECUL SE DECLARĂ (auditul admin, 3 aug): „Nicio versiune
              salvată încă" rămâne DOAR pentru o listă confirmată goală. */}
              {!recoveryLoading && recoveryFailed && (
                <div className="chat-hint" style={{ color: '#e6a23c' }}>
                  ⚠ Nu am putut citi versiunile — citire eșuată (GITHUB_TOKEN lipsă sau GitHub n-a răspuns), NU listă goală.{' '}
                  <button type="button" className="ghost" onClick={loadRecovery}>
                    Reîncearcă
                  </button>
                </div>
              )}
              {!recoveryLoading && !recoveryFailed && recoveryPoints.length === 0 && (
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
        {tab === 'sistem' && (
          <section className="admin-finance">
            <div className="fin-breakdown">
              <div className="fin-breakdown-head">Sistem (VPS)</div>
              <p className="chat-hint" style={{ marginTop: 8 }}>
                Declanșează fluxurile de restart pentru aplicație și Caddy. Durează câteva secunde.
              </p>
              <button
                className="ghost"
                style={{ marginTop: 12 }}
                onClick={async () => {
                  if (!confirm('Ești sigur că vrei să resetezi VPS-ul (aplicația și serverul web)?')) return
                  try {
                    const res = await fetch('/api/admin/reset-vps', {
                      method: 'POST',
                      credentials: 'include'
                    })
                    // CORPUL, nu doar statusul (măsurat 8 aug): serverul întorcea
                    // `{ok:true}` chiar și când GitHub refuzase declanșarea, deci
                    // aici scria „trimisă cu succes" pentru o repornire care nu
                    // pornise. Acum răspunsul poartă fiecare pas, cu motivul lui.
                    const j = (await res.json().catch(() => null)) as
                      | { ok?: boolean; pasi?: { runbook: string; ok: boolean; detaliu: string }[] }
                      | null
                    if (res.ok && j?.ok === true) {
                      alert(`Repornire pornită: ${(j.pasi ?? []).map((p) => p.runbook).join(', ')}`)
                    } else {
                      const motiv = (j?.pasi ?? []).find((p) => !p.ok)?.detaliu ?? `HTTP ${res.status}`
                      alert(`Resetarea NU a pornit: ${motiv}`)
                    }
                  } catch (e) {
                    // Eroarea era PRINSĂ și ARUNCATĂ: omul vedea „eroare de rețea"
                    // orice s-ar fi întâmplat, iar cauza reală dispărea. Acum
                    // motivul ajunge la el și în consolă, ca să se poată repara.
                    const motiv = e instanceof Error ? e.message : String(e)
                    console.error('[reset-vps]', e)
                    alert(`Eroare la trimiterea comenzii de resetare: ${motiv}`)
                  }
                }}
              >
                Reset VPS
              </button>
            </div>
          </section>
        )}
        {tab === 'erori' && (
          <section className="admin-finance">
            <div className="fin-breakdown">
              <div className="fin-breakdown-head">
                Erori — ce e fiecare, în clar. Kelion le vede și el în creier (le poți întreba în chat:
                „ce e eroarea asta?").
                {eroriBusy && <span className="chat-hint"> · se încarcă…</span>}
              </div>
              {erori === 'necitit' && <p className="chat-hint">Se încarcă…</p>}
              {erori === null && (
                <p className="chat-hint" style={{ color: '#e6a23c' }}>
                  ⚠ Nu pot citi erorile — citirea a eșuat (NU înseamnă „zero erori"). Reîncerc automat la 20s.
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
                      <div style={{ fontWeight: 600, marginBottom: 4 }}>Sistem (server + ordine de build)</div>
                      {erori.sistem.map((p, i) => (
                        <ErrRow key={`s${i}`} sev={p.severitate} cat={p.categorie} text={p.text} ceEste={p.ceEste} />
                      ))}
                    </div>
                  )}
                  {erori.browser.length > 0 && (
                    <div style={{ marginTop: 14 }}>
                      <div style={{ fontWeight: 600, marginBottom: 4 }}>Browser (F12 la utilizatori, ultimele 48h)</div>
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
        {tab === 'notificari' && (
          <section className="admin-finance">
            <div className="fin-breakdown">
              <div className="fin-breakdown-head">
                Notificări — cereri noi care cer atenția ta (plată neatribuită, cerere neacoperită).
              </div>
              {notificari === 'necitit' && <p className="chat-hint">Se încarcă…</p>}
              {notificari === null && (
                <p className="chat-hint" style={{ color: '#e6a23c' }}>
                  ⚠ Nu pot citi notificările — citirea a eșuat (NU înseamnă „zero"). Reîncerc automat la 20s.
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
                    <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                      {!n.read && (
                        <span
                          aria-hidden
                          style={{ width: 8, height: 8, borderRadius: 4, background: '#4aa3ff', display: 'inline-block', flex: '0 0 auto' }}
                        />
                      )}
                      <span style={{ fontWeight: 600 }}>{n.title}</span>
                      <span className="chat-hint" style={{ fontSize: 12 }}>{n.type}</span>
                      {!n.read && (
                        <button
                          type="button"
                          className="ghost"
                          style={{ marginLeft: 'auto', fontSize: 12, padding: '2px 8px' }}
                          onClick={async () => {
                            if (await markNotificareCitit(n.id)) loadNotificari()
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
              {/* (Checkbox-ul „Use Fable 5 brain (paid)" a fost SCOS, 3 aug —
                  extirparea OpenRouter: Fable 5 mergea prin OpenRouter, care nu
                  mai există. Constructorul rulează pe Gemini, cheia ownerului.) */}
              {buildMsg && <div className="chat-hint">{buildMsg}</div>}
            </div>
            <div className="fin-breakdown" style={{ marginTop: 12 }}>
              <div className="fin-breakdown-head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span>Coada ordinelor</span>
                {buildJobsData?.some((j) => j.status === 'failed' || j.status === 'done') && (
                  <button
                    type="button"
                    className="ghost"
                    style={{ fontSize: 12 }}
                    onClick={cleanBuildOrders}
                    title="Șterge din coadă toate ordinele eșuate și terminate (rămân doar cele în curs)"
                  >
                    Curăță eșuate/terminate
                  </button>
                )}
              </div>
              {/* PAUZA, VIZIBILĂ AICI (auditul admin, 3 aug): trăia doar în tabul
              Bani — ordinele stăteau „în coadă · 0%" fără nicio explicație. */}
              {buildPaused && (
                <div className="chat-hint" style={{ color: '#e6a23c' }}>
                  ⏸ Autonomia e PE PAUZĂ (oprită de tine din tabul Bani) — ordinele așteaptă în coadă, nu se pierd; lucrătorul nu ia nimic până n-o repornești.
                </div>
              )}
              {/* TREI STĂRI (auditul admin, 3 aug): „Niciun ordin încă" doar după
              o citire REUȘITĂ; înainte, orice eșec arăta coada „goală". */}
              {buildJobs === 'necitit' && <div className="chat-hint">{A.loading}</div>}
              {buildJobs === null && (
                <div className="chat-hint" style={{ color: '#e6a23c' }}>
                  ⚠ Nu am putut citi coada — citire eșuată, nu coadă goală (reîncerc la 10s).
                </div>
              )}
              {buildJobsData && buildJobsData.length === 0 && <div className="chat-hint">{A.noOrdersYet}</div>}
              {(buildJobsData ?? []).map((j) => (
                <div className="fin-row" key={j.id} style={{ flexWrap: 'wrap' }}>
                  <span>
                    <strong>#{j.id}</strong>{' '}
                    <span className={`vis-badge ${j.status === 'done' ? 'human' : j.status === 'failed' ? 'kind-demo' : ''}`}>
                      {/* ONESTITATE (Adrian, 5 aug): un job „done" = PR DESCHIS, NU
                          pe live. „GATA" sugera fals că e publicat. Un job al cărui
                          PR nu e merge-uit în master arată „în așteptare" (PR gata,
                          dar așteaptă publicarea) — orice, dar nu „GATA". */}
                      {j.status === 'queued' ? 'în coadă' : j.status === 'running' ? 'lucrează…' : j.status === 'done' ? 'în așteptare' : 'eșuat'}
                    </span>{' '}
                    {/* FABLE 5 BADGE — DOAR pe raportul lucrătorului (auditul
                        admin, 3 aug): ramura veche pe regex peste orderText
                        eticheta „Fable 5" orice ordin nou care doar pomenea
                        cuvintele, afirmând un creier care nu mai există
                        (toggle-ul a fost scos odată cu OpenRouter). Marcajul
                        rămâne istoric, pe rapoartele vechi cu j.brain='fable-5'. */}
                    {j.brain === 'fable-5' && (
                      <span
                        className="vis-badge"
                        style={{ background: '#7c3aed', color: '#fff' }}
                        title="Fable 5 — marcaj istoric (creierul plătit de dinainte de extirparea OpenRouter, 3 aug)"
                      >
                        Fable 5
                      </span>
                    )}{' '}
                    {j.orderText.slice(0, 90)}
                    {j.orderText.length > 90 ? '…' : ''}
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    {j.prUrl && (
                      <a href={j.prUrl} target="_blank" rel="noreferrer">
                        PR ↗
                      </a>
                    )}
                    {j.tokens > 0 && <span>{`· ${Math.round(j.tokens / 1000)}k tok`}</span>}
                    <span style={{ opacity: 0.7 }}>
                      · {new Date(j.updatedAt).toLocaleString('ro-RO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </span>
                    {/* REIA — doar pentru cele care nu sunt în curs (eșuat/GATA/în coadă). */}
                    {(j.status === 'failed' || j.status === 'done' || j.status === 'queued') && (
                      <button
                        type="button"
                        className="ghost"
                        style={{ fontSize: 12 }}
                        onClick={() => retryBuildOrder(j.id)}
                        title="Repune ordinul în coadă (îl reia de la zero)"
                      >
                        ↻ reia
                      </button>
                    )}
                    {/* ȘTERGE — un ordin viu ('running') nu se șterge din greșeală. */}
                    {j.status !== 'running' && (
                      <button
                        type="button"
                        className="ghost"
                        style={{ fontSize: 12, color: '#ff7a7a' }}
                        onClick={() => deleteBuildOrder(j.id)}
                        title="Șterge definitiv ordinul"
                      >
                        ✕
                      </button>
                    )}
                    {/* OPREȘTE — un 'running' nu putea fi oprit din panou deloc
                        (auditul admin, 3 aug); ruta cheamă cancelBuildJob. */}
                    {j.status === 'running' && (
                      <button
                        type="button"
                        className="ghost"
                        style={{ fontSize: 12, color: '#ff7a7a' }}
                        onClick={() => cancelBuildOrder(j.id)}
                        title={'Oprește ordinul aflat în lucru (trece pe „eșuat”)'}
                      >
                        ⏹ oprește
                      </button>
                    )}
                  </span>
                  {/* BARA 0–100% (Adrian, 3 aug: „fiecare job trebuie să afișeze
                      starea reală printr-o bară 0–100%, actualizată dinamic").
                      Procentul e harta etapei REALE raportate de lucrător
                      (serverul o calculează din progres); textul etapei stă
                      lângă cifră, ca s-o poți confrunta oricând cu sursa.
                      Se actualizează cu polling-ul de 10s al cozii. */}
                  {j.pct != null && (
                    <div style={{ flexBasis: '100%', display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                      <div
                        style={{
                          flex: 1,
                          height: 6,
                          borderRadius: 999,
                          background: 'color-mix(in srgb, currentColor 12%, transparent)',
                          overflow: 'hidden',
                        }}
                        title={j.progress || (j.status === 'queued' ? 'în coadă' : '')}
                      >
                        <div
                          style={{
                            width: `${j.pct}%`,
                            height: '100%',
                            borderRadius: 999,
                            background: j.status === 'done' ? '#38b26e' : '#4a8df0',
                            transition: 'width 0.6s ease',
                          }}
                        />
                      </div>
                      <span style={{ fontSize: 11, opacity: 0.8, minWidth: 34, textAlign: 'right' }}>{j.pct}%</span>
                      {j.status === 'running' && j.progress && (
                        <span className="chat-hint" style={{ fontSize: 11, maxWidth: '46%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {j.progress}
                        </span>
                      )}
                    </div>
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
                Gesturile lui Kelion — apasă „▶ Arată" ca să-l vezi făcând gestul; bifează ce are voie
                să folosească pe logică/context. Ce NU e bifat NU se folosește deloc în aplicație.
                {gestSaved ? ' · salvat ✓' : ''}
                {gestErr && <span style={{ color: '#ff7a7a' }}> · {gestErr}</span>}
              </div>
              {gestOff === 'necitit' && <div className="chat-hint">{A.loading}</div>}
              {/* BIFELE BLOCATE PE CITIRE EȘUATĂ (auditul admin, 3 aug): pe []
              fals, toate gesturile apăreau „active" și primul toggle salva peste
              lista reală de pe server, ștergând dezactivările anterioare. */}
              {gestOff === null && (
                <div className="chat-hint" style={{ color: '#e6a23c' }}>
                  ⚠ Nu am putut citi starea gesturilor — bifele sunt blocate ca să nu salvez peste o listă necitită. Redeschide tabul.
                </div>
              )}
              {GESTURE_CATEGORIES.map((cat) => (
                <div key={cat}>
                  <div className="fin-breakdown-head" style={{ opacity: 0.7, marginTop: 12 }}>
                    {cat}
                  </div>
                  {GESTURE_CATALOG.filter((g) => g.category === cat).map((g) => {
                    const on = gestOffData ? !gestOffData.includes(g.clip) : false
                    return (
                      <div className="fin-row" key={g.clip}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: gestOffData ? 'pointer' : 'not-allowed' }}>
                          <input type="checkbox" checked={on} disabled={!gestOffData} onChange={() => toggleGesture(g.clip)} />
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
            {/* TABELUL NU MAI DISPARE MUT (auditul admin, 3 aug): o citire
            eșuată se DECLARĂ — vedeta tabului nu poate lipsi fără explicație. */}
            {envCheck === 'necitit' && <p className="chat-hint">{A.loading}</p>}
            {envCheck === null && (
              <p className="chat-hint" style={{ color: '#e6a23c' }}>
                ⚠ Nu am putut citi cheile procesului — citire eșuată, NU înseamnă că lipsesc. Apasă „Reîmprospătează".
              </p>
            )}
            {envCheckData && (
              <div className="fin-breakdown" style={{ marginBottom: 14 }}>
                <div className="fin-breakdown-head">
                  Ce chei vede serverul CHIAR ACUM — {envCheckData.summary.total - envCheckData.summary.lipsa - envCheckData.summary.goale}/
                  {envCheckData.summary.total} prezente
                </div>
                <div className="or-wallet-sub">
                  Procesul a pornit la{' '}
                  <strong>{new Date(envCheckData.startedAt).toLocaleString('ro-RO')}</strong>. O cheie scrisă
                  DUPĂ ora asta nu e încărcată până la repornirea containerului — asta e capcana în care
                  „am scris-o de zeci de ori" și „nu o vede" sunt amândouă adevărate.
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
                    <span className="fin-sub">redenumește-le, sau spune-mi și le citesc și așa</span>
                  </div>
                )}
                {envCheckData.vars
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
                {envCheckData.summary.lipsa === 0 && envCheckData.summary.goale === 0 && (
                  <div className="fin-row">
                    <span>✅ Toate cheile așteptate sunt în procesul care rulează.</span>
                  </div>
                )}
                {envCheckData.vars
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
                    // REÎMPROSPĂTEAZĂ AMBELE BLOCURI (auditul admin, 3 aug):
                    // tabelul „CHIAR ACUM" rămânea pe datele de la deschidere —
                    // titlul mințea față de comportament.
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
            {/* TREI STĂRI (auditul admin, 3 aug): backend-ul răspundea 200 cu
            liste goale la DB picat, iar „nu s-a strâns activitate" era o
            afirmație nemăsurată; acum eșecul e eșec, cu reîncercare. */}
            {activity === 'necitit' && <p className="chat-hint">{A.loading}</p>}
            {activity === null && (
              <p className="chat-hint" style={{ color: '#e6a23c' }}>
                ⚠ Nu pot citi activitatea — citirea a eșuat, nu e cont fără activitate.{' '}
                <button type="button" className="ghost" onClick={() => void fetchActivity().then(setActivity)}>
                  Reîncearcă
                </button>
              </p>
            )}
            {activityData && activityData.users.length === 0 && (
              <p className="chat-hint">
                Încă nu s-a strâns activitate pe conturi — se adună de la prima intrare a fiecărui
                utilizator după această actualizare.
              </p>
            )}
            {activityData && activityData.users.length > 0 && (
              <>
                <div className="fin-breakdown">
                  <div className="fin-breakdown-head">
                    Pe utilizator — ultima intrare, IP, loc, cât a stat în total
                  </div>
                  {activityData.users.map((u) => (
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
                        {/* MONITORIZAREA PE USER (10 aug): cât a COSTAT pe
                            furnizori — roșu când a consumat peste ce are. */}
                        <span style={(u.consumedUsd ?? 0) > 0 && u.balance <= 0 ? { color: '#e5484d', fontWeight: 600 } : undefined}>
                          consum ${(u.consumedUsd ?? 0).toFixed(2)}
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
                        {/* FEEDBACK LA EȘEC (auditul admin, 3 aug): toate cele
                        patru acțiuni tăceau când manageUser întorcea null —
                        butonul părea apăsat degeaba. */}
                        <button
                          type="button"
                          className="user-act"
                          onClick={async () => {
                            const r = await manageUser(u.email, u.blocked ? 'unblock' : 'block')
                            if (r) setActivity(r)
                            else window.alert(A.alertCouldNotPerf)
                          }}
                        >
                          {u.blocked ? 'Deblochează' : 'Blochează'}
                        </button>
                        <button
                          type="button"
                          className="user-act"
                          onClick={async () => {
                            const s = window.prompt(
                              A.promptManualCreditAmount(u.email),
                            )
                            if (s == null) return
                            // VIRGULA ZECIMALĂ ACCEPTATĂ (auditul admin, 3 aug):
                            // „5,50" dădea NaN și funcția ieșea tăcut — ownerul
                            // credea că a creditat. Același tratament ca ruta
                            // gemini-credit din backend.
                            const amt = Number(s.replace(',', '.').trim())
                            if (!Number.isFinite(amt) || amt === 0) {
                              window.alert(A.alertInvalidAmount(s))
                              return
                            }
                            const r = await manageUser(u.email, 'credit', amt)
                            if (r) setActivity(r)
                            else window.alert(A.alertNotCredited)
                          }}
                        >
                          Credit
                        </button>
                        <button
                          type="button"
                          className="user-act danger"
                          onClick={async () => {
                            // CONFIRMAREA SPUNE SCOPUL REAL (auditul admin, 3 aug):
                            // lista vine din deleteUserData — inclusiv biometria
                            // și contul Google, nu doar „mesaje, sold".
                            if (!window.confirm(A.confirmDeleteUserData(u.email)))
                              return
                            const r = await manageUser(u.email, 'delete')
                            if (r) setActivity(r)
                            else window.alert(A.alertNotDeleted)
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
                  {activityData.sessions.length === 0 && <div className="chat-hint">—</div>}
                  {activityData.sessions.map((s, i) => (
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
                Contacte — vizitatori care și-au lăsat emailul{leadsData ? ` (${leadsData.length})` : ''}
              </div>
              {leads === 'necitit' && <div className="chat-hint">{A.loading}</div>}
              {/* null = citirea a EȘUAT (auditul admin, 3 aug) — nu „Niciun
              contact încă" afirmat fără măsurătoare. */}
              {leads === null && (
                <div className="chat-hint" style={{ color: '#e6a23c' }}>
                  ⚠ Nu am putut citi contactele — citire eșuată, nu listă goală (reîncerc la 30s).
                </div>
              )}
              {leadsData && leadsData.length === 0 && <div className="chat-hint">{A.noContactsYet}</div>}
              {(leadsData ?? []).map((l) => (
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
                        // ALERTA SPUNE CE S-A MĂSURAT (auditul admin, 3 aug):
                        // vechiul text inventa cauza „verifică MAIL_PASS" chiar
                        // când mailul mergea și eșecul era cu totul altul.
                        const verdict = await emailLead(l.id, l.email, subject, body)
                        if (verdict === 'ok') {
                          await fetchLeads().then(setLeads)
                          window.alert(A.alertEmailSent)
                        } else if (verdict === 'bad_request') {
                          window.alert(A.alertEmailNotSent400)
                        } else if (verdict === 'send_failed') {
                          window.alert(A.alertEmailNotSent502)
                        } else {
                          window.alert(A.alertEmailNotSentNetwork)
                        }
                      }}
                    >
                      Trimite email
                    </button>
                  </div>
                </div>
              ))}
            </div>
            {demos === 'necitit' && <p className="chat-hint">{A.loading}</p>}
            {/* ZEROURILE FABRICATE AU MURIT (auditul admin, 3 aug): DB picat nu
            mai desenează „Vizite 0/0" pe carduri — 500-ul serverului ajunge
            aici ca eșec declarat, cu reîncercare. */}
            {demos === null && (
              <p className="chat-hint" style={{ color: '#e6a23c' }}>
                ⚠ Nu pot citi vizitele — citirea a eșuat (nu înseamnă zero vizite).{' '}
                <button type="button" className="ghost" onClick={() => void fetchDemos().then(setDemos)}>
                  Reîncearcă
                </button>
              </p>
            )}
            {demosData && (
              <>
                <div className="fin-cards">
                  <div className="fin-card">
                    <span className="fin-label">Vizite azi / total</span>
                    <span className="fin-val">
                      {demosData.visitsToday} / {demosData.visitsTotal}
                    </span>
                  </div>
                  <div className="fin-card">
                    <span className="fin-label">Țări</span>
                    <span className="fin-val">{demosData.byCountry.filter((c) => c.code).length}</span>
                  </div>
                  <div className="fin-card">
                    <span className="fin-label">{A.botsDetected}</span>
                    <span className="fin-val">{demosData.bots}</span>
                  </div>
                </div>
                <div className="fin-breakdown">
                  <div className="fin-breakdown-head">{A.byCountry}</div>
                  {demosData.byCountry.length === 0 && (
                    <div className="chat-hint">{A.noVisitorsYet}</div>
                  )}
                  {demosData.byCountry.map((c) => (
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
                  {demosData.recent.length === 0 && <div className="chat-hint">—</div>}
                  {demosData.recent.map((r, i) => (
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
        {/* (Tabul „Chat live" SCOS — 10 aug, ordinul ownerului.) */}
        {tab === 'share' && (
          <section className="admin-finance">
            {(() => {
              const url = 'https://kelionai.app'
              // TABUL RESCRIS CORECT (Adrian, 3 aug: „rescrie corect tot tabul"):
              // (1) mesajul e AL LUI, editabil, salvat local — nu bătut în cod;
              // (2) fiecare rețea spune ce preia REAL (LinkedIn ignoră textul —
              //     doar linkul; nu promitem ce platforma nu face);
              // (3) clipul promo: fluxul REAL, pas cu pas (se generează din chat
              //     cu `prepare_promo_clip`, se salvează în Downloads, se urcă
              //     în studioul platformei) — nu o afirmație despre un folder.
              const text = shareText.trim() || SHARE_TEXT_IMPLICIT
              const enc = encodeURIComponent
              const links: { name: string; href: string }[] = [
                { name: 'X (Twitter)', href: `https://twitter.com/intent/tweet?text=${enc(text)}&url=${enc(url)}` },
                { name: 'Facebook', href: `https://www.facebook.com/sharer/sharer.php?u=${enc(url)}&quote=${enc(text)}` },
                { name: 'WhatsApp', href: `https://wa.me/?text=${enc(`${text} ${url}`)}` },
                { name: 'Telegram', href: `https://t.me/share/url?url=${enc(url)}&text=${enc(text)}` },
                // LinkedIn NU acceptă text pre-completat pe share-offsite — doar
                // linkul. Scris pe buton, ca să nu pară stricat când textul „dispare".
                { name: 'LinkedIn (doar linkul)', href: `https://www.linkedin.com/sharing/share-offsite/?url=${enc(url)}` },
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
                          // .catch OBLIGATORIU (auditul admin, 3 aug): clipboard-ul
                          // refuzat (permisiuni/focus) lăsa butonul mut + unhandled
                          // rejection în consolă (zgomot în auditul F12).
                          void navigator.clipboard.writeText(`${text} ${url}`).then(() => {
                            setCopied(true)
                            window.setTimeout(() => setCopied(false), 1800)
                          }).catch(() => {
                            setCopied(false)
                            window.alert('Nu s-a putut copia (browserul a refuzat clipboard-ul) — copiază manual textul.')
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
                    <div className="fin-breakdown-head">
                      Mesajul tău de prezentare — îl scrii o dată, îl folosesc toate
                      butoanele de mai jos. Se salvează în browserul ăsta.
                    </div>
                    <textarea
                      className="admin-input"
                      style={{ width: '100%', minHeight: 64, resize: 'vertical' }}
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
                      Clipul promo — fluxul real, pas cu pas: (1) îi ceri lui Kelion în
                      chat „pregătește clipul promo" — îl compune și ți-l salvează în
                      Downloads; (2) deschizi studioul platformei de mai jos; (3) urci
                      clipul din Downloads acolo. Butoanele DOAR deschid studiourile —
                      nicio platformă nu permite încărcare automată din afară.
                    </div>
                  </div>
                  <ShareGrid
                    title={A.videoPlatforms}
                    items={uploads}
                  />
                </>
              )
            })()}
          </section>
        )}
        {/* (Tabul „Cereri neacoperite" SCOS — 10 aug, ordinul ownerului.) */}
        {/* (Tabul „Istoric chat" a fost SCOS ca tab de sus — 10 aug, ownerul: „se mută în butonul user, cu istoric pe user"; istoricul per user se deschide din tabul Utilizatori, click pe rând.) */}
      </div>
      {userConvo && (
        <div className="convo-overlay" onClick={closeUserConvo}>
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
                  disabled={roBusy || (userConvo.rows?.length ?? 0) === 0}
                  title={A.translateToRo}
                  onClick={() => void toggleRo(userConvo.rows ?? [])}
                >
                  {roBusy ? 'Traduc…' : roOn ? 'Arată originalul' : '🌐 Tradu în română'}
                </button>
                {roOn && roFailed > 0 && (
                  <span className="chat-hint" style={{ color: '#d97706' }}>
                    ⚠ {roFailed} netraduse
                  </span>
                )}
                <button type="button" className="ghost" onClick={closeUserConvo}>
                  Close
                </button>
              </div>
            </header>
            <div className="admin-history convo-body">
              {userConvoLoading && <p className="chat-hint">{A.loading}</p>}
              {/* null = citirea a PICAT (auditul admin, 3 aug) — distinct de
              „Nu a scris niciun mesaj încă". */}
              {!userConvoLoading && userConvo.rows === null && (
                <p className="chat-hint" style={{ color: '#e6a23c' }}>
                  ⚠ {A.historyReadFail}
                </p>
              )}
              {!userConvoLoading && userConvo.rows !== null && userConvo.rows.length === 0 && (
                <p className="chat-hint">{A.noMessagesYet}</p>
              )}
              {!userConvoLoading &&
                groupByDay(userConvo.rows ?? []).map((g) => (
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
