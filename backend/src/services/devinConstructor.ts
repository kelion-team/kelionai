// ── DISPECERUL DEVIN — leagă coada `build_jobs` de constructorul extern ────────
//
// Owner, 20 aug: „când îi zic lui Kelion să repare, el apelează Devin; Devin
// repară, raportează jobul finalizat, deploy cu PR pe master; tot pe monitor
// mesajul cu PR link". Aici e logica PURĂ + orchestrarea subțire (clientul HTTP e
// în `devin.ts`). Cablarea în buclă/rută + coloana de sesiune vin peste asta.
//
// BARA REALĂ (owner: „bara reală, nu inventată"): Devin NU dă un procent fin, așa
// că NU inventăm unul. Arătăm o bară INDETERMINATĂ (lucrează) + text MĂSURAT:
// starea reală + minutele scurse + ACU consumat. Un procent scris de mână ar minți.

import { creeazaSesiuneDevin, stareSesiuneDevin, asiguraTokenRepoLaDevin, type StareDevin } from './devin.js'
import { config } from '../config.js'
import { claimNextBuildJob, createBuildJob, reportBuildJob, updateBuildJobProgress, setDevinSessionId, getOldestRunningBuildJob, type BuildJob } from '../db.js'
import { notifyAdmin } from './adminNotification.js'
import { construiesteLocal, numeModelLocal } from './constructorLocal.js'

// ── REZERVA LOCALĂ RAPIDĂ (owner, 22 aug: „când pică Devin, treci AUTOMAT pe
// modelul free de pe VPS; când Devin revine, întoarce-te — RAPID, nu 3 ore") ──
// La ORICE eșec Devin (pornire eșuată SAU sesiune fără PR), încercăm IMEDIAT
// constructorul local free (Ollama pe VPS) — în secunde, nu cu timeout de ore.
// Dacă local reușește → jobul e 'done' cu brain 'local' + PR în chat. Dacă și
// local pică → abia atunci creierul/notificarea. Devin rămâne PRIMUL la fiecare
// tick (dispecerul îl încearcă întâi), deci revenirea la Devin e automată când
// cheia/quota lui e OK din nou — fără comutator manual.
async function rezervaLocalaSauEsec(job: BuildJob, motivDevin: string): Promise<void> {
  // AFIȘEAZĂ CARE CONSTRUCTOR LUCREAZĂ (owner, 22 aug: „când comută să afișeze
  // care e") — pe bară/monitor scrie explicit că a trecut pe modelul local + numele lui.
  const numeLocal = numeModelLocal()
  await updateBuildJobProgress(job.id, `Devin indisponibil → COMUTAT pe rezerva LOCALĂ (${numeLocal}, VPS)…`).catch(() => {})
  const local = await construiesteLocal(job.orderText, job.id).catch((e) => ({ ok: false as const, motiv: String(e).slice(0, 200) }))
  if (local.ok && local.prUrl) {
    await reportBuildJob(job.id, { status: 'done', prUrl: local.prUrl, brain: `local:${numeLocal}`, log: `Devin a picat (${motivDevin.slice(0, 120)}); rezerva LOCALĂ (${numeLocal}) a dus ordinul → PR ${local.prUrl}` })
    await instiinteazaAdmin('scris', `Rezerva LOCALĂ (${numeLocal}) a terminat ordinul #${job.id}`, `Devin era indisponibil, așa că modelul free de pe VPS (${numeLocal}) a rezolvat. PR gata: ${local.prUrl} — verifică și fă merge pe master.`, { jobId: job.id })
    return
  }
  // Nici Devin, nici local — raportăm CINSTIT ambele motive, apoi la creier.
  const failLog = `Devin: ${motivDevin.slice(0, 150)} | rezerva locală: ${local.ok ? 'fără PR' : (local.motiv ?? 'necunoscut')}`
  await reportBuildJob(job.id, { status: 'failed', brain: 'local', log: failLog })
  await instiinteazaAdmin('scris', `Ordinul #${job.id}: și Devin, și rezerva locală au picat`, failLog, { jobId: job.id })
  await colaborareCreierDevin(job, failLog)
}

