// ── DIAGNOSTICUL CONSTRUCTORULUI — AUTONOM, PE SERVER (owner, 19 aug: „nu poate
// ca nu are autonomie si nu l-ai construit corect sa faca asta, cu toate ca eu
// am cerut de 1000 de ori") ───────────────────────────────────────────────────
// Ownerul are dreptate: sistemul trebuie să-și diagnosticheze SINGUR constructorul,
// pe server (unde ARE acces real la DB + probele host-ului), nu să depindă de o
// sesiune externă care nu ajunge la VPS. Aici e acea autonomie: dintr-un set de
// MĂSURĂTORI (pulsul lucrătorului, proba motorului Aider, proba creierului LOCAL
// Ollama, ultimele ordine reale) → un verdict FERM cu DE CE nu repară + recomandare.
//
// Nucleul e PUR (regula #1: nicio stare fără măsurătoare; nicio cauză inventată).
// Kelion îl cheamă din chat/voce (constructor_status) ȘI din bucla autonomă, iar
// panoul admin îl expune — deci „de ce nu se apucă / nu repară" nu mai e mister.
import { verdictPulsLucrator } from './pulsLucrator.js'

/** Un ordin recent, redus la ce contează pentru diagnostic (măsurat din DB). */
export interface OrdinRecentMasurat {
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled'
  brain: string | null // 'free_local' | 'paid_cloud' | null — cine a servit efectiv
  logTail: string // coada logului (semnalul „no_edit"/„no_change")
  ageSec: number // acum − updatedAt, în secunde
}

export interface MasuratoriConstructor {
  lucratorViu: boolean
  lucratorAgeSec: number | null
  aiderOk: boolean // motorul (Aider) răspunde pe VPS?
  ollamaOk: boolean // creierul LOCAL (free) e sus + are model?
  ordine: OrdinRecentMasurat[] // cele mai recente ordine, cel mai nou primul
  /** Devin e constructorul (cheia pusă)? Atunci lanțul vechi (Aider/Ollama/
   *  lucrător VPS) NU mai e calea ordinelor — verdictul se dă pe Devin. */
  devinActiv?: boolean
  /** Proba VIE a API-ului Devin (probaDevin) — doar când devinActiv. */
  devinOk?: boolean
  devinMotiv?: string
}

export interface ProblemaConstructor {
  cod: string
  severitate: 'critic' | 'atentie'
  ce: string
  recomandare: string
}

export interface DiagnosticConstructor {
  sanatos: boolean
  verdict: string
  probleme: ProblemaConstructor[]
  masuratori: {
    inCoada: number
    inLucru: number
    freeNoEdit: number // ordine recente unde FREE n-a editat (a escaladat/„no_change")
    escaladatePaid: number // ordine servite de rezerva plătită
    esuate: number
    oldestQueuedSec: number | null
    runningSec: number | null
  }
}

/** Semnătura „free n-a modificat nimic" din logul/raportul workerului (măsurat). */
const RE_NO_EDIT = /no[_ ]?edit|no[_ ]?change|n-a modificat|nu a modificat|escaladat \((?:no_change|timeout_throttle|free_indisponibil)\)/i

export function ordinFreeNoEdit(o: OrdinRecentMasurat): boolean {
  // FREE n-a reparat dacă: fie logul poartă semnătura de non-editare, fie ordinul
  // a fost servit de rezerva plătită (adică free a cedat înaintea lui).
  return RE_NO_EDIT.test(o.logTail || '') || o.brain === 'paid_cloud'
}

