import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { config } from '../config.js'
import { normalizeBranch } from './github.js'

// ── TREI LUCRĂTORI CARE PROPUN, UN CREIER CARE ALEGE ────────────────────────
//
// Adrian, 31 iul: „trebuie pornite toate 3, fiecare independent, creierul ia
// care e cel mai bun rezultat propus de ei, după ce analizează propunerile".
//
// Aici sunt cei trei. Fiecare primește ACEEAȘI sarcină, lucrează în clona LUI,
// pe ramura LUI, în procesul LUI — și întoarce o propunere. Nu deschid PR, nu
// fac merge, nu vorbesc între ei. Judecata e a creierului (`panouLucratori.ts`).
//
// ── O CORECTURĂ DE-A MEA, scrisă aici ca să nu se piardă ──────────────────
// I-am spus lui Adrian că „Cline nu poate rula pe server, e extensie de VS Code,
// merge doar cu tine la tastatură". GREȘIT. Cline are CLI complet headless
// (`cline --auto-approve true --json`), iar informația era chiar în rezultatele
// pe care le citisem eu cu două ore înainte — și am trecut peste ea. El a
// insistat („nu se poate pune vscode pe linux? sau care e problema") și avea
// dreptate. La fel OpenHands: `openhands --headless -t`.
// Nu era o limitare a uneltelor. Era a mea.
//
// ── DE CE FIECARE CU CLONA LUI ─────────────────────────────────────────────
// `.dockerignore` exclude `.git`, deci containerul are fișierele proiectului
// dar NU are repo — iar toți trei sunt git-nativi. Și doi lucrători în același
// director s-ar călca în picioare. Independența e literală: alt director, altă
// ramură, alt proces.
//
// ── DE CE MĂSURĂM CU GIT, NU CU CE SPUN EI ────────────────────────────────
// Fiecare unealtă își povestește altfel munca. Un raport în cuvintele ei e o
// afirmație; `git diff --shortstat` e o măsurătoare. Tot ce intră în judecată
// vine din git și din testele rulate de NOI — nimic pe încredere.

/** Timp maxim de perete pentru un lucrător. După el, procesul e UCIS. */
export const LIMITA_LUCRATOR_MS = 12 * 60_000
/** Cât din jurnal se ține. Un log de 40MB întors în chat nu e raport, e potop. */
const LOG_MAX = 5_000
/** Cât din diff ajunge la creier ca să judece. */
const DIFF_MAX = 20_000

export interface Lucrator {
  /** Numele scurt, folosit în ramuri și în raport. */
  nume: string
  /** Comanda prin care aflăm dacă e instalat. */
  verificare: [string, string[]]
  /** Comanda de lucru: primește sarcina și modelul, întoarce [cmd, args]. */
  comanda: (sarcina: string, model: string) => [string, string[]]
  /** La ce e bun — intră în raportul pentru creier, ca să judece în cunoștință. */
  descriere: string
}

// Cei trei. Ordinea nu contează — rulează în paralel.
export const LUCRATORI: Lucrator[] = [
  {
    nume: 'aider',
    verificare: ['aider', ['--version']],
    // `--auto-commits`: DA aici (spre deosebire de folosirea manuală din
    // `.aider.conf.yml`), fiindcă altfel n-am avea ce compara: propunerea E
    // commit-ul. `--model` e IMPUS, nu moștenit din fișier — modelul trebuie
    // să fie explicit, nu ceva ce se schimbă pe sub noi dintr-un fișier.
    comanda: (s, m) => [
      'aider',
      ['--message', s, '--model', m, '--yes-always', '--no-analytics', '--no-check-update', '--auto-commits'],
    ],
    descriere: 'git-nativ, editează prin blocuri căutare→înlocuire; rulează testele în bucla lui și repară din erori',
  },
  {
    nume: 'cline',
    verificare: ['cline', ['--version']],
    // `--auto-approve true`: nimeni nu stă lângă terminal. `--json`: ieșire
    // structurată, și tot ea declanșează modul headless.
    comanda: (s, m) => ['cline', ['--auto-approve', 'true', '--json', '-m', m, s]],
    descriere: 'agent de cod care face întâi un plan explicit, apoi execută; alt stil de lucru decât Aider',
  },
  {
    nume: 'openhands',
    verificare: ['openhands', ['--version']],
    // Singurul cu BROWSER: poate deschide pagina și verifica pe viu, nu doar
    // să ruleze teste. Modelul îl ia din mediu (LLM_MODEL), nu ca argument.
    comanda: (s) => ['openhands', ['--headless', '-t', s]],
    descriere: 'are BROWSER — poate deschide pagina live și verifica vizual, nu doar rula teste',
  },
]

