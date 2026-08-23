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
  fetchCreditAI,
  type CreditAIFurnizor,
  evalueazaOrdinConstructor,
  type EvalConstructor,
  clasaBec,
} from '../lib/admin'

// "cĂ˘t a stat" â€” human-readable duration from seconds: 45s / 7m / 2h 13m.
function fmtDur(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

// Un rĂ˘nd din lista de erori: pastilÄ de gravitate (culoare + categorie, nu doar
// culoare â€” pentru accesibilitate), explicaČ›ia â€žce este", apoi textul brut.
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
          {meta ? ` Â· ${meta}` : ''}
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

// A REAL flag image (Windows doesn't render emoji flags â€” they show as "GB"
// text). flagcdn serves every ISO country; on any failure we fall back to a dot.
// â”€â”€ P26 â€” REGISTRUL DE AUDIT (owner, 15 aug: â€žistoric salvat cu dovezi cine a
// modificat, trasabilitate 24 din 24 de ore" + â€žbaza de date nu se pierde").
// Se Ă®ncarcÄ la deschiderea tabului Utilizatori; aratÄ cine/cĂ˘nd/ce, valoarea
// â”€â”€ P22: TIMERUL DE PROMOVARE (owner: â€žcu functie timer de promovare eventual
// la ore prestabilite") â€” cheile sunt ALE ownerului, pe faČ›Ä: orele, plafonul
// zilnic Ă®n USD, ideea clipului, butonul PORNIT/OPRIT (implicit OPRIT â€” banii
// nu curg nesupravegheaČ›i). Serverul refuzÄ PE NUME orice rulare Ă®n afara
// cheilor (promoTimer.ts); fiecare salvare lasÄ urmÄ Ă®n registrul de audit.
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
  if (!stare) return <span className="or-wallet-sub">đź—“ Promovarea programatÄ: stare necititÄ</span>
  return (
    <span className="or-wallet-sub" style={{ display: 'block' }}>
      đź—“ Promovarea programatÄ (Studioul de Clipuri):{' '}
      {stare.pornit ? `PORNITÄ‚ â€” orele ${stare.ore.join(', ') || 'â€”'}, plafon $${stare.plafonUsdZi}/zi` : 'OPRITÄ‚'}
      <details style={{ marginTop: 4 }}>
        <summary>setÄri (ore, plafon, ideea clipului)</summary>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
          <label>
            Orele (0-23, cu virgulÄ):{' '}
            <input value={oreTxt} onChange={(e) => setOreTxt(e.target.value)} placeholder="ex. 9,18" />
          </label>
          <label>
            Plafon $/zi:{' '}
            <input value={plafonTxt} onChange={(e) => setPlafonTxt(e.target.value)} style={{ width: 70 }} />
          </label>
          <label>
            Ideea clipului:{' '}
            <input value={idee} onChange={(e) => setIdee(e.target.value)} placeholder="ex. Kelion, asistentul tÄu AI, pe kelionai.app" style={{ width: '100%' }} />
          </label>
          <span>
            <button type="button" className="ghost" disabled={busy} onClick={() => void salveaza(true)}>
              SalveazÄ Č™i PORNEČTE
            </button>{' '}
            <button type="button" className="ghost" disabled={busy} onClick={() => void salveaza(false)}>
              SalveazÄ OPRIT
            </button>
          </span>
        </div>
      </details>
    </span>
  )
}

// veche â†’ nouÄ, plus DOVADA backupului (cel mai nou fiČ™ier de pe disc, mÄsurat
// de server â€” datÄ + mÄrime; lipsa lui se spune, nu se mascheazÄ).
interface RandAudit { la: string; actor: string; actiune: string; tabel: string; cheie: string; vechi: string; nou: string }

// â”€â”€ AUTOVERIFICAREA INTELIGENTÄ‚ (owner, 19 aug): forma raportului mÄsurat pe care
// Ă®l Ă®ntoarce POST /api/admin/autoverificare (Kelion se testeazÄ singur pe TOATE
// funcČ›iile + spune DE CE nu merge). AceleaČ™i cĂ˘mpuri ca RaportAutoverificare din backend.
type VerdictFunctie = 'merge' | 'stricat' | 'nu_pot_verifica'
interface VerificareFunctie {
  functie: string; categorie: string; face: string; tip: 'citire' | 'efect'
  verdict: VerdictFunctie; deCe: string; recomandare: string; dovada: string
}
interface RaportAutoverificare {
  total: number; merg: number; stricate: number; nepotverifica: number; functii: VerificareFunctie[]
}
// Ordinea Ă®n listÄ: Ă®ntĂ˘i ce nu merge (stricate), apoi nesigurele, apoi ce merge.
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
  if (date === null) return <div className="chat-hint">registrul se Ă®ncarcÄâ€¦</div>
  if (date === 'eroare') return <div className="chat-hint">âš  Registrul de audit nu s-a putut citi.</div>
  return (
    <div className="fin-breakdown">
      <div className="fin-breakdown-head">Registrul modificÄrilor (audit â€” cine, cĂ˘nd, ce)</div>
      <div className="chat-hint">
        {date.backup
          ? `Ultimul backup: ${date.backup.fisier} Â· ${new Date(date.backup.la).toLocaleString('ro-RO')} Â· ${(date.backup.octeti / 1024 / 1024).toFixed(1)} MB`
          : 'Backup: nemÄsurabil de aici (directorul de backup nu e pe maČ™ina asta sau e gol) â€” de verificat pe VPS.'}
      </div>
      {date.randuri.length === 0 && <div className="chat-hint">â€” Ă®ncÄ nicio modificare Ă®nregistratÄ (registrul porneČ™te de la publicarea asta)</div>}
      {date.randuri.slice(0, 60).map((r, i) => (
        <div className="vis-meta" key={i} style={{ padding: '3px 0' }}>
          <span className="vis-time">{new Date(r.la).toLocaleString('ro-RO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
          <span><strong>{r.actor || 'â€”'}</strong></span>
          <span>{r.actiune}</span>
          <span className="muted">{r.tabel}{r.cheie ? ` Â· ${r.cheie}` : ''}</span>
          {(r.vechi || r.nou) && <span>{r.vechi ? `${r.vechi} â†’ ` : ''}{r.nou}</span>}
        </div>
      ))}
    </div>
  )
}

function Flag({ code }: { readonly code: string }) {
  if (!code || code.length !== 2) return <span className="flag-none">đźŚ</span>
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
  // scrie sub kind 'gemini' (chat.ts, google-direct) â€” rĂ˘ndul lui apÄrea cu
  // cheia brutÄ, Ă®n timp ce â€žCreier" stÄtea pe 'chat' (istoricul OpenRouter).
  // Un admin care citea â€žCreier $X" credea cÄ vede costul creierului de acum.
  gemini: 'Creier (Gemini)',
  chat: 'Creier (istoric OpenRouter)',
  correct: 'Gemini (correct)',
  image: 'Images (Gemini)',
  image_est: 'Images (estimare internÄ)',
  video: 'Video (Veo)',
  asr: 'Hearing (STT)',
  search: 'CÄutare web',
  memory: 'Memorie',
  memory_est: 'Memorie (estimare internÄ)',
  // The live-voice minutes â€” an INTERNAL ESTIMATE (mic-on seconds Ă— a fixed
  // rate), never the provider's invoice. Labeled as such wherever it shows.
  voice_minutes: 'Minute voce',
}

// Jurnalul scrie vocea ca 'tts:<motor>' (tts.ts) â€” vechea cheie fixÄ 'tts'
// nu se potrivea niciodatÄ, deci rĂ˘ndul apÄrea cu cheia brutÄ.
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
  if (diff === 0) return 'AstÄzi'
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

// â”€â”€ ONE GRID OF LINKS, built once (unique, no duplicates) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// â€žTrimite linkul pe reČ›eleâ€ť and â€žPlatforme videoâ€ť were TWO identical JSX
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

// PASTILELE AI, MUTATE ĂŽN ADMIN (10 aug). Din 15 aug soldul Gemini vine DERIVAT
// automat din exportul BigQuery (cĂ˘mpul `sold` din brain-credit) â€” declararea
// manualÄ a murit la ordinul ownerului (â€žvaloarea realÄâ€¦ citit automat").
// â”€â”€ BECURILE DE CREDIT AI (owner, 13 aug: â€žun bec roČ™u/verde care indicÄ credit
// sau lipsÄ de credit, click = reĂ®ncÄrcare; 402 Ă®nseamnÄ cÄ nu are credit") â”€â”€â”€
// Verde = are credit; roČ™u = fÄrÄ (402/sold 0 â€” click ca sÄ adaugi bani); gri =
// nu pot verifica (necunoscutul NU se mascheazÄ Ă®n verde â€” regula #1). Click pe
// rĂ˘nd = pagina de reĂ®ncÄrcare REALÄ‚ a furnizorului. Starea â€žroČ™u pĂ˘lpĂ˘ind"
// (clasa .bec-rosu.palpaie) e pregÄtitÄ Ă®n CSS pentru auto-alimentarea de pe
// card (card gol) â€” vine cu acea piesÄ, nu de aici.
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
          // ROČUL SPUNE CAUZA MÄ‚SURATÄ‚, NU PRESUPUNEREA (owner, 14 aug: becul
          // Fable era roČ™u pe CHEIE INVALIDÄ‚, dar eticheta zicea â€žfÄrÄ credit â€”
          // adaugÄ bani" â€” Ă®n contul Anthropic erau 35 USD; banii nu lipseau,
          // cheia era refuzatÄ). CĂ˘nd proba Â«serveČ™teÂ» are motivul, Äla se
          // aratÄ; genericul â€žfÄrÄ credit" rÄmĂ˘ne DOAR cĂ˘nd chiar nu Č™tim de ce.
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
                  : `${A.becuriNecunoscut}${f.ramas.motiv ? ` â€” ${f.ramas.motiv}` : ''}`
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
  // SOLDUL DERIVAT DIN EXPORT (15 aug: â€žvaloarea realÄâ€¦ citit automat").
  // Cifra apare DOAR cĂ˘nd serverul a derivat-o din exportul BigQuery
  // (full_amount â’ aplicat); altfel âś“/âš  pe becul viu, cu motivul Ă®n tooltip â€”
  // niciodatÄ un numÄr inventat. Butonul â€žâśŽ credit Gemini" a MURIT: nu mai
  // existÄ nimic de declarat de mĂ˘nÄ.
  // Verde âś“ DOAR pe probÄ vie 200; sold real cĂ˘nd e derivat din export; altfel NEUTRU
  // â€žÂ·" (nu pot verifica) â€” Google nu expune soldul prepay, deci pastila nu mai pretinde
  // NICIODATÄ‚ â€žepuizat"/â€žfÄrÄ credit" (owner: â€žscoate alerta falsÄ"; regula #1). Alerta
  // REALÄ‚ de credit + linkul de reĂ®ncÄrcare vin din chatul viu, pe eČ™ec mÄsurat.
  const geminiEticheta =
    g?.sold != null
      ? `${g.sold.toFixed(2)} ${g.soldMoneda ?? ''}`.trim()
      : g?.serving
        ? 'âś“'
        : 'Â·'
  const geminiTitlu = [
    g?.sold != null
      ? `sold REAL derivat din exportul BigQuery: ${g.sold.toFixed(2)} ${g.soldMoneda ?? ''}`
      : `soldul nu e Ă®ncÄ derivabil: ${g?.soldMotiv ?? 'motiv necunoscut'}`,
    g?.monthUsd != null ? `cheltuit luna asta: $${g.monthUsd.toFixed(2)}` : 'cheltuiala lunii necitibilÄ',
  ].join(' Â· ')
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, padding: '10px 14px', margin: '10px 0', background: 'color-mix(in srgb, var(--text) 4%, transparent)', border: '1px solid var(--border)', borderRadius: 10 }}>
      <strong style={{ fontSize: 13, opacity: 0.8 }}>Credite AI</strong>
      <span title={s?.live && typeof s.balance === 'number' ? `${s.balance.toLocaleString()} cÄutÄri rÄmase (Serper)` : 'citirea Serper a eČ™uat'}>
        {/* `?? 0` scos (owner, 19 aug): un `live:true` FÄ‚RÄ‚ sold arÄta â€žSerper 0" =
            fals â€žfÄrÄ credit", exact ce interzice tipul lui (Stage.tsx: â€žNICIODATÄ‚
            Serper 0"). FÄrÄ sold real â†’ âš  â€žnu pot citi", nu 0. */}
        Serper {s?.live && typeof s.balance === 'number' ? serperK(s.balance) : 'âš '}
      </span>
      <span title={geminiTitlu}>
        Gemini {geminiEticheta}
      </span>
      {/* (Constructorul e Devin (extern), iar creierul live e Gemini prin app â€”
          pastila de sus. Fable a fost scos total, 16 aug: nu mai are rĂ˘nd.) */}
      <a href="https://aistudio.google.com/billing" target="_blank" rel="noreferrer" style={{ fontSize: 12, opacity: 0.75 }}>alimenteazÄ Gemini</a>
    </div>
  )
}

