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
import { starePush, activeazaPush, dezactiveazaPush, type StarePush } from '../lib/pushTelefon'
import type { BrainCredit } from '../pages/Stage'
import {
  fetchHistory,
  type HistoryRow,
  translateToRo,
  fetchFinance,
  manageUser,
  fetchMoneyCircuit,
  setVideoPlatit,
  fetchDoveziAutonomie,
  fetchPlati,
  atribuiePlata,
  ignoraPlata,
  type PlatiAdmin,
  type DovadaAutonomie,
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
  fetchVoiceprints,
  fetchVoiceprintAudio,
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
  fetchPlafon,
  setPlafon,
  type PlafonConstructor,
  fetchCreier,
  setCreier,
  type CreierAdmin,
  fetchCreditAI,
  type CreditAIFurnizor,
  evalueazaOrdinConstructor,
  type EvalConstructor,
  clasaBec,
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
// ── P26 — REGISTRUL DE AUDIT (owner, 15 aug: „istoric salvat cu dovezi cine a
// modificat, trasabilitate 24 din 24 de ore" + „baza de date nu se pierde").
// Se încarcă la deschiderea tabului Utilizatori; arată cine/când/ce, valoarea
// ── P22: TIMERUL DE PROMOVARE (owner: „cu functie timer de promovare eventual
// la ore prestabilite") — cheile sunt ALE ownerului, pe față: orele, plafonul
// zilnic în USD, ideea clipului, butonul PORNIT/OPRIT (implicit OPRIT — banii
// nu curg nesupravegheați). Serverul refuză PE NUME orice rulare în afara
// cheilor (promoTimer.ts); fiecare salvare lasă urmă în registrul de audit.
interface SetariPromoUi { pornit: boolean; ore: number[]; plafonUsdZi: number; idee: string }
function PromoStudio() {
  const [stare, setStare] = useState<SetariPromoUi | null>(null)
  const [busy, setBusy] = useState(false)
  const [oreTxt, setOreTxt] = useState('')
  const [plafonTxt, setPlafonTxt] = useState('1')
  const [idee, setIdee] = useState('')
  useEffect(() => {
    void fetch('/api/admin/studio-promo', { credentials: 'include' })
      .then((r) => (r.ok ? (r.json() as Promise<SetariPromoUi>) : null))
      .then((j) => {
        if (!j) return
        setStare(j)
        setOreTxt(j.ore.join(','))
        setPlafonTxt(String(j.plafonUsdZi))
        setIdee(j.idee)
      })
      .catch(() => {})
  }, [])
  async function salveaza(pornit: boolean): Promise<void> {
    setBusy(true)
    const ore = oreTxt
      .split(',')
      .map((x) => Number(x.trim()))
      .filter((n) => Number.isInteger(n) && n >= 0 && n <= 23)
    const r = await fetch('/api/admin/studio-promo', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pornit, ore, plafonUsdZi: Number(plafonTxt) || 0, idee }),
    })
      .then((x) => (x.ok ? (x.json() as Promise<SetariPromoUi>) : null))
      .catch(() => null)
    if (r) {
      setStare(r)
      setOreTxt(r.ore.join(','))
      setPlafonTxt(String(r.plafonUsdZi))
      setIdee(r.idee)
    }
    setBusy(false)
  }
  if (!stare) return <span className="or-wallet-sub">🗓 Promovarea programată: stare necitită</span>
  return (
    <span className="or-wallet-sub" style={{ display: 'block' }}>
      🗓 Promovarea programată (Studioul de Clipuri):{' '}
      {stare.pornit ? `PORNITĂ — orele ${stare.ore.join(', ') || '—'}, plafon $${stare.plafonUsdZi}/zi` : 'OPRITĂ'}
      <details style={{ marginTop: 4 }}>
        <summary>setări (ore, plafon, ideea clipului)</summary>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
          <label>
            Orele (0-23, cu virgulă):{' '}
            <input value={oreTxt} onChange={(e) => setOreTxt(e.target.value)} placeholder="ex. 9,18" />
          </label>
          <label>
            Plafon $/zi:{' '}
            <input value={plafonTxt} onChange={(e) => setPlafonTxt(e.target.value)} style={{ width: 70 }} />
          </label>
          <label>
            Ideea clipului:{' '}
            <input value={idee} onChange={(e) => setIdee(e.target.value)} placeholder="ex. Kelion, asistentul tău AI, pe kelionai.app" style={{ width: '100%' }} />
          </label>
          <span>
            <button type="button" className="ghost" disabled={busy} onClick={() => void salveaza(true)}>
              Salvează și PORNEȘTE
            </button>{' '}
            <button type="button" className="ghost" disabled={busy} onClick={() => void salveaza(false)}>
              Salvează OPRIT
            </button>
          </span>
        </div>
      </details>
    </span>
  )
}

// veche → nouă, plus DOVADA backupului (cel mai nou fișier de pe disc, măsurat
// de server — dată + mărime; lipsa lui se spune, nu se maschează).
interface RandAudit { la: string; actor: string; actiune: string; tabel: string; cheie: string; vechi: string; nou: string }

// ── AUTOVERIFICAREA INTELIGENTĂ (owner, 19 aug): forma raportului măsurat pe care
// îl întoarce POST /api/admin/autoverificare (Kelion se testează singur pe TOATE
// funcțiile + spune DE CE nu merge). Aceleași câmpuri ca RaportAutoverificare din backend.
type VerdictFunctie = 'merge' | 'stricat' | 'nu_pot_verifica'
interface VerificareFunctie {
  functie: string; categorie: string; face: string; tip: 'citire' | 'efect'
  verdict: VerdictFunctie; deCe: string; recomandare: string; dovada: string
}
interface RaportAutoverificare {
  total: number; merg: number; stricate: number; nepotverifica: number; functii: VerificareFunctie[]
}
// Ordinea în listă: întâi ce nu merge (stricate), apoi nesigurele, apoi ce merge.
function rangVerdict(v: VerdictFunctie): number {
  return v === 'stricat' ? 0 : v === 'nu_pot_verifica' ? 1 : 2
}

