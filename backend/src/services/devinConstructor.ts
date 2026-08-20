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

/** Promptul trimis lui Devin dintr-un ordin al owner-ului. Îi spune clar: ramură
 *  din master, PR ÎNAPOI la master, verde (tsc+teste+porți), NU face merge. */
export function construiestePromptDevin(orderText: string): string {
  return [
    'Repository: kelion-team/kelionai. Base branch: master.',
    `Task (from the app owner): ${orderText}`,
    '',
    'Requirements:',
    '- The environment secret KELION_GH_TOKEN is a GitHub token with write access to this repo. Use it for git auth: clone via https://x-access-token:$KELION_GH_TOKEN@github.com/kelion-team/kelionai, push your branch, and open the PR with it.',
    '- Work on a NEW branch off master and open a Pull Request TO master when done.',
    '- Follow the repo conventions in CLAUDE.md, AI-HANDOFF.md and PROIECT-CHAT-VOCE.md.',
    '- Keep the build GREEN: TypeScript (tsc --noEmit), tests (vitest run), and the repo gates (scripts/verifica-*.mjs) must all pass.',
    '- Use the repository PR template for the PR description.',
    '- Do NOT merge. The owner reviews and merges the PR himself.',
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
export async function porneisteJobDevin(orderText: string, title?: string): Promise<{ sessionId: string; url: string | null }> {
  // Întâi ne asigurăm că Devin are cu ce clona repo-ul (tokenul-secret). Fără el,
  // sesiunea ar porni și ar eșua la clonare — mai bine oprim aici, NUMIT.
  const acces = await asiguraTokenRepoLaDevin()
  if (!acces.ok) throw new Error(`devin_fara_acces_repo: ${acces.motiv ?? 'necunoscut'}`)
  const s = await creeazaSesiuneDevin(construiestePromptDevin(orderText), { title })
  return { sessionId: s.sessionId, url: s.url }
}

/** Verifică o sesiune și întoarce progresul REAL (pentru bară + „gata → PR"). */
export async function verificaJobDevin(sessionId: string, elapsedMs: number): Promise<ProgresDevin> {
  const s = await stareSesiuneDevin(sessionId)
  return descrieProgresDevin(s, elapsedMs)
}
