// ── ROUTER AUTOMAT CAPABILITATE ↔ COST (Adrian, 10 iul) ──────────────────────
// „Evaluare de capabilități per sarcină, cu șansele cele mai mari de reușită la
//  costul cel mai mic — automat, în decizie."
//
// Principiul optim: alege CEL MAI IEFTIN model a cărui capabilitate ACOPERĂ
// dificultatea sarcinii. Așa cererile simple rămân rapide + ieftine, iar cele
// grele urcă automat la modelul cel mai puternic — șanse mari de reușită, cost
// minim. Decizia e DETERMINISTĂ și GRATUITĂ (fără un apel de model în plus, deci
// zero cost/latență adăugate pentru rutare).
//
// FUTURE-PROOF: tier-urile sunt configurabile din mediu (Railway). Când apare un
// model mai nou/mai puternic — acum sau în viitor — setezi variabila și intră
// INSTANT, fără deploy. Pentru mai multe trepte, extinzi MODEL_LADDER.

// CREIERUL — Kimi (primar) → GLM (rezervă). Vechiul provider scos complet (Adrian, 12
// iul). Configurabile din Railway (KELION_FAST_MODEL / KELION_TOP_MODEL) dacă
// furnizorii schimbă numele; implicit modelele native ale planurilor.
// Adrian, 14 iul: „creierul forțat Kimi 2.7, ZERO rabat la putere, dar primul
// cuvânt sub 1s". CATALOG REAL (Kimi /v1/models, verificat live 14 iul): endpointul
// servește DOAR `kimi-for-coding` și `kimi-for-coding-highspeed` — AMBELE
// `supports_thinking_type:"only"` + `supports_reasoning:true` (aceeași putere de
// raționament K2). `kimi-k2-thinking` NU e în catalog (endpointul doar îi returnează
// numele înapoi). Pentru CHAT/VOCE alegem varianta HIGH-SPEED: aceeași putere de
// gândire, servită rapid → zero compromis de calitate, doar latență mai mică.
// Constructorul (munca grea, fără constrângere de latență) rămâne pe varianta plină.
export const MODEL_FAST = 'kimi-for-coding-highspeed'
// GLM rezervă = TOPUL (Adrian: „la GLM tot cel mai performant e necesar adminului").
// glm-5.2 = cel mai nou din /v1/models (verificat LIVE 200, „model":"glm-5.2", 14 iul).
export const MODEL_TOP = 'glm-5.2'

export interface ModelRung {
  id: string
  capability: number // 0-100: cât de „puternic" e modelul
  costRel: number // cost relativ (mai mic = mai ieftin)
}

// Scara de modele, de la ieftin/rapid la scump/puternic. Ordinea nu contează —
// routerul sortează după cost. Adaugi o treaptă nouă și e folosită automat.
// Kimi e PRIMARUL pentru tot (capability 100 → chooseModel îl alege mereu); GLM
// nu e o treaptă „mai puternică" aleasă după dificultate, ci REZERVA folosită
// doar la eșecul lui Kimi (failover-ul din routes/chat.ts, brainModel()).
export const MODEL_LADDER: ModelRung[] = [
  { id: MODEL_FAST, capability: 100, costRel: 1 }, // Kimi — primar pentru orice cerere
  { id: MODEL_TOP, capability: 100, costRel: 5 }, // GLM — rezervă la eșec, nu escaladare de dificultate
]

// Dificultatea cerută de sarcină (0-100), estimată PUR euristic din text (0 cost).
// Semnale: lungimea/complexitatea, raționament/analiză, cod/depanare, multi-pas.
export function taskDifficulty(text: string): number {
  const t = (text || '').toLowerCase()
  let d = 15 // conversație simplă: salut, întrebare scurtă, mulțumire
  const len = t.length
  // Un singur semnal puternic (raționament, cod, sau text lung) trebuie să treacă
  // de pragul modelului rapid (75) → escaladează la modelul TOP.
  if (len > 1000) d += 65
  else if (len > 500) d += 45
  else if (len > 200) d += 20
  // Raționament / analiză / explicație aprofundată.
  if (/(analiz[ăae]|demonstr|rezolv[ăa]|[îi]n detaliu|pas cu pas|g[âa]nde[șs]te|ra[țt]ion|argument[ea]|compar[ăa]|evalu[eaă]|de ce\b|cum func[țt]ion|strategi[ea]|plan detaliat)/.test(t)) {
    d += 65
  }
  // Cod / software / depanare — cel mai exigent.
  if (/(algoritm|debug|\bcod\b|\bprogram|func[țt]i|script|\bbug\b|refactor|optimiz|compil|stack ?trace|except)/.test(t)) {
    d += 70
  }
  // Mai multe cereri într-un mesaj (multi-pas).
  if ((t.match(/\?/g) || []).length >= 3 || /(și apoi|dup[ăa] care|mai [îi]nt[âa]i)/.test(t)) d += 12
  return Math.min(100, Math.max(0, d))
}

// MARJĂ DE SIGURANȚĂ (Adrian, 10 iul): cerem cu +10% capabilitate peste
// dificultatea estimată, ca modelul ales să aibă REZERVĂ de putere — „ca să fie
// sigur rezolvat". Așa cererile la limită urcă la modelul mai puternic, nu riscă.
export const CAPABILITY_MARGIN = 1.1

// Capabilitatea NECESARĂ pentru sarcină = dificultatea estimată + marja de 10%.
export function requiredCapability(text: string): number {
  return Math.min(100, taskDifficulty(text) * CAPABILITY_MARGIN)
}

// Alege cel mai IEFTIN model a cărui capabilitate acoperă necesarul (cu marjă) →
// șanse mari de reușită la cost minim. Dacă niciunul nu ajunge, ia cel mai puternic.
export function chooseModel(text: string): string {
  const need = requiredCapability(text)
  const byCost = [...MODEL_LADDER].sort((a, b) => a.costRel - b.costRel)
  for (const m of byCost) if (m.capability >= need) return m.id
  return byCost.reduce((best, m) => (m.capability > best.capability ? m : best)).id
}

// Detectare erori de quota pentru failover instant Kimi → GLM.
export function isQuotaError(err: unknown): boolean {
  const status = (err as { status?: number })?.status
  const msg = String(err ?? '').toLowerCase()
  if (status === 403 || status === 429) return true
  return ['quota', 'exhausted', 'insufficient_quota'].some((k) => msg.includes(k))
}

// Încearcă Kimi întâi; la eroare de quota trece instant pe GLM.
export async function pickBrain<T>(
  tryKimi: () => Promise<T>,
  tryGLM: () => Promise<T>,
  onFailover?: (reason: string) => void,
): Promise<T> {
  try {
    return await tryKimi()
  } catch (e) {
    if (isQuotaError(e)) {
      onFailover?.('quota')
      return tryGLM()
    }
    throw e
  }
}
