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
import { claimNextBuildJob, reportBuildJob, updateBuildJobProgress, setDevinSessionId, getOldestRunningBuildJob } from '../db.js'
import { notifyAdmin } from './adminNotification.js'

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
    'Do NOT merge manually. Kelion\\'s santinelaPR will auto-merge the kelion/job-* PR when the "porti-vps" check on GitHub is green and the branch is mergeable.',
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
          await reportBuildJob(run.id, { status: 'failed', brain: 'devin', log: `Devin ${prog.stare} fără PR deschis` })
          await instiinteazaAdmin('scris', `Devin: ordinul #${run.id} nu s-a finalizat`, `Sesiunea Devin s-a încheiat (${prog.stare}) fără PR deschis. Repornește-l (Reia) după ce vezi de ce.`, { jobId: run.id })
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
    await reportBuildJob(job.id, { status: 'failed', brain: 'devin', log: `Devin pornire eșuată: ${String(e).slice(0, 300)}` })
  }
}
