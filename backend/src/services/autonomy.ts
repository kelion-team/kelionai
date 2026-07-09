// ══════════════════════════════════════════════════════════════════════════
// AUTONOMIE ÎN LESĂ (Adrian, 9 iul: „autonom, dar să nu mă aducă în sapă de
// lemn"). Partea PURĂ (fără efecte) — testabilă izolat, ca supervisor/orders.
//
// Două mecanisme, complementare siguranței de 3 focuri per-cerință care există
// deja (DEFAULT_SUPERVISE.maxAttempts):
//   1. budgetCheck — ÎNTRERUPĂTORUL PRINCIPAL: un plafon rulant peste TOATE
//      reparațiile autonome pe o fereastră de timp. Sub plafon lucrează liber;
//      la plafon îngheață și cere OK.
//   2. sameFailure — OPRIRE PE LIPSĂ DE PROGRES: aceeași eroare de două ori la
//      rând = împotmolit, nu progres → oprește-te înainte de plafon, nu mai
//      cheltui pe același fix.
// ══════════════════════════════════════════════════════════════════════════

export interface AutonomyCfg {
  windowMs: number // fereastra rulantă în care se numără acțiunile autonome
  maxRuns: number // câte acțiuni autonome sunt permise în fereastră
}

export const DEFAULT_AUTONOMY: AutonomyCfg = {
  windowMs: 24 * 60 * 60_000, // 24h
  maxRuns: 20,
}

export interface BudgetResult {
  allowed: boolean // mai încape o acțiune autonomă?
  recent: number[] // lista curățată (fără cele expirate) — NU include acțiunea nouă
  count: number // câte acțiuni în fereastră ÎNAINTE de asta
}

// Curăță marcajele mai vechi decât fereastra și decide dacă mai încape una.
// `runs` = timestamp-urile (ms) ale acțiunilor autonome de până acum.
export function budgetCheck(
  runs: number[],
  now: number,
  cfg: AutonomyCfg = DEFAULT_AUTONOMY,
): BudgetResult {
  const recent = runs.filter((t) => typeof t === 'number' && now - t < cfg.windowMs)
  return { allowed: recent.length < cfg.maxRuns, recent, count: recent.length }
}

// Două eșecuri autonome cu ACEEAȘI eroare → împotmolit, nu progres. Comparație
// normalizată (fără diacritice/punctuație/majuscule). Detaliile goale nu se
// potrivesc niciodată (nu putem judeca → lăsăm plafonul de încercări s-o prindă).
export function sameFailure(prev: string, cur: string): boolean {
  const n = (s: string): string =>
    String(s ?? '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
  const a = n(prev)
  const b = n(cur)
  if (!a || !b) return false
  if (a === b) return true
  // Unul îl conține pe celălalt, peste un prag de lungime (aceeași eroare de
  // fond + zgomot în plus) — dar nu fraze scurte care se potrivesc din întâmplare.
  const [shortS, longS] = a.length <= b.length ? [a, b] : [b, a]
  return shortS.length >= 20 && longS.includes(shortS)
}