export function diagnosticConstructor(m: MasuratoriConstructor): DiagnosticConstructor {
  const ordine = Array.isArray(m.ordine) ? m.ordine : []
  const queued = ordine.filter((o) => o.status === 'queued')
  const running = ordine.filter((o) => o.status === 'running')
  const finalizate = ordine.filter((o) => o.status === 'done' || o.status === 'failed')
  const esuate = ordine.filter((o) => o.status === 'failed').length
  const escaladatePaid = finalizate.filter((o) => o.brain === 'paid_cloud').length
  const freeNoEdit = finalizate.filter(ordinFreeNoEdit).length
  const oldestQueuedSec = queued.length ? Math.max(...queued.map((o) => o.ageSec)) : null
  const runningSec = running.length ? Math.max(...running.map((o) => o.ageSec)) : null

  const probleme: ProblemaConstructor[] = []

  // ── CONSTRUCTORUL E DEVIN (cheia pusă): verdictul se dă pe DEVIN, nu pe lanțul
  // vechi. Aider/Ollama/lucrătorul de pe VPS nu mai primesc ordine cât cheia
  // există (/api/constructor/next îi refuză), deci „aider_jos"/„lucrator_mort"
  // ar fi alarme FALSE — ar spune „nimeni nu construiește" exact când Devin
  // construiește. Se măsoară în schimb API-ul lui Devin + coada. ────────────
  if (m.devinActiv) {
    if (m.devinOk !== true) {
      probleme.push({
        cod: 'devin_jos',
        severitate: 'critic',
        ce: `Devin e constructorul (cheia pusă), dar API-ul lui NU răspunde — ordinele stau în coadă. Motiv măsurat: ${m.devinMotiv ?? 'necunoscut'}.`,
        recomandare: 'Verifică cheia DEVIN_API_KEY (secrete + vps-set-env) și rețeaua spre api.devin.ai; până la remediere, ordinele rămân în coadă (nu se pierd).',
      })
    }
    if (queued.length > 0 && running.length > 0 && (runningSec ?? 0) > 30 * 60) {
      probleme.push({
        cod: 'coada_blocata',
        severitate: 'atentie',
        ce: `Un ordin e „în lucru" la Devin de ${Math.round((runningSec ?? 0) / 60)} min și ține ${queued.length} în coadă în spate (dispecerul duce UN job pe rând).`,
        recomandare: 'Vezi sesiunea Devin (linkul de pe ordin) — dacă e agățată, anulează/repune ordinul (Admin→Constructor) ca să elibereze coada.',
      })
    }
    const critice = probleme.filter((p) => p.severitate === 'critic')
    const sanatos = critice.length === 0
    const verdict = sanatos
      ? probleme.length
        ? `Constructorul (Devin) funcționează, dar cu ${probleme.length} atenționare(i): ${probleme[0].ce}`
        : 'Constructorul e DEVIN (extern) și e sănătos: cheia pusă, API-ul răspunde; ordinele pleacă în sesiuni Devin și se întorc ca PR pe master.'
      : `Constructorul NU repară: ${critice[0].ce}`
    return {
      sanatos,
      verdict,
      probleme,
      masuratori: {
        inCoada: queued.length,
        inLucru: running.length,
        freeNoEdit,
        escaladatePaid,
        esuate,
        oldestQueuedSec,
        runningSec,
      },
    }
  }

  // 1) MOTORUL — fără Aider, nimeni nu construiește (nici free, nici plătit).
  if (!m.aiderOk) {
    probleme.push({
      cod: 'aider_jos',
      severitate: 'critic',
      ce: 'Motorul Aider nu răspunde pe VPS — constructorul nu poate edita nimic, nici free, nici plătit.',
      recomandare: 'Rulează pe VPS: bash deploy/setup-ollama.sh (instalează/repară Aider pe host).',
    })
  }

  // 2) CREIERUL LOCAL (FREE) — fără el, free NU poate repara (exact „nu repara ieftin").
  if (!m.ollamaOk) {
    probleme.push({
      cod: 'ollama_jos',
      severitate: 'critic',
      ce: 'Creierul LOCAL (Ollama, free) e jos sau fără model — de aceea FREE nu repară.',
      recomandare: 'Pe VPS: pornește Ollama și trage modelul (bash deploy/setup-ollama.sh); apoi free lucrează fără bani.',
    })
  }

  // 3) LUCRĂTORUL — dacă nu cere ordine, ele stau în coadă orice ai face.
  if (!m.lucratorViu) {
    const cat = m.lucratorAgeSec == null ? 'de la ultima repornire' : `de ${Math.round((m.lucratorAgeSec ?? 0) / 60)} min`
    probleme.push({
      cod: 'lucrator_mort',
      severitate: 'critic',
      ce: `Lucrătorul de pe VPS nu a mai cerut ordine ${cat} — cronul (*/2 min) pare oprit; de aceea ordinele stau în coadă.`,
      recomandare: 'Pe VPS: verifică cronul constructor-worker.sh (crontab -l) și /root/kelion/constructor.log; repornește-l.',
    })
  }

  // 4) FREE NU EDITEAZĂ — deși motorul + creierul local sunt sus, ultimele ordine
  //    au fost toate cedate pe plătit / marcate „no_edit". Măsurat, nu presupus.
  if (m.aiderOk && m.ollamaOk && finalizate.length >= 3 && freeNoEdit === finalizate.length) {
    probleme.push({
      cod: 'free_nu_editeaza',
      severitate: 'atentie',
      ce: `FREE nu a editat pe ultimele ${finalizate.length} ordine finalizate (toate „no_edit"/escaladate pe plătit) — modelul local nu produce reparația.`,
      recomandare: 'Crește răbdarea free (CONSTRUCTOR_SILENCE_MS / CONSTRUCTOR_FREE_TIMEOUT_MS) sau folosește un model local mai capabil; verifică în constructor.log dacă e omorât pe tăcere înainte să scrie.',
    })
  }

  // 5) COADĂ BLOCATĂ — lucrătorul viu, dar un ordin ține coada de mult timp.
  if (m.lucratorViu && queued.length > 0 && running.length > 0 && (runningSec ?? 0) > 30 * 60) {
    probleme.push({
      cod: 'coada_blocata',
      severitate: 'atentie',
      ce: `Un ordin e „în lucru" de ${Math.round((runningSec ?? 0) / 60)} min și ține ${queued.length} în coadă în spate.`,
      recomandare: 'Anulează/repune ordinul agățat (Admin→Constructor) ca să elibereze coada.',
    })
  }

  const critice = probleme.filter((p) => p.severitate === 'critic')
  const sanatos = critice.length === 0
  const verdict = sanatos
    ? probleme.length
      ? `Constructorul funcționează, dar cu ${probleme.length} atenționare(i): ${probleme[0].ce}`
      : 'Constructorul pare sănătos: motor + creier local probate, lucrătorul viu.'
    : `Constructorul NU repară: ${critice[0].ce}`

  return {
    sanatos,
    verdict,
    probleme,
    masuratori: {
      inCoada: queued.length,
      inLucru: running.length,
      freeNoEdit,
      escaladatePaid,
      esuate,
      oldestQueuedSec,
      runningSec,
    },
  }
}