export default function AdminPanel({
  onClose,
  initialTab,
  brainCredit,
}: {
  readonly onClose: () => void
  readonly initialTab?: 'finance' | 'users' | 'share' | 'stores' | 'inbox' | 'voiceprints' | 'gesturi' | 'tokenuri' | 'constructor' | 'recuperare' | 'sistem' | 'erori' | 'notificari'
  readonly brainCredit?: BrainCredit | null
}) {
  const [tab, setTab] = useState<
    'finance' | 'users' | 'share' | 'stores' | 'inbox' | 'voiceprints' | 'gesturi' | 'tokenuri' | 'constructor' | 'recuperare' | 'sistem' | 'erori' | 'notificari'
  >(initialTab ?? 'finance')
  // NotificÄrile pe telefon (Web Push): starea vine MÄ‚SURATÄ‚ din browser
  // (starePush), nu Č›inutÄ minte â€” â€žactiv" Ă®nseamnÄ chiar o abonare vie.
  const [push, setPush] = useState<StarePush>('inactiv')
  const [pushBusy, setPushBusy] = useState(false)
  // â”€â”€ AUTOVERIFICAREA INTELIGENTÄ‚ (owner, 19 aug): raportul e MÄ‚SURAT la cerere,
  // nu Č›inut minte Ă®ntre sesiuni â€” â€žmerge" apare doar cu dovadÄ (regula #1).
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
  // GESTURES (Adrian, Jul 13): the disabled list â€” what is NOT checked is NOT used.
  // Tri-stat (auditul admin, 3 aug): pe o citire EČUATÄ‚ nu desenÄm â€žtoate
  // active" Č™i mai ales nu lÄsÄm un toggle sÄ salveze peste o bazÄ necititÄ
  // (Č™tergea dezactivÄrile reale de pe server).
  const [gestOff, setGestOff] = useState<string[] | null | 'necitit'>('necitit')
  const [gestSaved, setGestSaved] = useState(false)
  // â€žNU s-a salvat" â€” simetric cu â€žsalvat âś“" (auditul admin, 3 aug: pe eČ™ec
  // checkbox-ul rÄmĂ˘nea Ă®ntors Č™i nimeni nu afla).
  const [gestErr, setGestErr] = useState('')
  // On preview the panel goes transparent for ~3.5s, so you see the avatar behind.
  const [peek, setPeek] = useState(false)
  // The â€žPune pe 0â€ť button in the Money tab: while it runs, it can't be pressed twice.
  const [resetBusy, setResetBusy] = useState(false)
  // Lista de erori (tab â€žErori"): erori browser + defecte de sistem, fiecare cu
  // â€žce este". 'necitit' = n-am Ă®ntrebat Ă®ncÄ; null = citirea a EČUAT (nu â€žzero
  // erori"); obiect = citit real.
  const [erori, setErori] = useState<EroriAdmin | null | 'necitit'>('necitit')
  const [eroriBusy, setEroriBusy] = useState(false)
  // NotificÄri pentru owner (K14): cereri noi (platÄ neatribuitÄ / cerere
  // neacoperitÄ). 'necitit' = n-am Ă®ntrebat; null = citirea a EČUAT; listÄ = citit.
  const [notificari, setNotificari] = useState<NotificareAdmin[] | null | 'necitit'>('necitit')
  // Plafonul zilnic de ardere al constructorului (B8/K15): contor + cifrÄ + comutator.
  const [plafon, setPlafonState] = useState<PlafonConstructor | null>(null)
  const previewAndPeek = (clip: string): void => {
    previewGesture(clip)
    setPeek(true)
    window.setTimeout(() => setPeek(false), 3500)
  }
  // Live chat with visitors (owner inbox): conversations, the selected one, the reply.
  // TRI-STAT peste tot (auditul admin, 3 aug): 'necitit' = Ă®ncÄ n-am Ă®ntrebat;
  // null = citirea a EČUAT (se scrie ca eČ™ec); [] = serverul chiar a rÄspuns gol.
  const [inbound, setInbound] = useState<InboundEmail[] | null | 'necitit'>('necitit')
  const [mailboxLive, setMailboxLive] = useState<MailboxLiveResult | null | 'necitit'>('necitit')
  const [mailboxLoading, setMailboxLoading] = useState(false)
  // ČTERGEREA DIN INBOX (Adrian, 3 aug: â€žsÄ Č™terg de aici cĂ˘te una sau prin
  // selecČ›ie toate"): selecČ›ia pe UID + Č™tergerea (una sau grupul selectat).
  // Serverul mutÄ Ă®n coČ™ul REAL al cÄsuČ›ei cĂ˘nd existÄ; mesajul de confirmare
  // spune ce s-a Ă®ntĂ˘mplat DE FAPT (cĂ˘te, Č™i unde au ajuns).
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
        // ReĂ®ncarcÄ lista REALÄ‚ de pe server â€” nu scoatem optimist rĂ˘nduri
        // pe care poate nu le-am Č™ters (cifra vine din ce s-a Ă®ntĂ˘mplat).
        setMailboxLoading(true)
        void fetchMailboxLive().then((m) => {
          setMailboxLive(m)
          setMailboxLoading(false)
        })
      })
      // (setMailSel(new Set()) de mai sus goleČ™te selecČ›ia, deci nu poate
      // rÄmĂ˘ne un â€žČterge selectate (N)" cu UID-uri moarte â€” auditul, 3 aug.)
      .catch(() => setMailDelMsg(A.mailDeleteFailed))
      .finally(() => setMailDelBusy(false))
  }
  const [contactMsgs, setContactMsgs] = useState<ContactMessage[] | null | 'necitit'>('necitit')
  const [copied, setCopied] = useState(false)
  // TEXTUL DE DISTRIBUIRE, AL OWNERULUI (Adrian, 3 aug: â€žrescrie corect tot
  // tabul"): mesajul nu mai e bÄtut Ă®n cuie Ă®n cod â€” Ă®l scrii/ajustezi aici Č™i
  // rÄmĂ˘ne salvat local (localStorage), iar toate butoanele Ă®l folosesc pe AL TÄ‚U.
  const SHARE_TEXT_IMPLICIT =
    'Čši-l prezint pe Kelion â€” asistentul meu AI cu avatar Č™i voce: vede, aude Č™i vorbeČ™te, Ă®n orice limbÄ. Contul e gratuit Č™i Ă®l faci Ă®n 30 de secunde:'
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
      /* privat/incognito â€” rÄmĂ˘ne doar Ă®n sesiune */
    }
  }
  // null = citirea listei a EČUAT (auditul admin, 3 aug) â€” nu â€žNo history yet".
  // null = fetchHistory a picat â€” se scrie ca eČ™ec, nu ca chat gol.
  // THE OUTAGES AUDIT (Adrian, Jul 27): everything that went down, in the same tab as gaps.
  // un blip Č™tergea problemele critice de pe ecran) â€” auditFailedAt spune de cĂ˘nd.
  const [finance, setFinance] = useState<Finance | null>(null)
  // financeFailed = ultima citire a picat: fÄrÄ date â†’ mesaj de eČ™ec (nu
  // â€žSe Ă®ncarcÄâ€¦" pe veci); cu date vechi â†’ notÄ cÄ cifrele sunt ultimele bune.
  const [financeFailed, setFinanceFailed] = useState(false)
  // The money circuit, managed FROM admin (Adrian, Jul 24).
  const [circuit, setCircuit] = useState<MoneyCircuit | null>(null)
  const [circuitFailed, setCircuitFailed] = useState(false)
  // Mesajul butonului â€žPune pe 0" (auditul admin, 3 aug: r.ok nu era verificat
  // â€” eČ™ecul arÄta identic cu succesul).
  const [resetMsg, setResetMsg] = useState('')
  // Legarea contului Revolut (PSD2) â€” starea celor douÄ butoane noi.
  const [legMsg, setLegMsg] = useState('')
  // AI pool â€” how much you add/remove (typed value) + the buttons' state.


  const [activity, setActivity] = useState<UserActivity | null | 'necitit'>('necitit')
  const [stores, setStores] = useState<StoresData | null | 'necitit'>('necitit')
  const [voiceprints, setVoiceprints] = useState<VoiceprintRow[] | null>([])
  const [voiceprintsLoading, setVoiceprintsLoading] = useState(false)
  // Mesajele acČ›iunilor pe amprente (Č™tergere/ascultare picate â€” nu mai tac).
  const [vpMsg, setVpMsg] = useState('')
  // Captura facialÄ a unui om, dupÄ email (owner, 14 aug: â€žuserii nu au poze") â€”
  // din aceeaČ™i listÄ ca tabul Amprente; gol/nelistat = nu existÄ capturÄ.
  const pozaUser = (email: string): string =>
    (Array.isArray(voiceprints) ? voiceprints : []).find((v) => v.email === email && v.hasFace)?.facePhoto ?? ''
  // THE BUILDER (Adrian, Jul 27: â€žKelion must be able to create any software the
  // admin asks him toâ€ť): new orders + the queue with their state (the worker on
  // the VPS executes them and opens PRs; the merge is Adrian's).
  interface BuildJobRow {
    id: number
    status: 'queued' | 'running' | 'done' | 'failed'
    orderText: string
    /** P8: fapta ordinului, extrasÄ de server din â€žCE A CERUT" â€” pentru afiČ™aj. */
    nume?: string
    branch: string | null
    prUrl: string | null
    tokens: number
    // Aug 2: 'fable-5' when the order ran on the expressly requested paid
    // brain, 'free' otherwise (null until the worker reports).
    brain: string | null
    updatedAt: string
    // BARA 0â€“100% (Adrian, 3 aug): etapa REALÄ‚ raportatÄ de lucrÄtor + harta
    // ei Ă®n procent (serverul o calculeazÄ din progres â€” progresOrdin.ts).
    // null = eČ™uat (eticheta spune adevÄrul, fÄrÄ procent inventat).
    progress?: string | null
    pct?: number | null
    // DEVIN dovedit PE ORDIN (owner, 22 aug: â€žam cerut devin peste tot in
    // constructor"): id-ul sesiunii Devin, pus de dispecer la pornire â€” rĂ˘ndul
    // aratÄ MÄ‚SURAT cÄ Devin duce sarcina, nu se presupune.
    devinSessionId?: string | null
  }
  // null = coada nu s-a putut citi (auditul admin, 3 aug) â€” nu â€žNiciun ordin".
  const [buildJobs, setBuildJobs] = useState<BuildJobRow[] | null | 'necitit'>('necitit')
  // Pauza de autonomie, VIZIBILÄ‚ Č™i aici (auditul admin, 3 aug): cu pauza
  // pornitÄ lucrÄtorul nu ia nimic â€” ordinul stÄtea â€žĂ®n coadÄ Â· 0%" la
  // nesfĂ˘rČ™it dupÄ promisiunea â€žmax. 2 minute", fÄrÄ nicio explicaČ›ie.
  const [buildPaused, setBuildPaused] = useState(false)
  // CINE E CONSTRUCTORUL â€” MÄ‚SURAT de server din config (owner, 22 aug: â€žam
  // cerut devin peste tot in constructorâ€¦ sa-i stergi de tot pe ce e local").
  // Luminile vechi (proba localÄ, puls lucrÄtor) au fost ČTERSE cu toatÄ
  // maČ™inÄria localÄ: constructorul e DEVIN, iar panoul aratÄ starea LUI.
  const [constructorId, setConstructorId] = useState<{ cine: 'devin' | 'local'; motiv: string } | null>(null)
  // DIAGNOSTICUL AUTONOM (owner, 19 aug): â€žde ce (nu) reparÄ", mÄsurat pe server.
  const [diagnostic, setDiagnostic] = useState<{ sanatos: boolean; verdict: string; probleme: { cod: string; severitate: 'critic' | 'atentie'; ce: string; recomandare: string }[] } | null>(null)
  const [buildOrder, setBuildOrder] = useState('')
  const [buildMsg, setBuildMsg] = useState('')
  // EVALUAREA CERINČšEI (owner, 13 aug): pe mÄsurÄ ce scrii ordinul, evaluÄm
  // cerinČ›a (poarta de calitate + AI-urile potrivite pe capacitate, credit live).
  const [evalOrdin, setEvalOrdin] = useState<EvalConstructor | null>(null)
  useEffect(() => {
    if (tab !== 'constructor') return
    const text = buildOrder.trim()
    if (text.length < 3) {
      setEvalOrdin(null)
      return
    }
    // Debounce: nu lovim serverul la fiecare tastÄ.
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
  // recoveryFailed = citirea versiunilor a picat (403/503/reČ›ea) â€” se scrie ca
  // eČ™ec, nu ca â€žNicio versiune salvatÄ Ă®ncÄ" (auditul admin, 3 aug).
  const [recoveryFailed, setRecoveryFailed] = useState(false)
  const [recoveryLoading, setRecoveryLoading] = useState(false)
  const [recoveryNote, setRecoveryNote] = useState('')
  const [recoveryMsg, setRecoveryMsg] = useState('')
  // Restore BY BUTTON (Adrian, Jul 27: â€žthe admin must be able to select itâ€ť).
  // While a restore runs, every restore button is locked.
  const [restoringTag, setRestoringTag] = useState<string | null>(null)
  // THE ADMIN BUTTON LOCK (Adrian, Jul 27): the activation secret is set HERE
  // (next to the voiceprints â€” both lock factors stay together).
  // ATENČšIE (auditul admin, 3 aug): lacÄtul e DEZARMAT hard Ă®n backend
  // (adminLock.ts, LACAT_DEZARMAT=true, la cererea ownerului din 31 iul) â€”
  // serverul rÄspunde mereu armed:false, deci UI-ul spune starea REALÄ‚, nu
  // mai vinde armarea ca funcČ›ionalÄ. 'necitit' = n-am Ă®ntrebat Ă®ncÄ;
  // null = citirea stÄrii a picat (nu â€žnearmat"!).
  const [lockArmed, setLockArmed] = useState<boolean | null | 'necitit'>('necitit')
  const [lockSecret, setLockSecret] = useState('')
  const [lockMsg, setLockMsg] = useState('')
  // Playing a voiceprint's audio sample (the â€žplayâ€ť button): we remember who is
  // playing now, to show âŹ¸ and never start two at once.
  const [playingVp, setPlayingVp] = useState<string | null>(null)
  const vpAudioRef = useRef<HTMLAudioElement | null>(null)
  // Ocupat ĂŽNTRE click Č™i rezolvarea fetch-ului (auditul admin, 3 aug): douÄ
  // clickuri rapide porneau douÄ obiecte Audio Ă®n paralel â€” primul nu mai
  // putea fi oprit decĂ˘t din pauza globalÄ.
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
      // â–¶ nu mai tace la eČ™ec (auditul admin, 3 aug): apÄsarea primea NIMIC.
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
  // WHICH KEYS THE SERVER SEES RIGHT NOW â€” the answer to â€žI've typed them dozens of timesâ€ť.
  // Tri-stat (auditul admin, 3 aug): tabelul-vedetÄ dispÄrea MUT cĂ˘nd citirea
  // pica â€” ownerul vedea tabul fÄrÄ tabel Č™i nu Č™tia dacÄ e stricat sau aČ™a
  // trebuie. null = citire eČ™uatÄ, spusÄ ca atare.
  const [envCheck, setEnvCheck] = useState<EnvCheckResult | null | 'necitit'>('necitit')

  // The conversation + testing profile of a clicked user (tab "Utilizatori") â€”
  // what he wrote (the chat) and how he tested (browser/device/IP/sessions/time),
  // in one click, without going through the separate "Istoric chat" tab.
  // rows: null = citirea conversaČ›iei a PICAT (auditul admin, 3 aug) â€” se
  // scrie ca eČ™ec, nu ca â€žNu a scris niciun mesaj Ă®ncÄ".
  const [userConvo, setUserConvo] = useState<{ u: UserActivityRow; rows: HistoryRow[] | null } | null>(null)
  const [userConvoLoading, setUserConvoLoading] = useState(false)
  // â€žTradu Ă®n romĂ˘nÄâ€ť in the conversation view: roOn = show the translation;
  // roMap = original-text â†’ translation cache (one request per new message).
  const [roOn, setRoOn] = useState(false)
  const [roMap, setRoMap] = useState<Record<string, string>>({})
  const [roBusy, setRoBusy] = useState(false)
  // How many messages could NOT be translated (shown as the original text) â€”
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
    // fetchHistory nu mai aruncÄ (auditul admin, 3 aug): null = citire picatÄ,
    // iar loading se Ă®nchide ORICUM â€” overlay-ul nu mai rÄmĂ˘ne pe veci pe
    // â€žSe Ă®ncarcÄâ€¦".
    const rows = await fetchHistory(u.email)
    setUserConvo({ u, rows })
    setUserConvoLoading(false)
  }

  // ĂŽnchiderea overlay-ului RESETEAZÄ‚ starea traducerii (auditul admin, 3 aug):
  // roOn/roFailed se scurgeau Ă®n tabul Istoric chat â€” butonul arÄta â€žAratÄ
  // originalul" Č™i â€žâš  N netraduse" pentru ALTÄ‚ conversaČ›ie.
  const closeUserConvo = (): void => {
    setUserConvo(null)
    setRoOn(false)
    setRoFailed(0)
  }

  // LEGEA din 16 aug: pĂ˘rghia de pauzÄ a autonomiei NU MAI EXISTÄ‚ (ordinul
  // verbatim: â€žscoti posibilitatea sa mai treaca pe off" + â€žGATA") â€” rĂ˘ndul
  // din panou e o DECLARAČšIE, nu un comutator; onPauzaAutonomie/pauzaBusy au
  // murit odatÄ cu butonul.
  // THE EIGHT PROOFS (Adrian, Jul 31: â€žthere must be 8 out of 8 proofsâ€ť).
  const [dovezi, setDovezi] = useState<{ dovedite: number; din: number; dovezi: DovadaAutonomie[] } | null>(null)
  // THE PAYMENTS PANEL (M3, Aug 2): 'necitit' until the read lands; null = the
  // read FAILED (shown as failure, never as an empty ledger â€” rule no. 1).
  const [plati, setPlati] = useState<PlatiAdmin | null | 'necitit'>('necitit')

  // P29 â€” butonul â€žVideo plÄtit" (owner, 15 aug: â€žeu vreau sa platesc, sau
  // clientul, de ce nu ma duce spre plata"): porneČ™te/opreČ™te Veo din panou,
  // nu din env-ul VPS-ului; dupÄ apÄsare starea se RECITEČTE, nu se presupune.
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
    // gaps: la eČ™ec PÄ‚STRÄ‚M lista (aici Ă®ncÄ goalÄ) Č™i ridicÄm doar flagul â€”
    // LegÄturÄ cereri neacoperite (plÄČ›i neatribuite + cereri useri)
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
  // only the starting value â€” if the panel was ALREADY open and Kelion got
  // â€ždeschide admin â†’ vizitatoriâ€ť, the tab didn't change at all.
  useEffect(() => {
    if (initialTab) setTab(initialTab)
  }, [initialTab])

  // LOAD ON TAB, NOT ON CLICK (defect 6): stores/inbox/tokens loaded their data
  // ONLY from the button's onClick â€” opened by voice or initialTab they stayed
  // forever empty (â€žSe verificÄ magazinele liveâ€¦â€ť forever).
  useEffect(() => {
    if (tab === 'stores') {
      setStores('necitit')
      void fetchStores().then(setStores)
    } else if (tab === 'inbox') {
      // SELECČšIA SE RESETEAZÄ‚ la fiecare intrare Ă®n tab (auditul admin, 3 aug):
      // mailSel/mailDelMsg rÄmĂ˘neau stÄtute â€” â€žČterge selectate (3)" pentru
      // mesaje care nu mai existau Ă®n listÄ, plus un â€žČterse: â€¦" vechi afiČ™at
      // ca Č™i cum tocmai s-ar fi Ă®ntĂ˘mplat.
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
      // The â€žCe chei vede serverul CHIAR ACUMâ€ť table loads together with the tab.
      // This call had ended up by mistake at the tail of the `inbox` branch, so the
      // table NEVER appeared in Tokens â€” caught by Adrian from a screenshot.
      void fetchEnvCheck().then(setEnvCheck)
      setTokenChecksLoading(true)
      void fetchTokenChecks().then((r) => {
        setTokenChecks(r)
        setTokenChecksLoading(false)
      })
    } else if (tab === 'users') {
      // REĂŽNCÄ‚RCARE LA DESCHIDEREA TABULUI (auditul admin, 3 aug): activitatea
      // se citea O SINGURÄ‚ datÄ, la montare â€” un eČ™ec lÄsa â€žSe Ă®ncarcÄâ€¦" pe
      // veci, fÄrÄ nicio a doua Č™ansÄ.
      void fetchActivity().then(setActivity)
      // POZELE oamenilor (owner, 14 aug: â€žuserii nu au poze") â€” capturile
      // faciale vin din aceeaČ™i listÄ ca tabul Amprente; o citire picatÄ lasÄ
      // pur Č™i simplu â€ž?"-ul cinstit pe rĂ˘nd, nu stricÄ tabul.
      void fetchVoiceprints().then(setVoiceprints)
    }
  }, [tab])

  // MONEY IN REAL TIME (Adrian, Jul 24: â€žall credits show in real time, the real
  // valueâ€ť): while the Money tab is open we refresh the balances and the profit
  // every 15s â€” LIVE values.
  useEffect(() => {
    if (tab !== 'finance') return
    const id = window.setInterval(() => {
      // PÄ‚STREAZÄ‚ ultimele date bune (auditul admin, 3 aug): pollul scria null
      // peste datele afiČ™ate la un blip de reČ›ea, golind tabul Ă®napoi Ă®n
      // â€žSe Ă®ncarcÄâ€¦". EČ™ecul se declarÄ prin financeFailed, nu prin golire.
      void fetchFinance().then((f) => {
        if (f) setFinance(f)
        setFinanceFailed(!f)
      })
    }, 15_000)
    return () => window.clearInterval(id)
  }, [tab])

  // Live visitor chat: refresh the conversation list while the tab is open, and
  // poll the OPEN conversation for new visitor lines (both every few seconds).




  // Tab â€žAmprente vocaleâ€ť open â†’ loads the list and refreshes every 10s.
  useEffect(() => {
    if (tab !== 'voiceprints') return
    const load = async (): Promise<void> => {
      setVoiceprintsLoading(true)
      // null = citirea a picat (auditul admin, 3 aug) â€” se afiČ™eazÄ ca eČ™ec,
      // nu ca â€žNicio amprentÄ Ă®nregistratÄ Ă®ncÄ".
      const rows = await fetchVoiceprints()
      setVoiceprints(rows)
      setVoiceprintsLoading(false)
    }
    void load()
    const id = window.setInterval(() => void load(), 10_000)
    return () => window.clearInterval(id)
  }, [tab])

  // ReĂ®ncarcÄ coada ordinelor â€” UN SINGUR loc (jscpd, 3 aug): efectul de tab Č™i
  // butoanele de Č™tergere/reia foloseau douÄ copii identice ale aceluiaČ™i fetch.
  const refreshBuildJobs = (): void => {
    fetch('/api/admin/constructor', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { jobs?: BuildJobRow[]; paused?: boolean; constructor?: { cine: 'devin' | 'local'; motiv: string } } | null) => {
        // null/eČ™ec = coada NU s-a citit (auditul admin, 3 aug) â€” se spune,
        // nu se lasÄ â€žNiciun ordin Ă®ncÄ" peste o citire picatÄ.
        if (j?.jobs) {
          setBuildJobs(j.jobs)
          setBuildPaused(!!j.paused)
          setConstructorId(j.constructor ?? null)
        } else setBuildJobs(null)
      })
      .catch(() => setBuildJobs(null))
    // DIAGNOSTICUL AUTONOM: de ce (nu) reparÄ, mÄsurat pe server (regula #1 â€” pe
    // eČ™ec Ă®l ascundem, nu inventÄm â€žsÄnÄtos").
    fetch('/api/admin/constructor/diagnostic', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { sanatos: boolean; verdict: string; probleme: { cod: string; severitate: 'critic' | 'atentie'; ce: string; recomandare: string }[] } | null) => setDiagnostic(d && typeof d.verdict === 'string' ? d : null))
      .catch(() => setDiagnostic(null))
  }
  // Tab â€žConstructorâ€ť open â†’ the orders queue, refreshed every 10s.
  useEffect(() => {
    if (tab !== 'constructor') return
    refreshBuildJobs()
    void fetchPlafon().then(setPlafonState)
    const id = window.setInterval(() => {
      refreshBuildJobs()
      void fetchPlafon().then(setPlafonState)
    }, 10_000)
    return () => window.clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refreshBuildJobs e stabil funcČ›ional (doar fetch+set)
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
          // PROMISIUNEA ONESTÄ‚ (auditul admin, 3 aug): cu autonomia pe pauzÄ
          // lucrÄtorul NU ia nimic â€” â€žmax. 2 minute" ar fi fost o minciunÄ.
          setBuildMsg(buildPaused ? A.orderEnqueuedPaused(j.id) : A.orderEnqueuedActive(j.id))
        } else if (j?.error === 'ordin_respins') {
          // Poarta de calitate a respins ordinul â€” arÄtÄm MOTIVUL, nu un â€žeČ™ec" mut.
          setBuildMsg(`Ordin respins: ${j.motiv ?? 'cerinČ›Ä neclarÄ'}`)
        } else setBuildMsg(A.orderSendFailed)
      })
      .catch(() => setBuildMsg(A.orderSendFailed))
  }

  // â”€â”€ ČTERGE / CURÄ‚ČšÄ‚ / REIA un ordin din coadÄ (Adrian, 3 aug: â€žscoate 30/31
  //    dacÄ nu le poate face â€¦ aici nu apar butoane de Č™tergere"). Rutele existau
  //    (db.ts â†’ constructor.ts); aici sunt butoanele care le cheamÄ.
  //    ReĂ®ncÄrcarea = refreshBuildJobs, definit sus lĂ˘ngÄ efectul de tab.
  // ČTERGERE CU VERDICT, o singurÄ implementare (jscpd + auditul admin, 3 aug):
  // DELETE + citirea lui {ok} din CORP â€” serverul rÄspunde 200 cu {ok:false}
  // cĂ˘nd rĂ˘ndul nu existÄ sau DB picÄ, iar vechiul cod care se uita doar la
  // status raporta â€žČ™ters" pentru o Č™tergere care nu s-a Ă®ntĂ˘mplat.
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
  // OPREČTE un ordin Ă®n curs (auditul admin, 3 aug): cancelBuildJob exista Ă®n
  // backend, dar panoul n-avea niciun buton spre el â€” un 'running' nu putea fi
  // oprit decĂ˘t din chat.
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

  // Tab â€žRecuperareâ€ť open â†’ loads the saved recovery points.
  const loadRecovery = (): void => {
    setRecoveryLoading(true)
    fetch('/api/admin/backups', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { points?: RecoveryRow[] } | null) => {
        // EČ™ecul se DECLARÄ‚ (auditul admin, 3 aug): 503/403/reČ›ea nu mai
        // aratÄ ca â€žNicio versiune salvatÄ Ă®ncÄ" â€” Ă®n panoul de siguranČ›Ä
        // unde ownerul decide dacÄ are la ce sÄ se Ă®ntoarcÄ.
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

  // Tab â€žErori" deschis â†’ Ă®ncarcÄ lista (erori browser + defecte de sistem, cu
  // â€žce este") Č™i o reĂ®mprospÄteazÄ cĂ˘t stÄ deschis. null = citirea a EČUAT.
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

  // Tab â€žNotificÄri" deschis â†’ Ă®ncarcÄ cererile noi Č™i reĂ®mprospÄteazÄ la 20s.
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
  // O Ă®ncÄrcare la montare, pentru badge-ul de necitite (owner vede â€ž(3)" fÄrÄ sÄ
  // deschidÄ tabul â€” asta e â€žanunČ›ul" din K14).
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
      // CITEČTE CORPUL ČI LA EČEC (auditul admin, 3 aug): serverul trimite
      // cauza mÄsuratÄ ({error:'github_token_missing'} etc.) â€” genericul
      // â€žreĂ®ncearcÄ" trimitea ownerul sÄ repete o operaČ›ie condamnatÄ.
      // AcelaČ™i tipar ca restoreFromPoint, douÄ funcČ›ii mai jos.
      .then((r) => r.json().then((j: { ok?: boolean; tag?: string; error?: string }) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (ok && j.tag != null) {
          setRecoveryMsg(A.recoverySaved(j.tag))
          setRecoveryNote('')
          loadRecovery()
        } else setRecoveryMsg(A.recoverySaveFailed(j.error ?? 'eroare necunoscutÄ'))
      })
      .catch(() => setRecoveryMsg(A.recoverySaveNetworkError))
  }

  // Restores the app to a saved point: double confirmation (heavy action â€”
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
        else setRecoveryMsg(A.restoreFailed(j.error ?? 'eroare necunoscutÄ'))
      })
      .catch(() => {
        setRestoringTag(null)
        setRecoveryMsg(A.restoreNetworkError)
      })
  }

  // Tab â€žAmprente vocaleâ€ť open â†’ also the lock's state (armed or not).
  // null = citirea a PICAT (auditul admin, 3 aug) â€” nu se mai afiČ™eazÄ ca
  // â€žnearmat": o valoare nemÄsuratÄ nu e un verdict (regula #1).
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
          // FÄ‚RÄ‚ AFIRMAČšII (auditul admin, 3 aug): vechiul setLockArmed(true) +
          // â€žlacÄtul e armat" era o pretenČ›ie, nu o mÄsurÄtoare â€” backend-ul e
          // DEZARMAT hard (adminLock.ts, la cererea ownerului din 31 iul), deci
          // butonul Admin nu cerea nimic. Spunem ce s-a Ă®ntĂ˘mplat DE FAPT Č™i
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

  // Tab â€žGesturiâ€ť open â†’ loads the disabled list.
  useEffect(() => {
    if (tab !== 'gesturi') return
    setGestOff('necitit')
    void fetchDisabledGestures().then(setGestOff)
  }, [tab])

  // Check/uncheck a gesture â†’ saves to the server. Checked = active (NOT on the
  // disabled list). What is not checked is NOT used anywhere in the app.
  // NU se salveazÄ peste o bazÄ necititÄ (auditul admin, 3 aug): pe o citire
  // eČ™uatÄ, un singur toggle ar fi ČTERS toate dezactivÄrile reale de pe server.
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
        // REVERT + mesaj (auditul admin, 3 aug): fÄrÄ el, checkbox-ul rÄmĂ˘nea
        // Ă®ntors pe o stare pe care serverul nu o are, iar bifele â€žsÄreau
        // Ă®napoi" inexplicabil la urmÄtoarea deschidere.
        setGestOff(inainte)
        setGestErr(A.gestureSaveFailed)
      }
    })
  }

  // TEXTUL PANOULUI, in limba adminului (engleza implicit). Vezi lib/adminText.ts.
  const A = adminStrings()
  // Formele â€ždoar date" ale stÄrilor tri-valente (auditul admin, 3 aug):
  // 'necitit'/null nu sunt liste â€” render-ul le trateazÄ explicit.
  const activityData = typeof activity === 'object' && activity !== null ? activity : null
  const mailboxData = typeof mailboxLive === 'object' && mailboxLive !== null ? mailboxLive : null
  const inboundData = Array.isArray(inbound) ? inbound : null
  const contactData = Array.isArray(contactMsgs) ? contactMsgs : null
  const storesData = typeof stores === 'object' && stores !== null ? stores : null
  const envCheckData = typeof envCheck === 'object' && envCheck !== null ? envCheck : null
  const buildJobsData = Array.isArray(buildJobs) ? buildJobs : null
  const gestOffData = Array.isArray(gestOff) ? gestOff : null
  const sym = finance?.currency === 'usd' ? '$' : 'ÂŁ'
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
            {/* Deschide pagina de adÄugat agenČ›i manual (+ temele iscoadelor).
                Crearea Ă®n consola Google Enterprise a fost SCOASÄ‚ pe ordinul
                ownerului (8 aug) â€” agenČ›ii lucreazÄ Ă®n aplicaČ›ie, la /api/a2a. */}
            <button
              type="button"
              className="admin-tab"
              onClick={() => window.open('/api/enterprise/creeaza', '_blank', 'noopener')}
            >
              {A.tabEnterprise}
            </button>
            {/* â”€â”€ VITRINA SIMPLIFICATÄ‚ (Adrian, 14 aug: â€žavem AplicaČ›ii, deci Ă®n
                admin nu mai apar: TranzacČ›ionare, Adaptare CV, Magazine, Inbox,
                Erori, NotificÄri â€” nu le Č™tergi, le foloseČ™te Kelion; doar nu
                mai sunt vizibile"). Butoanele au fost SCOASE din barÄ, dar TOT
                restul trÄieČ™te: TranzacČ›ionare + Adaptare CV stau Ă®n meniul
                â€žAplicaČ›ii" din bara de sus; panourile Inbox/Magazine/Erori Č™i
                rutele lor rÄmĂ˘n Ă®n cod (Kelion le foloseČ™te prin unelte).
                EXCEPČšIA, spusÄ ownerului: NotificÄri NU dispare de tot â€”
                alarmele construite azi (creier cÄzut Ă®n lanČ›, ordin mort) scriu
                DOAR aici (adminNotification = DB + copia pe telefon prin Web
                Push, dacÄ ownerul a pornit-o din â€žđź”” Pe telefon"), deci
                tabul reapare SINGUR doar cĂ˘nd existÄ ceva NECITIT, ca alarma sÄ
                nu redevinÄ mutÄ. La zero necitite, vitrina rÄmĂ˘ne curatÄ. */}
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
            {/* â€žDistribuie" ASCUNS din barÄ (ordinul ownerului, 14 aug, seara:
                â€ždistribuie ascunde") â€” panoul + linkurile de share rÄmĂ˘n Ă®n
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
            {/* â€žTokenuri" ASCUNS din barÄ (ordinul ownerului, 14 aug, seara:
                â€žtokenuri ascunde") â€” panoul + rutele rÄmĂ˘n Ă®n cod; creierul
                vede cheile prin admin_vezi Â«env-checkÂ» + tokenChecks; tabul se
                mai poate deschide doar prin voce (initialTab), nu din vitrinÄ. */}
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
            {/* NotificÄri: ASCUNS COMPLET (ordinul ownerului, 14 aug, seara:
                â€žascunde notificÄrile; tot ce ai ascuns creierul trebuie sÄ le
                vadÄ"). ExcepČ›ia veche â€žreapare la necitite" a fost scoasÄ la
                cererea lui. Creierul le vede Ă®n continuare prin admin_vezi
                (Â«notificariÂ»), iar alarmele (creier cÄzut, ordin mort, PR gata)
                se scriu tot acolo â€” panoul se mai deschide doar prin voce. */}
          </div>
          {/* NotificÄrile pe telefon: anunČ›urile santinelei (â€žPR gata") Č™i
              alarmele ajung la owner Č™i cĂ˘nd NU e pe site â€” Web Push, pornit
              conČ™tient de aici (browserul oricum cere permisiunea lui). */}
          <button
            type="button"
            className="ghost"
            disabled={pushBusy || push === 'nesuportat' || push === 'refuzat'}
            title={
              push === 'refuzat'
                ? 'NotificÄrile sunt blocate din setÄrile browserului â€” deblocheazÄ-le acolo Ă®ntĂ˘i.'
                : push === 'nesuportat'
                  ? 'Browserul Ästa nu Č™tie Web Push.'
                  : 'AnunČ›urile de panou (PR gata, alarme) vin Č™i pe telefonul Ästa.'
            }
            onClick={() => void comutaPush()}
          >
            {pushBusy
              ? 'đź”” â€¦'
              : push === 'activ'
                ? 'đź”” Pe telefon: pornit'
                : push === 'refuzat'
                  ? 'đź”• blocat din browser'
                  : push === 'nesuportat'
                    ? 'đź”• indisponibil aici'
                    : 'đź”” PorneČ™te pe telefon'}
          </button>
          <BackLink onBack={onClose} />
        </header>
        {/* CREDITELE AI, SUS ĂŽN ADMIN (Adrian, 10 aug: â€žmutÄ pastilele AI sub
            admin"): Serper + Gemini + editarea creditului Gemini declarat â€” mutate
            din bara de sus. Bara Č›ine doar VPS-ul. */}
        <CreditAICard brainCredit={brainCredit} />
        {tab === 'finance' && (
          <section className="admin-finance">
            {/* BECURILE DE CREDIT AI, SUS (owner, 13 aug): unde are nevoie de
                credit se vede din prima â€” roČ™u = fÄrÄ, click = reĂ®ncÄrcare. */}
            <BecuriCredit />
            {/* TREI STÄ‚RI, NU DOUÄ‚ (auditul admin, 3 aug): o citire EČUATÄ‚ nu
            mai e deghizatÄ Ă®n â€žSe Ă®ncarcÄâ€¦" fÄrÄ sfĂ˘rČ™it â€” se declarÄ. */}
            {!finance && !financeFailed && <p className="chat-hint">{A.loading}</p>}
            {!finance && financeFailed && (
              <p className="chat-hint" style={{ color: '#e6a23c' }}>
                âš  Nu pot citi datele de bani â€” citirea a eČ™uat (nu e o Ă®ncÄrcare). ReĂ®ncerc automat la 15s.
              </p>
            )}
            {finance && financeFailed && (
              <p className="chat-hint" style={{ color: '#e6a23c' }}>
                âš  Ultima reĂ®mprospÄtare a picat â€” cifrele de mai jos sunt ultimele citite cu succes.
              </p>
            )}
            {finance && (
              <>
                {/* â”€â”€ THE MONEY PANEL, CLEANED (Adrian, Jul 30: â€žsimplify the page,
                keep only what we useâ€ť) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
                What it was: the same figures written two-three times. â€žStripe â€”
                availableâ€ť appeared both as a big card on top and as a row in the
                wallet. The brain's balance appeared twice â€” in dollars on top, in
                pounds below (â€žCredit la creierâ€ť). The card wallet, likewise, in two
                places. And â€žConsumat la AI (real)â€ť was exactly the sum of the
                â€žCost per AIâ€ť table below. From 4 cards + 2 blocks, ONE single place
                remains, saying how much you have, each figure exactly once. */}
                {/* â€žPUNGA" A MURIT DE TOT (3 aug â€” extirparea totalÄ): punga ERA
                soldul contului OpenRouter, iar furnizorul a fost scos din
                aplicaČ›ie cu totul. Nu mai existÄ un sold de citit, deci nici o
                cifrÄ de desenat â€” o pastilÄ cu un â€ž$0.00" fabricat ar fi exact
                minciuna interzisÄ de regula #1. Starea creierului (Gemini) se
                vede pe pastila Gemini din barÄ. */}
                {/* THE GUARD THAT KILLED THE PANEL (Adrian, Aug 2: â€žmai jos nu
                mai e nimic"): this block was gated on `expenses` â€” a field
                built in stripe.ts that silently DIED when Stripe was removed
                (#624). Since Aug 1 the payment reader, the autonomy row, the
                proofs and the pause were ALL invisible. The status readings
                gate on `circuit` now; only the provider row needs expenses. */}
                {circuit && (
                  <div className="or-wallet">
                    <div className="or-wallet-main">
                      <span className="or-wallet-label">Furnizorii plÄtiČ›i cu cardul tÄu</span>
                    </div>
                    {/* AUTOMATIC PAYMENT CREDITING (Adrian, Jul 30). Revolut Pro has no
                    webhook, so the app reads the transactions itself and matches the
                    unique code. The state is SHOWN, because â€žI can't read the accountâ€ť
                    and â€žnobody paidâ€ť look identical if you stay silent â€” exactly the
                    confusion that cost a day. */}
                    {circuit?.citirePlati && (
                      <span className="or-wallet-sub" style={{ color: circuit.citirePlati.ok ? undefined : '#e6a23c' }}>
                        {circuit.citirePlati.ok ? 'âś…' : 'âš '} Citirea plÄČ›ilor Revolut:{' '}
                        {circuit.citirePlati.detaliu}
                      </span>
                    )}
                    {/* CALEA REALÄ‚ pe Pro (auditul admin, 3 aug): serverul trimitea
                    citirePlatiEmail â€” cititorul mailurilor â€žAi primit â€¦" din Gmail,
                    calea de creditare care CHIAR merge din 3 aug â€” dar nimeni n-o
                    desena: ownerul nu putea deosebi â€žnimeni n-a plÄtit" de â€žnu pot
                    citi inboxul". AceleaČ™i reguli de culoare ca rĂ˘ndul de sus. */}
                    {circuit?.citirePlatiEmail && (
                      <span className="or-wallet-sub" style={{ color: circuit.citirePlatiEmail.ok ? undefined : '#e6a23c' }}>
                        {circuit.citirePlatiEmail.ok ? 'âś…' : 'âš '} Citirea plÄČ›ilor din email (Gmail â€žAi primitâ€¦"):{' '}
                        {circuit.citirePlatiEmail.detaliu}
                      </span>
                    )}
                    {/* LEGAREA CONTULUI REVOLUT (auditul admin, 3 aug): detaliul de
                    mai sus trimitea la â€žAdmin â†’ Money", dar butoanele nu existau â€”
                    rutele /plati/legatura/* n-aveau niciun apelant. ConsimČ›ÄmĂ˘ntul
                    PSD2 (max 90 zile) se porneČ™te/reĂ®nnoieČ™te acum de AICI. */}
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
                              } else setLegMsg(A.revolutLinkStartFailed(j.error ?? 'eroare necunoscutÄ'))
                            })
                            .catch(() => setLegMsg(A.revolutLinkNetworkError))
                        }}
                      >
                        LeagÄ contul Revolut (PSD2)
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
                              else setLegMsg(A.revolutLinkFailed(j.error ?? 'eroare necunoscutÄ'))
                            })
                            .catch(() => setLegMsg(A.revolutLinkNetworkError))
                        }}
                      >
                        Am codul din retur
                      </button>
                      {legMsg && <i> {legMsg}</i>}
                    </span>
                    {/* KELION STARTS BY HIMSELF (Adrian, Jul 30: â€žmake him autonomousâ€ť Â·
                    â€žhis autonomy theme will be doing the whole part with Revolutâ€ť).
                    Here you see the loop's LAST pass: either it started something on
                    its own, or why not. Without this row, â€žhe is autonomousâ€ť would be
                    just another claim of mine. */}
                    {/* THE COST IN PLAIN SIGHT (Adrian, Jul 30). It existed as a tool â€”
                    you had to ask to learn what it costs you. Now it's here, next to
                    the money. It cuts nothing: it shows. */}
                    {circuit?.costReal && (
                      <>
                      <span className="or-wallet-sub">
                        {/* IT SAID â€žHow much it cost, REALâ€ť. That was false for ~90% of the
                        sum: only the brain calls come with the money spelled out by the
                        provider (OpenRouter usage.cost). The rest â€” the voice minutes
                        especially â€” is MY fixed rate multiplied by how long the microphone
                        was on. Adrian, Jul 31: â€žwhere did the $504 figure come from?â€ť
                        Exactly from there, and it had to be written on the figure, not
                        explained afterwards. */}
                        đź’· MÄsurat de furnizor: <b>${circuit.costReal.masurat.toFixed(2)}</b>
                        {' Â· '}estimat de mine (tarife fixe, NU facturi):{' '}
                        <b>${circuit.costReal.estimat.toFixed(2)}</b>
                        {' Â· '}azi ${circuit.costReal.today.toFixed(2)}
                        {Object.keys(circuit.costReal.byKind).length > 0 && (
                          <>
                            {' â€” '}
                            {Object.entries(circuit.costReal.byKind)
                              .sort((a, b) => b[1] - a[1])
                              .slice(0, 4)
                              .map(
                                ([k, v]) =>
                                  `${k} $${v.toFixed(2)}${circuit.costReal!.felul[k] === 'masurat' ? '' : '~'}`,
                              )
                              .join(' Â· ')}
                            {' â€” â€ž~" = estimare'}
                          </>
                        )}
                      </span>
                      {/* FÄ‚RÄ‚ FALLBACK DE MĂ‚NÄ‚ (auditul admin, 3 aug): vechiul
                      â€ž?? 0.35" afiČ™a o cifrÄ scrisÄ Ă®n cod cu aerul uneia citite â€”
                      exact minciuna pe care cĂ˘mpul voiceUsdPerMin existÄ s-o
                      Ă®mpiedice. CĂ˘mp absent â†’ fraza spune cÄ tariful nu s-a citit. */}
                      <span className="or-wallet-sub" style={{ opacity: 0.7 }}>
                        {circuit.voiceUsdPerMin != null
                          ? `Minutele de voce se socotesc cĂ˘t a fost microfonul PORNIT Ă— $${circuit.voiceUsdPerMin.toFixed(2)}/min â€” estimare internÄ, nu factura furnizorului de voce. Suma exactÄ e doar Ă®n contul furnizorului.`
                          : 'Minutele de voce: tariful pe minut nu s-a putut citi de la server â€” nu afiČ™ez o cifrÄ din cod.'}
                      </span>
                      </>
                    )}
                    {/* M7b (8 aug): costul necitit se SPUNE, nu se ascunde â€” Ă®nainte,
                    costReal null fÄcea blocul sÄ disparÄ tÄcut, fix â€žÂŁ0.00"-ul invers. */}
                    {circuit && !circuit.costReal && (
                      <span className="or-wallet-sub">
                        đź’· nu pot citi jurnalul de cost{circuit.costRealMotiv ? `: ${circuit.costRealMotiv}` : ''}
                      </span>
                    )}
                    {/* YOUR LEVER (Adrian: â€žthe 6 are needed, but not brakesâ€ť). The
                    â€žpauza-autonomieâ€ť command existed since Jul 27, but you had to know
                    it by heart. A limit YOU choose is not a barrier; one I impose on
                    you, is. */}
                    {/* LEGEA din 16 aug (ownerul, verbatim: â€žautonomia pe on si
                    scoti posibilitatea sa mai treaca pe off" + â€žGATA"): nu mai
                    existÄ buton, nu mai existÄ stare care se rÄstoarnÄ nevÄzut.
                    DOVADA stÄ pe ecran, pe faČ›Ä â€” cum a arÄtat el. */}
                    <span className="or-wallet-sub">
                      â–¶ Autonomia: PORNITÄ‚ PERMANENT (LEGE, 16 aug) â€” fÄrÄ buton de oprire.
                      FrĂ˘nele tale reale: plafonul zilnic de bani, oprirea pe erori permanente (P27), cheile timerului de promovare.
                    </span>
                    {/* P29: comutatorul VIDEO. Ownerul, 20:58 (â€žtu ai zis sa
                    opresc in admin ca sa genereze video gratis, iti bati joc
                    de mine?"): numele vechi Â«Video plÄtitÂ» l-a Ă®mpins sÄ-l
                    OPREASCÄ‚ atunci cĂ˘nd voia video â€” capcana era eticheta.
                    AdevÄrul, pe faČ›Ä: la Veo NU EXISTÄ‚ gratis (Google
                    factureazÄ pe secundÄ); PORNIT = clipurile tale de admin
                    se genereazÄ (pe banii tÄi la Google); clienČ›ii cu tarif
                    plÄtit merg ORICUM; gratis = doar Google Flow. */}
                    {/* 21:29 (â€žnu mai bine il faci sa genereze? nu ma mai umple
                    de butoane"): cererea EXPLICITÄ‚ â€” a ta sau a unui client
                    plÄtit â€” genereazÄ DIRECT, fÄrÄ niciun buton. Comutatorul
                    de aici a rÄmas doar peste TIMERUL de promovare (singurul
                    care cheltuie nesupravegheat). Google factureazÄ
                    ~0,10 $/secundÄ pe cheia ta; gratis la Veo nu existÄ â€”
                    gratis e doar prin Google Flow (Studioul). */}
                    <span className="or-wallet-sub">
                      đźŽ¬ Clipurile CERUTE (de tine sau de clienČ›i plÄtiČ›i) se genereazÄ DIRECT â€” fÄrÄ butoane.{' '}
                      {circuit?.videoPlatit == null
                        ? 'Timerul de promovare: stare necititÄ.'
                        : circuit.videoPlatit.pornit
                          ? `Timerul de promovare POATE genera singur${circuit.videoPlatit.sursa === 'env' ? ' (din env)' : ''} (pe banii tÄi, sub plafonul de mai jos).`
                          : 'Timerul de promovare NU genereazÄ singur (oprit).'}{' '}
                      <button
                        type="button"
                        className="ghost"
                        disabled={videoBusy}
                        onClick={() => void onVideoPlatit(!(circuit?.videoPlatit?.pornit ?? false))}
                      >
                        {circuit?.videoPlatit?.pornit ? 'OpreČ™te timerul' : 'Permite timerului sÄ genereze'}
                      </button>
                    </span>
                    {/* Diagnoza pe faČ›Ä (21:26, â€žnu vrea sa genereze"): ultima
                    Ă®ncercare REALÄ‚, cu verdictul ei â€” nu se mai ghiceČ™te. */}
                    {circuit?.videoUltimaIncercare && (
                      <span className="or-wallet-sub" style={{ color: circuit.videoUltimaIncercare.ok ? undefined : '#e6a23c' }}>
                        {circuit.videoUltimaIncercare.ok ? 'âś…' : 'âš '} Ultima Ă®ncercare de clip ({new Date(circuit.videoUltimaIncercare.la).toLocaleTimeString()}):{' '}
                        {circuit.videoUltimaIncercare.verdict}
                      </span>
                    )}
                    <PromoStudio />
                    {circuit?.autonomie && (
                      <span className="or-wallet-sub" style={{ color: circuit.autonomie.ok ? undefined : '#8a8f98' }}>
                        {circuit.autonomie.ok ? 'đź¤–' : 'Â·'} Kelion, de capul lui: {circuit.autonomie.detaliu}
                      </span>
                    )}
                    {(circuit.expenses?.length ?? 0) > 0 && (
                    <span className="or-wallet-sub">
                      Unde se schimbÄ cardul, la fiecare:{' '}
                      {(circuit.expenses ?? [])
                        .filter((e) => e.configured)
                        .map((e, i) => (
                          <span key={e.name}>
                            {i > 0 && ' Â· '}
                            {/* WHAT WAS MEASURED on the provider's page, not what someone said:
                            đź” = automatic top-up is on, đź’ł = only a card on file (so NOT done).
                            A provider nobody touched has no sign at all â€” â€žI don't knowâ€ť is
                            never written as â€žnoâ€ť. */}
                            {e.platiAutomate ? 'đź” ' : e.cardPus ? 'đź’ł ' : ''}
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
                {/* GARDUL NU MAI OMOARÄ‚ TOT (auditul admin, 3 aug): cĂ˘nd
                money-circuit picÄ, o spunem â€” nu dispare tÄcut jumÄtate de tab
                (fix tiparul â€žthe guard that killed the panel" din 2 aug, cu
                `circuit` Ă®n locul lui `expenses`). */}
                {!circuit && circuitFailed && (
                  <div className="or-wallet">
                    <span className="or-wallet-sub" style={{ color: '#e6a23c' }}>
                      âš  Nu pot citi circuitul banilor (starea plÄČ›ilor, costul, autonomia) â€” citirea a eČ™uat.
                    </span>
                  </div>
                )}
                {/* DOVEZILE + PLÄ‚ČšILE, ĂŽN AFARA gardului {circuit && â€¦} (auditul
                admin, 3 aug): au surse PROPRII de date (fetchDoveziAutonomie,
                fetchPlati) â€” un money-circuit picat nu are voie sÄ le ascundÄ. */}
                {(dovezi !== null || plati !== 'necitit') && (
                  <div className="or-wallet">
                    {/* THE EIGHT PROOFS. Not a list written by me: each level looks
                    for its own trace in the database â€” an order, a PR, a measurement
                    â€” and says â€žprovenâ€ť ONLY if it found it. What has no proof says
                    what exactly the proof would be. */}
                    {dovezi && (
                      <span className="or-wallet-sub">
                        đźŽŻ Autonomia: <b>{dovezi.dovedite}/{dovezi.din} dovedite</b>
                        {dovezi.dovezi.map((d) => (
                          <span key={d.nivel} style={{ display: 'block', paddingLeft: 12, opacity: d.dovedit ? 1 : 0.65 }}>
                            {d.dovedit ? 'âś…' : 'â¬ś'} <b>{d.nivel}.</b> {d.ce} â€”{' '}
                            {d.dovedit ? d.dovada : <i>{d.dovada || d.cum}</i>}
                          </span>
                        ))}
                      </span>
                    )}
                    {/* Tablou PlÄČ›i & ĂŽncasÄri */}
                    {plati !== 'necitit' && (
                      <span className="or-wallet-sub">
                        đź’ł <b>Tablou PlÄČ›i & ĂŽncasÄri:</b>
                        
                        {/* 1. TOTALURI */}
                        <span style={{ display: 'block', marginTop: 8, marginBottom: 8 }}>
                          <b>đź’° Totaluri ĂŽncasate:</b>{' '}
                          {plati === null || !plati.totaluri ? (
                            <i style={{ color: 'red' }}>nu pot verifica</i>
                          ) : (
                            <span>
                              Azi: <b>{plati.totaluri.totalAzi} {plati.totaluri.moneda}</b> Â· Luna asta: <b>{plati.totaluri.totalLunaAsta} {plati.totaluri.moneda}</b>
                            </span>
                          )}
                        </span>

                        {/* 2. CODURI EMISE ČI NEPLÄ‚TITE */}
                        <span style={{ display: 'block', marginTop: 8, marginBottom: 8 }}>
                          <b>âŹł Coduri Emise Č™i NeplÄtite:</b>
                          {plati === null || plati.coduriNeplatite === null ? (
                            <span style={{ display: 'block', paddingLeft: 12, color: 'red' }}><i>nu pot verifica</i></span>
                          ) : plati.coduriNeplatite.length === 0 ? (
                            <span style={{ display: 'block', paddingLeft: 12, opacity: 0.8 }}>Niciun cod neplÄtit Ă®n aČ™teptare.</span>
                          ) : (
                            plati.coduriNeplatite.map((c) => (
                              <span key={c.code} style={{ display: 'block', paddingLeft: 12, marginTop: 2 }}>
                                {c.expirata ? 'đźź  [ĂŽn aČ™teptare >2h]' : 'âŹł [ĂŽn aČ™teptare]'} <b>{c.code}</b> Â· User: {c.email} Â· SumÄ: {c.amount} {c.currency} Â· De cĂ˘nd: {new Date(c.createdAt).toLocaleString()}
                              </span>
                            ))
                          )}
                        </span>

                        {/* 3. PLÄ‚ČšI ĂŽNCASATE ČI CREDITATE */}
                        <span style={{ display: 'block', marginTop: 8, marginBottom: 8 }}>
                          <b>âś… PlÄČ›i ĂŽncasate Č™i Creditate:</b>
                          {plati === null || plati.platiIncasate === null ? (
                            <span style={{ display: 'block', paddingLeft: 12, color: 'red' }}><i>nu pot verifica</i></span>
                          ) : plati.platiIncasate.length === 0 ? (
                            <span style={{ display: 'block', paddingLeft: 12, opacity: 0.8 }}>Nicio platÄ Ă®ncasatÄ.</span>
                          ) : (
                            plati.platiIncasate.map((p) => (
                              <span key={p.code} style={{ display: 'block', paddingLeft: 12, marginTop: 2 }}>
                                âś… <b>{p.code}</b> Â· User: {p.email} Â· SumÄ: {p.amount} {p.currency} Â· Data: {new Date(p.paidAt).toLocaleString()} Â· Ref bancarÄ: {p.bankRef || 'â€”'}
                              </span>
                            ))
                          )}
                        </span>

                        {/* 4. PLÄ‚ČšI NEATRIBUITE (PLASA) */}
                        <span style={{ display: 'block', marginTop: 8, marginBottom: 8 }}>
                          <b>đź•¸ PlÄČ›i Neatribuite (Ă®n plasÄ):</b>
                          {plati === null || plati.neatribuite === null ? (
                            <span style={{ display: 'block', paddingLeft: 12, color: 'red' }}><i>nu pot verifica</i></span>
                          ) : plati.neatribuite.length === 0 ? (
                            <span style={{ display: 'block', paddingLeft: 12, opacity: 0.8 }}>Nimic Ă®n plasÄ (nicio platÄ neatribuitÄ).</span>
                          ) : (
                            plati.neatribuite.map((p) => (
                              <span key={p.id} style={{ display: 'block', paddingLeft: 12, marginTop: 2 }}>
                                {p.amount} {p.currency || 'ÂŁ'} Â· â€ž{p.referinta || p.bankRef || 'â€”'}â€ť Â· VÄzut la: {new Date(p.seenAt).toLocaleString()}{' '}
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
                    total to ÂŁ while "azi" stayed in $ â€” the mixed "total ÂŁ163.66,
                    azi $0.02" Adrian flagged. The split "mÄsurat / estimare
                    internÄ" is written on the head too, so a number without its
                    kind is never read as an invoice. */}
                    Cost per AI â€” total ${finance.spentUsd.toFixed(2)}
                    {` (mÄsurat $${finance.masurat.toFixed(2)} Â· estimare internÄ $${finance.estimat.toFixed(2)})`}
                    , azi ${finance.today.toFixed(2)}
                    {/* RESETTING THE COUNTERS (Adrian, Jul 30). Deletes ONLY our
                        provider-cost journal. The users' wallets are NOT touched: spent
                        credits are never given back. The wallet has nothing to reset â€” it
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
                        // butonul ieČ™ea tÄcut din â€žâ€¦" Č™i adminul nu afla cÄ
                        // resetarea NU s-a fÄcut.
                        const r = await fetch('/api/admin/reset-counters', { method: 'POST', credentials: 'include' }).catch(() => null)
                        // ČI CORPUL (mÄsurat 8 aug): un DELETE picat rÄspundea
                        // 200 cu `{ok:false, sterse:0}`, deci `r.ok` era true Č™i
                        // aici scria â€žResetat âś“" peste contoare neatinse. Acum
                        // serverul dÄ 502 la eČ™ec, iar aici se citeČ™te cifra.
                        const j = (await r?.json().catch(() => null)) as
                          | { ok?: boolean; sterse?: number; error?: string }
                          | null
                        setResetMsg(
                          r?.ok && j?.ok === true
                            ? `Resetat âś“ (${j.sterse ?? 0} Ă®nregistrÄri Č™terse)`
                            : `Nu s-a putut reseta${j?.error ? ` â€” ${j.error}` : ''} â€” reĂ®ncearcÄ.`,
                        )
                        await fetchFinance().then((f) => { if (f) setFinance(f) }).catch(() => {})
                        setResetBusy(false)
                      }}
                    >
                      {resetBusy ? 'â€¦' : 'Pune pe 0'}
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
                        {/* THE GOLDEN RULE (Adrian: â€žREAL, stop fabricating"):
                        a shown figure is either MEASURED (the provider's own
                        number / DB recordCost from its response) or it says
                        â€žestimare internÄ" right next to it. The voice minutes
                        are the big one: mic-on seconds Ă— a fixed rate â€” never
                        the OpenAI invoice. */}
                        {finance.felul[k] === 'estimat' && (
                          <span className="fin-sub" style={{ color: '#e6a23c' }}>
                            {' '}â€” estimare internÄ
                          </span>
                        )}
                      </span>
                      <span>${v.toFixed(4)}</span>
                    </div>
                  ))}
                </div>
                {/* THE STRIPE BLOCK â€” REMOVED (Adrian, Jul 31: â€žthese don't exist
                    anymoreâ€ť Â· â€žStripe doesn't exist anymoreâ€ť Â· â€žwe only have Revolutâ€ť).
                    The only payment channel is Revolut, by card. The old Jul 24 rows
                    were his own tests, from his own accounts, paid with his own card â€”
                    not revenue from clients. They stay in the database (`transactions`),
                    but no longer belong in the panel: they showed a dead channel as if
                    it were alive. */}
              </>
            )}
          </section>
        )}
        {tab === 'stores' && (
          <section className="admin-finance">
            {/* TREI STÄ‚RI (auditul admin, 3 aug): citirea picatÄ nu mai stÄ
            deghizatÄ Ă®n â€žSe verificÄ magazinele liveâ€¦" pe veci. */}
            {stores === 'necitit' && <p className="chat-hint">{A.checkingStores}</p>}
            {stores === null && (
              <p className="chat-hint" style={{ color: '#e6a23c' }}>
                âš  Nu am putut citi magazinele â€” citire eČ™uatÄ, nu magazine lipsÄ.{' '}
                <button
                  type="button"
                  className="ghost"
                  onClick={() => {
                    setStores('necitit')
                    void fetchStores().then(setStores)
                  }}
                >
                  ReĂ®ncearcÄ
                </button>
              </p>
            )}
            {storesData && (
              <>
                <div className="fin-breakdown">
                  <div className="fin-breakdown-head">
                    Magazine â€” verificare LIVE pe paginile publice (nu pe promisiunile
                    dashboard-urilor), la maxim 5 minute vechime.
                  </div>
                  {storesData.stores.map((s) => (
                    <div className="fin-row" key={s.key}>
                      <span>
                        {s.name} â€” {s.store}
                      </span>
                      <span>
                        {s.listed ? (
                          <a href={s.url} target="_blank" rel="noreferrer" className="store-live">
                            â—Ź LISTAT â€” deschide
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
                    {/* TEXT CORECTAT (auditul admin, 3 aug): vechiul â€žprin
                    API-urile lor" sugera cÄ aplicaČ›ia citeČ™te instalÄrile din
                    magazine â€” niciun cod nu cheamÄ vreun API de magazin. */}
                    DescÄrcÄri directe de pe site (numÄrate de serverul nostru â€” cifre reale).
                    Magazinele Ă®Č™i aratÄ instalÄrile doar agregat, Ă®n propriile dashboard-uri;
                    aplicaČ›ia NU le citeČ™te â€” aici sunt numÄrate doar descÄrcÄrile directe.
                  </div>
                  {/* dbOk=false = jurnalul NU s-a citit (auditul admin, 3 aug) â€”
                  nu se afiČ™eazÄ zeroul fals â€žnicio descÄrcare". */}
                  {!storesData.downloads.dbOk && (
                    <div className="chat-hint" style={{ color: '#e6a23c' }}>
                      âš  Nu pot citi jurnalul de descÄrcÄri â€” baza de date nu rÄspunde (NU Ă®nseamnÄ zero descÄrcÄri).
                    </div>
                  )}
                  {storesData.downloads.dbOk && storesData.downloads.counts.length === 0 && (
                    <div className="chat-hint">
                      Nicio descÄrcare Ă®nregistratÄ Ă®ncÄ (jurnalul porneČ™te de la acest release).
                    </div>
                  )}
                  {storesData.downloads.counts.map((c) => (
                    <div className="fin-row" key={c.file}>
                      <span>{c.file}</span>
                      <span>{c.total} descÄrcÄri</span>
                    </div>
                  ))}
                </div>
                {storesData.downloads.recent.length > 0 && (
                  <div className="fin-breakdown">
                    <div className="fin-breakdown-head">{A.downloadsHead}</div>
                    {storesData.downloads.recent.map((d, i) => (
                      <div className="fin-row" key={i}>
                        <span>
                          {d.user_email || `${d.ip}${d.country ? ` Â· ${d.country}` : ''} (nelogat)`}
                        </span>
                        <span>
                          {d.file} Â·{' '}
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
                  {/* TEXT CORECTAT (auditul admin, 3 aug): vechiul â€žtoate mesajele"
                  era fals â€” aici se citeČ™te DOAR folderul INBOX, iar pollerul
                  rĂ˘ndului 19 (MAIL_ORGANIZE) mutÄ mesajele procesate Ă®n
                  Kelion-Answered / Kelion-ToAnswer / Kelion-Automated Ă®n ~3 min.
                  Un mesaj â€ždispÄrut" de aici e de regulÄ ARHIVAT acolo, nu pierdut
                  (defectul din 10 iul, reintrodus de organizare). */}
                  đź“¬ Cutia contact@kelionai.app â€” DOAR folderul INBOX, citit direct din
                  server (ultimele 40, citite sau nu). Mesajele deja procesate de Secretar
                  stau Ă®n folderele Kelion-Answered / Kelion-ToAnswer / Kelion-Automated
                  (vizibile Ă®n clientul de mail). BifeazÄ Č™i Č™terge â€” una sau mai multe
                  odatÄ; serverul le mutÄ Ă®n coČ™ul cÄsuČ›ei cĂ˘nd acesta existÄ.
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
                      {mailboxData && mailSel.size === mailboxData.emails.length && mailboxData.emails.length > 0 ? 'DeselecteazÄ tot' : 'SelecteazÄ tot'}
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
                      {mailDelBusy ? 'â€¦' : `Čterge selectate (${mailSel.size})`}
                    </button>
                  )}
                </span>
              </div>
              {mailDelMsg && <div className="chat-hint">{mailDelMsg}</div>}
              {mailboxLoading && <p className="chat-hint">{A.readingMailbox}</p>}
              {/* TREI STÄ‚RI DISTINCTE (auditul admin, 3 aug): â€žgoalÄ", â€žIMAP a
              picat: {motiv}" Č™i â€žMAIL_PASS nesetat" nu mai sunt un singur text. */}
              {!mailboxLoading && mailboxLive === null && (
                <p className="chat-hint" style={{ color: '#e6a23c' }}>
                  âš  {A.mailboxReadFail.replace('{motiv}', 'ruta serverului nu a rÄspuns')}
                </p>
              )}
              {!mailboxLoading && mailboxData && !mailboxData.ok && (
                <p className="chat-hint" style={{ color: '#e6a23c' }}>
                  âš {' '}
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
                        title="SelecteazÄ pentru Č™tergere"
                      />
                      {m.fromName ? `${m.fromName} <${m.from}>` : m.from || '(expeditor necunoscut)'}
                    </span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      <span className={`inbox-flag ${m.seen ? 'ok' : 'wait'}`}>
                        {m.seen ? 'citit' : 'â—Ź necitit'}
                      </span>
                      <button
                        type="button"
                        className="ghost"
                        style={{ fontSize: 12, color: '#ff7a7a' }}
                        disabled={mailDelBusy}
                        onClick={() => stergeMailuri([m.uid])}
                        title="Čterge acest mesaj"
                      >
                        âś•
                      </button>
                    </span>
                  </div>
                  <div className="inbox-subj">{m.subject || '(fÄrÄ subiect)'}</div>
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
                Mesaje din formularul â€žContact" â€” salvate MEREU aici, chiar dacÄ
                emailul (MAIL_PASS) nu e configurat. Niciun mesaj nu se mai pierde.
              </div>
              {contactMsgs === 'necitit' && <p className="chat-hint">{A.loading}</p>}
              {contactMsgs === null && (
                <p className="chat-hint" style={{ color: '#e6a23c' }}>
                  âš  Nu am putut citi mesajele de contact â€” citire eČ™uatÄ (posibil sesiune expiratÄ), nu listÄ goalÄ.
                </p>
              )}
              {contactData && contactData.length === 0 && (
                <p className="chat-hint">{A.noContactMessagesYet}</p>
              )}
              {(contactData ?? []).map((m) => (
                <div className="inbox-item" key={m.id}>
                  <div className="inbox-top">
                    <span className="inbox-from">
                      {m.name || '(fÄrÄ nume)'} &lt;{m.email}&gt;
                    </span>
                    {/* `emailed` e acum MÄ‚SURAT (auditul admin, 3 aug): devine
                    true doar dupÄ ce sendMail chiar a raportat succes â€” vechea
                    etichetÄ âś‰ď¸Ź se scria Ă®nainte de orice trimitere. */}
                    <span className={`inbox-flag ${m.emailed ? 'ok' : 'wait'}`}>
                      {m.emailed ? 'âś‰ď¸Ź redirecČ›ionat pe email' : 'đź“Ą doar salvat (trimiterea a picat sau email off)'}
                    </span>
                  </div>
                  <div className="inbox-subj">
                    {m.department ? `[${m.department}] ` : ''}
                    {m.subject || '(fÄrÄ subiect)'}
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
                Inbox contact@kelionai.app â€” emailurile PRIMITE Č™i rÄspunsul redactat
                automat de Secretar (row 19). Se citesc la fiecare 3 minute.
              </div>
              {inbound === 'necitit' && <p className="chat-hint">{A.loading}</p>}
              {inbound === null && (
                <p className="chat-hint" style={{ color: '#e6a23c' }}>
                  âš  Nu am putut citi scrisorile â€” citire eČ™uatÄ (posibil sesiune expiratÄ), nu listÄ goalÄ.
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
                      {m.replied ? 'âś… rÄspuns trimis' : 'âŹł fÄrÄ rÄspuns'}
                    </span>
                  </div>
                  <div className="inbox-subj">{m.subject || '(fÄrÄ subiect)'}</div>
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
                Amprente vocale Ă®nregistrate â€” identificare speaker + gen detectat
              </div>
              {voiceprintsLoading && (voiceprints?.length ?? 0) === 0 && (
                <div className="chat-hint">{A.loading}</div>
              )}
              {/* null = citirea a PICAT (auditul admin, 3 aug) â€” nu se afiČ™eazÄ
              â€žNicio amprentÄ": ownerul ar crede cÄ amprenta lui a dispÄrut. */}
              {!voiceprintsLoading && voiceprints === null && (
                <div className="chat-hint" style={{ color: '#e6a23c' }}>
                  âš  Nu am putut citi lista amprentelor â€” citire eČ™uatÄ, nu listÄ goalÄ (reĂ®ncerc la 10s).
                </div>
              )}
              {!voiceprintsLoading && voiceprints !== null && voiceprints.length === 0 && (
                <div className="chat-hint">{A.noVoiceprintsYet}</div>
              )}
              {vpMsg && <div className="chat-hint" style={{ color: '#e6a23c' }}>{vpMsg}</div>}
              {(voiceprints ?? []).map((v) => (
                <div className="fin-row" key={v.email}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {/* THE PAIRED FACE (Adrian, Aug 1: â€žvoiceprint paired with an
                    image capture â€” why wasn't it done?â€ť). It WAS â€” saved in
                    faceprints since Jul â€” only INVISIBLE. Now shown, so the pair
                    voice+face is seen at a glance. */}
                    {v.hasFace ? (
                      <img
                        src={v.facePhoto}
                        alt={`FaČ›a lui ${v.name || v.email}`}
                        title="Captura de imagine Ă®mperecheatÄ cu amprenta vocalÄ"
                        style={{ width: 44, height: 44, borderRadius: 8, objectFit: 'cover', border: '1px solid rgba(255,255,255,0.15)' }}
                      />
                    ) : (
                      <span
                        className="muted"
                        title="FÄrÄ capturÄ Ă®ncÄ â€” se face singurÄ la prima turÄ cu camera pornitÄ"
                        style={{ width: 44, height: 44, borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: '1px dashed rgba(255,255,255,0.2)', fontSize: 18 }}
                      >
                        ?
                      </span>
                    )}
                    <strong>{v.name || v.email}</strong>
                    {' Â· '}
                    <span className={`vis-badge ${v.isAdmin ? 'kind-demo' : 'human'}`}>
                      {v.isAdmin ? 'ADMIN' : 'USER'}
                    </span>
                    {' Â· '}
                    <span>
                      gen: {v.gender === 'male' ? 'bÄrbat' : v.gender === 'female' ? 'femeie' : 'necunoscut'}
                    </span>
                  </span>
                  <span>
                    {new Date(v.updatedAt).toLocaleString('ro-RO', {
                      day: 'numeric',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                    {' Â· '}
                    {v.hasAudio ? (
                      <button
                        type="button"
                        className="ghost"
                        title={A.playVoiceSample}
                        onClick={() => void playVoiceprint(v.email)}
                      >
                        {playingVp === v.email ? 'âŹ¸ opreČ™te' : 'â–¶ ascultÄ'}
                      </button>
                    ) : (
                      <span className="muted" title={A.noVoiceSampleYet}>
                        fÄrÄ audio
                      </span>
                    )}
                    {' Â· '}
                    {/* BUTONUL â€žČ™terge" A FOST SCOS (ordinul ownerului, 14 aug:
                        â€žamprentele vocale trebuie sÄ se pÄstreze"). Serverul
                        oricum refuzÄ (ruta 403 + triggerul din Postgres) â€” un
                        buton care promite o Č™tergere imposibilÄ ar fi afiČ™aj
                        fals. ĂŽn loc, starea pe faČ›Ä: */}
                    <span className="muted" title={A.voiceprintKeptTitle}>
                      {A.voiceprintKept}
                    </span>
                  </span>
                </div>
              ))}
            </div>
            <div className="fin-breakdown" style={{ marginTop: 12 }}>
              {/* STAREA REALÄ‚, NU RECLAMA (auditul admin, 3 aug): backend-ul e
              DEZARMAT hard (adminLock.ts, LACAT_DEZARMAT=true â€” cererea
              ownerului, 31 iul), deci serverul rÄspunde mereu armed:false.
              Vechiul formular promitea â€žArmeazÄ lacÄtul â€¦ butonul Admin cere
              de-acum vocea ta sau secretul" â€” fals: nu cerea nimic, niciodatÄ.
              Acum: starea cititÄ se afiČ™eazÄ CUM E, iar null (citire picatÄ)
              nu se mai preface â€žnearmat". */}
              <div className="fin-breakdown-head">
                LacÄtul butonului Admin â€”{' '}
                {lockArmed === 'necitit'
                  ? 'se citeČ™te stareaâ€¦'
                  : lockArmed === null
                    ? 'nu am putut citi starea (citire eČ™uatÄ â€” redeschide tabul)'
                    : lockArmed
                      ? 'ARMAT âś“: butonul se deschide doar cu amprenta ta vocalÄ sau cu secretul'
                      : 'DEZARMAT la cererea ta (31 iul): butonul Admin intrÄ direct, fÄrÄ voce/secret'}
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
                  placeholder="Secretul de activare (min. 4 caractere) â€” pÄstrat pentru rearmare"
                  autoComplete="new-password"
                  style={{ flex: 1, minWidth: 0 }}
                />
                <button type="submit" className="ghost">
                  SalveazÄ secretul
                </button>
              </form>
              {lockMsg && <div className="chat-hint">{lockMsg}</div>}
              <div className="chat-hint">
                Dezarmarea e o constantÄ Ă®n cod (decizia ta din 31 iul: â€žscoate aprobarea complet").
                Secretul salvat aici rÄmĂ˘ne pregÄtit; ca sÄ REARMEZI lacÄtul, cere-mi Ă®n chat
                â€žreporneČ™te lacÄtul admin" â€” e o linie de cod + deploy. CĂ˘t e dezarmat, sesiunea
                de admin e singurul factor de acces.
              </div>
            </div>
          </section>
        )}
        {tab === 'recuperare' && (
          <section className="admin-finance">
            <div className="fin-breakdown">
              <div className="fin-breakdown-head">
                Recuperare â€” versiunile salvate ale aplicaČ›iei (tag-uri git, oglindite pe serverul
                Linux ca .bundle + .tar.gz). Fiecare e recuperabilÄ integral.
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
                  SalveazÄ versiunea curentÄ
                </button>
              </form>
              {recoveryMsg && <div className="chat-hint">{recoveryMsg}</div>}
            </div>
            <div className="fin-breakdown" style={{ marginTop: 12 }}>
              <div className="fin-breakdown-head">Versiuni salvate ({recoveryPoints.length})</div>
              {recoveryLoading && recoveryPoints.length === 0 && <div className="chat-hint">{A.loading}</div>}
              {/* EČECUL SE DECLARÄ‚ (auditul admin, 3 aug): â€žNicio versiune
              salvatÄ Ă®ncÄ" rÄmĂ˘ne DOAR pentru o listÄ confirmatÄ goalÄ. */}
              {!recoveryLoading && recoveryFailed && (
                <div className="chat-hint" style={{ color: '#e6a23c' }}>
                  âš  Nu am putut citi versiunile â€” citire eČ™uatÄ (GITHUB_TOKEN lipsÄ sau GitHub n-a rÄspuns), NU listÄ goalÄ.{' '}
                  <button type="button" className="ghost" onClick={loadRecovery}>
                    ReĂ®ncearcÄ
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
                    {' Â· '}
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
                      {restoringTag === p.tag ? 'Restaurezâ€¦' : 'RestaureazÄ'}
                    </button>
                  </span>
                </div>
              ))}
              <div className="chat-hint">
                â€žRestaureazÄ" aduce aplicaČ›ia EXACT la versiunea aleasÄ (commit nou pe master â€”
                nimic nu se pierde din istoric) Č™i republicÄ automat pe server. Rezerve manuale:
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
                  â€žVPS Ă®l pui sub admin, vizibil"). AceleaČ™i mÄsurÄtori ca pastila
                  veche: RAM liber + Ă®ncÄrcarea (raport la nuclee), roČ™u la acelaČ™i
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
                        ĂŽncÄrcare: <b>{(v.incarcarePct / 100).toFixed(1)}Ă—</b> pe {v.procesoare} nuclee
                      </span>
                      <span className="vps-cifra vps-load">
                        load: {v.incarcare.map((n) => n.toFixed(2)).join(' / ')}
                      </span>
                      {critic && <span className="vps-alarma">âš  critic</span>}
                    </div>
                  )
                })()
              ) : (
                <div className="vps-resurse">
                  <span className="vps-cifra">âš  VPS necitibil (nu s-au putut mÄsura RAM/Ă®ncÄrcarea acum)</span>
                </div>
              )}
              <p className="chat-hint" style={{ marginTop: 8 }}>
                DeclanČ™eazÄ fluxurile de restart pentru aplicaČ›ie Č™i Caddy. DureazÄ cĂ˘teva secunde.
              </p>
              <button
                className="ghost"
                style={{ marginTop: 12 }}
                onClick={async () => {
                  if (!confirm('EČ™ti sigur cÄ vrei sÄ resetezi VPS-ul (aplicaČ›ia Č™i serverul web)?')) return
                  try {
                    const res = await fetch('/api/admin/reset-vps', {
                      method: 'POST',
                      credentials: 'include'
                    })
                    // CORPUL, nu doar statusul (mÄsurat 8 aug): serverul Ă®ntorcea
                    // `{ok:true}` chiar Č™i cĂ˘nd GitHub refuzase declanČ™area, deci
                    // aici scria â€žtrimisÄ cu succes" pentru o repornire care nu
                    // pornise. Acum rÄspunsul poartÄ fiecare pas, cu motivul lui.
                    const j = (await res.json().catch(() => null)) as
                      | { ok?: boolean; pasi?: { runbook: string; ok: boolean; detaliu: string }[] }
                      | null
                    if (res.ok && j?.ok === true) {
                      alert(`Repornire pornitÄ: ${(j.pasi ?? []).map((p) => p.runbook).join(', ')}`)
                    } else {
                      const motiv = (j?.pasi ?? []).find((p) => !p.ok)?.detaliu ?? `HTTP ${res.status}`
                      alert(`Resetarea NU a pornit: ${motiv}`)
                    }
                  } catch (e) {
                    // Eroarea era PRINSÄ‚ Č™i ARUNCATÄ‚: omul vedea â€žeroare de reČ›ea"
                    // orice s-ar fi Ă®ntĂ˘mplat, iar cauza realÄ dispÄrea. Acum
                    // motivul ajunge la el Č™i Ă®n consolÄ, ca sÄ se poatÄ repara.
                    const motiv = e instanceof Error ? e.message : String(e)
                    console.error('[reset-vps]', e)
                    alert(`Eroare la trimiterea comenzii de resetare: ${motiv}`)
                  }
                }}
              >
                Reset VPS
              </button>
            </div>

            {/* â”€â”€ AUTOVERIFICAREA INTELIGENTÄ‚ (owner, 19 aug: â€žceva inteligent bazat
                pe AI" + â€žverificÄ Č™i DE CE nu merge"). Kelion se testeazÄ SINGUR pe
                TOATE funcČ›iile din registrul unic: citirile probate REAL, funcČ›iile
                cu efect verificate fÄrÄ sÄ le execute (dry-run), iar pe cele picate
                creierul dÄ cauza + recomandarea fermÄ. Verdictul e MÄ‚SURAT (regula
                #1): â€žnu pot verifica" cinstit, niciodatÄ â€žmerge" fabricat. */}
            <div className="fin-breakdown" style={{ marginTop: 16 }}>
              <div className="fin-breakdown-head">Autoverificare inteligentÄ</div>
              <p className="chat-hint" style={{ marginTop: 8 }}>
                Kelion se testeazÄ pe el Ă®nsuČ™i pe toate funcČ›iile Č™i spune, pentru fiecare care nu
                merge, <b>de ce</b> Č™i ce e de fÄcut. DureazÄ cĂ˘teva secunde (probeazÄ real citirile).
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
                      setAvEroare('RÄspuns necitibil de la server (nu pot afiČ™a un raport pe care nu l-am mÄsurat).')
                      setAvRaport(null)
                      return
                    }
                    setAvRaport(j)
                  } catch (e) {
                    // Regula #1: eroarea realÄ ajunge la om, nu o mascÄm.
                    const motiv = e instanceof Error ? e.message : String(e)
                    console.error('[autoverificare]', e)
                    setAvEroare(`Eroare la autoverificare: ${motiv}`)
                    setAvRaport(null)
                  } finally {
                    setAvBusy(false)
                  }
                }}
              >
                {avBusy ? 'Verific toate funcČ›iileâ€¦' : 'đź§Ş VerificÄ toate funcČ›iile'}
              </button>

              {avEroare && (
                <p className="chat-hint" style={{ marginTop: 10, color: '#e0603a' }}>
                  âš  {avEroare}
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
                      // ĂŽntĂ˘i ce nu merge (stricate, apoi nu-pot-verifica), apoi ce merge.
                      .slice()
                      .sort((a, b) => rangVerdict(a.verdict) - rangVerdict(b.verdict))
                      .map((f) => {
                        const c =
                          f.verdict === 'merge' ? '#2e9e5b' : f.verdict === 'stricat' ? '#e0603a' : '#c79218'
                        const et =
                          f.verdict === 'merge' ? 'âś“ merge' : f.verdict === 'stricat' ? 'âś— stricat' : 'â€¦ nu pot verifica'
                        return (
                          <li
                            key={f.functie}
                            style={{ borderLeft: `3px solid ${c}`, paddingLeft: 10 }}
                          >
                            <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                              <b>{f.functie}</b>
                              <span style={{ color: c, fontSize: '0.85em' }}>{et}</span>
                              <span className="chat-hint" style={{ fontSize: '0.8em' }}>
                                {f.tip === 'efect' ? '(cu efect â€” dry-run)' : '(citire â€” probat real)'}
                              </span>
                            </div>
                            <div className="chat-hint" style={{ fontSize: '0.85em' }}>{f.face}</div>
                            {f.verdict !== 'merge' && (
                              <div style={{ fontSize: '0.85em', marginTop: 2 }}>
                                <span style={{ color: c }}>De ce:</span> {f.deCe}
                                {f.recomandare && (
                                  <>
                                    {' '}
                                    <span style={{ color: c }}>â†’</span> <b>{f.recomandare}</b>
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
                Erori â€” ce e fiecare, Ă®n clar. Kelion le vede Č™i el Ă®n creier (le poČ›i Ă®ntreba Ă®n chat:
                â€žce e eroarea asta?").
                {eroriBusy && <span className="chat-hint"> Â· se Ă®ncarcÄâ€¦</span>}
              </div>
              {erori === 'necitit' && <p className="chat-hint">Se Ă®ncarcÄâ€¦</p>}
              {erori === null && (
                <p className="chat-hint" style={{ color: '#e6a23c' }}>
                  âš  Nu pot citi erorile â€” citirea a eČ™uat (NU Ă®nseamnÄ â€žzero erori"). ReĂ®ncerc automat la 20s.
                </p>
              )}
              {erori && erori !== 'necitit' && (
                <>
                  {erori.sistem.length === 0 && erori.browser.length === 0 && (
                    <p className="chat-hint" style={{ marginTop: 8 }}>
                      Nicio eroare Ă®n ultimele 48h. đźŽ‰
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
                          meta={`Ă—${e.cate}${e.cine ? ` Â· ${e.cine}` : ''}`}
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
                NotificÄri â€” cereri noi care cer atenČ›ia ta (platÄ neatribuitÄ, cerere neacoperitÄ).
              </div>
              {notificari === 'necitit' && <p className="chat-hint">Se Ă®ncarcÄâ€¦</p>}
              {notificari === null && (
                <p className="chat-hint" style={{ color: '#e6a23c' }}>
                  âš  Nu pot citi notificÄrile â€” citirea a eČ™uat (NU Ă®nseamnÄ â€žzero"). ReĂ®ncerc automat la 20s.
                </p>
              )}
              {Array.isArray(notificari) && notificari.length === 0 && (
                <p className="chat-hint" style={{ marginTop: 8 }}>
                  Nicio cerere nouÄ. đźŽ‰
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
                          MarcheazÄ citit
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
                {/* TEXT ADUS LA REALITATE (auditul buton-cu-buton, 14 aug): â€žiar
                    merge-ul Ă®l dai tu" nu mai era adevÄrat â€” poarta de pe VPS
                    Ă®mbinÄ SINGURÄ‚ PR-urile de constructor verzi, iar santinela
                    Ă®mbinÄ Č™i restul cĂ˘nd nu eČ™ti logat. */}
                Constructorul â€” dai ordinul, Kelion construieČ™te pe server (build + teste), deschide
                PR-ul; pe verde se Ă®mbinÄ singur (sau Ă®l dai tu, dacÄ eČ™ti logat). PoČ›i ordona Č™i prin
                voce/chat: â€žKelion, construieČ™teâ€¦".
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
                      {/* P10: â€ž$0.00 mÄsurat" nu mai poate ascunde nici citirea
                          picatÄ, nici joburile fÄrÄ cost raportat (regula #1). */}
                      {plafon.cheltuitCitit === false
                        ? `Plafon zilnic de ardere: NU POT CITI cheltuiala azi${plafon.cheltuitMotiv ? ` (${plafon.cheltuitMotiv})` : ''} â€” plafon $${plafon.plafon.toFixed(2)}`
                        : `Plafon zilnic de ardere: construit azi $${plafon.cheltuit.toFixed(2)} din $${plafon.plafon.toFixed(2)}`}
                      {plafon.cheltuitCitit !== false && (plafon.faraCost ?? 0) > 0
                        ? ` Â· ${plafon.faraCost} joburi fÄrÄ cost raportat â€” cifra e minimul mÄsurat, nu totalul`
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
                          ? 'ATINS â€” oprit azi'
                          : 'limitÄ activÄ'
                        : 'limitÄ opritÄ'}
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
                      {plafon.activ ? 'OpreČ™te limita' : 'PorneČ™te limita'}
                    </button>
                    {/* CONSTRUCTORUL = DEVIN, MÄ‚SURAT (owner, 22 aug: â€žam cerut devin
                        peste tot in constructor" + â€žsa-i stergi de tot pe ce e local").
                        Becul vine din config-ul REAL al serverului (cheia Devin), nu
                        dintr-un text scris de mĂ˘nÄ: verde = Devin deČ›ine coada (ordinele
                        pleacÄ Ă®n sesiuni Devin â†’ PR pe master); roČ™u = cheia lipseČ™te pe
                        server Č™i trebuie pusÄ â€” se spune exact asta, nu se inventeazÄ. */}
                    <span
                      className="chat-hint"
                      style={{ fontSize: 12, fontWeight: 600, color: constructorId == null ? undefined : constructorId.cine === 'devin' ? '#1a7f37' : '#c1121f' }}
                      title={constructorId?.motiv ?? 'identitatea constructorului Ă®ncÄ nu s-a citit'}
                    >
                      {constructorId == null
                        ? 'Constructor: se citeČ™teâ€¦'
                        : constructorId.cine === 'devin'
                          ? 'đźź˘ Constructorul e DEVIN (extern â€” cheia pusÄ; ordin â†’ sesiune Devin â†’ PR)'
                          : 'đź”´ Cheia Devin NU e pusÄ pe server â€” pune DEVIN_API_KEY ca Devin sÄ preia coada'}
                    </span>
                  </div>
                  {/* DIAGNOSTICUL AUTONOM (owner, 19 aug: â€žnu are autonomieâ€¦ sa faca
                      asta"): Kelion mÄsoarÄ SINGUR de ce (nu) reparÄ Č™i o aratÄ aici,
                      cu recomandarea fermÄ â€” nu mai Ă®ntrebi â€žde ce?". */}
                  {diagnostic && (diagnostic.probleme.length > 0 || !diagnostic.sanatos) && (
                    <div style={{ marginTop: 8, padding: 10, borderRadius: 8, border: '1px solid', borderColor: diagnostic.sanatos ? '#d0a92066' : '#c1121f66', background: diagnostic.sanatos ? '#d0a92014' : '#c1121f10' }}>
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: diagnostic.sanatos ? '#8a6d1a' : '#c1121f' }}>
                        {diagnostic.sanatos ? 'âš  ' : 'đź”´ '}{diagnostic.verdict}
                      </div>
                      {diagnostic.probleme.map((p) => (
                        <div key={p.cod} style={{ fontSize: 12, marginTop: 6 }}>
                          <span style={{ fontWeight: 600 }}>{p.severitate === 'critic' ? 'đź”´' : 'âš '} {p.ce}</span>
                          <br />
                          <span className="chat-hint" style={{ fontSize: 11.5 }}>â†’ {p.recomandare}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {/* ExplicaČ›ia vine DIN DATE (constructorId.motiv, mÄsurat de server),
                      nu dintr-o frazÄ scrisÄ de mĂ˘nÄ â€” fraza veche (â€žConstructor: Ollama
                      local free") a minČ›it exact cĂ˘nd ownerul Ă®ntreba de Devin. */}
                  <div style={{ marginTop: 10, padding: 10, border: '1px solid #8884', borderRadius: 8, fontSize: 11, opacity: 0.75 }}>
                    Creier: <b>Gemini</b> unic (rapid + greu). Constructor: {constructorId == null ? 'se citeČ™te de pe serverâ€¦' : constructorId.cine === 'devin' ? <><b>DEVIN</b> (extern) â€” {constructorId.motiv}</> : <>{constructorId.motiv}</>}
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
                      Enter ca sÄ salvezi. CĂ˘nd se atinge, Kelion nu mai porneČ™te ordine azi (doar cheltuiala MÄ‚SURATÄ‚ se numÄrÄ).
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
              {/* EVALUAREA CERINČšEI + AI-uri pe capacitate (owner, 13 aug): cerinČ›a
              e evaluatÄ, poarta de calitate spune dacÄ trece, iar AI-urile potrivite
              se aČ™azÄ de sus Ă®n jos, cu creditul live. Recomandarea e informativÄ â€”
              executorul rÄmĂ˘ne constructorul local (Jules se dÄ din chat). */}
              {evalOrdin && (
                <div className="eval-ordin">
                  <div className={`eval-verdict ${evalOrdin.trece ? 'ok' : 'stop'}`}>
                    {evalOrdin.trece ? 'âś“ ' : 'âś• '}
                    {evalOrdin.motiv}
                  </div>
                  {evalOrdin.capacitatiNecesare.length > 0 && (
                    <div className="eval-caps">
                      CerinČ›Ä: {evalOrdin.capacitatiNecesare.map((c) => (
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
                    title="Čterge din coadÄ toate ordinele eČ™uate Č™i terminate (rÄmĂ˘n doar cele Ă®n curs)"
                  >
                    CurÄČ›Ä eČ™uate/terminate
                  </button>
                )}
              </div>
              {/* PAUZA, VIZIBILÄ‚ AICI (auditul admin, 3 aug): trÄia doar Ă®n tabul
              Bani â€” ordinele stÄteau â€žĂ®n coadÄ Â· 0%" fÄrÄ nicio explicaČ›ie. */}
              {buildPaused && (
                <div className="chat-hint" style={{ color: '#e6a23c' }}>
                  âŹ¸ Autonomia e PE PAUZÄ‚ (opritÄ de tine din tabul Bani) â€” ordinele aČ™teaptÄ Ă®n coadÄ, nu se pierd; lucrÄtorul nu ia nimic pĂ˘nÄ n-o reporneČ™ti.
                </div>
              )}
              {/* TREI STÄ‚RI (auditul admin, 3 aug): â€žNiciun ordin Ă®ncÄ" doar dupÄ
              o citire REUČITÄ‚; Ă®nainte, orice eČ™ec arÄta coada â€žgoalÄ". */}
              {buildJobs === 'necitit' && <div className="chat-hint">{A.loading}</div>}
              {buildJobs === null && (
                <div className="chat-hint" style={{ color: '#e6a23c' }}>
                  âš  Nu am putut citi coada â€” citire eČ™uatÄ, nu coadÄ goalÄ (reĂ®ncerc la 10s).
                </div>
              )}
              {buildJobsData && buildJobsData.length === 0 && <div className="chat-hint">{A.noOrdersYet}</div>}
              {(buildJobsData ?? []).map((j) => (
                <div className="fin-row" key={j.id} style={{ flexWrap: 'wrap' }}>
                  <span>
                    <strong>#{j.id}</strong>{' '}
                    <span className={`vis-badge ${j.status === 'done' ? 'human' : j.status === 'failed' ? 'kind-demo' : ''}`}>
                      {/* ONESTITATE (Adrian, 5 aug): un job â€ždone" = PR DESCHIS, NU
                          pe live. â€žGATA" sugera fals cÄ e publicat. Un job al cÄrui
                          PR nu e merge-uit Ă®n master aratÄ â€žĂ®n aČ™teptare" (PR gata,
                          dar aČ™teaptÄ publicarea) â€” orice, dar nu â€žGATA". */}
                      {j.status === 'queued' ? 'Ă®n coadÄ' : j.status === 'running' ? 'lucreazÄâ€¦' : j.status === 'done' ? 'Ă®n aČ™teptare' : 'eČ™uat'}
                    </span>{' '}
                    {/* DEVIN, DOVEDIT PE RĂ‚ND (owner, 22 aug: â€žam cerut devin peste
                        tot in constructor"): badge-ul apare DOAR cĂ˘nd dispecerul a
                        pus id-ul sesiunii Devin pe ordin â€” mÄsurat, nu presupus. */}
                    {j.devinSessionId ? <span className="vis-badge human" title={`sesiune Devin: ${j.devinSessionId}`}>DEVIN</span> : null}{' '}
                    {/* P8 (owner, 15 aug: â€žfoarte clar ce executa"): FAPTA
                        extrasÄ de server (nume), nu ambalajul promptului. */}
                    {j.nume || j.orderText.slice(0, 90)}
                    {(j.nume ?? j.orderText).length > 90 ? 'â€¦' : ''}
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    {j.prUrl && (
                      <a href={j.prUrl} target="_blank" rel="noreferrer">
                        PR â†—
                      </a>
                    )}
                    {j.tokens > 0 && <span>{`Â· ${Math.round(j.tokens / 1000)}k tok`}</span>}
                    <span style={{ opacity: 0.7 }}>
                      Â· {new Date(j.updatedAt).toLocaleString('ro-RO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </span>
                    {/* REIA â€” doar pentru cele care nu sunt Ă®n curs (eČ™uat/GATA/Ă®n coadÄ). */}
                    {(j.status === 'failed' || j.status === 'done' || j.status === 'queued') && (
                      <button
                        type="button"
                        className="ghost"
                        style={{ fontSize: 12 }}
                        onClick={() => retryBuildOrder(j.id)}
                        title="Repune ordinul Ă®n coadÄ (Ă®l reia de la zero)"
                      >
                        â†» reia
                      </button>
                    )}
                    {/* ČTERGE â€” un ordin viu ('running') nu se Č™terge din greČ™ealÄ. */}
                    {j.status !== 'running' && (
                      <button
                        type="button"
                        className="ghost"
                        style={{ fontSize: 12, color: '#ff7a7a' }}
                        onClick={() => deleteBuildOrder(j.id)}
                        title="Čterge definitiv ordinul"
                      >
                        âś•
                      </button>
                    )}
                    {/* OPREČTE â€” un 'running' nu putea fi oprit din panou deloc
                        (auditul admin, 3 aug); ruta cheamÄ cancelBuildJob. */}
                    {j.status === 'running' && (
                      <button
                        type="button"
                        className="ghost"
                        style={{ fontSize: 12, color: '#ff7a7a' }}
                        onClick={() => cancelBuildOrder(j.id)}
                        title={'OpreČ™te ordinul aflat Ă®n lucru (trece pe â€žeČ™uatâ€ť)'}
                      >
                        âŹą opreČ™te
                      </button>
                    )}
                  </span>
                  {/* BARA 0â€“100% (Adrian, 3 aug: â€žfiecare job trebuie sÄ afiČ™eze
                      starea realÄ printr-o barÄ 0â€“100%, actualizatÄ dinamic").
                      Procentul e harta etapei REALE raportate de lucrÄtor
                      (serverul o calculeazÄ din progres); textul etapei stÄ
                      lĂ˘ngÄ cifrÄ, ca s-o poČ›i confrunta oricĂ˘nd cu sursa.
                      Se actualizeazÄ cu polling-ul de 10s al cozii. */}
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
                        title={j.progress || (j.status === 'queued' ? 'Ă®n coadÄ' : '')}
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
                Gesturile lui Kelion â€” apasÄ â€žâ–¶ AratÄ" ca sÄ-l vezi fÄcĂ˘nd gestul; bifeazÄ ce are voie
                sÄ foloseascÄ pe logicÄ/context. Ce NU e bifat NU se foloseČ™te deloc Ă®n aplicaČ›ie.
                {gestSaved ? ' Â· salvat âś“' : ''}
                {gestErr && <span style={{ color: '#ff7a7a' }}> Â· {gestErr}</span>}
              </div>
              {gestOff === 'necitit' && <div className="chat-hint">{A.loading}</div>}
              {/* BIFELE BLOCATE PE CITIRE EČUATÄ‚ (auditul admin, 3 aug): pe []
              fals, toate gesturile apÄreau â€žactive" Č™i primul toggle salva peste
              lista realÄ de pe server, Č™tergĂ˘nd dezactivÄrile anterioare. */}
              {gestOff === null && (
                <div className="chat-hint" style={{ color: '#e6a23c' }}>
                  âš  Nu am putut citi starea gesturilor â€” bifele sunt blocate ca sÄ nu salvez peste o listÄ necititÄ. Redeschide tabul.
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
                          â–¶ AratÄ
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
                â€žall the keys have been typed dozens of timesâ€ť). A WRITTEN key does
                not automatically reach the running process: it can be in a
                different file than the one given to docker, written AFTER the
                container started, or set as a GitHub secret without running
                `vps-set-env`. This table separates â€žnot writtenâ€ť from â€žwritten but
                never got hereâ€ť. */}
            {/* TABELUL NU MAI DISPARE MUT (auditul admin, 3 aug): o citire
            eČ™uatÄ se DECLARÄ‚ â€” vedeta tabului nu poate lipsi fÄrÄ explicaČ›ie. */}
            {envCheck === 'necitit' && <p className="chat-hint">{A.loading}</p>}
            {envCheck === null && (
              <p className="chat-hint" style={{ color: '#e6a23c' }}>
                âš  Nu am putut citi cheile procesului â€” citire eČ™uatÄ, NU Ă®nseamnÄ cÄ lipsesc. ApasÄ â€žReĂ®mprospÄteazÄ".
              </p>
            )}
            {envCheckData && (
              <div className="fin-breakdown" style={{ marginBottom: 14 }}>
                <div className="fin-breakdown-head">
                  Ce chei vede serverul CHIAR ACUM â€” {envCheckData.summary.total - envCheckData.summary.lipsa - envCheckData.summary.goale}/
                  {envCheckData.summary.total} prezente
                </div>
                <div className="or-wallet-sub">
                  Procesul a pornit la{' '}
                  <strong>{new Date(envCheckData.startedAt).toLocaleString('ro-RO')}</strong>. O cheie scrisÄ
                  DUPÄ‚ ora asta nu e Ă®ncÄrcatÄ pĂ˘nÄ la repornirea containerului â€” asta e capcana Ă®n care
                  â€žam scris-o de zeci de ori" Č™i â€žnu o vede" sunt amĂ˘ndouÄ adevÄrate.
                </div>
                {envCheckData.orphans.length > 0 && (
                  <div className="fin-row">
                    <span style={{ color: '#e6a23c', fontWeight: 600 }}>
                      âš  Chei pe care LE AI, dar sub alt nume:{' '}
                      {envCheckData.orphans.map((n, i) => (
                        <span key={n}>
                          {i > 0 && ', '}
                          <code>{n}</code>
                        </span>
                      ))}
                    </span>
                    <span className="fin-sub">redenumeČ™te-le, sau spune-mi Č™i le citesc Č™i aČ™a</span>
                  </div>
                )}
                {envCheckData.vars
                  .filter((v) => !v.present || v.length === 0)
                  .map((v) => (
                    <div className="fin-row" key={v.name}>
                      <span style={{ color: '#e6a23c' }}>
                        âš  <code>{v.name}</code> â€” {v.what}
                      </span>
                      <span className="fin-sub" title={`Nume acceptate: ${v.accepts.join(', ')}`}>
                        {v.present ? 'prezentÄ dar GOALÄ‚' : 'nu e Ă®n proces'} Â· {v.breaks}
                      </span>
                    </div>
                  ))}
                {envCheckData.summary.lipsa === 0 && envCheckData.summary.goale === 0 && (
                  <div className="fin-row">
                    <span>âś… Toate cheile aČ™teptate sunt Ă®n procesul care ruleazÄ.</span>
                  </div>
                )}
                {envCheckData.vars
                  .filter((v) => v.present && v.length > 0)
                  .map((v) => (
                    <div className="fin-row" key={v.name}>
                      <span>
                        âś… <code>{v.name}</code> â€” {v.what}
                      </span>
                      <span className="fin-sub" title={`Nume acceptate: ${v.accepts.join(', ')}`}>
                        {v.foundAs && v.foundAs !== v.name ? `gÄsitÄ ca ${v.foundAs} Â· ` : ''}
                        {v.length} caractere
                      </span>
                    </div>
                  ))}
              </div>
            )}
            <div className="fin-breakdown">
              <div className="fin-breakdown-head">
                Tokenuri Č™i chei API cu drepturi â€” verificare LIVE
                <button
                  type="button"
                  className="ghost"
                  style={{ marginLeft: 12 }}
                  onClick={() => {
                    // REĂŽMPROSPÄ‚TEAZÄ‚ AMBELE BLOCURI (auditul admin, 3 aug):
                    // tabelul â€žCHIAR ACUM" rÄmĂ˘nea pe datele de la deschidere â€”
                    // titlul minČ›ea faČ›Ä de comportament.
                    void fetchEnvCheck().then(setEnvCheck)
                    setTokenChecksLoading(true)
                    void fetchTokenChecks().then((r) => {
                      setTokenChecks(r)
                      setTokenChecksLoading(false)
                    })
                  }}
                >
                  ReĂ®mprospÄteazÄ
                </button>
              </div>
              {tokenChecksLoading && <p className="chat-hint">{A.checkingTokens}</p>}
              {!tokenChecksLoading && !tokenChecks && <p className="chat-hint">{A.tokensFailed}</p>}
              {tokenChecks && (
                <>
                  <div className="fin-row" style={{ fontWeight: 600 }}>
                    <span>âś… {tokenChecks.ok} OK</span>
                    <span>âšŞ {tokenChecks.notConfigured} neconfigurate</span>
                    <span>đź”´ {tokenChecks.failed} eČ™uate</span>
                  </div>
                  {tokenChecks.checks.map((c) => (
                    <div className="fin-row" key={c.name}>
                      <span>
                        {c.status === 'ok' ? 'âś…' : c.status === 'not_configured' ? 'âšŞ' : 'đź”´'} {c.name}
                        {c.detail ? ` â€” ${c.detail}` : ''}
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
            {/* TREI STÄ‚RI (auditul admin, 3 aug): backend-ul rÄspundea 200 cu
            liste goale la DB picat, iar â€žnu s-a strĂ˘ns activitate" era o
            afirmaČ›ie nemÄsuratÄ; acum eČ™ecul e eČ™ec, cu reĂ®ncercare. */}
            {activity === 'necitit' && <p className="chat-hint">{A.loading}</p>}
            {activity === null && (
              <p className="chat-hint" style={{ color: '#e6a23c' }}>
                âš  Nu pot citi activitatea â€” citirea a eČ™uat, nu e cont fÄrÄ activitate.{' '}
                <button type="button" className="ghost" onClick={() => void fetchActivity().then(setActivity)}>
                  ReĂ®ncearcÄ
                </button>
              </p>
            )}
            <RegistruAudit />
            {activityData && activityData.users.length === 0 && (
              <p className="chat-hint">
                ĂŽncÄ nu s-a strĂ˘ns activitate pe conturi â€” se adunÄ de la prima intrare a fiecÄrui
                utilizator dupÄ aceastÄ actualizare.
              </p>
            )}
            {activityData && activityData.users.length > 0 && (
              <>
                <div className="fin-breakdown">
                  <div className="fin-breakdown-head">
                    Pe utilizator â€” ultima intrare, IP, loc, cĂ˘t a stat Ă®n total
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
                          {/* POZA OMULUI (owner, 14 aug: â€žuserii nu au poze"):
                              captura facialÄ existÄ Ă®n faceprints (Ă®mperecheatÄ
                              cu amprenta vocalÄ) â€” doar tabul Amprente o arÄta.
                              Aici vine din aceeaČ™i listÄ (fetchVoiceprints,
                              Ă®ncÄrcatÄ la deschiderea tabului); fÄrÄ capturÄ â†’
                              â€ž?", cinstit, nu o siluetÄ care promite. */}
                          {(u.foto || pozaUser(u.email)) ? (
                            <img
                              src={u.foto || pozaUser(u.email)}
                              alt={`FaČ›a lui ${u.email}`}
                              style={{ width: 28, height: 28, borderRadius: 6, objectFit: 'cover', border: '1px solid rgba(255,255,255,0.15)' }}
                            />
                          ) : (
                            <span
                              className="muted"
                              title="FÄrÄ capturÄ de faČ›Ä Ă®ncÄ â€” se face singurÄ la prima turÄ cu camera pornitÄ"
                              style={{ width: 28, height: 28, borderRadius: 6, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: '1px dashed rgba(255,255,255,0.2)', fontSize: 13 }}
                            >
                              ?
                            </span>
                          )}
                          <Flag code={u.code} />
                          <strong>{u.email}</strong>
                        </span>
                        <span className="vis-open">deschide â€ş</span>
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
                        <span>{u.last_ip || 'â€”'}</span>
                        <span>{[u.city, u.country].filter(Boolean).join(', ') || 'â€”'}</span>
                        <span>
                          {u.browser || 'â€”'}
                          {u.device ? ` Â· ${u.device === 'mobile' ? 'mobil' : 'desktop'}` : ''}
                        </span>
                        <span>{u.sessions} sesiuni</span>
                        <span>timp total {fmtDur(u.seconds)}</span>
                        <span>{u.messages} mesaje</span>
                        <span title={u.scutit ? 'Ownerul e scutit de taxare peste tot â€” soldul negativ e istoric, dinaintea scutirilor, Č™i nu se mai miČ™cÄ. ĂŽl poČ›i aduce la zero din Admin â†’ user â†’ credit (butonul e al tÄu, miČ™cÄ bani).' : undefined}>
                          sold {sym}
                          {u.balance.toFixed(2)}
                          {/* P10: cifra realÄ rÄmĂ˘ne, dar cu adevÄrul lĂ˘ngÄ ea. */}
                          {u.scutit ? ' (scutit â€” sold istoric)' : ''}
                        </span>
                        {/* MONITORIZAREA PE USER (10 aug): cĂ˘t a COSTAT pe
                            furnizori â€” roČ™u cĂ˘nd a consumat peste ce are. */}
                        <span style={typeof u.consumedUsd === 'number' && u.consumedUsd > 0 && u.balance <= 0 ? { color: '#e5484d', fontWeight: 600 } : undefined}>
                          {/* `?? 0` scos (owner, 19 aug): un rĂ˘nd fÄrÄ `consumedUsd` arÄta
                              â€ž$0.00" ca fapt mÄsurat. FÄrÄ cifrÄ realÄ â†’ â€žâ€”", nu 0. */}
                          consum {typeof u.consumedUsd === 'number' ? `$${u.consumedUsd.toFixed(2)}` : 'â€”'}
                        </span>
                        {u.blocked && <span className="user-badge blocked">BLOCAT</span>}
                        {/* P26: mostra de voce e parte din cardul omului â€” dacÄ
                            existÄ, se spune (ascultarea rÄmĂ˘ne Ă®n Amprente). */}
                        {u.voce && (
                          <span title={u.mostraAudio ? 'AmprentÄ vocalÄ Ă®nscrisÄ, cu mostrÄ audio ascultabilÄ Ă®n tabul Amprente (â–¶)' : 'AmprentÄ vocalÄ Ă®nscrisÄ (fÄrÄ mostrÄ audio Ă®ncÄ)'}>
                            đźŽ¤ voce{u.mostraAudio ? ' + mostrÄ' : ''}
                          </span>
                        )}
                      </div>
                      {/* DEVICE-URILE LUI, DEDESUBT (P6; owner, 15 aug: â€žse
                          pastreaza unica si se adauga doar device cu care intra
                          cu datele aferente") â€” Ă®n locul listei plate de sesiuni
                          care repeta acelaČ™i om de N ori. */}
                      {(u.devices ?? []).map((d, i) => (
                        <div className="vis-meta" key={i} style={{ paddingLeft: 36, opacity: 0.8 }}>
                          <span>{d.device === 'mobile' ? 'đź“± mobil' : 'đź’» desktop'}{d.browser ? ` Â· ${d.browser}` : ''}</span>
                          <span>{d.sessions} sesiuni</span>
                          <span>
                            ultima {new Date(d.last_seen).toLocaleString('ro-RO', {
                              day: 'numeric',
                              month: 'short',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                          <span>{d.ip || 'â€”'}</span>
                          <span>{[d.city, d.country].filter(Boolean).join(', ') || 'â€”'}</span>
                        </div>
                      ))}
                      <div className="vis-actions" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          className="user-act"
                          title={A.seeWholeChat}
                          onClick={() => void openUserConvo(u)}
                        >
                          đź’¬ Vezi chat
                        </button>
                        {/* FEEDBACK LA EČEC (auditul admin, 3 aug): toate cele
                        patru acČ›iuni tÄceau cĂ˘nd manageUser Ă®ntorcea null â€”
                        butonul pÄrea apÄsat degeaba. */}
                        <button
                          type="button"
                          className="user-act"
                          onClick={async () => {
                            const r = await manageUser(u.email, u.blocked ? 'unblock' : 'block')
                            if (r) setActivity(r)
                            else window.alert(A.alertCouldNotPerf)
                          }}
                        >
                          {u.blocked ? 'DeblocheazÄ' : 'BlocheazÄ'}
                        </button>
                        <button
                          type="button"
                          className="user-act"
                          onClick={async () => {
                            const s = window.prompt(
                              A.promptManualCreditAmount(u.email),
                            )
                            if (s == null) return
                            // VIRGULA ZECIMALÄ‚ ACCEPTATÄ‚ (auditul admin, 3 aug):
                            // â€ž5,50" dÄdea NaN Č™i funcČ›ia ieČ™ea tÄcut â€” ownerul
                            // credea cÄ a creditat.
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
                        {/* BUTONUL â€žČterge" A FOST SCOS (ordinul ownerului, 14
                            aug: â€žbaza de utilizatori nu se poate Č™terge prin
                            nicio comandÄ"). Serverul refuzÄ (403) Č™i scutul din
                            Postgres refuzÄ Č™i el â€” un buton care promite o
                            Č™tergere imposibilÄ ar fi afiČ™aj fals. Cererile GDPR
                            se rezolvÄ manual, la decizia ownerului. */}
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
              // TABUL RESCRIS CORECT (Adrian, 3 aug: â€žrescrie corect tot tabul"):
              // (1) mesajul e AL LUI, editabil, salvat local â€” nu bÄtut Ă®n cod;
              // (2) fiecare reČ›ea spune ce preia REAL (LinkedIn ignorÄ textul â€”
              //     doar linkul; nu promitem ce platforma nu face);
              // (3) clipul promo: fluxul REAL, pas cu pas (se genereazÄ din chat
              //     cu `prepare_promo_clip`, se salveazÄ Ă®n Downloads, se urcÄ
              //     Ă®n studioul platformei) â€” nu o afirmaČ›ie despre un folder.
              const text = shareText.trim() || SHARE_TEXT_IMPLICIT
              const enc = encodeURIComponent
              const links: { name: string; href: string }[] = [
                { name: 'X (Twitter)', href: `https://twitter.com/intent/tweet?text=${enc(text)}&url=${enc(url)}` },
                { name: 'Facebook', href: `https://www.facebook.com/sharer/sharer.php?u=${enc(url)}&quote=${enc(text)}` },
                { name: 'WhatsApp', href: `https://wa.me/?text=${enc(`${text} ${url}`)}` },
                { name: 'Telegram', href: `https://t.me/share/url?url=${enc(url)}&text=${enc(text)}` },
                // LinkedIn NU acceptÄ text pre-completat pe share-offsite â€” doar
                // linkul. Scris pe buton, ca sÄ nu parÄ stricat cĂ˘nd textul â€ždispare".
                { name: 'LinkedIn (doar linkul)', href: `https://www.linkedin.com/sharing/share-offsite/?url=${enc(url)}` },
                { name: 'Reddit', href: `https://www.reddit.com/submit?url=${enc(url)}&title=${enc(text)}` },
              ]
              const uploads: { name: string; href: string }[] = [
                { name: 'TikTok â€” Ă®ncarcÄ clip', href: 'https://www.tiktok.com/tiktokstudio/upload' },
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
                          // refuzat (permisiuni/focus) lÄsa butonul mut + unhandled
                          // rejection Ă®n consolÄ (zgomot Ă®n auditul F12).
                          void navigator.clipboard.writeText(`${text} ${url}`).then(() => {
                            setCopied(true)
                            window.setTimeout(() => setCopied(false), 1800)
                          }).catch(() => {
                            setCopied(false)
                            window.alert('Nu s-a putut copia (browserul a refuzat clipboard-ul) â€” copiazÄ manual textul.')
                          })
                        }}
                      >
                        {copied ? 'Copiat âś“' : 'CopiazÄ text + link'}
                      </button>
                      {'share' in navigator && (
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => void navigator.share({ title: 'Kelionai', text, url }).catch(() => {})}
                        >
                          Distribuieâ€¦
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="fin-breakdown">
                    <div className="fin-breakdown-head">
                      Mesajul tÄu de prezentare â€” Ă®l scrii o datÄ, Ă®l folosesc toate
                      butoanele de mai jos. Se salveazÄ Ă®n browserul Ästa.
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
                      Clipul promo â€” fluxul real, pas cu pas: (1) Ă®i ceri lui Kelion Ă®n
                      chat â€žpregÄteČ™te clipul promo" â€” Ă®l compune Č™i Č›i-l salveazÄ Ă®n
                      Downloads; (2) deschizi studioul platformei de mai jos; (3) urci
                      clipul din Downloads acolo. Butoanele DOAR deschid studiourile â€”
                      nicio platformÄ nu permite Ă®ncÄrcare automatÄ din afarÄ.
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
                  {[userConvo.u.city, userConvo.u.country].filter(Boolean).join(', ') || 'loc necunoscut'} Â·{' '}
                  {userConvo.u.browser || 'â€”'}
                  {userConvo.u.device ? ` Â· ${userConvo.u.device === 'mobile' ? 'mobil' : 'desktop'}` : ''} Â·{' '}
                  {userConvo.u.last_ip || 'IP necunoscut'} Â· {userConvo.u.sessions} sesiuni Â· timp total{' '}
                  {fmtDur(userConvo.u.seconds)} Â· {userConvo.u.messages} mesaje
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
                  {roBusy ? 'Traducâ€¦' : roOn ? 'AratÄ originalul' : 'đźŚ Tradu Ă®n romĂ˘nÄ'}
                </button>
                {roOn && roFailed > 0 && (
                  <span className="chat-hint" style={{ color: '#d97706' }}>
                    âš  {roFailed} netraduse
                  </span>
                )}
                {/* â€žClose" era ENGLEZESC hardcodat Ă®ntr-un panou de admin
                    romĂ˘nesc (auditul buton-cu-buton, 14 aug) â€” limba trebuie
                    sÄ fie una singurÄ pe tot panoul. */}
                <button type="button" className="ghost" onClick={closeUserConvo}>
                  ĂŽnchide
                </button>
              </div>
            </header>
            <div className="admin-history convo-body">
              {userConvoLoading && <p className="chat-hint">{A.loading}</p>}
              {/* null = citirea a PICAT (auditul admin, 3 aug) â€” distinct de
              â€žNu a scris niciun mesaj Ă®ncÄ". */}
              {!userConvoLoading && userConvo.rows === null && (
                <p className="chat-hint" style={{ color: '#e6a23c' }}>
                  âš  {A.historyReadFail}
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
