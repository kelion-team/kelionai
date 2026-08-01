// ── REQUIREMENT MANAGEMENT + SOLUTION EVALUATION ─────────────────────────────
//
// Adrian, Jul 30: "I need advanced systems allocated to Kelion for requirement
// management, advanced evaluations of the offered solutions" · "continuous
// analysis and improvement of the implementation / resolution possibilities
// for the requirements".
//
// WHY IT'S NEEDED, measured from today, not from theory: one of his
// requirements lived in three places that didn't talk to each other — a
// hand-written row in `RAMAS-DE-FACUT.md`, an order in `build_jobs` with no
// link to the requirement, and sometimes only in chat, where it got lost.
// That's why "I asked you dozens of times" was TRUE and unprovable at the same
// time. And that's why someone (me) started building on the first idea that
// came to mind, without laying the options side by side — email, portal, API —
// and each one fell in turn.
//
// Here the requirement has ONE path, with three gates:
//   1. ANALYSIS — before a line of code is written, 2-4 REAL options are laid
//      on the table, each scored on five axes and with what can kill it. One
//      is chosen, with a written reason. An option that depends on the owner
//      is marked as such.
//   2. EXECUTION — the order ships with the chosen variant and the acceptance
//      criterion glued to it, so the target doesn't move after delivery.
//   3. CONTINUOUS IMPROVEMENT — what's delivered gets revisited periodically:
//      "could it be better, now, with what we know in addition?" If yes, a new
//      requirement comes out, linked to the first. Without this, the system
//      delivers once and freezes.
import { brainComplete } from './brain.js'
import { adaugaCerinta, listeazaCerinte, actualizeazaCerinta, type Cerinta } from '../db.js'

/** A resolution option, as it gets laid on the table. */
export interface Varianta {
  nume: string
  cum: string
  /** 0-10: how COMPLETELY it resolves the requirement (not how elegant it is). */
  rezolva: number
  /** 0-10: how fast it can be delivered (10 = today). */
  rapid: number
  /** 0-10: how little it risks breaking what already works (10 = zero risk). */
  sigur: number
  /** 0-10: how little it costs, in money and in the owner's time (10 = free). */
  ieftin: number
  /** 0-10: how little it depends on the owner or third parties (10 = not at all). */
  independent: number
  /** What can kill it. Written HONESTLY — an option without risks is an
   *  unanalyzed option. */
  risc: string
  /** HOW HARD it is to carry, 1..5 (Adrian, Jul 30: "by difficulty level, set
   *  automatically per requirement"). Not decoration: the HAND that works is
   *  chosen from it — a big model on a heavy task, a free one on a rename.
   *  Chosen together with the variant, because difficulty depends on the
   *  CHOSEN PATH, not just the requirement: "through the browser on the
   *  portal" is a different thing from "change a text". */
  dificultate?: number
}

/** The level the order starts with, clamped. Without it → 3: better to start
 *  with a good hand than to burn half the budget discovering it was heavy. */
export function nivelDificultate(v: Varianta | undefined): number {
  const n = Math.round(Number(v?.dificultate ?? 3))
  return Math.max(1, Math.min(5, Number.isFinite(n) ? n : 3))
}

/** The final score. The weights say what matters in THIS project, in the
 *  order the owner said it throughout the day: must RESOLVE (otherwise no
 *  point), must not ask HIM for time anymore (he lost a day in portals), must
 *  not break what works, must be fast, must not cost. */
export function scor(v: Varianta): number {
  const n = (x: number): number => Math.max(0, Math.min(10, Number(x) || 0))
  return (
    n(v.rezolva) * 0.35 +
    n(v.independent) * 0.25 +
    n(v.sigur) * 0.18 +
    n(v.rapid) * 0.12 +
    n(v.ieftin) * 0.1
  )
}

/** The best option + why. Pure, so it can be kept under test: the choice must
 *  NOT depend on the model's mood. */
