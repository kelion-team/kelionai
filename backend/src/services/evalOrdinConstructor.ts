// ── EVALUAREA UNUI ORDIN DE CONSTRUCȚIE + AI-uri pe capacitate ───────────────
// Owner, 13 aug: „cînd intru în constructor am nevoie de un tab să văd AI care
// au unelte, de sus în jos selectabili pe capacitate; am ordinul X cu o cerință,
// trebuie evaluată cerința și se oferă AI-urile potrivite" + „să treacă orice
// ordin?" (retoric — NU orice ordin trece).
//
// De ce PUR (fără browser, fără LLM, fără DB): o poartă de calitate trebuie să
// fie deterministă și probabilă la capete — altfel „nu orice ordin trece" ar fi
// o promisiune, nu o regulă. Aici intră textul ordinului (+ opțional creditul
// LIVE al furnizorilor, din becuri) și ies: verdictul porții, capacitățile cerute
// și clasamentul AI-urilor potrivite. Decizia adâncă rămâne a creierului; asta e
// pre-verificarea rapidă care oprește ordinele goale ÎNAINTE să ardă credit.

export type BecCredit = 'verde' | 'rosu' | 'gri'

/** Un AI real pe care constructorul îl poate folosi — cu uneltele lui și cu
 *  furnizorul din becuri care îi arată creditul LIVE. Nimic inventat: exact cele
 *  trei căi care există în cod (constructorul local, Jules, creierul 2). */
export interface AiConstructor {
  cheie: 'constructor' | 'jules' | 'creier2'
  nume: string
  descriere: string
  /** Etichete de capacitate pe care le acoperă (se potrivesc cu cele cerute). */
  capacitati: string[]
  /** SUBȘIR stabil din numele furnizorului în becuri (creditAI) — se caută cu
   *  `includes`, nu egalitate: numele complet variază („Gemini (Google AI)",
   *  „RunPod/DeepInfra (creierul constructorului)"). '' = fără credit urmărit. */
  becFurnizor: string
}

// Cele TREI AI-uri reale (măsurat în cod: constructor-agent.mjs, services/jules.ts,
// endpointul /api/constructor/creier care rutează la Gemini). Ordinea din listă e
// doar implicită; clasamentul real se calculează pe potrivire + credit.
export const AI_CONSTRUCTORI: AiConstructor[] = [
  {
    cheie: 'constructor',
    nume: 'Constructorul local',
    descriere:
      'Construiește CHIAR în repo pe server: editează fișiere, rulează tsc + testele, deschide PR. Cel mai potrivit pentru reparații și modificări de cod verificabile.',
    capacitati: ['cod', 'repo', 'teste', 'pr', 'reparatie', 'frontend', 'backend'],
    becFurnizor: 'creierul constructorului',
  },
  {
    cheie: 'jules',
    nume: 'Jules (agentul Google)',
    descriere:
      'Agentul asincron oficial Google: lucrează în VM-ul lui, pe repo-urile conectate, și deschide PR. Bun pentru sarcini mai mari, izolate, care pot rula în fundal.',
    capacitati: ['cod', 'repo', 'pr', 'asincron', 'mare'],
    becFurnizor: 'Jules',
  },
  {
    cheie: 'creier2',
    nume: 'Creierul 2 (Gemini)',
    descriere:
      'Creierul de raționament: analizează, planifică și deblochează constructorul când se împotmolește. NU construiește singur în repo — pregătește terenul.',
    capacitati: ['analiza', 'planificare', 'deblocare'],
    becFurnizor: 'Gemini',
  },
]

export interface RandClasament {
  cheie: AiConstructor['cheie']
  nume: string
  descriere: string
  scor: number
  /** De ce e (sau nu) potrivit — text scurt pentru panou. */
  potrivire: string
  /** Creditul live din becuri, dacă a fost dat; altfel null (necunoscut). */
  bec: BecCredit | null
}

