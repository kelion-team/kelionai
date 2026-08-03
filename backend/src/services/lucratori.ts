import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { config } from '../config.js'
import { normalizeBranch } from './github.js'

// ── THREE WORKERS WHO PROPOSE, ONE BRAIN WHO CHOOSES ───────────────────────
//
// Adrian, Jul 31: "all 3 must be started, each independent, the brain takes
// the best result they propose, after analysing the proposals".
//
// Here are the three. Each gets the SAME task, works in HIS clone, on HIS
// branch, in HIS process — and returns a proposal. They don't open PRs, don't
// merge, don't talk to each other. The judgement belongs to the brain
// (`panouLucratori.ts`).
//
// ── A CORRECTION OF MINE, written here so it isn't lost ────────────────────
// I told Adrian that "Cline can't run on a server, it's a VS Code extension,
// it only works with you at the keyboard". WRONG. Cline has a fully headless
// CLI (`cline --auto-approve true --json`), and the information was right
// there in the results I had read two hours earlier — and I skipped over it.
// He insisted ("can't you put vscode on linux? or what's the problem") and he
// was right. Same for OpenHands: `openhands --headless -t`.
// It wasn't a limitation of the tools. It was mine.
//
// ── WHY EACH ONE WITH HIS OWN CLONE ─────────────────────────────────────────
// `.dockerignore` excludes `.git`, so the container has the project files but
// NOT the repo — and all three are git-native. And two workers in the same
// directory would step on each other. Independence is literal: another
// directory, another branch, another process.
//
// ── WHY WE MEASURE WITH GIT, NOT WITH WHAT THEY SAY ─────────────────────────
// Each tool narrates its work differently. A report in its own words is a
// claim; `git diff --shortstat` is a measurement. Everything that enters the
// judgement comes from git and from tests run by US — nothing on trust.

/** Maximum wall time for one worker. After it, the process is KILLED. */
export const LIMITA_LUCRATOR_MS = 12 * 60_000
/** How much of the log is kept. A 40MB log returned in chat isn't a report, it's a flood. */
const LOG_MAX = 5_000
/** How much of the diff reaches the brain for judgement. */
const DIFF_MAX = 20_000

export interface Lucrator {
  /** The short name, used in branches and in the report. */
  nume: string
  /** The command that tells us whether it's installed. */
  verificare: [string, string[]]
  /** The work command: takes the task and the model, returns [cmd, args]. */
  comanda: (sarcina: string, model: string) => [string, string[]]
  /** What it's good at — goes into the report for the brain, so it judges knowingly. */
  descriere: string
}

