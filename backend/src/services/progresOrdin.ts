// ── BARA 0–100% A ORDINULUI (Adrian, 3 aug: „fiecare job trebuie să afișeze
// starea reală de rezolvare printr-o bară 0–100%, actualizată dinamic") ──────
//
// Procentul NU e inventat: e o HARTĂ a etapelor pe care lucrătorul chiar le
// raportează prin /api/constructor/progress (clonat → pas i/N → build/teste →
// ramura împinsă → PR deschis → CI). Fiecare valoare e ancorată într-o etapă
// REALĂ raportată; textul etapei se afișează lângă bară, ca cifra să poată fi
// oricând confruntată cu sursa ei (regula #1: nimic fără măsurătoare).
//
// Pură și deterministă — testată în progresOrdin.test.ts.

export function procentDinProgres(status: string, progress?: string | null): number | null {
  if (status === 'done') return 100
  // Eșuat: bara nu arată un procent — eticheta „eșuat" spune adevărul singură.
  if (status === 'failed') return null
  if (status === 'queued') return 0
  // status === 'running': citim etapa raportată.
  const p = progress ?? ''
  if (!p.trim()) return 3 // preluat, încă nimic raportat
  // Etapele finale întâi (un text poate conține și „pas 24/24" și „PR deschis").
  if (/aștept verificarea|astept verificarea|\bCI\b/i.test(p)) return 97
  if (/PR deschis/i.test(p)) return 95
  if (/împins|impins/i.test(p)) return 90
  if (/verific: npm/i.test(p)) return 80
  if (/modificări|modificari/i.test(p)) return 75
  const pas = /pas\s+(\d+)\s*\/\s*(\d+)/i.exec(p)
  if (pas) {
    const i = Number(pas[1])
    const n = Math.max(Number(pas[2]), 1)
    // Pașii de lucru acoperă 15%→74% — proporțional cu pasul raportat.
    return Math.min(74, 15 + Math.round((i / n) * 59))
  }
  if (/atelier clonat/i.test(p)) return 10
  return 5 // a pornit (scara/ordinul afișat), încă fără pași
}
