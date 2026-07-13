// SUPERVIZORUL peste agenți (Adrian, 5 iul): forțează ducerea sarcinii la capăt
// sau ÎNLOCUIEȘTE agentul cu unul proaspăt, escaladat, dacă nu performează.
// Logica de DECIZIE e pură (fără efecte) → testabilă separat, dovedită.
//
// „Nu performează" = cerința a stagnat (statusul nu s-a schimbat de `stallMs`)
// ȘI constructorul nu mai postează activitate de `activeMs` (nu doar „e lent" —
// chiar s-a împotmolit). Un agent care CHIAR lucrează (build beat recent) NU e
// înlocuit. După `maxAttempts` re-asignări → nu mai buclează, îl anunță pe Adrian.

export type SuperviseAction = 'wait' | 'deploy-check' | 'active' | 'reassign' | 'giveup'

export interface SuperviseState {
  status: string
  at: number // ultima schimbare de status a cerinței
  nudged: number // ultima acțiune a supervizorului
  attempts: number // câți agenți proaspeți au fost re-asignați până acum
}

export interface SuperviseCfg {
  stallMs: number // cât timp fără schimbare de status = stagnare
  nudgeMs: number // nu acționa mai des de-atât (anti-spam)
  activeMs: number // build beat mai nou de-atât = constructorul chiar lucrează
  maxAttempts: number // câte re-asignări automate înainte de a-l anunța pe Adrian
}

export const DEFAULT_SUPERVISE: SuperviseCfg = {
  stallMs: 4 * 60_000,
  nudgeMs: 4 * 60_000,
  activeMs: 90_000,
  // Adrian (13 iul: „trebuie să se poată repara sau rezolva"): o cerință blocată
  // se REÎNCEARCĂ cu unghiuri DIFERITE (escalationText are 3 strategii: bucăți
  // mici → strict minimul → ultima încercare) înainte de a-l anunța pe Adrian —
  // ca Kelion să REZOLVE singur, nu să renunțe după un pas. Bounded la 3 (nu la
  // infinit) ca să nu macine credite pe o cerință cu adevărat imposibilă.
  maxAttempts: 3,
}

export function superviseDecision(
  r: SuperviseState,
  now: number,
  lastBuildBeat: number,
  cfg: SuperviseCfg = DEFAULT_SUPERVISE,
): SuperviseAction {
  if (now - r.at < cfg.stallMs) return 'wait' // n-a stagnat destul
  if (now - r.nudged < cfg.nudgeMs) return 'wait' // deja am acționat recent
  if (r.status.startsWith('deploy pornit')) return 'deploy-check' // publică — doar confirm
  if (now - lastBuildBeat < cfg.activeMs) return 'active' // constructorul CHIAR lucrează
  if (r.attempts < cfg.maxAttempts) return 'reassign' // împotmolit → agent proaspăt
  return 'giveup' // gata cu re-asignările automate → la Adrian
}

// Instrucțiunea de escaladare pentru re-asignarea `attempt` (1-based): fiecare
// încercare cere o abordare mai strânsă decât precedenta.
export function escalationText(attempt: number, maxAttempts: number): string {
  const steps = [
    'Taie sarcina în bucăți mici; citește întâi codul relevant, apoi modifică țintit, build + verifică fiecare pas.',
    'Agentul anterior NU a dus-o la capăt. Schimbă abordarea: fă STRICT minimul care rezolvă, dovedit cu build curat, fără să te împrăștii.',
    `ULTIMA încercare automată (${attempt}/${maxAttempts}) înainte să-l anunț pe Adrian. Minimul funcțional, build curat OBLIGATORIU, apoi gata de publicare.`,
  ]
  return steps[Math.min(Math.max(attempt, 1), steps.length) - 1]
}
