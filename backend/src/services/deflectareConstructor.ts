// ── GARDUL DETERMINIST ANTI-DEFLECTARE (Adrian, 5 aug) ───────────────────────
//
// „kelion nu aloca constructorului cererile — spune si asteapta ca echipa de
// dezvoltare sa repare. Care este echipa de dezvoltare?" Nu există niciuna:
// Kelion E constructorul. Promptul îi INTERZICE deja să spună „my developer
// will handle it" (SYSTEM_PROMPT, ramura owner) — dar modelul slab o ignoră.
// „Ce cablezi, aia face": aici e cablul. Un răspuns care AMÂNĂ spre o echipă
// inexistentă, când tura NU a chemat nicio unealtă de construcție, e marfă
// stricată — chat.ts îl aruncă, reîncearcă, iar dacă tot amână depune singur
// ordinul la constructor. Pur și testat.

// Uneltele prin care o cerere de construcție/reparație chiar E alocată. Dacă
// vreuna a fost chemată în tură, NU e deflectare — e execuție reală.
export const UNELTE_CONSTRUCTIE = new Set([
  'build_software', 'repo_write', 'repo_open_pr', 'repo_merge_pr', 'request_repair', 'run_runbook',
])

const TIPARE_DEFLECTARE: RegExp[] = [
  // Amânare spre o „echipă"/„dezvoltatori" inexistentă.
  /echip\w*\s+(?:de\s+)?(?:dezvolt\w*|tehnic\w*|IT)/i,
  /dezvoltator\w*\s+(?:se\s+vor\s+ocupa|vor\s+rezolva|vor\s+repara)/i,
  /(?:voi|o\s+să|am)\s+(?:transmite?|raporta|escalada)\w*\s+(?:spre\s+reparare|echipei|mai\s+departe|către)/i,
  /(?:va|urmează\s+să)\s+fi\s+(?:reparat|implementat|rezolvat)\s+(?:de|în\s+curând|ulterior)/i,
  /(?:se\s+va\s+ocupa|va\s+prelua)\s+(?:cineva|echipa|un\s+dezvoltator)/i,
  // Engleză.
  /(?:development|dev|engineering)\s+team\s+(?:will|can|should)/i,
  /(?:the\s+)?developers?\s+will\s+(?:fix|handle|look)/i,
  /i(?:'|\s+wi)ll\s+(?:forward|escalate|pass)\s+this\s+(?:to|on)/i,
  /(?:this\s+)?will\s+be\s+(?:fixed|handled|implemented)\s+by\s+(?:the\s+)?(?:team|developer)/i,
]

/** `true` = răspunsul AMÂNĂ spre o echipă inexistentă în loc să construiască. */
export function deflecteazaConstructor(text: string): boolean {
  const t = (text ?? '').trim()
  if (!t) return false
  return TIPARE_DEFLECTARE.some((re) => re.test(t))
}

/** A fost alocată cererea CU ADEVĂRAT (o unealtă de construcție chemată în tură)? */
export function aAlocatConstructie(uneltePeTura: Iterable<string>): boolean {
  for (const u of uneltePeTura) if (UNELTE_CONSTRUCTIE.has(u)) return true
  return false
}