// Înștiințare admin (ajunge în chat/notificări) — best-effort, nu crapă tick-ul.
async function instiinteazaAdmin(
  type: Parameters<typeof notifyAdmin>[0],
  titlu: string,
  mesaj: string,
  payload?: Record<string, unknown>,
): Promise<void> {
  try {
    await notifyAdmin(type, titlu, mesaj, payload)
  } catch (e) {
    console.error('[devin] înștiințare admin:', String(e).slice(0, 120))
  }
}

/** Promptul trimis lui Devin dintr-un ordin al owner-ului. Îi spune clar: ramură
 *  din master, PR ÎNAPOI la master, verde (tsc+teste+porți), NU face merge. */
export function construiestePromptDevin(orderText: string, jobId?: number): string {
  const branch = `kelion/job-${jobId ?? 'devin'}`
  return [
    'You are the Kelionai constructor (Devin). Work on the repository kelion-team/kelionai.',
    'Base branch: master.',
    `Task (from the app owner): ${orderText}`,
    '',
    'Before coding, read these files from the repo to understand the architecture, state and rules:',
    '- CONSTRUCTOR_SCHEMA.md — high-level application schema',
    '- AI-HANDOFF.md — current state, architecture and decisions',
    '- CLAUDE.md, AGENTS.md — rules for any AI working in this repo',
    '- RAMAS-DE-FACUT.md — what is not done / not working',
    '',
    `Branch: create a NEW branch ${branch} off master.`,
    'The environment secret KELION_GH_TOKEN is a GitHub token with write access. Use it for git auth: clone via https://x-access-token:$KELION_GH_TOKEN@github.com/kelion-team/kelionai, push your branch, and open the PR with it.',
    'Open a Pull Request TO master when done. Use the repository PR template.',
    "Do NOT merge manually. Kelion's santinelaPR will auto-merge the kelion/job-* PR when the 'porti-vps' check on GitHub is green and the branch is mergeable.",
    '',
    'Requirements:',
    '- Follow the repo conventions: no hardcoded values, use env/config/DB, keep chat/voice latency low, respect the AI-HANDOFF decisions.',
    '- Keep the build GREEN: `npx tsc --noEmit` (backend), `npx tsc -b --force` (frontend), `npx vitest run`, `node scripts/verifica-sintaxa.mjs`, `node scripts/verifica-hardcodari.mjs`, `npm run build` in frontend/.',
    '- Do NOT touch C:/Users/adria/Downloads/k (old archived project).',
    '- Do NOT modify admin/demo keys or routing without explicit owner approval.',
    '- When finished, write the PR URL clearly at the end of your final message.',
    '- Do NOT merge yourself — let Kelion auto-merge on green.',
  ].join('\n')
}

import { rationeaza } from './creierRationament.js'

/** Creierul de raționament (Gemini) face un plan înainte ca Devin să-și
 *  consume sesiunea. Rezultatul se anexează ordinului, ca Devin să pornească
 *  cu contextul gândirii deja făcut. Dacă creierul cade, ordinul intră gol
 *  (best-effort — nu oprim constructorul pentru o eroare de raționament). */
export async function planificaOrdinConstructor(orderText: string): Promise<string> {
  if (!orderText.trim()) return orderText
  const prompt = [
    'Ești creierul de raționament al aplicației Kelionai. Constructorul extern (Devin) va primi ordinul de mai jos.',
    'Înainte să pornească Devin, fă un plan concis pentru el:',
    '1. Ce fișiere/arhitectură să verifice (folosește referințe la CONSTRUCTOR_SCHEMA.md, AI-HANDOFF.md, CLAUDE.md, AGENTS.md).',
    '2. Ce anume să modifice și ce să NU modifice.',
    '3. Care porți trebuie să treacă (tsc, vitest, verifica-sintaxa, verifica-hardcodari, build frontend).',
    '4. Branch `kelion/job-<id>` și PR pe master; NU merge.',
    'Răspunde în cel mult 800 de cuvinte, clar și direct, în română sau engleză după limb ordinului.',
    '',
    `Ordinul: ${orderText}`,
  ].join('\n')
  try {
    const plan = await rationeaza(prompt, { ruta: 'constructor-plan', treapta: 'plan', maxTokens: 1200 })
    return `PLAN (făcut de creierul Kelion, înainte de Devin):\n${plan.trim()}\n\n---\n\nORDIN ORIGINAL:\n${orderText}`
  } catch (e) {
    console.error('[devin] planificare eșuată:', String(e).slice(0, 160))
    return orderText
  }
}