export function alege(variante: Varianta[]): { castigatoare: Varianta; motiv: string } | null {
  if (!variante.length) return null
  const cu = variante.map((v) => ({ v, s: scor(v) })).sort((a, b) => b.s - a.s)
  const c = cu[0]
  const alDoilea = cu[1]
  const motiv = alDoilea
    ? `„${c.v.nume}" (scor ${c.s.toFixed(1)}) bate „${alDoilea.v.nume}" (${alDoilea.s.toFixed(1)}): ` +
      `rezolvă ${c.v.rezolva}/10 și depinde de owner cât mai puțin (${c.v.independent}/10). Risc: ${c.v.risc}`
    : `singura variantă pusă pe masă: „${c.v.nume}". Risc: ${c.v.risc}`
  return { castigatoare: c.v, motiv }
}

const AXE =
  `rezolva (cât de COMPLET rezolvă cerința), rapid (cât de repede se livrează), ` +
  `sigur (cât de puțin riscă să strice ce merge), ieftin (bani + timpul ownerului), ` +
  `independent (cât de puțin depinde de owner sau de terți)`

// What each level means — written explicitly, so the grades aren't by ear.
const SCARA_DIFICULTATE =
  `1 = banal (un text, o culoare, o redenumire); ` +
  `2 = simplu (o funcție mică, un câmp nou, într-un singur fișier); ` +
  `3 = mediu (mai multe fișiere, o rută + interfață, teste noi); ` +
  `4 = greu (integrare cu un serviciu extern, migrare de date, ceva ce atinge banii sau sesiunile); ` +
  `5 = foarte greu (arhitectură, ceva ce poate strica producția dacă e greșit)`

/** ANALYSIS: lays the options on the table, scores them, picks one. */
export async function evalueazaCerinta(c: Cerinta): Promise<{ ok: boolean; detaliu: string }> {
  const prompt =
    `Ești Kelion și îți evaluezi SINGUR soluțiile, înainte să scrii o linie de cod.\n\n` +
    `CERINȚA OWNERULUI: "${c.text}"\n` +
    (c.criteriu ? `CUM SE DOVEDEȘTE CĂ E FĂCUTĂ: ${c.criteriu}\n` : '') +
    `\nPune pe masă 2-4 variante REALE de rezolvare. Nu variații ale aceleiași idei — ` +
    `drumuri diferite. Pentru fiecare dă note de la 0 la 10 pe axele: ${AXE}. ` +
    `Și scrie RISCUL — ce o poate omorî. O variantă fără riscuri e o variantă neanalizată.\n\n` +
    `Dă și DIFICULTATEA fiecărei variante, 1..5 — cât de greu e de DUS drumul ăla, nu cât de ` +
    `important e: ${SCARA_DIFICULTATE}. Din ea se alege cine lucrează: o sarcină grea pleacă ` +
    `direct pe un model puternic, una banală pe unul gratuit. Dacă o umfli, se ard bani degeaba; ` +
    `dacă o subestimezi, munca ta pică la jumătate.\n\n` +
    `LECȚIA ZILEI DE 30 IUL, ține cont de ea: o soluție care cere ownerului să umble ` +
    `prin portaluri sau conturi noi e o soluție PROASTĂ, chiar dacă tehnic e curată — ` +
    `de-aia „independent" cântărește mult.\n\n` +
    `Răspunde DOAR cu JSON valid: ` +
    `[{"nume":"...","cum":"în 1-2 propoziții, concret","rezolva":0,"rapid":0,"sigur":0,` +
    `"ieftin":0,"independent":0,"dificultate":3,"risc":"..."}] — fără alt text.`

  const raw = await brainComplete(prompt, 1600)
  if (!raw) return { ok: false, detaliu: 'creierul n-a răspuns' }
  let variante: Varianta[] = []
  try {
    const m = raw.match(/\[[\s\S]*\]/)
    variante = JSON.parse(m ? m[0] : raw) as Varianta[]
  } catch {
    return { ok: false, detaliu: 'răspuns care nu e JSON' }
  }
  const ales = alege(variante.filter((v) => v && typeof v.nume === 'string'))
  if (!ales) return { ok: false, detaliu: 'n-a pus nicio variantă pe masă' }

  await actualizeazaCerinta(c.id, {
    stare: 'analizata',
    optiuni: JSON.stringify(variante).slice(0, 8000),
    aleasa: `${ales.castigatoare.nume} — ${ales.castigatoare.cum}\nDE CE: ${ales.motiv}`.slice(0, 2000),
    // The level of the CHOSEN VARIANT, not of the requirement: difficulty
    // depends on the chosen path. The order carries it forward, and the
    // constructor picks its hand from it.
    dificultate: nivelDificultate(ales.castigatoare),
  })
  const niv = nivelDificultate(ales.castigatoare)
  return { ok: true, detaliu: `${variante.length} variante evaluate → ${ales.castigatoare.nume} (dificultate ${niv}/5)` }
}