function RegistruAudit() {
  const [date, setDate] = useState<{ randuri: RandAudit[]; backup: { fisier: string; la: string; octeti: number } | null } | null | 'eroare'>(null)
  useEffect(() => {
    let viu = true
    void fetch('/api/admin/registru-audit', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j) => { if (viu) setDate(j) })
      .catch(() => { if (viu) setDate('eroare') })
    return () => { viu = false }
  }, [])
  if (date === null) return <div className="chat-hint">registrul se încarcă…</div>
  if (date === 'eroare') return <div className="chat-hint">⚠ Registrul de audit nu s-a putut citi.</div>
  return (
    <div className="fin-breakdown">
      <div className="fin-breakdown-head">Registrul modificărilor (audit — cine, când, ce)</div>
      <div className="chat-hint">
        {date.backup
          ? `Ultimul backup: ${date.backup.fisier} · ${new Date(date.backup.la).toLocaleString('ro-RO')} · ${(date.backup.octeti / 1024 / 1024).toFixed(1)} MB`
          : 'Backup: nemăsurabil de aici (directorul de backup nu e pe mașina asta sau e gol) — de verificat pe VPS.'}
      </div>
      {date.randuri.length === 0 && <div className="chat-hint">— încă nicio modificare înregistrată (registrul pornește de la publicarea asta)</div>}
      {date.randuri.slice(0, 60).map((r, i) => (
        <div className="vis-meta" key={i} style={{ padding: '3px 0' }}>
          <span className="vis-time">{new Date(r.la).toLocaleString('ro-RO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
          <span><strong>{r.actor || '—'}</strong></span>
          <span>{r.actiune}</span>
          <span className="muted">{r.tabel}{r.cheie ? ` · ${r.cheie}` : ''}</span>
          {(r.vechi || r.nou) && <span>{r.vechi ? `${r.vechi} → ` : ''}{r.nou}</span>}
        </div>
      ))}
    </div>
  )
}

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

// PASTILELE AI, MUTATE ÎN ADMIN (10 aug). Din 15 aug soldul Gemini vine DERIVAT
// automat din exportul BigQuery (câmpul `sold` din brain-credit) — declararea
// manuală a murit la ordinul ownerului („valoarea reală… citit automat").
// ── BECURILE DE CREDIT AI (owner, 13 aug: „un bec roșu/verde care indică credit
// sau lipsă de credit, click = reîncărcare; 402 înseamnă că nu are credit") ───
// Verde = are credit; roșu = fără (402/sold 0 — click ca să adaugi bani); gri =
// nu pot verifica (necunoscutul NU se maschează în verde — regula #1). Click pe
// rând = pagina de reîncărcare REALĂ a furnizorului. Starea „roșu pâlpâind"
// (clasa .bec-rosu.palpaie) e pregătită în CSS pentru auto-alimentarea de pe
// card (card gol) — vine cu acea piesă, nu de aici.
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
  if (err) return <div className="becuri-credit becuri-stare">{A.becuriEroare}</div>
  if (!rows) return <div className="becuri-credit becuri-stare">{A.becuriLoad}</div>
  return (
    <div className="becuri-credit">
      <div className="becuri-titlu">{A.becuriTitlu}</div>
      <div className="becuri-lista">
        {rows.map((f) => {
          // ROȘUL SPUNE CAUZA MĂSURATĂ, NU PRESUPUNEREA (owner, 14 aug: becul
          // Fable era roșu pe CHEIE INVALIDĂ, dar eticheta zicea „fără credit —
          // adaugă bani" — în contul Anthropic erau 35 USD; banii nu lipseau,
          // cheia era refuzată). Când proba «servește» are motivul, ăla se
          // arată; genericul „fără credit" rămâne DOAR când chiar nu știm de ce.
          const motivRosu =
            f.serveste?.masurat && f.serveste.valoare && !f.serveste.valoare.da && f.serveste.valoare.detaliu
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
          const titlu = f.bec === 'rosu' ? (motivRosu ?? A.becuriReincarca) : A.becuriDeschideFactura
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
            <div key={f.furnizor} className={`bec-rand bec-rand-${f.bec}`} title={titlu}>
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
  const g = brainCredit.gemini
  const s = brainCredit.serper
  const serperK = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))
  // SOLDUL DERIVAT DIN EXPORT (15 aug: „valoarea reală… citit automat").
  // Cifra apare DOAR când serverul a derivat-o din exportul BigQuery
  // (full_amount − aplicat); altfel ✓/⚠ pe becul viu, cu motivul în tooltip —
  // niciodată un număr inventat. Butonul „✎ credit Gemini" a MURIT: nu mai
  // există nimic de declarat de mână.
  // Verde ✓ DOAR pe probă vie 200; sold real când e derivat din export; altfel NEUTRU
  // „·" (nu pot verifica) — Google nu expune soldul prepay, deci pastila nu mai pretinde
  // NICIODATĂ „epuizat"/„fără credit" (owner: „scoate alerta falsă"; regula #1). Alerta
  // REALĂ de credit + linkul de reîncărcare vin din chatul viu, pe eșec măsurat.
  const geminiEticheta =
    g?.sold != null
      ? `${g.sold.toFixed(2)} ${g.soldMoneda ?? ''}`.trim()
      : g?.serving
        ? '✓'
        : '·'
  const geminiTitlu = [
    g?.sold != null
      ? `sold REAL derivat din exportul BigQuery: ${g.sold.toFixed(2)} ${g.soldMoneda ?? ''}`
      : `soldul nu e încă derivabil: ${g?.soldMotiv ?? 'motiv necunoscut'}`,
    g?.monthUsd != null ? `cheltuit luna asta: $${g.monthUsd.toFixed(2)}` : 'cheltuiala lunii necitibilă',
  ].join(' · ')
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, padding: '10px 14px', margin: '10px 0', background: 'color-mix(in srgb, var(--text) 4%, transparent)', border: '1px solid var(--border)', borderRadius: 10 }}>
      <strong style={{ fontSize: 13, opacity: 0.8 }}>Credite AI</strong>
      <span title={s?.live && typeof s.balance === 'number' ? `${s.balance.toLocaleString()} căutări rămase (Serper)` : 'citirea Serper a eșuat'}>
        {/* `?? 0` scos (owner, 19 aug): un `live:true` FĂRĂ sold arăta „Serper 0" =
            fals „fără credit", exact ce interzice tipul lui (Stage.tsx: „NICIODATĂ
            Serper 0"). Fără sold real → ⚠ „nu pot citi", nu 0. */}
        Serper {s?.live && typeof s.balance === 'number' ? serperK(s.balance) : '⚠'}
      </span>
      <span title={geminiTitlu}>
        Gemini {geminiEticheta}
      </span>
      {/* (Constructorul e Devin (extern), iar creierul live e Gemini prin app —
          pastila de sus. Fable a fost scos total, 16 aug: nu mai are rând.) */}
      <a href="https://aistudio.google.com/billing" target="_blank" rel="noreferrer" style={{ fontSize: 12, opacity: 0.75 }}>alimentează Gemini</a>
    </div>
  )
}