// The three. Order doesn't matter — they run in parallel.
export const LUCRATORI: Lucrator[] = [
  {
    nume: 'aider',
    verificare: ['aider', ['--version']],
    // `--auto-commits`: YES here (unlike the manual use in `.aider.conf.yml`),
    // because otherwise we'd have nothing to compare: the proposal IS the
    // commit. `--model` is FORCED, not inherited from a file — the model must
    // be explicit, not something that changes under us from a file.
    comanda: (s, m) => [
      'aider',
      ['--message', s, '--model', m, '--yes-always', '--no-analytics', '--no-check-update', '--auto-commits'],
    ],
    descriere: 'git-nativ, editează prin blocuri căutare→înlocuire; rulează testele în bucla lui și repară din erori',
  },
  {
    nume: 'cline',
    verificare: ['cline', ['--version']],
    // `--auto-approve true`: nobody sits by the terminal. `--json`: structured
    // output, and it also triggers headless mode.
    comanda: (s, m) => ['cline', ['--auto-approve', 'true', '--json', '-m', m, s]],
    descriere: 'agent de cod care face întâi un plan explicit, apoi execută; alt stil de lucru decât Aider',
  },
  {
    nume: 'openhands',
    verificare: ['openhands', ['--version']],
    // The only one with a BROWSER: it can open the page and verify live, not
    // just run tests. It takes the model from the environment (LLM_MODEL), not
    // as an argument.
    comanda: (s) => ['openhands', ['--headless', '-t', s]],
    descriere: 'are BROWSER — poate deschide pagina live și verifica vizual, nu doar rula teste',
  },
  {
    // AGENTUL OFICIAL GOOGLE (Adrian, 3 aug: „dă-mi... și suita oficială de la
    // Google"). Gemini CLI rulează headless pe cheia GEMINI_API_KEY din mediu
    // (aceeași ca tot creierul): `-p` = prompt non-interactiv, `--yolo` =
    // execută uneltele fără să aștepte un om la terminal. Modelul vine fără
    // prefixul LiteLLM (`gemini/`), fiindcă CLI-ul e nativ Google.
    nume: 'gemini-cli',
    verificare: ['gemini', ['--version']],
    comanda: (s, m) => ['gemini', ['-p', s, '-m', m.replace(/^gemini\//, ''), '--yolo']],
    descriere: 'agentul OFICIAL Google — nativ pe cheia Gemini, scrie cod și execută comenzi în terminal; al doilea punct de vedere „de la sursă"',
  },
]

export interface Propunere {
  lucrator: string
  model: string
  ok: boolean
  /** Why it didn't work, when it didn't. Empty on success. */
  motiv?: string
  branch?: string
  aSchimbat: boolean
  /** The figures from `git diff --shortstat` — measured, not narrated. */
  fisiere: number
  adaugate: number
  sterse: number
  /** The proposal's diff, capped. This is what the brain judges. */
  diff: string
  /** Did the tests pass AFTER the change? Run by US. `null` = we never got there. */
  testeTrec: boolean | null
  secunde: number
  log: string
}

/** Runs a command with a time cap and capped output. Never throws: a failure
 *  from here is information, not an exception. */
function ruleaza(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; limitaMs: number },
): Promise<{ cod: number; text: string; ucis: boolean }> {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { cwd: opts.cwd, env: opts.env ?? process.env })
    let text = ''
    let ucis = false
    const adauga = (b: Buffer): void => {
      if (text.length < LOG_MAX * 6) text += b.toString('utf8')
    }
    p.stdout.on('data', adauga)
    p.stderr.on('data', adauga)
    const ceas = setTimeout(() => {
      ucis = true
      p.kill('SIGKILL')
    }, opts.limitaMs)
    p.on('close', (cod) => {
      clearTimeout(ceas)
      resolve({ cod: cod ?? -1, text, ucis })
    })
    p.on('error', (e) => {
      clearTimeout(ceas)
      resolve({ cod: -1, text: `${text}\n${String(e)}`, ucis })
    })
  })
}

const coada = (t: string, max = LOG_MAX): string => (t.length > max ? `…\n${t.slice(-max)}` : t)

/** Which of the three are installed NOW. Checked, not assumed — if one is
 *  missing, the panel says which and carries on with the others. */
export async function lucratoriInstalati(): Promise<string[]> {
  const gasiti: string[] = []
  await Promise.all(
    LUCRATORI.map(async (l) => {
      const r = await ruleaza(l.verificare[0], l.verificare[1], { limitaMs: 20_000 })
      if (r.cod === 0) gasiti.push(l.nume)
    }),
  )
  return gasiti
}

/**
 * Sets ONE worker on the task. Returns its proposal.
 * It doesn't open a PR and doesn't merge — it only proposes.
 */