// ── GATHERER (server-side): adună măsurătorile reale și dă verdictul. Injectat cu
// dependențe ca să fie testabil și ca să nu existe DOUĂ implementări (ruta admin ȘI
// unealta de chat îl refolosesc — poarta jscpd). Întoarce {error} pe citire picată
// (regula #1: nu raportează „sănătos" peste o citire care a eșuat). ──────────────
export interface DepsDiagnosticConstructor {
  loadKv: (cheie: string) => Promise<string | null>
  listBuildJobs: (n: number) => Promise<Array<{ status: string; brain: string | null; log: string | null; updatedAt: string }> | null>
  probaAider: () => Promise<{ ok: boolean }>
  probaOllama: () => Promise<{ ok: boolean; modele: string[] }>
  now: number
  /** Devin e constructorul (config.devinKey)? Atunci se probează Devin, nu Aider/Ollama. */
  devinActiv?: boolean
  probaDevin?: () => Promise<{ ok: boolean; motiv?: string }>
}

export async function culegeDiagnosticConstructor(
  deps: DepsDiagnosticConstructor,
): Promise<DiagnosticConstructor | { error: string }> {
  const devinActiv = Boolean(deps.devinActiv)
  const [lastPollRaw, jobs, aider, ollama, devinProba] = await Promise.all([
    deps.loadKv('constructor:worker:lastPoll').catch(() => null),
    deps.listBuildJobs(16).catch(() => null),
    // Cu Devin activ NU mai probam lanțul vechi (Aider/Ollama pe VPS): nu el duce
    // ordinele, iar probele lui ar costa timp și ar hrăni alarme false.
    devinActiv ? Promise.resolve({ ok: false }) : deps.probaAider().catch(() => ({ ok: false })),
    devinActiv ? Promise.resolve({ ok: false, modele: [] as string[] }) : deps.probaOllama().catch(() => ({ ok: false, modele: [] as string[] })),
    devinActiv && deps.probaDevin
      ? deps.probaDevin().catch((e) => ({ ok: false, motiv: String(e).slice(0, 160) }))
      : Promise.resolve(null),
  ])
  if (!jobs) return { error: 'coada_necitibila' }
  const puls = verdictPulsLucrator(Number(lastPollRaw) || 0, deps.now)
  const ordine: OrdinRecentMasurat[] = jobs.map((j) => ({
    status: (['queued', 'running', 'done', 'failed', 'cancelled'].includes(j.status) ? j.status : 'failed') as OrdinRecentMasurat['status'],
    brain: j.brain ?? null,
    logTail: String(j.log ?? '').slice(-600),
    ageSec: Math.max(0, Math.round((deps.now - new Date(j.updatedAt).getTime()) / 1000)),
  }))
  return diagnosticConstructor({
    lucratorViu: puls.viu,
    lucratorAgeSec: puls.ageSec,
    aiderOk: !!aider.ok,
    ollamaOk: !!ollama.ok && ollama.modele.length > 0,
    ordine,
    devinActiv,
    // devinOk doar dintr-o probă REALĂ: fără probaDevin injectată, rămâne undefined
    // (≠ true) — diagnosticul spune „nu răspunde", nu inventează un verde.
    devinOk: devinProba ? devinProba.ok : undefined,
    devinMotiv: devinProba && 'motiv' in devinProba ? devinProba.motiv : undefined,
  })
}

