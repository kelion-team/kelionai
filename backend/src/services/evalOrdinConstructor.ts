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

// AI-urile VIZIBILE în clasament (măsurat în cod: constructor-agent.mjs +
// endpointul /api/constructor/creier care rutează la Gemini). Ordinea din listă e
// doar implicită; clasamentul real se calculează pe potrivire + credit.
// JULES A IEȘIT DIN CLASAMENT (owner, 15 aug: „Pune-l rezerva tacuta, invizibil",
// după dovada: 12 zile de la integrare, zero PR-uri din ramuri jules/*). Serviciul
// și uneltele jules_* trăiesc mai departe (services/jules.ts, adminTools) — Kelion
// îl cheamă DOAR la ordinul explicit al ownerului; cheia 'jules' rămâne în tipul
// de mai sus fiindcă e contractul API purtat și de panou.
export const AI_CONSTRUCTORI: AiConstructor[] = [
  {
    cheie: 'constructor',
    // MOTORUL UNIC = AIDER (owner, 16 aug: „constructor unic aider… nu vad aider
    // default in constructor"). Constructorul rulează Aider CHIAR în repo pe server.
    nume: 'Aider (constructorul)',
    descriere:
      'Motorul UNIC al constructorului: Aider construiește CHIAR în repo pe server — editează fișiere, rulează tsc + testele, deschide PR. Creierul lui vine prin app (Gemini rapid → performant). Cel mai potrivit pentru reparații și modificări de cod verificabile.',
    capacitati: ['cod', 'repo', 'teste', 'pr', 'reparatie', 'frontend', 'backend', 'mare', 'asincron'],
    becFurnizor: 'creierul constructorului', // cheie internă pt. maparea creditului — stabilă
  },
  {
    cheie: 'creier2',
    nume: 'Creierul de raționament (Gemini)',
    descriere:
      'Creierul de raționament: analizează, planifică și deblochează Aider când se împotmolește. NU construiește singur în repo — pregătește terenul.',
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

// Vocabular fara echivoc: "fa" nu inseamna cod. Constructorul primeste doar
// un verb tehnic + o tinta din repo; actiunile de ecran/browser au clasa lor.
const ACTIUNI_COD =
  /(?<![\p{L}\p{N}_])(implementeaz[aă]?|construie[sș]te|programeaz[aă]?|repar[aă]?|corecteaz[aă]?|modific[aă]?|refactorizeaz[aă]?|integreaz[aă]?|optimizeaz[aă]?|rescrie|refac|adaug[aă]?|[sș]terge|scrie (?:cod|teste?|un test)|creeaz[aă]? (?:un |o )?(?:endpoint|component[aă]?|func[tț]ie|modul|test|migrare)|implement|build|program|repair|fix|modify|refactor|integrate|optimize|rewrite|add|delete|write (?:code|tests?|a test)|create (?:an? )?(?:endpoint|component|function|module|test|migration))(?![\p{L}\p{N}_])/iu
const TINTE_COD =
  /(?<![\p{L}\p{N}_])(cod(?:ul)?|repo(?:-ul)?|ramur[ăa]|fi[sș]ier(?:ul|e)?|modul(?:ul|e)?|func[tț]i[ea]|clas[ăa]|component[ăa]|frontend|backend|endpoint|api|buton(?:ul|oane)?|formular(?:ul|e)?|pagin[ăa]|bar[ăa]|panou(?:l)?|css|react|typescript|tsx|teste?|bug|eroare|baz[ăa] de date|sql|code|repository|branch|files?|modules?|functions?|classes?|components?|buttons?|forms?|pages?|dashboard|database)(?![\p{L}\p{N}_])/iu
const ACTIUNI_ANALIZA_COD =
  /(?<![\p{L}\p{N}_])(analizeaz[aă]?|investigheaz[aă]?|cerceteaz[aă]?|afl[aă]?|planific[aă]?|proiecteaz[aă]?|verific[aă]?|analyze|analyse|investigate|research|plan|design|verify)(?![\p{L}\p{N}_])/iu
const ACTIUNI_DIRECTE =
  /(?<![\p{L}\p{N}_])(f[aă] (?:un |o )?(?:screenshot|captur[aă])|captur[aă] (?:de )?ecran|focalizeaz[aă]?.*(?:monitor|ecran|bar[aă])|deschide (?:browser(?:ul)?|pagin[aă]|site(?:-ul|ul)?)|d[aă] click|arat[aă]?.*(?:monitor|ecran)|trimite (?:un )?e-?mail|cite[sș]te (?:un )?e-?mail|take (?:a )?screenshot|capture (?:the )?screen|open (?:the )?(?:browser|page|site)|click (?:on )?|show .* (?:monitor|screen)|send (?:an )?e-?mail|read (?:an )?e-?mail)(?![\p{L}\p{N}_])/iu

export type TipActiuneConstructor = 'cod' | 'directa' | 'neclara'

function cerereaDinOrdin(order: string): string {
  const text = String(order || '').trim()
  return /CE A CERUT:\s*([^\n]+)/i.exec(text)?.[1]?.trim() || text
}

export function clasificaActiuneConstructor(order: string): TipActiuneConstructor {
  const text = cerereaDinOrdin(order)
  if ((ACTIUNI_COD.test(text) || ACTIUNI_ANALIZA_COD.test(text)) && TINTE_COD.test(text)) return 'cod'
  if (ACTIUNI_DIRECTE.test(text)) return 'directa'
  return 'neclara'
}

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
  const text = cerereaDinOrdin(order ?? '')
  const tipActiune = clasificaActiuneConstructor(text)

  // ── Poarta de calitate (NU orice ordin trece) ──────────────────────────────
  if (text.length < 8) {
    return respins('Ordin prea scurt — spune concret ce să construiască sau să repare (minim o propoziție).')
  }
  if (IN_AFARA.test(text) || tipActiune === 'directa') {
    return respins('În afara constructorului de cod: aceasta este o acțiune directă de ecran/browser, nu o modificare în repo. Folosește unealta de monitor/browser, fără job de construcție.')
  }
  const capacitatiNecesare = CAPACITATI.filter((c) => c.re.test(text)).map((c) => c.eticheta)
  const analizaExplicita = ACTIUNI_ANALIZA_COD.test(text) &&
    capacitatiNecesare.some((c) => c === 'analiza' || c === 'planificare')
  if (tipActiune === 'neclara' && !analizaExplicita) {
    return respins('Cuvânt de acțiune vag sau neclar pentru constructor. Folosește explicit implementează/repară/modifică/refactorizează + ținta din cod; acțiunile directe merg la uneltele de monitor/browser.')
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
    // (Sarcinile mari/asincrone cad tot la el — Jules e rezervă tăcută, 15 aug.)
    if (ai.cheie === 'constructor') scor += 1
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
  // Executorul implicit rămâne constructorul — DAR dacă el e pe ROȘU (fără
  // credit), nu-l recomandăm orbește: vârful clasamentului iese în față chiar
  // la potrivire slabă (creierul 2 măcar analizează/deblochează cât ownerul
  // reîncarcă). Cu doar două benzi vizibile (Jules e rezervă tăcută, 15 aug),
  // regula asta trebuie spusă explicit, nu lăsată pe seama scorului.
  const constructorPeRosu = clasament.find((r) => r.cheie === 'constructor')?.bec === 'rosu'
  return {
    trece: true,
    motiv: 'Cerință clară — poate intra în coadă.',
    capacitatiNecesare,
    clasament,
    aiRecomandat: varf && (varf.scor > 0 || constructorPeRosu) ? varf.cheie : 'constructor',
  }
}

function respins(motiv: string): EvaluareOrdin {
  return { trece: false, motiv, capacitatiNecesare: [], clasament: [], aiRecomandat: null }
}