export async function ruleazaLucrator(
  lucrator: Lucrator,
  model: string,
  sarcina: string,
): Promise<Propunere> {
  const t0 = Date.now()
  const sec = (): number => Math.round((Date.now() - t0) / 1000)
  const gol: Propunere = {
    lucrator: lucrator.nume, model, ok: false, aSchimbat: false,
    fisiere: 0, adaugate: 0, sterse: 0, diff: '', testeTrec: null, secunde: 0, log: '',
  }

  const token = config.githubToken
  if (!token) return { ...gol, motiv: 'lipsește GITHUB_TOKEN — nu pot clona', secunde: sec() }
  if (!config.geminiKey) return { ...gol, motiv: 'lipsește cheia Gemini — n-are creier', secunde: sec() }

  let lucru = ''
  try {
    lucru = await mkdtemp(path.join(tmpdir(), `${lucrator.nume}-`))
    const url = `https://x-access-token:${token}@github.com/${config.githubRepo}.git`
    const branch = normalizeBranch(`panou/${lucrator.nume}-${Date.now().toString(36)}`)

    const clona = await ruleaza('git', ['clone', '--depth', '1', url, lucru], { limitaMs: 180_000 })
    if (clona.cod !== 0) return { ...gol, motiv: 'clonarea a eșuat', log: coada(clona.text), secunde: sec() }

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
      // The name it signs with — so history shows WHO proposed.
      GIT_AUTHOR_NAME: `Kelion (${lucrator.nume})`,
      GIT_AUTHOR_EMAIL: 'kelion@kelionai.app',
      GIT_COMMITTER_NAME: `Kelion (${lucrator.nume})`,
      GIT_COMMITTER_EMAIL: 'kelion@kelionai.app',
      // OpenHands takes the model from the environment, not as a CLI argument.
      // GEMINI DIRECT (3 aug — OpenRouter extirpat): toți muncitorii primesc
      // cheia Gemini a ownerului; `model` vine deja în forma LiteLLM
      // `gemini/...` (vezi MODELE în panouLucratori.ts), pe care o înțeleg
      // toate trei uneltele (aider/cline/openhands folosesc LiteLLM dedesubt).
      LLM_MODEL: model.includes('/') ? model : `gemini/${model}`,
      LLM_API_KEY: config.geminiKey,
      GEMINI_API_KEY: config.geminiKey,
    }
    await ruleaza('git', ['checkout', '-b', branch], { cwd: lucru, env, limitaMs: 30_000 })
    const inainte = await ruleaza('git', ['rev-parse', 'HEAD'], { cwd: lucru, env, limitaMs: 20_000 })

    const [cmd, args] = lucrator.comanda(sarcina, model)
    const a = await ruleaza(cmd, args, { cwd: lucru, env, limitaMs: LIMITA_LUCRATOR_MS })
    const log = coada(a.text)
    if (a.ucis) {
      return { ...gol, motiv: `oprit la limita de ${LIMITA_LUCRATOR_MS / 60_000} minute`, log, secunde: sec() }
    }

    // Some commit on their own, others leave the changes uncommitted. We take
    // both: if anything is left in the tree, we commit it ourselves — the
    // proposal must be a commit, so it can be compared and pushed.
    const murdar = await ruleaza('git', ['status', '--porcelain'], { cwd: lucru, env, limitaMs: 20_000 })
    if (murdar.text.trim()) {
      await ruleaza('git', ['add', '-A'], { cwd: lucru, env, limitaMs: 60_000 })
      await ruleaza('git', ['commit', '-m', `${lucrator.nume}: ${sarcina.slice(0, 60)}`], { cwd: lucru, env, limitaMs: 60_000 })
    }

    // Did it change anything? We ask GIT, against where it started — we don't
    // guess from what the tool narrated about itself.
    const baza = inainte.text.trim()
    const stat = await ruleaza('git', ['diff', '--shortstat', baza, 'HEAD'], { cwd: lucru, env, limitaMs: 30_000 })
    const m = /(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/.exec(stat.text)
    const fisiere = Number(m?.[1] ?? 0)
    if (!fisiere) return { ...gol, ok: true, motiv: 'n-a modificat nimic', log, secunde: sec() }

    const d = await ruleaza('git', ['diff', baza, 'HEAD'], { cwd: lucru, env, limitaMs: 30_000 })

    // THE TESTS — run by US, after the change. A proposal that fails the tests
    // isn't a proposal, it's a problem; and the brain must learn that as a
    // measured fact, not from what the tool wrote in its log about itself.
    const t = await ruleaza('npx', ['vitest', 'run'], {
      cwd: path.join(lucru, 'backend'), env, limitaMs: 6 * 60_000,
    })
    const testeTrec = t.cod === 0 && /Tests\s+\d+ passed/.test(t.text) && !/\d+ failed/.test(t.text)

    const push = await ruleaza('git', ['push', '-u', 'origin', branch], { cwd: lucru, env, limitaMs: 120_000 })
    if (push.cod !== 0) {
      return { ...gol, motiv: 'push-ul a eșuat', log: coada(`${log}\n${push.text}`), secunde: sec() }
    }

    return {
      lucrator: lucrator.nume, model, ok: true, branch, aSchimbat: true,
      fisiere,
      adaugate: Number(m?.[2] ?? 0),
      sterse: Number(m?.[3] ?? 0),
      diff: coada(d.text, DIFF_MAX),
      testeTrec,
      secunde: sec(),
      log,
    }
  } catch (e) {
    return { ...gol, motiv: e instanceof Error ? e.message : String(e), secunde: sec() }
  } finally {
    if (lucru) await rm(lucru, { recursive: true, force: true }).catch(() => {})
  }
}
