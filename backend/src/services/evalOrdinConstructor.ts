/** Deterministic preflight for the separate Codex worker. The web process only
 * validates and queues repository work; it never selects an alternate worker
 * or executes repository tools itself. */

export interface AiConstructor {
  cheie: 'codex_worker'
  nume: string
  descriere: string
  capacitati: string[]
}

export const AI_CONSTRUCTORI: readonly AiConstructor[] = [{
  cheie: 'codex_worker',
  nume: 'Codex worker',
  descriere: 'Worker separat, autentificat oficial, care lucrează într-un worktree izolat și raportează porțile, PR-ul și versiunea live.',
  capacitati: ['cod', 'repo', 'teste', 'pr', 'reparatie', 'frontend', 'backend', 'migrare', 'asincron'],
}]

export interface EvaluareOrdin {
  trece: boolean
  motiv: string
  capacitatiNecesare: string[]
  clasament: Array<AiConstructor & { scor: number; potrivire: string }>
  aiRecomandat: AiConstructor['cheie'] | null
}

const ACTIUNE_COD =
  /(?<![\p{L}\p{N}_])(implementeaz[aă]?|construie[sș]te|programeaz[aă]?|repar[aă]?|corecteaz[aă]?|modific[aă]?|refactorizeaz[aă]?|integreaz[aă]?|optimizeaz[aă]?|rescrie|adaug[aă]?|[sș]terge|creeaz[aă]?|implement|build|repair|fix|modify|refactor|integrate|rewrite|add|delete|create)(?![\p{L}\p{N}_])/iu
const TINTA_REPO =
  /(?<![\p{L}\p{N}_])(cod(?:ul)?|repo(?:-ul)?|ramur[ăa]|fi[sș]ier(?:ul|e)?|modul(?:ul|e)?|func[tț]i[ea]|component[ăa]|frontend|backend|endpoint|api|pagin[ăa]|css|react|typescript|tsx|teste?|bug|eroare|baz[ăa] de date|sql|code|repository|branch|files?|modules?|functions?|components?|pages?|database)(?![\p{L}\p{N}_])/iu
const ACTIUNE_DIRECTA =
  /(?<![\p{L}\p{N}_])(captur[aă] (?:de )?ecran|deschide (?:browser(?:ul)?|pagin[aă]|site)|d[aă] click|trimite (?:un )?e-?mail|cite[sș]te (?:un )?e-?mail|take (?:a )?screenshot|open (?:the )?(?:browser|page|site)|click|send (?:an )?e-?mail)(?![\p{L}\p{N}_])/iu

const CAPACITATI: Array<{ nume: string; expresie: RegExp }> = [
  { nume: 'teste', expresie: /\b(test|teste|vitest|jest|poart|gate)\b/i },
  { nume: 'pr', expresie: /\b(pr|pull request|merge|branch|ramur)/i },
  { nume: 'frontend', expresie: /\b(frontend|ui|css|react|tsx|pagin|component)/i },
  { nume: 'backend', expresie: /\b(backend|endpoint|rut[aă]|api|server|db|sql)/i },
  { nume: 'migrare', expresie: /\b(migrare|migration|schema)/i },
  { nume: 'reparatie', expresie: /\b(repar|bug|eroare|fix)/i },
  { nume: 'asincron', expresie: /\b(asincron|lung|peste noapte|background)/i },
]

function cererea(order: string): string {
  const text = String(order ?? '').trim()
  return /CE A CERUT:\s*([^\n]+)/i.exec(text)?.[1]?.trim() || text
}

export function evalueazaOrdin(order: string): EvaluareOrdin {
  const text = cererea(order)
  if (text.length < 8) return respins('Ordin prea scurt — descrie concret schimbarea și criteriul de verificare.')
  if (text.length > 12_000) return respins('Ordin prea lung — rezumă cerința la maximum 12.000 de caractere.')
  if (ACTIUNE_DIRECTA.test(text)) return respins('Aceasta este o acțiune directă de interfață, nu o schimbare în repository.')
  if (!ACTIUNE_COD.test(text) || !TINTA_REPO.test(text)) {
    return respins('Ordin neclar: folosește un verb tehnic și numește ținta din repository plus verificarea dorită.')
  }
  const capacitatiNecesare = CAPACITATI.filter((item) => item.expresie.test(text)).map((item) => item.nume)
  for (const required of ['cod', 'repo']) if (!capacitatiNecesare.includes(required)) capacitatiNecesare.push(required)
  const worker = AI_CONSTRUCTORI[0]
  const potriviri = worker.capacitati.filter((capability) => capacitatiNecesare.includes(capability))
  return {
    trece: true,
    motiv: 'Cerință de repository clară — poate fi pusă în coada workerului Codex.',
    capacitatiNecesare,
    clasament: [{ ...worker, scor: potriviri.length, potrivire: `acoperă: ${potriviri.join(', ')}` }],
    aiRecomandat: 'codex_worker',
  }
}

function respins(motiv: string): EvaluareOrdin {
  return { trece: false, motiv, capacitatiNecesare: [], clasament: [], aiRecomandat: null }
}
