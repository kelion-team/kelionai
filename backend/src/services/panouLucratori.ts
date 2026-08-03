import { config } from '../config.js'
import { brainComplete } from './brain.js'
import { repoOpenPR } from './github.js'
import { resurseGazda, PRAG_INCARCARE_PCT } from './resurse.js'
import { LUCRATORI, ruleazaLucrator, lucratoriInstalati, type Propunere } from './lucratori.js'

// ── THE PANEL: THREE PROPOSE, THE BRAIN CHOOSES ─────────────────────────────
//
// Adrian, Jul 31: "all 3 must be started, each independent, the brain takes
// the best result proposed by them, after analysing the proposals".
//
// That's exactly what this file does:
//   1. checks whether the machine can take it (production has priority — always)
//   2. sees WHO is installed; one missing doesn't stop the panel, it gets said
//      and we proceed with the others
//   3. starts all installed workers IN PARALLEL, on the same task, with
//      DIFFERENT MODELS — otherwise it wouldn't be three opinions, it would be
//      the same opinion three times
//   4. collects the proposals: diff measured with git, tests run by us
//   5. gives the brain the proposals and has it CHOOSE, with a reason
//   6. opens ONE SINGLE PR, for the winner. Never a merge.
//
// WHY DIFFERENT MODELS: a panel's value is in diversity. Three tools on the
// same model give, most of the time, the same solution in other words. Each
// worker gets a different free brain, hence three paths of thought.
//
// WHY THE BRAIN CHOOSES, NOT A FORMULA: "best" is not "least code" and not
// "fastest". A 5-line proposal that repairs the cause beats a 200-line one
// that hides the symptom. That takes judgment, not arithmetic. But judgment
// gets FACTS as input: how many files, how many lines, tests PASS or NOT —
// measured, not declared by the tools about themselves.

/** How many workers can run at once. Three clones + three models + three test
 *  runs is already a lot on a machine that also hosts production. */
const MAX_PARALEL = 3

/** One panel at a time. The second gets a clear "no", not a silent queue. */
let ocupat = false

export interface RezultatPanou {
  ok: boolean
  motiv?: string
  /** Who was started, who was missing. */
  pornit: string[]
  lipsa: string[]
  propuneri: Propunere[]
  /** The chosen worker's name, if one was chosen. */
  castigator?: string
  /** Why it was chosen — in the brain's words. */
  judecata?: string
  pr?: string
}

/** DIFFERENT models for different workers — that's why it's a panel, not an
 *  echo. GEMINI-ONLY (3 aug — OpenRouter extirpat): trei trepte Gemini pe
 *  aceeași cheie, în forma LiteLLM `gemini/...` pe care o vorbesc uneltele. */
const MODELE = [
  'gemini/gemini-2.5-pro',
  'gemini/gemini-2.5-flash',
  'gemini/gemini-2.5-flash-lite',
]

/** A proposal's summary, for the brain. Facts only, in the order they matter
 *  to the judgment. */
function rezuma(p: Propunere, i: number): string {
  const cap = `### Propunerea ${i + 1} — ${p.lucrator} (model: ${p.model})`
  if (!p.ok) return `${cap}\nA EȘUAT: ${p.motiv ?? 'motiv necunoscut'}`
  if (!p.aSchimbat) return `${cap}\nN-a modificat nimic (${p.motiv ?? ''}).`
  const teste =
    p.testeTrec === null ? 'NU S-AU PUTUT RULA' : p.testeTrec ? 'TREC' : 'PICĂ'
  return (
    `${cap}\n` +
    `Fișiere atinse: ${p.fisiere} · +${p.adaugate} / −${p.sterse} rânduri · ${p.secunde}s\n` +
    `TESTELE PROIECTULUI: ${teste}\n` +
    `Ramura: ${p.branch}\n\n` +
    `\`\`\`diff\n${p.diff}\n\`\`\``
  )
}

/**
 * Starts the panel on a task. Returns the proposals, the judgment and the PR.
 * `raporteaza` gets the steps as they happen (for the monitor).
 */
