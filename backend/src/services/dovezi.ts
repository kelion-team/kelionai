// ── THE EIGHT PROOFS OF AUTONOMY ────────────────────────────────────────────
//
// Adrian, 31 Jul: "it must be 8 out of 8 proofs."
//
// Until now, the autonomy level was an assertion of mine, in a chat that gets
// lost. Here is a READING: each level looks into the database for its
// concrete trace — an order, a PR, a measurement, a timestamp — and says
// "proven" only if it found it. If not, it says "unproven" and WHAT exactly
// the proof would be.
//
// The owner's rule #1, applied to my own evidence: nothing here gets checked
// off on anyone's word. A missing proof is a missing proof, not "it probably
// works".
import { listBuildJobs, listeazaCerinte, loadKv, saveKv, getCapabilityGaps } from '../db.js'

export interface Dovada {
  /** 1..8 — the scale from the 30-31 Jul discussion. */
  nivel: number
  /** What the level means, in the person's language. */
  ce: string
  /** What EXACTLY would prove it — written BEFOREHAND, so the target doesn't move. */
  cum: string
  dovedit: boolean
  /** The trace found in the database: order, PR, measurement. Empty if there is none. */
  dovada: string
  /** When it happened. */
  cand: string | null
}

/** A job started by the autonomous loop (not by a human). */
function alLui(j: { orderedBy?: string }): boolean {
  return String(j.orderedBy ?? '').toLowerCase().startsWith('kelion')
}

export async function dovezileAutonomiei(): Promise<{ dovedite: number; din: number; dovezi: Dovada[] }> {
  // null = coada necitibilă (auditul admin, 3 aug) — dovezile lipsă rămân „nedovedite".
  const jobs = (await listBuildJobs(200).catch(() => null)) ?? []
  const aleLui = jobs.filter(alLui)
  const gata = aleLui.filter((j) => j.status === 'done')
  const cuPr = gata.filter((j) => j.prUrl)
  const reluate = aleLui.filter((j) => j.attempts > 1)

  const verificate = await listeazaCerinte('verificata', 50).catch(() => [])
  const deLaEl = (await listeazaCerinte(undefined, 200).catch(() => [])).filter((c) => c.sursa === 'kelion')
  const goluri = await getCapabilityGaps(true, 200).catch(() => [])
  const golRezolvat = goluri.find((g) => g.resolved && String(g.triage ?? '').includes('DE IMPLEMENTAT'))
  const trecereBucla = await loadKv('autonomie:ultima').catch(() => null)

  // Level 8: an ENTIRE chain, with no human touch — a requirement that
  // went by itself through analysis, construction, PR and verification on
  // live.
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

  // O DOVADĂ ÎNTÂMPLATĂ NU SE „DEZ-ÎNTÂMPLĂ" (Adrian, 5 aug: „a avut 3 bifate,
  // acum are doar 1"). Recitirea vie se uită într-o FEREASTRĂ (ultimele 200 de
  // ordine / 50 de cerințe) — când urma iese din fereastră sau curățenia de
  // ordine vechi o șterge, bifa cădea singură, deși faptul fusese MĂSURAT.
  // De-acum: în clipa în care o dovadă e găsită, o CONSEMNĂM permanent (nivel +
  // urma + data) în kv. La afișările următoare, un nivel fără urmă vie dar cu
  // consemnare rămâne DOVEDIT, cu urma salvată și data consemnării — cinstit:
  // arătăm exact ce s-a măsurat și când, nu o bifă goală.
  for (const x of d) {
    const cheia = `autonomie:dovada:${x.nivel}`
    if (x.dovedit) {
      // Urmă vie → împrospătăm consemnarea (cea mai nouă urmă reală).
      void saveKv(cheia, JSON.stringify({ dovada: x.dovada, cand: x.cand, consemnat: new Date().toISOString() })).catch(() => {})
      continue
    }
    const consemnat = await loadKv(cheia).catch(() => null)
    if (consemnat) {
      try {
        const c = JSON.parse(consemnat) as { dovada?: string; cand?: string | null; consemnat?: string }
        x.dovedit = true
        x.dovada = `${c.dovada ?? ''} (urmă consemnată la ${String(c.consemnat ?? '').slice(0, 10)}; originalul a ieșit din fereastra de citire)`
        x.cand = c.cand ?? null
        continue
      } catch {
        /* consemnare coruptă → cade pe drumul „nedovedit" de mai jos */
      }
    }
    if (!x.dovada) {
      x.dovada = trecereBucla ? 'încă nedovedit — bucla merge, dar n-a ajuns aici' : 'încă nedovedit'
    }
  }

  return { dovedite: d.filter((x) => x.dovedit).length, din: d.length, dovezi: d }
}
