// ══════════════════════════════════════════════════════════════════════════
// REGISTRU + DECIZII PE ORDINE (Adrian, 5 iul) — Kelion trebuie să știe ce s-a
// făcut cu TOATE ordinele, să nu construiască același lucru de două ori, și la
// conflict de deploy să DECIDĂ singur (nu să buclează pe „ok").
// Modulul ăsta e partea PURĂ (fără efecte) — testabilă izolat.
// ══════════════════════════════════════════════════════════════════════════

const norm = (s: string): string =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // scoate diacriticele (ă→a, î→i, ș→s): „coadă"=„coada"
    .replace(/[„”"'`.,!?;:()\-—]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

// ── #2 DECIZIE LA EȘEC DE DEPLOY ────────────────────────────────────────────
// La eșec, deployerul trimite un `detail`. Dacă e CONFLICT DE MERGE, ramura e
// veche/duplicat față de master — a reîncerca ACELAȘI lucru pică la infinit.
// Decidem: conflict → NU reîncerca; retrimite la reconstruit pe master proaspăt
// (sau aruncă). Alt eșec (build, rețea) → poate fi trecător → cere „ok".
export type DeployFailAction = 'rebuild' | 'retry'
export interface DeployFailDecision {
  action: DeployFailAction
  conflict: boolean
  message: string // ce i se spune lui Adrian (cinstit, fără buclă falsă)
}
export function decideDeployFailure(detail: string, summary = ''): DeployFailDecision {
  const d = String(detail ?? '')
  const conflict = /conflict|imbin|îmbin|merge|nu se poate (îmbina|imbina)|automatic merge failed|CONFLICT/i.test(d)
  const what = summary ? `„${summary.slice(0, 80)}"` : 'ramura'
  if (conflict) {
    return {
      action: 'rebuild',
      conflict: true,
      message:
        `${what} nu s-a putut publica: s-a ciocnit cu ce e deja pe master ` +
        `(ramură veche sau duplicat). NU reîncerc la fel — am retrimis-o la reconstruit ` +
        `pe versiunea curentă. Dacă era deja făcută, o las la o parte. Nu trebuie să faci nimic.`,
    }
  }
  return {
    action: 'retry',
    conflict: false,
    message: `Deploy-ul a picat: ${d.slice(0, 160) || 'motiv necunoscut'}. Nu s-a publicat nimic — versiunea veche e tot live. Vrei să reîncerc? Zi „ok".`,
  }
}

// ── #3 METODA DE UNICAT (dedup ordine) ──────────────────────────────────────
// Kelion construia același lucru de mai multe ori (ex: Influencer de 2 ori).
// Un ordin nou care e practic identic cu unul recent (neîncheiat) e DUPLICAT și
// nu se mai trimite la construit. Comparăm pe text normalizat: identic sau unul
// îl conține pe celălalt (peste un prag de lungime, ca să nu prindem fraze scurte).
export function isDuplicateOrder(text: string, recent: string[]): boolean {
  const a = norm(text)
  if (a.length < 8) return false // prea scurt ca să judecăm duplicat sigur
  for (const r of recent) {
    const b = norm(r)
    if (!b) continue
    if (a === b) return true
    const [shortS, longS] = a.length <= b.length ? [a, b] : [b, a]
    if (shortS.length >= 15 && longS.includes(shortS)) return true
  }
  return false
}

// ── #4 RAPORT CU TOATE CERERILE + STADIILE ──────────────────────────────────
// Kelion compune un raport cu toate ordinele și în ce stadiu sunt, ca să-ți
// spună clar ce s-a făcut cu fiecare (nu doar „am trimis la execuție").
export interface OrderRow {
  text: string
  status: string // pending | delivered | ready | published | failed | certified
  created_at?: string | Date
  delivered_at?: string | Date | null
}
const STAGE: Record<string, string> = {
  pending: '⏳ în așteptare (netrimis încă la constructor)',
  delivered: '🔧 preluat de constructor (în lucru)',
  ready: '📦 gata, așteaptă „da" pentru publicare',
  published: '🟢 publicat pe live',
  certified: '✅ certificat (tester PASS)',
  finalized: '✅ finalizat (închis)',
  failed: '🔴 a picat',
}
const hm = (v?: string | Date | null): string => {
  if (!v) return ''
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(11, 16)
}
export function composeOrdersReport(orders: OrderRow[], ownedSummary?: string | null): string {
  if (!orders || orders.length === 0) {
    return ownedSummary
      ? `Cerință deschisă acum: „${ownedSummary}". Alte ordine în registru: niciunul.`
      : 'Nu am niciun ordin în registru acum.'
  }
  const counts: Record<string, number> = {}
  for (const o of orders) counts[o.status] = (counts[o.status] ?? 0) + 1
  const head =
    `Raport ordine (${orders.length}): ` +
    Object.entries(counts)
      .map(([s, n]) => `${n} ${s}`)
      .join(', ') +
    (ownedSummary ? `. Cerință activă acum: „${ownedSummary}".` : '.')
  const lines = orders.slice(0, 20).map((o, i) => {
    const t = hm(o.delivered_at) || hm(o.created_at)
    const stage = STAGE[o.status] ?? o.status
    return `${i + 1}. ${stage}${t ? ` (${t})` : ''} — ${String(o.text).replace(/\s+/g, ' ').slice(0, 90)}`
  })
  return `${head}\n${lines.join('\n')}`
}