export interface EvaluareOrdin {
  /** Poarta de calitate: dacă ordinul poate intra deloc în coadă. */
  trece: boolean
  /** De ce trece / de ce e respins — mereu spus, niciodată tăcut. */
  motiv: string
  /** Capacitățile deduse din text (etichete). Gol = cerință neclară. */
  capacitatiNecesare: string[]
  /** AI-urile potrivite, cel mai bun primul. Gol dacă ordinul e respins. */
  clasament: RandClasament[]
  /** Cheia AI-ului recomandat (sus în clasament), sau null dacă respins. */
  aiRecomandat: AiConstructor['cheie'] | null
}

// Verbe/indicii de ACȚIUNE constructivă — fără măcar unul, ordinul e doar o temă,
// nu o cerință („fă ceva cu X" nu spune ce să construiască).
const VERBE_ACTIUNE =
  /\b(repar|repară|adaug|adaugă|schimb|schimbă|modific|modifică|scrie|creeaz|creează|fac|fă|construi|implement|refactor|șterg|șterge|scoate|mut|mută|leg|leagă|integr|optimiz|corect|rescri|actualiz|updat|fix|test|verific)/i

// Hărțile de capacitate: eticheta ← cuvinte-cheie din ordin.
const CAPACITATI: { eticheta: string; re: RegExp }[] = [
  { eticheta: 'teste', re: /\b(test|teste|vitest|jest|poart|gate)\b/i },
  { eticheta: 'pr', re: /\b(pr|pull request|merge|branch|ramur)/i },
  { eticheta: 'frontend', re: /\b(frontend|ui|buton|css|pagin|react|ecran|bar[aă]|panou)/i },
  { eticheta: 'backend', re: /\b(backend|endpoint|rut[aă]|api|server|db|bazǎ de date|baz[aă] de date|sql)/i },
  { eticheta: 'reparatie', re: /\b(repar|repar[aă]|bug|eroare|erori|crap[aă]|nu merge|fix)/i },
  { eticheta: 'mare', re: /\b(tot|complet|întreg|intreg|mare|complex|migr|rescrie tot|refac)/i },
  { eticheta: 'asincron', re: /\b(în fundal|in fundal|asincron|lung|dureaz[aă]|peste noapte)/i },
  { eticheta: 'analiza', re: /\b(analiz|de ce|investig|cerceteaz|cercet|verific de ce|afl[aă])/i },
  { eticheta: 'planificare', re: /\b(planific|plan|strategi|proiecteaz|gânde|gînde)/i },
  { eticheta: 'cod', re: /\b(cod|funcți|functie|fișier|fisier|modul|clas[aă]|import|typescript|\.ts|\.tsx)/i },
]

// Cereri clar ÎN AFARA a ce poate face un constructor de cod — respinse cinstit,
// nu împinse într-o coadă unde ar eșua oricum și ar arde credit.
const IN_AFARA =
  /\b(sun[aă]-l|sun[aă] pe|cump[aă]r|pl[aă]te[sș]te cuiva|trimite bani|transfer[aă] bani|comand[aă] mâncare|rezerv[aă] (o mas[aă]|bilet)|formateaz[aă] (discul|calculator))/i

/** Evaluează ordinul: poarta de calitate + capacitățile cerute + clasamentul AI.
 *  `credit` (opțional): becul LIVE per furnizor (din creditAI) — un AI pe roșu
 *  coboară în clasament, unul pe verde urcă. Funcția rămâne PURĂ: creditul intră
 *  ca argument, nu-l citește ea. */
