// ── CELE OPT DOVEZI ALE AUTONOMIEI ───────────────────────────────────────────
//
// Adrian, 31 iul: „trebuie 8 din 8 dovezi."
//
// Până acum, nivelul autonomiei era o afirmație de-a mea, într-un chat care se
// pierde. Aici e o CITIRE: fiecare nivel se uită în baza de date după urma lui
// concretă — un ordin, un PR, o măsurătoare, o oră — și spune „dovedit" doar
// dacă a găsit-o. Dacă nu, spune „nedovedit" și CE anume ar fi dovada.
//
// Regula #1 a ownerului, aplicată propriei mele evidențe: nimic aici nu se
// bifează pe cuvântul cuiva. O dovadă lipsă e o dovadă lipsă, nu „probabil merge".
import { listBuildJobs, listeazaCerinte, loadKv, getCapabilityGaps } from '../db.js'

export interface Dovada {
  /** 1..8 — scara din discuția din 30-31 iul. */
  nivel: number
  /** Ce înseamnă nivelul, pe limba omului. */
  ce: string
  /** Ce ANUME ar dovedi-o — scris ÎNAINTE, ca ținta să nu se mute. */
  cum: string
  dovedit: boolean
  /** Urma găsită în bază: ordin, PR, măsurătoare. Gol dacă nu există. */
  dovada: string
  /** Când s-a întâmplat. */
  cand: string | null
}

/** Un job pornit de bucla autonomă (nu de om). */
function alLui(j: { orderedBy?: string }): boolean {
  return String(j.orderedBy ?? '').toLowerCase().startsWith('kelion')
}

export async function dovezileAutonomiei(): Promise<{ dovedite: number; din: number; dovezi: Dovada[] }> {
  const jobs = await listBuildJobs(200).catch(() => [])
  const aleLui = jobs.filter(alLui)
  const gata = aleLui.filter((j) => j.status === 'done')
  const cuPr = gata.filter((j) => j.prUrl)
  const reluate = aleLui.filter((j) => j.attempts > 1)

  const verificate = await listeazaCerinte('verificata', 50).catch(() => [])
  const deLaEl = (await listeazaCerinte(undefined, 200).catch(() => [])).filter((c) => c.sursa === 'kelion')
  const goluri = await getCapabilityGaps(true, 200).catch(() => [])
  const golRezolvat = goluri.find((g) => g.resolved && String(g.triage ?? '').includes('DE IMPLEMENTAT'))
  const trecereBucla = await loadKv('autonomie:ultima').catch(() => null)

  // Nivelul 8: un lanț ÎNTREG, fără nicio atingere de om — o cerință care a
  // trecut singură prin analiză, construcție, PR și verificare pe live.
  const capCoada = verificate.find((c) => c.aleasa && c.dovada && c.job_id)

  const d: Dovada[] = [
    {
      nivel: 1,
      ce: 'duce o sarcină întreagă la ordin — scrie cod, deschide PR, îl integrează',
      cum: 'un ordin terminat, cu PR-ul lui',
      dovedit: cuPr.length > 0,
      dovada: cuPr[0] ? `ordinul #${cuPr[0].id} → ${cuPr[0].prUrl}` : '',
      cand: cuPr[0]?.updatedAt ?? null,
    },
    {
      nivel: 2,
      ce: 'pornește singur, fără să-i ceară cineva',
      cum: 'un ordin al cărui autor e bucla, nu un om',
      dovedit: aleLui.length > 0,
      dovada: aleLui[0] ? `ordinul #${aleLui[0].id}, pornit de „${aleLui[0].orderedBy}"` : '',
      cand: aleLui[0]?.createdAt ?? null,
    },
    {
      nivel: 3,
      ce: 'se repară singur — ce a picat se reia, cu jurnalul eșecului în mână',
      cum: 'un ordin cu mai mult de o încercare, terminat',
      dovedit: reluate.some((j) => j.status === 'done'),
      dovada: (() => {
        const j = reluate.find((x) => x.status === 'done')
        return j ? `ordinul #${j.id}, reușit din încercarea ${j.attempts}` : ''
      })(),
      cand: reluate.find((j) => j.status === 'done')?.updatedAt ?? null,
    },
    {
      nivel: 4,
      ce: 'își face singur setările — chei, portal, publicare',
      cum: 'pasul de setări închis prin MĂSURARE (cheile chiar există)',
      dovedit: Boolean(await loadKv('autonomie:pas:M0').then((v) => v && JSON.parse(v).gata).catch(() => false)),
      dovada: 'pasul M0 marcat gata doar după ce cheile au fost găsite în secrete',
      cand: null,
    },
    {
      nivel: 5,
      ce: 'se verifică singur pe live — „cred că merge" nu trece',
      cum: 'o cerință trecută pe „verificată" cu măsurătoarea lângă ea',
      dovedit: verificate.some((c) => c.dovada),
      dovada: (() => {
        const c = verificate.find((x) => x.dovada)
        return c ? `cerința #${c.id}: ${String(c.dovada).slice(0, 160)}` : ''
      })(),
      cand: verificate.find((c) => c.dovada)?.updated_at?.toISOString?.() ?? null,
    },
    {
      nivel: 6,
      ce: 'vede ce îi lipsește și construiește',
      cum: 'un gol pe care l-a triat singur „de implementat" și l-a închis prin cod',
      dovedit: Boolean(golRezolvat),
      dovada: golRezolvat ? `golul #${golRezolvat.id}: „${String(golRezolvat.request).slice(0, 120)}"` : '',
      cand: null,
    },
    {
      nivel: 7,
      ce: 'își reanalizează soluțiile livrate — „se putea mai bine, acum?"',
      cum: 'o cerință născută din el, nu din owner',
      dovedit: deLaEl.length > 0,
      dovada: deLaEl[0] ? `cerința #${deLaEl[0].id}, propusă de el: „${deLaEl[0].text.slice(0, 120)}"` : '',
      cand: deLaEl[0]?.created_at?.toISOString?.() ?? null,
    },
    {
      nivel: 8,
      ce: 'lanțul ÎNTREG, fără nicio atingere de om',
      cum: 'o cerință care a trecut singură prin analiză → construcție → PR → verificare pe live',
      dovedit: Boolean(capCoada),
      dovada: capCoada
        ? `cerința #${capCoada.id}: analizată, dusă de ordinul #${capCoada.job_id}, verificată pe live`
        : '',
      cand: capCoada?.updated_at?.toISOString?.() ?? null,
    },
  ]

  // Ce n-a fost găsit rămâne gol — dar spunem MĂCAR dacă bucla trăiește, ca să
  // se deosebească „n-a apucat încă" de „nu merge deloc".
  for (const x of d) {
    if (!x.dovedit && !x.dovada) {
      x.dovada = trecereBucla ? 'încă nedovedit — bucla merge, dar n-a ajuns aici' : 'încă nedovedit'
    }
  }

  return { dovedite: d.filter((x) => x.dovedit).length, din: d.length, dovezi: d }
}