export default function AdminPanel({
  onClose,
  initialTab,
  brainCredit,
}: {
  readonly onClose: () => void
  readonly initialTab?: 'finance' | 'users' | 'share' | 'stores' | 'inbox' | 'voiceprints' | 'gesturi' | 'tokenuri' | 'constructor' | 'recuperare' | 'sistem' | 'erori' | 'notificari' | 'creier'
  readonly brainCredit?: BrainCredit | null
}) {
  const [tab, setTab] = useState<
    'finance' | 'users' | 'share' | 'stores' | 'inbox' | 'voiceprints' | 'gesturi' | 'tokenuri' | 'constructor' | 'recuperare' | 'sistem' | 'erori' | 'notificari' | 'creier'
  >(initialTab ?? 'finance')
  // Notificările pe telefon (Web Push): starea vine MĂSURATĂ din browser
  // (starePush), nu ținută minte — „activ" înseamnă chiar o abonare vie.
  const [push, setPush] = useState<StarePush>('inactiv')
  const [pushBusy, setPushBusy] = useState(false)
  // ── AUTOVERIFICAREA INTELIGENTĂ (owner, 19 aug): raportul e MĂSURAT la cerere,
  // nu ținut minte între sesiuni — „merge" apare doar cu dovadă (regula #1).
  const [avBusy, setAvBusy] = useState(false)
  const [avRaport, setAvRaport] = useState<RaportAutoverificare | null>(null)
  const [avEroare, setAvEroare] = useState('')
  useEffect(() => {
    void starePush().then(setPush)
  }, [])
  const comutaPush = async (): Promise<void> => {
    setPushBusy(true)
    try {
      setPush(push === 'activ' ? await dezactiveazaPush() : await activeazaPush())
    } finally {
      setPushBusy(false)
    }
  }
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
  // Plafonul zilnic de ardere al constructorului (B8/K15): contor + cifră + comutator.
  const [plafon, setPlafonState] = useState<PlafonConstructor | null>(null)
  // Comutator de creier (23 aug 2026): provider activ + scalare pe dificultate.
  const [creier, setCreierState] = useState<CreierAdmin | null | 'necitit'>('necitit')
  const [creierBusy, setCreierBusy] = useState(false)
  const [creierMsg, setCreierMsg] = useState('')
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
  // AI pool — how much you add/remove (typed value) + the buttons' state.
  const [activity, setActivity] = useState<UserActivity | null | 'necitit'>('necitit')
  const [stores, setStores] = useState<StoresData | null | 'necitit'>('necitit')
  const [voiceprints, setVoiceprints] = useState<VoiceprintRow[] | null>([])
  const [voiceprintsLoading, setVoiceprintsLoading] = useState(false)
  // Mesajele acțiunilor pe amprente (ștergere/ascultare picate — nu mai tac).
  const [vpMsg, setVpMsg] = useState('')
  // Captura facială a unui om, după email (owner, 14 aug: „userii nu au poze") —
  // din aceeași listă ca tabul Amprente; gol/nelistat = nu există captură.
  const pozaUser = (email: string): string =>
    (Array.isArray(voiceprints) ? voiceprints : []).find((v) => v.email === email && v.hasFace)?.facePhoto ?? ''
  // THE BUILDER (Adrian, Jul 27: „Kelion must be able to create any software the
  // admin asks him to”): new orders + the queue with their state (the worker on
  // the VPS executes them and opens PRs; the merge is Adrian's).
  interface BuildJobRow {
    id: number
    status: 'queued' | 'running' | 'done' | 'failed'
    orderText: string
    /** P8: fapta ordinului, extrasă de server din „CE A CERUT" — pentru afișaj. */
    nume?: string
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
    // DEVIN dovedit PE ORDIN (owner, 22 aug: „am cerut devin peste tot in
    // constructor"): id-ul sesiunii Devin, pus de dispecer la pornire — rândul
    // arată MĂSURAT că Devin duce sarcina, nu se presupune.
    devinSessionId?: string | null
  }
  // null = coada nu s-a putut citi (auditul admin, 3 aug) — nu „Niciun ordin".
  const [buildJobs, setBuildJobs] = useState<BuildJobRow[] | null | 'necitit'>('necitit')
  // Pauza de autonomie, VIZIBILĂ și aici (auditul admin, 3 aug): cu pauza
  // pornită lucrătorul nu ia nimic — ordinul stătea „în coadă · 0%" la
  // nesfârșit după promisiunea „max. 2 minute", fără nicio explicație.
  const [buildPaused, setBuildPaused] = useState(false)
  // CINE E CONSTRUCTORUL — MĂSURAT de server din config (owner, 22 aug: „am
  // cerut devin peste tot in constructor… sa-i stergi de tot pe ce e local").
  // Luminile vechi (proba locală, puls lucrător) au fost ȘTERSE cu toată
  // mașinăria locală: constructorul e DEVIN, iar panoul arată starea LUI.
  const [constructorId, setConstructorId] = useState<{ cine: 'devin' | 'local'; motiv: string } | null>(null)
  // DIAGNOSTICUL AUTONOM (owner, 19 aug): „de ce (nu) repară", măsurat pe server.
  const [diagnostic, setDiagnostic] = useState<{ sanatos: boolean; verdict: string; probleme: { cod: string; severitate: 'critic' | 'atentie'; ce: string; recomandare: string }[] } | null>(null)
  const [buildOrder, setBuildOrder] = useState('')
  const [buildMsg, setBuildMsg] = useState('')
  // EVALUAREA CERINȚEI (owner, 13 aug): pe măsură ce scrii ordinul, evaluăm
  // cerința (poarta de calitate + AI-urile potrivite pe capacitate, credit live).
  const [evalOrdin, setEvalOrdin] = useState<EvalConstructor | null>(null)
  useEffect(() => {
    if (tab !== 'constructor') return
    const text = buildOrder.trim()
    if (text.length < 3) {
      setEvalOrdin(null)
      return
    }
    // Debounce: nu lovim serverul la fiecare tastă.
    const id = window.setTimeout(() => {
      void evalueazaOrdinConstructor(text).then((e) => setEvalOrdin(e))
    }, 400)
    return () => window.clearTimeout(id)
  }, [buildOrder, tab])
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

  // LEGEA din 16 aug: pârghia de pauză a autonomiei NU MAI EXISTĂ (ordinul
  // verbatim: „scoti posibilitatea sa mai treaca pe off" + „GATA") — rândul
  // din panou e o DECLARAȚIE, nu un comutator; onPauzaAutonomie/pauzaBusy au
  // murit odată cu butonul.
  // THE EIGHT PROOFS (Adrian, Jul 31: „there must be 8 out of 8 proofs”).
  const [dovezi, setDovezi] = useState<{ dovedite: number; din: number; dovezi: DovadaAutonomie[] } | null>(null)
  // THE PAYMENTS PANEL (M3, Aug 2): 'necitit' until the read lands; null = the
  // read FAILED (shown as failure, never as an empty ledger — rule no. 1).
  const [plati, setPlati] = useState<PlatiAdmin | null | 'necitit'>('necitit')

  // P29 — butonul „Video plătit" (owner, 15 aug: „eu vreau sa platesc, sau
  // clientul, de ce nu ma duce spre plata"): pornește/oprește Veo din panou,
  // nu din env-ul VPS-ului; după apăsare starea se RECITEȘTE, nu se presupune.
  const [videoBusy, setVideoBusy] = useState(false)
  async function onVideoPlatit(pornit: boolean): Promise<void> {
    setVideoBusy(true)
    await setVideoPlatit(pornit)
    const c = await fetchMoneyCircuit()
    if (c) setCircuit(c)
    setCircuitFailed(!c)
    setVideoBusy(false)
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
    } else if (tab === 'creier') {
      setCreierState('necitit')
      void fetchCreier().then(setCreierState)
    } else if (tab === 'users') {
      // REÎNCĂRCARE LA DESCHIDEREA TABULUI (auditul admin, 3 aug): activitatea
      // se citea O SINGURĂ dată, la montare — un eșec lăsa „Se încarcă…" pe
      // veci, fără nicio a doua șansă.
      void fetchActivity().then(setActivity)
      // POZELE oamenilor (owner, 14 aug: „userii nu au poze") — capturile
      // faciale vin din aceeași listă ca tabul Amprente; o citire picată lasă
      // pur și simplu „?"-ul cinstit pe rând, nu strică tabul.
      void fetchVoiceprints().then(setVoiceprints)
    }
  }, [tab])

  // Tab „Vizitatori" deschis → reîncarcă și REÎMPROSPĂTEAZĂ cât stă deschis
  // (auditul admin, 3 aug: datele veneau doar la montare — „Vizite azi"
  // îngheța la valoarea de la deschidere, iar un eșec inițial lăsa
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
      .then((j: { jobs?: BuildJobRow[]; paused?: boolean; constructor?: { cine: 'devin' | 'local'; motiv: string } } | null) => {
        // null/eșec = coada NU s-a citit (auditul admin, 3 aug) — se spune,
        // nu se lasă „Niciun ordin încă" peste o citire picată.
        if (j?.jobs) {
          setBuildJobs(j.jobs)
          setBuildPaused(!!j.paused)
          setConstructorId(j.constructor ?? null)
        } else setBuildJobs(null)
      })
      .catch(() => setBuildJobs(null))
    // DIAGNOSTICUL AUTONOM: de ce (nu) repară, măsurat pe server (regula #1 — pe
    // eșec îl ascundem, nu inventăm „sănătos").
    fetch('/api/admin/constructor/diagnostic', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { sanatos: boolean; verdict: string; probleme: { cod: string; severitate: 'critic' | 'atentie'; ce: string; recomandare: string }[] } | null) => setDiagnostic(d && typeof d.verdict === 'string' ? d : null))
      .catch(() => setDiagnostic(null))
  }
  // Tab „Constructor” open → the orders queue, refreshed every 10s.
  useEffect(() => {
    if (tab !== 'constructor') return
    refreshBuildJobs()
    void fetchPlafon().then(setPlafonState)
    const id = window.setInterval(() => {
      refreshBuildJobs()
      void fetchPlafon().then(setPlafonState)
    }, 10_000)
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
      .then(async (r) => ({
        ok: r.ok,
        j: (await r.json().catch(() => null)) as { id?: number; error?: string; motiv?: string } | null,
      }))
      .then(({ ok, j }) => {
        if (ok && j?.id) {
          setBuildOrder('')
          setEvalOrdin(null)
          // PROMISIUNEA ONESTĂ (auditul admin, 3 aug): cu autonomia pe pauză
          // lucrătorul NU ia nimic — „max. 2 minute" ar fi fost o minciună.
          setBuildMsg(buildPaused ? A.orderEnqueuedPaused(j.id) : A.orderEnqueuedActive(j.id))
        } else if (j?.error === 'ordin_respins') {
          // Poarta de calitate a respins ordinul — arătăm MOTIVUL, nu un „eșec" mut.
          setBuildMsg(`Ordin respins: ${j.motiv ?? 'cerință neclară'}`)
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
            {/* ── VITRINA SIMPLIFICATĂ (Adrian, 14 aug: „avem Aplicații, deci în
                admin nu mai apar: Tranzacționare, Adaptare CV, Magazine, Inbox,
                Erori, Notificări — nu le ștergi, le folosește Kelion; doar nu
                mai sunt vizibile"). Butoanele au fost SCOASE din bară, dar TOT
                restul trăiește: Tranzacționare + Adaptare CV stau în meniul
                „Aplicații" din bara de sus; panourile Inbox/Magazine/Erori și
                rutele lor rămân în cod (Kelion le folosește prin unelte).
                EXCEPȚIA, spusă ownerului: Notificări NU dispare de tot —
                alarmele construite azi (creier căzut în lanț, ordin mort) scriu
                DOAR aici (adminNotification = DB + copia pe telefon prin Web
                Push, dacă ownerul a pornit-o din „🔔 Pe telefon"), deci
                tabul reapare SINGUR doar când există ceva NECITIT, ca alarma să
                nu redevină mută. La zero necitite, vitrina rămâne curată. */}
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
            {/* „Distribuie" ASCUNS din bară (ordinul ownerului, 14 aug, seara:
                „distribuie ascunde") — panoul + linkurile de share rămân în
                cod; se mai deschide doar prin voce (initialTab). */}
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
            {/* „Tokenuri" ASCUNS din bară (ordinul ownerului, 14 aug, seara:
                „tokenuri ascunde") — panoul + rutele rămân în cod; creierul
                vede cheile prin admin_vezi «env-check» + tokenChecks; tabul se
                mai poate deschide doar prin voce (initialTab), nu din vitrină. */}
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
              className={`admin-tab ${tab === 'creier' ? 'sel' : ''}`}
              onClick={() => setTab('creier')}
            >
              Creier
            </button>
            {/* Notificări: ASCUNS COMPLET (ordinul ownerului, 14 aug, seara:
                „ascunde notificările; tot ce ai ascuns creierul trebuie să le
                vadă"). Excepția veche „reapare la necitite" a fost scoasă la
                cererea lui. Creierul le vede în continuare prin admin_vezi
                («notificari»), iar alarmele (creier căzut, ordin mort, PR gata)
                se scriu tot acolo — panoul se mai deschide doar prin voce. */}
          </div>
          {/* Notificările pe telefon: anunțurile santinelei („PR gata") și
              alarmele ajung la owner și când NU e pe site — Web Push, pornit
              conștient de aici (browserul oricum cere permisiunea lui). */}
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
        {/* CREDITELE AI, SUS ÎN ADMIN (Adrian, 10 aug: „mută pastilele AI sub
            admin"): Serper + Gemini + editarea creditului Gemini declarat — mutate
            din bara de sus. Bara ține doar VPS-ul. */}
        <CreditAICard brainCredit={brainCredit} />
        {tab === 'finance' && (
          <section className="admin-finance">
            {/* BECURILE DE CREDIT AI, SUS (owner, 13 aug): unde are nevoie de
                credit se vede din prima — roșu = fără, click = reîncărcare. */}
            <BecuriCredit />
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
                    {/* LEGEA din 16 aug (ownerul, verbatim: „autonomia pe on si
                    scoti posibilitatea sa mai treaca pe off" + „GATA"): nu mai
                    există buton, nu mai există stare care se răstoarnă nevăzut.
                    DOVADA stă pe ecran, pe față — cum a arătat el. */}
                    <span className="or-wallet-sub">
                      ▶ Autonomia: PORNITĂ PERMANENT (LEGE, 16 aug) — fără buton de oprire.
                      Frânele tale reale: plafonul zilnic de bani, oprirea pe erori permanente (P27), cheile timerului de promovare.
                    </span>
                    {/* P29: comutatorul VIDEO. Ownerul, 20:58 („tu ai zis sa
                    opresc in admin ca sa genereze video gratis, iti bati joc
                    de mine?"): numele vechi «Video plătit» l-a împins să-l
                    OPREASCĂ atunci când voia video — capcana era eticheta.
                    Adevărul, pe față: la Veo NU EXISTĂ gratis (Google
                    facturează pe secundă); PORNIT = clipurile tale de admin
                    se generează (pe banii tăi la Google); clienții cu tarif
                    plătit merg ORICUM; gratis = doar Google Flow. */}
                    {/* 21:29 („nu mai bine il faci sa genereze? nu ma mai umple
                    de butoane"): cererea EXPLICITĂ — a ta sau a unui client
                    plătit — generează DIRECT, fără niciun buton. Comutatorul
                    de aici a rămas doar peste TIMERUL de promovare (singurul
                    care cheltuie nesupravegheat). Google facturează
                    ~0,10 $/secundă pe cheia ta; gratis la Veo nu există —
                    gratis e doar prin Google Flow (Studioul). */}
                    <span className="or-wallet-sub">
                      🎬 Clipurile CERUTE (de tine sau de clienți plătiți) se generează DIRECT — fără butoane.{' '}
                      {circuit?.videoPlatit == null
                        ? 'Timerul de promovare: stare necitită.'
                        : circuit.videoPlatit.pornit
                          ? `Timerul de promovare POATE genera singur${circuit.videoPlatit.sursa === 'env' ? ' (din env)' : ''} (pe banii tăi, sub plafonul de mai jos).`
                          : 'Timerul de promovare NU generează singur (oprit).'}{' '}
                      <button
                        type="button"
                        className="ghost"
                        disabled={videoBusy}
                        onClick={() => void onVideoPlatit(!(circuit?.videoPlatit?.pornit ?? false))}
                      >
                        {circuit?.videoPlatit?.pornit ? 'Oprește timerul' : 'Permite timerului să genereze'}
                      </button>
                    </span>
                    {/* Diagnoza pe față (21:26, „nu vrea sa genereze"): ultima
                    încercare REALĂ, cu verdictul ei — nu se mai ghicește. */}
                    {circuit?.videoUltimaIncercare && (
                      <span className="or-wallet-sub" style={{ color: circuit.videoUltimaIncercare.ok ? undefined : '#e6a23c' }}>
                        {circuit.videoUltimaIncercare.ok ? '✅' : '⚠'} Ultima încercare de clip ({new Date(circuit.videoUltimaIncercare.la).toLocaleTimeString()}):{' '}
                        {circuit.videoUltimaIncercare.verdict}
                      </span>
                    )}
                    <PromoStudio />
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
                                {c.expirata ? '🟠 [În așteptare >2h]' : '⏳ [În așteptare]'} <b>{c.code}</b> · User: {c.email} · Sumă: {c.amount} {c.currency} · De când: {new Date(c.createdAt).toLocaleString()}
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
                                {p.amount} {p.currency || '£'} · „{p.referinta || p.bankRef || '—'}” · Văzut la: {new Date(p.seenAt).toLocaleString()}{' '}
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
                    {/* BUTONUL „șterge" A FOST SCOS (ordinul ownerului, 14 aug:
                        „amprentele vocale trebuie să se păstreze"). Serverul
                        oricum refuză (ruta 403 + triggerul din Postgres) — un
                        buton care promite o ștergere imposibilă ar fi afișaj
                        fals. În loc, starea pe față: */}
                    <span className="muted" title={A.voiceprintKeptTitle}>
                      {A.voiceprintKept}
                    </span>
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
              {/* CIFRELE VPS, MUTATE DIN BARA DE SUS SUB ADMIN (owner, 13 aug:
                  „VPS îl pui sub admin, vizibil"). Aceleași măsurători ca pastila
                  veche: RAM liber + încărcarea (raport la nuclee), roșu la același
                  prag ca alarma sentinelei. Necitibil = se spune, nu se pun zerouri. */}
              {brainCredit?.vps ? (
                (() => {
                  const v = brainCredit.vps
                  const critic =
                    v.liberPct <= (v.pragMemoriePct ?? 10) || v.incarcarePct >= (v.pragIncarcarePct ?? 200)
                  return (
                    <div className={`vps-resurse${critic ? ' vps-critic' : ''}`}>
                      <span className="vps-cifra">
                        RAM liber: <b>{v.liberGb.toFixed(1)}GB</b> / {v.totalGb.toFixed(1)}GB
                      </span>
                      <span className="vps-cifra">
                        Încărcare: <b>{(v.incarcarePct / 100).toFixed(1)}×</b> pe {v.procesoare} nuclee
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
                  <span className="vps-cifra">⚠ VPS necitibil (nu s-au putut măsura RAM/încărcarea acum)</span>
                </div>
              )}
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

            {/* ── AUTOVERIFICAREA INTELIGENTĂ (owner, 19 aug: „ceva inteligent bazat
                pe AI" + „verifică și DE CE nu merge"). Kelion se testează SINGUR pe
                TOATE funcțiile din registrul unic: citirile probate REAL, funcțiile
                cu efect verificate fără să le execute (dry-run), iar pe cele picate
                creierul dă cauza + recomandarea fermă. Verdictul e MĂSURAT (regula
                #1): „nu pot verifica" cinstit, niciodată „merge" fabricat. */}
            <div className="fin-breakdown" style={{ marginTop: 16 }}>
              <div className="fin-breakdown-head">Autoverificare inteligentă</div>
              <p className="chat-hint" style={{ marginTop: 8 }}>
                Kelion se testează pe el însuși pe toate funcțiile și spune, pentru fiecare care nu
                merge, <b>de ce</b> și ce e de făcut. Durează câteva secunde (probează real citirile).
              </p>
              <button
                className="ghost"
                style={{ marginTop: 12 }}
                disabled={avBusy}
                onClick={async () => {
                  setAvBusy(true)
                  setAvEroare('')
                  try {
                    const res = await fetch('/api/admin/autoverificare', {
                      method: 'POST',
                      credentials: 'include',
                    })
                    if (!res.ok) {
                      setAvEroare(`Autoverificarea NU a pornit: HTTP ${res.status}`)
                      setAvRaport(null)
                      return
                    }
                    const j = (await res.json().catch(() => null)) as RaportAutoverificare | null
                    if (!j || typeof j.total !== 'number') {
                      setAvEroare('Răspuns necitibil de la server (nu pot afișa un raport pe care nu l-am măsurat).')
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
                {avBusy ? 'Verific toate funcțiile…' : '🧪 Verifică toate funcțiile'}
              </button>

              {avEroare && (
                <p className="chat-hint" style={{ marginTop: 10, color: '#e0603a' }}>
                  ⚠ {avEroare}
                </p>
              )}

              {avRaport && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontVariantNumeric: 'tabular-nums' }}>
                    <span>Total: <b>{avRaport.total}</b></span>
                    <span style={{ color: '#2e9e5b' }}>Merg: <b>{avRaport.merg}</b></span>
                    <span style={{ color: '#e0603a' }}>Stricate: <b>{avRaport.stricate}</b></span>
                    <span style={{ color: '#c79218' }}>Nu pot verifica: <b>{avRaport.nepotverifica}</b></span>
                  </div>
                  <ul style={{ listStyle: 'none', padding: 0, marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {avRaport.functii
                      // Întâi ce nu merge (stricate, apoi nu-pot-verifica), apoi ce merge.
                      .slice()
                      .sort((a, b) => rangVerdict(a.verdict) - rangVerdict(b.verdict))
                      .map((f) => {
                        const c =
                          f.verdict === 'merge' ? '#2e9e5b' : f.verdict === 'stricat' ? '#e0603a' : '#c79218'
                        const et =
                          f.verdict === 'merge' ? '✓ merge' : f.verdict === 'stricat' ? '✗ stricat' : '… nu pot verifica'
                        return (
                          <li
                            key={f.functie}
                            style={{ borderLeft: `3px solid ${c}`, paddingLeft: 10 }}
                          >
                            <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                              <b>{f.functie}</b>
                              <span style={{ color: c, fontSize: '0.85em' }}>{et}</span>
                              <span className="chat-hint" style={{ fontSize: '0.8em' }}>
                                {f.tip === 'efect' ? '(cu efect — dry-run)' : '(citire — probat real)'}
                              </span>
                            </div>
                            <div className="chat-hint" style={{ fontSize: '0.85em' }}>{f.face}</div>
                            {f.verdict !== 'merge' && (
                              <div style={{ fontSize: '0.85em', marginTop: 2 }}>
                                <span style={{ color: c }}>De ce:</span> {f.deCe}
                                {f.recomandare && (
                                  <>
                                    {' '}
                                    <span style={{ color: c }}>→</span> <b>{f.recomandare}</b>
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
        {tab === 'creier' && (
          <section className="admin-finance">
            <div className="fin-breakdown">
              <div className="fin-breakdown-head">Creier — comutator provider</div>
              {creier === 'necitit' && <p className="chat-hint">Se încarcă…</p>}
              {creier === null && <p className="chat-hint">Nu s-a putut citi starea comutatorului.</p>}
              {typeof creier === 'object' && creier !== null && (
                (() => {
                  const isOpenAI = creier.activ === 'openai'
                  const ids = creier.modele.map((m) => m.id)
                  const modelSelect =
                    creier.modelCustom === '' ? 'auto' :
                    ids.includes(creier.modelCustom) ? creier.modelCustom :
                    'custom'
                  return (
                    <>
                      <p className="chat-hint">Activ: <b>{creier.activ}</b>{creier.modelCustom ? ` / ${creier.modelCustom}` : ''}</p>
                      <div style={{ marginTop: 12 }}>
                        <select
                          value={creier.activ}
                          disabled={creierBusy}
                          onChange={(e) => {
                            const activ = e.target.value
                            setCreierState({ ...creier, activ })
                          }}
                        >
                          {creier.provideri.map((p) => (
                            <option key={p.prefix} value={p.prefix} disabled={!p.disponibil}>
                              {p.nume} {!p.disponibil ? '(neconfigurat)' : ''}
                            </option>
                          ))}
                        </select>
                      </div>
                      {isOpenAI && (
                        <div style={{ marginTop: 12 }}>
                          <select
                            value={modelSelect}
                            disabled={creierBusy}
                            onChange={(e) => {
                              const id = e.target.value
                              const modelCustom = id === 'auto' ? '' : id === 'custom' ? (creier.modelCustom || '') : id
                              setCreierState({ ...creier, modelCustom })
                            }}
                          >
                            {creier.modele.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.isAuto ? '▶ ' : ''}{m.nume}{m.tag ? ` — ${m.tag}` : ''}
                              </option>
                            ))}
                          </select>
                          {modelSelect === 'custom' && (
                            <input
                              type="text"
                              placeholder="ex. gpt-5.6-luna"
                              value={creier.modelCustom}
                              disabled={creierBusy}
                              onChange={(e) => setCreierState({ ...creier, modelCustom: e.target.value })}
                              style={{ width: '100%', marginTop: 8 }}
                            />
                          )}
                        </div>
                      )}
                      <button
                        type="button"
                        className="ghost"
                        style={{ marginTop: 12 }}
                        disabled={creierBusy}
                        onClick={async () => {
                          setCreierBusy(true)
                          setCreierMsg('')
                          const r = await setCreier(creier.activ, creier.modelCustom)
                          setCreierBusy(false)
                          if (r) {
                            setCreierState(r)
                            setCreierMsg('Salvat.')
                          } else {
                            setCreierMsg('Eroare la salvare.')
                          }
                          window.setTimeout(() => setCreierMsg(''), 3000)
                        }}
                      >
                        {creierBusy ? 'Se salvează…' : 'Salvează comutatorul'}
                      </button>
                      {creierMsg && <p className="chat-hint" style={{ marginTop: 8 }}>{creierMsg}</p>}
                      <div className="chat-hint" style={{ marginTop: 12 }}>
                        OpenAI: {creier.modele.filter((m) => !m.isAuto && !m.isCustom).map((m) => m.nume).join(' → ')}.
                      </div>
                    </>
                  )
                })()
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
                {/* TEXT ADUS LA REALITATE (auditul buton-cu-buton, 14 aug): „iar
                    merge-ul îl dai tu" nu mai era adevărat — poarta de pe VPS
                    îmbină SINGURĂ PR-urile de constructor verzi, iar santinela
                    îmbină și restul când nu ești logat. */}
                Constructorul — dai ordinul, Kelion construiește pe server (build + teste), deschide
                PR-ul; pe verde se îmbină singur (sau îl dai tu, dacă ești logat). Poți ordona și prin
                voce/chat: „Kelion, construiește…".
              </div>
              {plafon && (
                <div
                  style={{
                    marginTop: 10,
                    padding: '8px 10px',
                    borderRadius: 8,
                    border: '1px solid var(--border)',
                    background: 'color-mix(in srgb, var(--text) 3%, transparent)',
                  }}
                >
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 600 }}>
                      {/* P10: „$0.00 măsurat" nu mai poate ascunde nici citirea
                          picată, nici joburile fără cost raportat (regula #1). */}
                      {plafon.cheltuitCitit === false
                        ? `Plafon zilnic de ardere: NU POT CITI cheltuiala azi${plafon.cheltuitMotiv ? ` (${plafon.cheltuitMotiv})` : ''} — plafon $${plafon.plafon.toFixed(2)}`
                        : `Plafon zilnic de ardere: construit azi $${plafon.cheltuit.toFixed(2)} din $${plafon.plafon.toFixed(2)}`}
                      {plafon.cheltuitCitit !== false && (plafon.faraCost ?? 0) > 0
                        ? ` · ${plafon.faraCost} joburi fără cost raportat — cifra e minimul măsurat, nu totalul`
                        : ''}
                    </span>
                    <span
                      className="build-faza"
                      style={
                        plafon.activ
                          ? plafon.cheltuit >= plafon.plafon
                            ? { color: '#ff9a9a', borderColor: '#ff7a7a', opacity: 1 }
                            : { color: 'var(--text)', opacity: 1 }
                          : { opacity: 0.6 }
                      }
                    >
                      {plafon.activ
                        ? plafon.cheltuit >= plafon.plafon
                          ? 'ATINS — oprit azi'
                          : 'limită activă'
                        : 'limită oprită'}
                    </span>
                    <button
                      type="button"
                      className="ghost"
                      style={{ marginLeft: 'auto', fontSize: 12, padding: '3px 10px' }}
                      onClick={async () => {
                        const p = await setPlafon({ activ: !plafon.activ })
                        if (p) setPlafonState(p)
                      }}
                    >
                      {plafon.activ ? 'Oprește limita' : 'Pornește limita'}
                    </button>
                    {/* CONSTRUCTORUL = DEVIN, MĂSURAT (owner, 22 aug: „am cerut devin
                        peste tot in constructor" + „sa-i stergi de tot pe ce e local").
                        Becul vine din config-ul REAL al serverului (cheia Devin), nu
                        dintr-un text scris de mână: verde = Devin deține coada (ordinele
                        pleacă în sesiuni Devin → PR pe master); roșu = cheia lipsește pe
                        server și trebuie pusă — se spune exact asta, nu se inventează. */}
                    <span
                      className="chat-hint"
                      style={{ fontSize: 12, fontWeight: 600, color: constructorId == null ? undefined : constructorId.cine === 'devin' ? '#1a7f37' : '#c1121f' }}
                      title={constructorId?.motiv ?? 'identitatea constructorului încă nu s-a citit'}
                    >
                      {constructorId == null
                        ? 'Constructor: se citește…'
                        : constructorId.cine === 'devin'
                          ? '🟢 Constructorul e DEVIN (extern — cheia pusă; ordin → sesiune Devin → PR)'
                          : '🔴 Cheia Devin NU e pusă pe server — pune DEVIN_API_KEY ca Devin să preia coada'}
                    </span>
                  </div>
                  {/* DIAGNOSTICUL AUTONOM (owner, 19 aug: „nu are autonomie… sa faca
                      asta"): Kelion măsoară SINGUR de ce (nu) repară și o arată aici,
                      cu recomandarea fermă — nu mai întrebi „de ce?". */}
                  {diagnostic && (diagnostic.probleme.length > 0 || !diagnostic.sanatos) && (
                    <div style={{ marginTop: 8, padding: 10, borderRadius: 8, border: '1px solid', borderColor: diagnostic.sanatos ? '#d0a92066' : '#c1121f66', background: diagnostic.sanatos ? '#d0a92014' : '#c1121f10' }}>
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: diagnostic.sanatos ? '#8a6d1a' : '#c1121f' }}>
                        {diagnostic.sanatos ? '⚠ ' : '🔴 '}{diagnostic.verdict}
                      </div>
                      {diagnostic.probleme.map((p) => (
                        <div key={p.cod} style={{ fontSize: 12, marginTop: 6 }}>
                          <span style={{ fontWeight: 600 }}>{p.severitate === 'critic' ? '🔴' : '⚠'} {p.ce}</span>
                          <br />
                          <span className="chat-hint" style={{ fontSize: 11.5 }}>→ {p.recomandare}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {/* Explicația vine DIN DATE (constructorId.motiv, măsurat de server),
                      nu dintr-o frază scrisă de mână — fraza veche („Constructor: Ollama
                      local free") a mințit exact când ownerul întreba de Devin. */}
                  <div style={{ marginTop: 10, padding: 10, border: '1px solid #8884', borderRadius: 8, fontSize: 11, opacity: 0.75 }}>
                    Creier: <b>Gemini</b> unic (rapid + greu). Constructor: {constructorId == null ? 'se citește de pe server…' : constructorId.cine === 'devin' ? <><b>DEVIN</b> (extern) — {constructorId.motiv}</> : <>{constructorId.motiv}</>}
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
                    <label className="chat-hint" style={{ fontSize: 12 }}>
                      Cifra ($/zi):
                    </label>
                    <input
                      type="number"
                      min={0.5}
                      step={0.5}
                      defaultValue={plafon.plafon}
                      style={{ width: 90 }}
                      onKeyDown={async (e) => {
                        if (e.key === 'Enter') {
                          const v = Number((e.target as HTMLInputElement).value)
                          if (v > 0) {
                            const p = await setPlafon({ plafon: v })
                            if (p) setPlafonState(p)
                          }
                        }
                      }}
                    />
                    <span className="chat-hint" style={{ fontSize: 12 }}>
                      Enter ca să salvezi. Când se atinge, Kelion nu mai pornește ordine azi (doar cheltuiala MĂSURATĂ se numără).
                    </span>
                  </div>
                </div>
              )}
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
              {/* EVALUAREA CERINȚEI + AI-uri pe capacitate (owner, 13 aug): cerința
              e evaluată, poarta de calitate spune dacă trece, iar AI-urile potrivite
              se așază de sus în jos, cu creditul live. Recomandarea e informativă —
              executorul rămâne constructorul local (Jules se dă din chat). */}
              {evalOrdin && (
                <div className="eval-ordin">
                  <div className={`eval-verdict ${evalOrdin.trece ? 'ok' : 'stop'}`}>
                    {evalOrdin.trece ? '✓ ' : '✕ '}
                    {evalOrdin.motiv}
                  </div>
                  {evalOrdin.capacitatiNecesare.length > 0 && (
                    <div className="eval-caps">
                      Cerință: {evalOrdin.capacitatiNecesare.map((c) => (
                        <span className="eval-cap" key={c}>{c}</span>
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
                          <span className={clasaBec(ai.bec ?? 'gri')} title={ai.bec ? `credit: ${ai.bec}` : 'credit necunoscut'} />
                          <div className="eval-ai-text">
                            <div className="eval-ai-cap">
                              <strong>{ai.nume}</strong>
                              {ai.cheie === evalOrdin.aiRecomandat && <span className="eval-badge">recomandat</span>}
                              <span className="eval-potrivire">{ai.potrivire}</span>
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
                    {/* DEVIN, DOVEDIT PE RÂND (owner, 22 aug: „am cerut devin peste
                        tot in constructor"): badge-ul apare DOAR când dispecerul a
                        pus id-ul sesiunii Devin pe ordin — măsurat, nu presupus. */}
                    {j.devinSessionId ? <span className="vis-badge human" title={`sesiune Devin: ${j.devinSessionId}`}>DEVIN</span> : null}{' '}
                    {/* P8 (owner, 15 aug: „foarte clar ce executa"): FAPTA
                        extrasă de server (nume), nu ambalajul promptului. */}
                    {j.nume || j.orderText.slice(0, 90)}
                    {(j.nume ?? j.orderText).length > 90 ? '…' : ''}
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
            <RegistruAudit />
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
                          {/* POZA OMULUI (owner, 14 aug: „userii nu au poze"):
                              captura facială există în faceprints (împerecheată
                              cu amprenta vocală) — doar tabul Amprente o arăta.
                              Aici vine din aceeași listă (fetchVoiceprints,
                              încărcată la deschiderea tabului); fără captură →
                              „?", cinstit, nu o siluetă care promite. */}
                          {(u.foto || pozaUser(u.email)) ? (
                            <img
                              src={u.foto || pozaUser(u.email)}
                              alt={`Fața lui ${u.email}`}
                              style={{ width: 28, height: 28, borderRadius: 6, objectFit: 'cover', border: '1px solid rgba(255,255,255,0.15)' }}
                            />
                          ) : (
                            <span
                              className="muted"
                              title="Fără captură de față încă — se face singură la prima tură cu camera pornită"
                              style={{ width: 28, height: 28, borderRadius: 6, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: '1px dashed rgba(255,255,255,0.2)', fontSize: 13 }}
                            >
                              ?
                            </span>
                          )}
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
                        <span title={u.scutit ? 'Ownerul e scutit de taxare peste tot — soldul negativ e istoric, dinaintea scutirilor, și nu se mai mișcă. Îl poți aduce la zero din Admin → user → credit (butonul e al tău, mișcă bani).' : undefined}>
                          sold {sym}
                          {u.balance.toFixed(2)}
                          {/* P10: cifra reală rămâne, dar cu adevărul lângă ea. */}
                          {u.scutit ? ' (scutit — sold istoric)' : ''}
                        </span>
                        {/* MONITORIZAREA PE USER (10 aug): cât a COSTAT pe
                            furnizori — roșu când a consumat peste ce are. */}
                        <span style={typeof u.consumedUsd === 'number' && u.consumedUsd > 0 && u.balance <= 0 ? { color: '#e5484d', fontWeight: 600 } : undefined}>
                          {/* `?? 0` scos (owner, 19 aug): un rând fără `consumedUsd` arăta
                              „$0.00" ca fapt măsurat. Fără cifră reală → „—", nu 0. */}
                          consum {typeof u.consumedUsd === 'number' ? `$${u.consumedUsd.toFixed(2)}` : '—'}
                        </span>
                        {u.blocked && <span className="user-badge blocked">BLOCAT</span>}
                        {/* P26: mostra de voce e parte din cardul omului — dacă
                            există, se spune (ascultarea rămâne în Amprente). */}
                        {u.voce && (
                          <span title={u.mostraAudio ? 'Amprentă vocală înscrisă, cu mostră audio ascultabilă în tabul Amprente (▶)' : 'Amprentă vocală înscrisă (fără mostră audio încă)'}>
                            🎤 voce{u.mostraAudio ? ' + mostră' : ''}
                          </span>
                        )}
                      </div>
                      {/* DEVICE-URILE LUI, DEDESUBT (P6; owner, 15 aug: „se
                          pastreaza unica si se adauga doar device cu care intra
                          cu datele aferente") — în locul listei plate de sesiuni
                          care repeta același om de N ori. */}
                      {(u.devices ?? []).map((d, i) => (
                        <div className="vis-meta" key={i} style={{ paddingLeft: 36, opacity: 0.8 }}>
                          <span>{d.device === 'mobile' ? '📱 mobil' : '💻 desktop'}{d.browser ? ` · ${d.browser}` : ''}</span>
                          <span>{d.sessions} sesiuni</span>
                          <span>
                            ultima {new Date(d.last_seen).toLocaleString('ro-RO', {
                              day: 'numeric',
                              month: 'short',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                          <span>{d.ip || '—'}</span>
                          <span>{[d.city, d.country].filter(Boolean).join(', ') || '—'}</span>
                        </div>
                      ))}
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
                            // credea că a creditat.
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
                        {/* BUTONUL „Șterge" A FOST SCOS (ordinul ownerului, 14
                            aug: „baza de utilizatori nu se poate șterge prin
                            nicio comandă"). Serverul refuză (403) și scutul din
                            Postgres refuză și el — un buton care promite o
                            ștergere imposibilă ar fi afișaj fals. Cererile GDPR
                            se rezolvă manual, la decizia ownerului. */}
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
                {/* „Close" era ENGLEZESC hardcodat într-un panou de admin
                    românesc (auditul buton-cu-buton, 14 aug) — limba trebuie
                    să fie una singură pe tot panoul. */}
                <button type="button" className="ghost" onClick={closeUserConvo}>
                  Închide
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