export interface Propunere {
  lucrator: string
  model: string
  ok: boolean
  /** De ce n-a mers, când n-a mers. Gol la reușită. */
  motiv?: string
  branch?: string
  aSchimbat: boolean
  /** Cifrele din `git diff --shortstat` — măsurate, nu povestite. */
  fisiere: number
  adaugate: number
  sterse: number
  /** Diff-ul propunerii, plafonat. Ăsta e ce judecă creierul. */
  diff: string
  /** Au trecut testele DUPĂ modificare? Rulate de NOI. `null` = n-am ajuns acolo. */
  testeTrec: boolean | null
  secunde: number
  log: string
}

/** Rulează o comandă cu timp maxim și ieșire plafonată. Nu aruncă: un eșec de
 *  aici e o informație, nu o excepție. */
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

/** Care dintre cei trei sunt instalați ACUM. Verificat, nu presupus — dacă
 *  lipsește unul, panoul spune care și merge mai departe cu ceilalți. */
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
 * Pune UN lucrător să rezolve sarcina. Întoarce propunerea lui.
 * Nu deschide PR și nu face merge — doar propune.
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
  if (!config.openrouter.key) return { ...gol, motiv: 'lipsește cheia OpenRouter — n-are creier', secunde: sec() }

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
      // Numele cu care semnează — ca să se vadă în istorie CINE a propus.
      GIT_AUTHOR_NAME: `Kelion (${lucrator.nume})`,
      GIT_AUTHOR_EMAIL: 'kelion@kelionai.app',
      GIT_COMMITTER_NAME: `Kelion (${lucrator.nume})`,
      GIT_COMMITTER_EMAIL: 'kelion@kelionai.app',
      // OpenHands ia modelul din mediu, nu ca argument de linie de comandă.
      LLM_MODEL: `openrouter/${model}`,
      LLM_API_KEY: config.openrouter.key,
      OPENROUTER_API_KEY: config.openrouter.key,
    }
    await ruleaza('git', ['checkout', '-b', branch], { cwd: lucru, env, limitaMs: 30_000 })
    const inainte = await ruleaza('git', ['rev-parse', 'HEAD'], { cwd: lucru, env, limitaMs: 20_000 })

    const [cmd, args] = lucrator.comanda(sarcina, model)
    const a = await ruleaza(cmd, args, { cwd: lucru, env, limitaMs: LIMITA_LUCRATOR_MS })
    const log = coada(a.text)
    if (a.ucis) {
      return { ...gol, motiv: `oprit la limita de ${LIMITA_LUCRATOR_MS / 60_000} minute`, log, secunde: sec() }
    }

    // Unii comit singuri, alții lasă modificările necomise. Le luăm pe amândouă:
    // dacă a rămas ceva în arbore, comităm noi — propunerea trebuie să fie un
    // commit, ca să poată fi comparată și împinsă.
    const murdar = await ruleaza('git', ['status', '--porcelain'], { cwd: lucru, env, limitaMs: 20_000 })
    if (murdar.text.trim()) {
      await ruleaza('git', ['add', '-A'], { cwd: lucru, env, limitaMs: 60_000 })
      await ruleaza('git', ['commit', '-m', `${lucrator.nume}: ${sarcina.slice(0, 60)}`], { cwd: lucru, env, limitaMs: 60_000 })
    }

    // A schimbat ceva? Întrebăm GIT-ul, față de unde a pornit — nu ghicim din
    // ce a povestit unealta despre sine.
    const baza = inainte.text.trim()
    const stat = await ruleaza('git', ['diff', '--shortstat', baza, 'HEAD'], { cwd: lucru, env, limitaMs: 30_000 })
    const m = /(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/.exec(stat.text)
    const fisiere = Number(m?.[1] ?? 0)
    if (!fisiere) return { ...gol, ok: true, motiv: 'n-a modificat nimic', log, secunde: sec() }

    const d = await ruleaza('git', ['diff', baza, 'HEAD'], { cwd: lucru, env, limitaMs: 30_000 })

    // TESTELE — rulate de NOI, după modificare. O propunere care pică testele
    // nu e o propunere, e o problemă; iar creierul trebuie să afle asta ca
    // fapt măsurat, nu din ce a scris unealta în jurnalul ei despre sine.
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