/** CONTINUOUS IMPROVEMENT: what's delivered gets revisited — "could it be
 *  better, NOW?"
 *
 *  Not cosmetics: a solution that was good six weeks ago can be the bad one
 *  today, because in the meantime new tools appeared (the browser, the
 *  secrets) or a path closed (the API that doesn't exist for his account).
 *  If something comes out, it becomes a NEW requirement, linked to the first
 *  — not a silent rewrite of history. */
export async function imbunatatireContinua(limita = 5): Promise<{ propuneri: number; detaliu: string }> {
  const livrate = (await listeazaCerinte('verificata', 50)).slice(0, limita)
  if (!livrate.length) return { propuneri: 0, detaliu: 'nimic livrat încă de reanalizat' }

  const lista = livrate.map((c) => `#${c.id}: "${c.text}" — rezolvat prin: ${c.aleasa ?? '(nescris)'}`).join('\n')
  const prompt =
    `Ești Kelion și îți reanalizezi SINGUR soluțiile deja livrate.\n\n` +
    `Pentru fiecare, întreabă-te: cu ce știi ACUM și cu uneltele pe care le ai ACUM, ` +
    `se putea mai bine? „Mai bine" înseamnă: rezolvă mai complet, cere mai puțin de la ` +
    `owner, sau riscă mai puțin. NU propune rescrieri de dragul eleganței — dacă merge ` +
    `bine, spui că merge bine.\n\n` +
    `LIVRATE:\n${lista}\n\n` +
    `Răspunde DOAR cu JSON: [{"id":<număr>,"mai_bine":true|false,"propunere":"<ce anume, ` +
    `într-o propoziție>","de_ce":"<ce s-a schimbat de atunci>"}] — fără alt text.`

  const raw = await brainComplete(prompt, 1400)
  if (!raw) return { propuneri: 0, detaliu: 'creierul n-a răspuns' }
  let d: { id?: number; mai_bine?: boolean; propunere?: string; de_ce?: string }[] = []
  try {
    const m = raw.match(/\[[\s\S]*\]/)
    d = JSON.parse(m ? m[0] : raw) as typeof d
  } catch {
    return { propuneri: 0, detaliu: 'răspuns care nu e JSON' }
  }
  const valide = new Set(livrate.map((c) => c.id))
  let n = 0
  for (const x of d) {
    if (!x.mai_bine || !x.propunere || !valide.has(Number(x.id))) continue
    const id = await adaugaCerinta(
      `ÎMBUNĂTĂȚIRE la cerința #${x.id}: ${String(x.propunere).slice(0, 500)}`,
      'kelion',
      `Se compară cu soluția de acum. Motivul reanalizei: ${String(x.de_ce ?? '').slice(0, 300)}`,
    )
    if (id) n++
  }
  return { propuneri: n, detaliu: n ? `${n} îmbunătățiri propuse de el` : 'a considerat că merg bine așa' }
}