export function evalueazaOrdin(
  order: string,
  credit?: Record<string, BecCredit>,
): EvaluareOrdin {
  const text = (order ?? '').trim()

  // ── Poarta de calitate (NU orice ordin trece) ──────────────────────────────
  if (text.length < 8) {
    return respins('Ordin prea scurt — spune concret ce să construiască sau să repare (minim o propoziție).')
  }
  if (IN_AFARA.test(text)) {
    return respins('În afara a ce pot construi: pot lucra doar cod în repo (fișiere, teste, PR), nu acțiuni din lumea reală.')
  }
  const capacitatiNecesare = CAPACITATI.filter((c) => c.re.test(text)).map((c) => c.eticheta)
  const areVerb = VERBE_ACTIUNE.test(text)
  if (!areVerb && capacitatiNecesare.length === 0) {
    return respins('Cerință prea vagă — nu văd nici o acțiune (repară/adaugă/schimbă…) și nici o țintă (fișier, buton, endpoint). Spune ce și unde.')
  }

  // ORICE muncă de cod atinge repo-ul: dacă am prins un semnal de cod (test/PR/
  // frontend/backend/reparație/cod), adăugăm capacitățile LARGI „cod"+„repo" — pe
  // care le acoperă ȘI constructorul local ȘI Jules — ca alternativa să conteze
  // când executorul implicit e pe roșu. Fără asta, un ordin de cod n-ar fi văzut
  // de Jules (etichete disjuncte) și n-ar exista cui să trecem la lipsă de credit.
  const SEMNAL_COD = ['teste', 'pr', 'frontend', 'backend', 'reparatie', 'cod']
  const eCod = capacitatiNecesare.some((c) => SEMNAL_COD.includes(c))
  if (eCod) {
    for (const larg of ['cod', 'repo']) {
      if (!capacitatiNecesare.includes(larg)) capacitatiNecesare.push(larg)
    }
  }

  // ── Clasamentul AI-urilor pe potrivire + credit live ───────────────────────
  const clasament = AI_CONSTRUCTORI.map((ai) => {
    const comune = ai.capacitati.filter((c) => capacitatiNecesare.includes(c))
    let scor = comune.length
    // Constructorul local e executorul implicit (are teste + PR pe repo): un mic
    // avantaj de bază ca să nu piardă la egalitate în fața celor ce nu execută.
    if (ai.cheie === 'constructor') scor += 1
    // Sarcină mare/asincronă → Jules urcă (e făcut pentru fundal izolat).
    if (ai.cheie === 'jules' && (capacitatiNecesare.includes('mare') || capacitatiNecesare.includes('asincron'))) scor += 2
    // Cerință de analiză/planificare fără cod → creierul 2 urcă.
    if (ai.cheie === 'creier2' && (capacitatiNecesare.includes('analiza') || capacitatiNecesare.includes('planificare'))) scor += 2

    const bec = credit ? (credit[ai.becFurnizor] ?? null) : null
    // Creditul live modulează, nu inventează. ROȘU = 402 = fără credit = nu poate
    // rula: penalizare aproape-hard, ca un AI fără credit să NU fie recomandat cât
    // există altul cu credit ȘI potrivire. Dacă TOATE sunt pe roșu, tot iese primul
    // cel mai potrivit — dar cu becul roșu vizibil în clasament (owner reîncarcă).
    if (bec === 'rosu') scor -= 100
    else if (bec === 'verde') scor += 0.5

    const potrivire =
      comune.length > 0
        ? `acoperă: ${comune.join(', ')}`
        : ai.cheie === 'constructor'
          ? 'executor implicit (build + teste + PR)'
          : 'potrivire slabă pentru această cerință'

    return { cheie: ai.cheie, nume: ai.nume, descriere: ai.descriere, scor, potrivire, bec }
  }).sort((a, b) => b.scor - a.scor)

  const varf = clasament[0]
  return {
    trece: true,
    motiv: 'Cerință clară — poate intra în coadă.',
    capacitatiNecesare,
    clasament,
    aiRecomandat: varf && varf.scor > 0 ? varf.cheie : 'constructor',
  }
}

function respins(motiv: string): EvaluareOrdin {
  return { trece: false, motiv, capacitatiNecesare: [], clasament: [], aiRecomandat: null }
}