/** Când Devin eșuează, ordinul se DUCE ÎNAPOI la creier. Creierul analizează
 *  logul + planul original și produce un ordin REFINAT. Dacă e posibil,
 *  depune un nou job #2 (`kelion-escalare-creier`) pentru Devin — colaborare
 *  creier ⇄ Devin. Dacă creierul spune STOP, înștiințează ownerul și nu
 *  arde banii pe un eșec repetitiv. */
export async function colaborareCreierDevin(run: BuildJob, log: string): Promise<void> {
  if (run.orderedBy.startsWith('kelion-escalare-creier')) {
    console.log(`[devin] ordinul #${run.id} a eșuat și după intervenția creierului — nu mai reescaladez.`)
    await instiinteazaAdmin(
      'scris',
      `Devin + creier: ordinul #${run.id} rămâne blocat`,
      `Eșecul persistă chiar după refinarea de către creier. Log: ${log.slice(-400)}`,
      { jobId: run.id },
    )
    return
  }

  const prompt = [
    'Ești creierul de raționament Kelionai. Devin a încercat ordinul de mai jos și a eșuat.',
    'Analizează ORDINUL ORIGINAL, PLANUL și LOGUL. Dacă poți formula un ordin MAI BUN (mai specific, altă abordare, detalii suplimentare), răspunde DOAR cu textul ordinului refiat, fără explicații.',
    'Dacă eșecul e definitiv (de ex. cheie respinsă, repo inaccesibil, imposibil de făcut așa cum e cerut) răspunde cu exact: STOP: <motiv scurt>.',
    '',
    `Ordin original:\n${run.orderText}\n`,
    `Log Devin (eșec):\n${log.slice(-2000)}\n`,
  ].join('\n')

  try {
    const raspuns = (await rationeaza(prompt, { ruta: 'constructor-escalare', treapta: 'lucru', maxTokens: 1500 })).trim()
    if (/^STOP[:\s]/i.test(raspuns)) {
      await instiinteazaAdmin(
        'scris',
        `Creierul a oprit reîncercarea pentru ordinul #${run.id}`,
        `Motiv: ${raspuns.replace(/^STOP[:\s]*/i, '').slice(0, 500)}\nLog: ${log.slice(-400)}`,
        { jobId: run.id },
      )
      return
    }

    const orderRefinat = [
      `[[ESCALARE CREIER — ordinul #${run.id} a eșuat, creierul a reformulat]]`,
      raspuns,
    ].join('\n\n')
    const orderCuPlan = await planificaOrdinConstructor(orderRefinat)
    const newId = await createBuildJob('kelion-escalare-creier', orderCuPlan)
    if (newId) {
      console.log(`[devin] creierul a reformulat ordinul #${run.id} → nou ordin #${newId}`)
      // Pornește dispecerul imediat, dar nu recursiv în același stack.
      setTimeout(() => {
        tickDispecerDevin().catch((e) => console.error('[devin] tick după escalare:', String(e).slice(0, 160)))
      }, 0)
    } else {
      await instiinteazaAdmin('scris', `Escalare creier ratată pentru #${run.id}`, 'Noul ordin nu s-a putut depune în coadă.', { jobId: run.id })
    }
  } catch (e) {
    console.error('[devin] colaborare creier eșuată:', String(e).slice(0, 160))
    await instiinteazaAdmin('scris', `Eroare la escalarea creierului pentru #${run.id}`, String(e).slice(0, 300), { jobId: run.id })
  }
}

export interface ProgresDevin {
  /** Textul pentru bară/monitor — MĂSURAT (stare · minute · ACU), fără procent inventat. */
  bara: string
  /** Procent doar dacă vreodată Devin dă o fracție REALĂ; altfel null = bară indeterminată. */
  procent: number | null
  gata: boolean
  prUrl: string | null
  stare: string
}

/** Bara REALĂ dintr-o stare Devin + timpul scurs. Nu inventează procent. */
export function descrieProgresDevin(s: StareDevin, elapsedMs: number): ProgresDevin {
  const min = Math.max(0, Math.floor(elapsedMs / 60000))
  const parti = [`Devin: ${s.status}`]
  if (min > 0) parti.push(`${min} min`)
  if (s.acu != null) parti.push(`${s.acu.toFixed(1)} ACU`)
  return { bara: parti.join(' · '), procent: null, gata: s.gata, prUrl: s.prUrl, stare: s.status }
}

