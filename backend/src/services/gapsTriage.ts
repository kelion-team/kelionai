import { getCapabilityGaps, setGapTriage } from '../db.js'
import { brainComplete } from './brain.js'

// ── TRIAJUL AUTONOM AL CERERILOR NEACOPERITE ─────────────────────────────────
// Adrian (24 iul): „Kelion trebuie să analizeze cererile neacoperite și să
// poată decide SINGUR dacă sunt bune și aduc valoare aplicației să le
// implementeze, dacă nu să le închidă automat."
// Kelion (modelul work, prin OpenRouter) citește gap-urile deschise și decide:
//   VALOROS → rămâne deschis, marcat „DE IMPLEMENTAT: <motiv>" (owner-ul vede
//             lista scurtă, curată, doar cu ce merită construit);
//   ÎNCHIDE → închis automat cu „ÎNCHIS AUTONOM: <motiv>" (duplicat / deja
//             posibil / fără valoare / în afara scopului).
// Rulează la cerere (buton admin) și AUTONOM o dată pe zi (index.ts).

const APP_CAPABILITIES = `Aplicația Kelionai POATE deja: conversație (chat+voce full-duplex) cu escaladare
automată chat→creier; hărți + traseu rutier pe monitor; vreme; căutare web live;
YouTube; generare imagini; traduceri; Wikipedia; valute; ceas mondial; Gmail
(citire+trimitere), Calendar, Drive, Tasks, Contacts (după Connect Google);
memorie persistentă + note explicite; voiceprint; vedere prin cameră + analiză
poze; afișare orice pagină pe monitor + browser live cu click/scris; gesturi
avatar (inclusiv dans); credite Stripe cu auto-recharge.`

export interface TriageOutcome {
  triaged: number
  kept: number
  closed: number
  error?: string
}

export async function triageGaps(): Promise<TriageOutcome> {
  const gaps = (await getCapabilityGaps(false, 100)).filter((g) => !g.resolved)
  const pending = gaps.filter((g) => !(g as { triage?: string | null }).triage)
  if (pending.length === 0) return { triaged: 0, kept: 0, closed: 0 }

  const list = pending
    .map((g) => `${g.id}. "${g.request.slice(0, 200)}" (cerut de ${g.hits}x${g.reason ? `; motiv logat: ${String(g.reason).slice(0, 120)}` : ''})`)
    .join('\n')

  const prompt =
    `Ești Kelion și îți administrezi SINGUR lista de „cereri neacoperite" (ce au cerut userii și n-ai putut face).\n\n` +
    `${APP_CAPABILITIES}\n\n` +
    `Pentru FIECARE cerere de mai jos decide:\n` +
    `- "valoros" — capabilitate reală, nouă, care aduce valoare aplicației și merită implementată;\n` +
    `- "inchide" — duplicat, deja posibil cu ce ai, neclară, glumă, în afara scopului, sau valoare neglijabilă.\n\n` +
    `CERERI:\n${list}\n\n` +
    `Răspunde DOAR cu JSON valid, un array: [{"id":<număr>,"verdict":"valoros"|"inchide","motiv":"<o propoziție scurtă în română>"}] — fără alt text.`

  const raw = await brainComplete(prompt, 2000)
  if (!raw) return { triaged: 0, kept: 0, closed: 0, error: 'brain_unavailable' }

  let decisions: { id?: number; verdict?: string; motiv?: string }[] = []
  try {
    const m = raw.match(/\[[\s\S]*\]/)
    decisions = JSON.parse(m ? m[0] : raw) as typeof decisions
  } catch {
    return { triaged: 0, kept: 0, closed: 0, error: 'bad_brain_json' }
  }

  let kept = 0
  let closed = 0
  const validIds = new Set(pending.map((g) => g.id))
  for (const d of decisions) {
    const id = Number(d.id)
    if (!validIds.has(id)) continue
    const motiv = String(d.motiv ?? '').slice(0, 300) || 'fără motiv'
    if (d.verdict === 'inchide') {
      await setGapTriage(id, `ÎNCHIS AUTONOM: ${motiv}`, true)
      closed++
    } else {
      await setGapTriage(id, `DE IMPLEMENTAT: ${motiv}`, false)
      kept++
    }
  }
  return { triaged: kept + closed, kept, closed }
}