// Wiring-ul REAL (o SINGURĂ implementare — ruta admin ȘI unealta de chat/voce îl
// refolosesc, fără cod duplicat, poarta jscpd). Injectează dependențele vii peste
// gatherer-ul testabil de mai sus.
export async function diagnosticConstructorViu(now: number): Promise<DiagnosticConstructor | { error: string }> {
  const { loadKv, listBuildJobs } = await import('../db.js')
  const { probaAider } = await import('./aiderProba.js')
  const { probaOllama } = await import('./ollamaProba.js')
  const { devinDisponibil, probaDevin } = await import('./devin.js')
  return culegeDiagnosticConstructor({
    loadKv,
    listBuildJobs: (n) => listBuildJobs(n).then((r) => r?.map((j) => ({ status: j.status, brain: j.brain, log: j.log, updatedAt: j.updatedAt })) ?? null),
    probaAider: () => probaAider().then((a) => ({ ok: a.ok })),
    probaOllama: () => probaOllama().then((o) => ({ ok: o.ok, modele: o.modele })),
    now,
    // Devin e constructorul când cheia e pusă — atunci diagnosticul îl probează
    // pe EL (probaDevin), nu lanțul vechi Aider/Ollama/lucrător.
    devinActiv: devinDisponibil(),
    probaDevin,
  })
}