export async function ruleazaPanou(
  sarcina: string,
  raporteaza?: (pas: string) => void,
): Promise<RezultatPanou> {
  const spune = (s: string): void => {
    raporteaza?.(s)
  }
  const gol: RezultatPanou = { ok: false, pornit: [], lipsa: [], propuneri: [] }

  const text = sarcina.trim()
  if (text.length < 10) return { ...gol, motiv: 'sarcina e prea scurtă ca să însemne ceva' }
  if (ocupat) return { ...gol, motiv: 'rulează deja un panou — unul singur odată' }
  if (!config.githubToken) return { ...gol, motiv: 'lipsește GITHUB_TOKEN — lucrătorii nu pot clona' }

  // ── PRODUCTION HAS PRIORITY ────────────────────────────────────────────────
  // Three workers in parallel means three clones, three models and three test
  // runs on the machine that also hosts the app. If it's already loaded, the
  // panel does NOT start — a repair isn't worth a page that moves slowly.
  const res = await resurseGazda()
  if (res && res.incarcarePct >= PRAG_INCARCARE_PCT) {
    return { ...gol, motiv: `VPS-ul e încărcat ${res.incarcarePct}% — nu pornesc panoul acum, ar călca producția` }
  }
  if (res && res.liberGb < 2) {
    return { ...gol, motiv: `au mai rămas ${res.liberGb.toFixed(1)} GB liberi — prea puțin pentru trei lucrători` }
  }

  ocupat = true
  try {
    const instalati = await lucratoriInstalati()
    const echipa = LUCRATORI.filter((l) => instalati.includes(l.nume)).slice(0, MAX_PARALEL)
    const lipsa = LUCRATORI.filter((l) => !instalati.includes(l.nume)).map((l) => l.nume)
    if (!echipa.length) {
      return { ...gol, lipsa, motiv: `niciun lucrător instalat (lipsesc: ${lipsa.join(', ')})` }
    }
    spune(`Pornesc ${echipa.length} lucrători în paralel: ${echipa.map((l) => l.nume).join(', ')}` +
      (lipsa.length ? ` (lipsesc: ${lipsa.join(', ')})` : ''))

    // ALL AT ONCE, independent. `allSettled`: one that crashes doesn't stop
    // the others — that's why there are three.
    const rezultate = await Promise.allSettled(
      echipa.map((l, i) => ruleazaLucrator(l, MODELE[i % MODELE.length], text)),
    )
    const propuneri: Propunere[] = rezultate.map((r, i) =>
      r.status === 'fulfilled'
        ? r.value
        : {
            lucrator: echipa[i].nume, model: MODELE[i % MODELE.length], ok: false,
            motiv: String(r.reason).slice(0, 200), aSchimbat: false,
            fisiere: 0, adaugate: 0, sterse: 0, diff: '', testeTrec: null, secunde: 0, log: '',
          },
    )
    for (const p of propuneri) {
      spune(`${p.lucrator}: ${p.aSchimbat ? `${p.fisiere} fișiere, teste ${p.testeTrec ? 'TREC' : p.testeTrec === null ? 'nerulate' : 'PICĂ'}` : (p.motiv ?? 'nimic')}`)
    }

    const valide = propuneri.filter((p) => p.ok && p.aSchimbat)
    if (!valide.length) {
      return { ok: true, pornit: echipa.map((l) => l.nume), lipsa, propuneri, motiv: 'niciun lucrător n-a produs o modificare' }
    }

    // ── THE JUDGMENT ─────────────────────────────────────────────────────────
    // A single brain call, with the FACTS in front. We don't ask it to guess
    // whether it works — we tell it ourselves, measured, and have it weigh.
    spune(`Creierul compară ${valide.length} propuneri…`)
    const intrebare =
      `Ai ${valide.length} propuneri INDEPENDENTE pentru aceeași sarcină. Alege UNA.\n\n` +
      `SARCINA CERUTĂ DE OWNER:\n> ${text}\n\n` +
      valide.map(rezuma).join('\n\n') +
      `\n\n---\nCUM ALEGI, în ordinea asta:\n` +
      `1. O propunere care PICĂ testele nu se alege decât dacă toate pică.\n` +
      `2. Rezolvă CAUZA cerută, nu simptomul, și nu face altceva pe lângă.\n` +
      `3. Mai puțin cod care face treaba bate mai mult cod. Dar 5 rânduri care\n` +
      `   repară cauza bat 200 care ascund simptomul — nu număra, judecă.\n` +
      `4. Nu șterge cod fără motiv. O propunere care taie mult și explică puțin\n` +
      `   e suspectă (pe 31 iul un fișier de 1049 de rânduri a ajuns la 14 așa).\n\n` +
      `Răspunde EXACT în formatul:\n` +
      `ALEG: <numele lucrătorului>\n` +
      `MOTIV: <2-4 propoziții, concret, cu ce anume din diff te-a convins>`

    const verdict = await brainComplete(intrebare, 700).catch(() => '')
    const numeAles = /ALEG:\s*([a-z0-9_-]+)/i.exec(verdict)?.[1]?.toLowerCase() ?? ''
    const motivAles = /MOTIV:\s*([\s\S]+)/i.exec(verdict)?.[1]?.trim() ?? ''

    // If the brain didn't answer in format (or at all), we do NOT invent a
    // silent winner: we fall back on a written rule, and we SAY we fell back
    // on it.
    let castigator = valide.find((p) => p.lucrator.toLowerCase() === numeAles)
    let judecata = motivAles
    if (!castigator) {
      castigator = valide.find((p) => p.testeTrec) ?? valide[0]
      judecata =
        `(Creierul n-a dat un verdict în format — am ales după regula scrisă: ` +
        `prima propunere cu testele verzi.)${verdict ? `\n\nCe a răspuns: ${verdict.slice(0, 300)}` : ''}`
    }
    spune(`Ales: ${castigator.lucrator}`)

    const pr = await repoOpenPR(
      castigator.branch ?? '',
      `Panou: ${text.slice(0, 60)}`,
      `Sarcină dată de owner prin Kelion:\n\n> ${text}\n\n` +
        `## Cum s-a ales\n\n${judecata}\n\n` +
        `## Toate propunerile\n\n` +
        propuneri
          .map((p) =>
            `- **${p.lucrator}** (${p.model}) — ` +
            (p.ok && p.aSchimbat
              ? `${p.fisiere} fișiere, +${p.adaugate}/−${p.sterse}, teste ${p.testeTrec === null ? 'nerulate' : p.testeTrec ? '✅' : '❌'}, ${p.secunde}s` +
                (p.lucrator === castigator?.lucrator ? '  ← **ALES**' : ` (ramura \`${p.branch}\`)`)
              : `nu a propus nimic: ${p.motiv ?? '—'}`),
          )
          .join('\n') +
        `\n\n**Nu s-a făcut merge — te uiți tu.**`,
    ).catch((e: Error) => `PR nedeschis: ${e.message}`)

    return {
      ok: true,
      pornit: echipa.map((l) => l.nume),
      lipsa,
      propuneri,
      castigator: castigator.lucrator,
      judecata,
      pr,
    }
  } catch (e) {
    return { ...gol, motiv: e instanceof Error ? e.message : String(e) }
  } finally {
    ocupat = false
  }
}