/** Pornește o sesiune Devin pentru un ordin. Întoarce id-ul sesiunii (de ținut pe
 *  job) + URL-ul ei (pentru monitor/istoric). */
export async function porneisteJobDevin(orderText: string, title?: string, jobId?: number): Promise<{ sessionId: string; url: string | null }> {
  // Întâi ne asigurăm că Devin are cu ce clona repo-ul (tokenul-secret). Fără el,
  // sesiunea ar porni și ar eșua la clonare — mai bine oprim aici, NUMIT.
  const acces = await asiguraTokenRepoLaDevin()
  if (!acces.ok) throw new Error(`devin_fara_acces_repo: ${acces.motiv ?? 'necunoscut'}`)
  const s = await creeazaSesiuneDevin(construiestePromptDevin(orderText, jobId), { title })
  return { sessionId: s.sessionId, url: s.url }
}

/** Verifică o sesiune și întoarce progresul REAL (pentru bară + „gata → PR"). */
export async function verificaJobDevin(sessionId: string, elapsedMs: number): Promise<ProgresDevin> {
  const s = await stareSesiuneDevin(sessionId)
  return descrieProgresDevin(s, elapsedMs)
}

// ── TICK-ul DISPECERULUI (Stage 4) — O trecere, pe bucla de autonomie ──────────
// Owner: 1a (doar la comandă → `claimNextBuildJob` ia ce a pus ordinul), UN job
// pe rând (ne întoarcem după jobul running), plafon de cost în client (max_acu).
// Anularea e SOFT (nu oprim sesiunea Devin din cloud — API-ul n-are stop confirmat
// încă): plafonul ACU ține costul în frâu; jobul iese din monitor la anulare.
// Inert când Devin nu e configurat ȘI în teste (nu pornește nimic fără cheie).
export async function tickDispecerDevin(): Promise<void> {
  if (!config.devinKey) return
  const run = await getOldestRunningBuildJob()
  if (run) {
    // Abia claimat / stale (fără sesiune încă) → NU pornim a doua sesiune (bani dubli).
    if (!run.devinSessionId) return
    try {
      const prog = await verificaJobDevin(run.devinSessionId, Date.now() - Date.parse(run.createdAt))
      if (prog.gata) {
        if (prog.prUrl) {
          await reportBuildJob(run.id, { status: 'done', prUrl: prog.prUrl, brain: 'devin', log: `Devin gata (${prog.stare}) → PR ${prog.prUrl}` })
          // ȘI ÎN CHAT (owner, 20 aug: „intră și pe chat"): linkul PR vine în
          // conversație, nu doar pe monitor — bucla se închide unde comanzi.
          await instiinteazaAdmin('scris', `Devin a terminat ordinul #${run.id}`, `PR gata: ${prog.prUrl} — verifică și fă merge pe master.`, { jobId: run.id })
        } else {
          // Sesiunea Devin s-a încheiat fără PR → rezerva locală preia RAPID.
          await rezervaLocalaSauEsec(run, `sesiune încheiată (${prog.stare}) fără PR`)
        }
      } else {
        await updateBuildJobProgress(run.id, prog.bara)
      }
    } catch (e) {
      console.error(`[devin] poll job #${run.id}:`, String(e).slice(0, 160))
    }
    return // UN job pe rând
  }
  // Nimic în lucru → ia următorul ordin din coadă și pornește Devin pe el.
  const job = await claimNextBuildJob()
  if (!job) return
  try {
    const { sessionId } = await porneisteJobDevin(job.orderText, `Ordin #${job.id}`, job.id)
    await setDevinSessionId(job.id, sessionId)
    await updateBuildJobProgress(job.id, 'Devin: pornit')
  } catch (e) {
    // Pornirea sesiunii Devin a eșuat (cheie/quota/repo) → rezerva locală preia
    // RAPID, în secunde, în loc să lase ordinul „eșuat" (owner: „nu 3 ore").
    await rezervaLocalaSauEsec(job, `pornire eșuată: ${String(e).slice(0, 200)}`)
  }
}
