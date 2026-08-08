import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { loadKv, saveKv } from '../db.js'

const exec = promisify(execFile)

// ── SISTEMUL DE MĂSURARE AL LUI KELION (Adrian, 8 aug 2026) ─────────────────
//
// „implementează sistemul de măsurare și lui Kelion în orice face, să știe
//  să-și ruleze testele cum îmi dai tu mie să-ți rulez — el trebuie singur să
//  poată, și DOAR după să implementeze. Procedură completă, fără să inventeze,
//  să lucreze doar pe date precise primite din verificări și testări măsurate."
//
// PROBLEMA, în forma ei exactă (regula #1 din CLAUDE.md, plătită de trei ori
// într-o singură zi): „Cardul Kelion AI: necreat" — codul nu căutase niciodată
// carduri. „£0.00" — câmpul pornea de la 0 și rămânea 0 când cererea pica. Trei
// ❌ roșii produse de UN SINGUR apel eșuat. De fiecare dată același tipar: o
// CITIRE PICATĂ, prezentată ca FAPT STABILIT.
//
// SOLUȚIA NU E O REGULĂ ÎN PROMPT — e TIPUL DE DATE. O măsurătoare eșuată NU
// ARE câmp `valoare`. Nu există cale, în tot codul, prin care un număr să iasă
// dintr-o citire care n-a reușit: TypeScript refuză să compileze. Un prompt se
// uită; un tip nu.
//
// PROCEDURA pe care o impune modulul, în ordinea asta:
//   1. MĂSOARĂ ÎNAINTE  — starea de plecare, cu dovadă (`masoara`)
//   2. SCHIMBĂ          — abia acum se scrie cod
//   3. MĂSOARĂ DUPĂ     — aceeași măsurătoare, aceeași metodă
//   4. COMPARĂ          — `compara()` spune ce s-a schimbat, cu cifre
//   5. RAPORTEAZĂ       — `raport()` scrie „nu pot verifica" acolo unde chiar
//                         n-a putut, niciodată o cifră liniștitoare inventată
// Tot ce trece prin `masoara` intră și în JURNAL — deci o afirmație despre
// starea sistemului se poate CONFRUNTA cu ce s-a măsurat, nu se ia pe cuvânt.

/** O măsurătoare: ori a reușit ȘI are valoare, ori a picat ȘI are un motiv.
 *  Nu există a treia formă — și, crucial, forma picată n-are câmp `valoare`. */
export type Masuratoare<T> =
  | { masurat: true; cum: string; valoare: T; ms: number; la: string }
  | { masurat: false; cum: string; motiv: string; ms: number; la: string }

/** Câte măsurători ține jurnalul (dovada recentă, nu o arhivă). */
export const JURNAL_MAX = 200
const KV_JURNAL = 'masuratori_jurnal'

/** Rândul din jurnal: ce s-a măsurat, când, cât a durat, și ce a ieșit. */
export interface RandJurnal {
  cum: string
  la: string
  ms: number
  masurat: boolean
  /** Rezumat scurt al valorii (sau motivul picării) — dovada, nu doar bifa. */
  rezumat: string
}

function rezumaValoare(v: unknown): string {
  if (v === null || v === undefined) return String(v)
  if (typeof v === 'object') {
    try {
      return JSON.stringify(v).slice(0, 300)
    } catch {
      return '[obiect nescriptibil]'
    }
  }
  return String(v).slice(0, 300)
}

async function scrieInJurnal(rand: RandJurnal): Promise<void> {
  try {
    const brut = await loadKv(KV_JURNAL)
    const lista = brut ? (JSON.parse(brut) as RandJurnal[]) : []
    lista.push(rand)
    await saveKv(KV_JURNAL, JSON.stringify(lista.slice(-JURNAL_MAX)))
  } catch {
    /* jurnalul e dovadă, nu cale critică: dacă DB-ul e jos, măsurătoarea
       rămâne validă — doar nu se arhivează. Nu stricăm măsurarea pentru log. */
  }
}

/**
 * MĂSOARĂ. Rulează `fn`, cronometrează, și întoarce ori valoarea REALĂ, ori un
 * motiv NUMIT. O excepție, un timeout, un `null` neașteptat — toate devin
 * „n-am putut măsura", niciodată o valoare implicită.
 *
 * `cum` descrie METODA („GET /api/health", „npx tsc --noEmit") — fiindcă o cifră
 * fără metoda din care a ieșit nu se poate verifica de nimeni.
 */
export async function masoara<T>(cum: string, fn: () => Promise<T>): Promise<Masuratoare<T>> {
  const t0 = Date.now()
  const la = new Date().toISOString()
  try {
    const valoare = await fn()
    const ms = Date.now() - t0
    void scrieInJurnal({ cum, la, ms, masurat: true, rezumat: rezumaValoare(valoare) })
    return { masurat: true, cum, valoare, ms, la }
  } catch (e) {
    const ms = Date.now() - t0
    const motiv = e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200)
    void scrieInJurnal({ cum, la, ms, masurat: false, rezumat: motiv })
    return { masurat: false, cum, motiv, ms, la }
  }
}

/** Jurnalul măsurătorilor — dovada, ca să se poată confrunta o afirmație cu ce
 *  s-a măsurat cu adevărat. Gol înseamnă „n-a măsurat nimic", nu „e bine". */
export async function jurnalMasuratori(cate = 30): Promise<RandJurnal[]> {
  try {
    const brut = await loadKv(KV_JURNAL)
    const lista = brut ? (JSON.parse(brut) as RandJurnal[]) : []
    return lista.slice(-Math.max(1, Math.min(cate, JURNAL_MAX)))
  } catch {
    return []
  }
}

// ── PORȚILE, RULATE DE KELION ÎNSUȘI ────────────────────────────────────────
// Exact aceleași comenzi pe care le rulez eu înainte să trimit ceva. Ownerul a
// cerut asta explicit: „să știe să-și ruleze testele cum îmi dai tu mie".
// Fiecare poartă e o MĂSURĂTOARE: dacă nu s-a putut rula, rezultatul e „nu pot
// verifica", NU „TRECE" și nici „PICĂ" — o comandă care n-a pornit nu e un verdict.

export interface Poarta {
  nume: string
  comanda: string
  argumente: string[]
  /** Unde se rulează, relativ la rădăcina repo-ului. */
  in: string
}

export const PORTI: Poarta[] = [
  { nume: 'tipuri', comanda: 'npx', argumente: ['tsc', '--noEmit'], in: 'backend' },
  { nume: 'teste', comanda: 'npx', argumente: ['vitest', 'run'], in: 'backend' },
  { nume: 'lacat-gemini', comanda: 'node', argumente: ['scripts/verifica-gemini.mjs'], in: '.' },
  { nume: 'exporturi', comanda: 'node', argumente: ['scripts/verifica-exporturi.mjs'], in: '.' },
  { nume: 'sintaxa', comanda: 'node', argumente: ['scripts/verifica-sintaxa.mjs'], in: '.' },
  { nume: 'build-frontend', comanda: 'npm', argumente: ['run', 'build'], in: 'frontend' },
]

/** Rădăcina repo-ului în imagine (aplicația pornește din /app). Pe env pentru
 *  rulările din afara containerului — fără să poată fi confundată cu altceva. */
export const RADACINA = process.env.KELION_REPO_ROOT || '/app'

/** Rezultatul unei porți: a trecut, a picat, sau NU S-A PUTUT RULA — trei stări
 *  distincte, fiindcă a treia a fost confundată cu a doua și ne-a costat. */
export type RezultatPoarta =
  | { poarta: string; stare: 'TRECE'; ms: number; iesire: string }
  | { poarta: string; stare: 'PICĂ'; ms: number; iesire: string }
  | { poarta: string; stare: 'NU POT VERIFICA'; ms: number; motiv: string }

export async function ruleazaPoarta(p: Poarta, secunde = 600): Promise<RezultatPoarta> {
  const cwd = p.in === '.' ? RADACINA : `${RADACINA}/${p.in}`
  const m = await masoara(`${p.comanda} ${p.argumente.join(' ')} (în ${p.in})`, async () => {
    const r = await exec(p.comanda, p.argumente, { cwd, timeout: secunde * 1000, maxBuffer: 8 * 1024 * 1024 })
    return `${r.stdout}\n${r.stderr}`.trim().slice(-1500)
  })
  if (m.masurat) return { poarta: p.nume, stare: 'TRECE', ms: m.ms, iesire: m.valoare.slice(-600) }
  // Ieșire cu cod ≠ 0 = poarta chiar a PICAT (avem verdict). Comanda inexistentă,
  // director lipsă, timeout = NU S-A PUTUT RULA (n-avem verdict). Distincția e
  // toată treaba acestui modul.
  const nuAPornit = /ENOENT|not found|spawn|ENOTDIR|timed out|ETIMEDOUT/i.test(m.motiv)
  if (nuAPornit) return { poarta: p.nume, stare: 'NU POT VERIFICA', ms: m.ms, motiv: m.motiv }
  return { poarta: p.nume, stare: 'PICĂ', ms: m.ms, iesire: m.motiv.slice(-600) }
}

/** Verdictul agregat al unei rulări de porți. „INCOMPLET" e o stare de sine
 *  stătătoare: înseamnă că nu se poate spune nici că merge, nici că e stricat. */
export type VerdictPorti = 'TRECE' | 'PICĂ' | 'INCOMPLET'

export function verdictPortilor(r: RezultatPoarta[]): VerdictPorti {
  if (r.some((x) => x.stare === 'PICĂ')) return 'PICĂ'
  if (r.some((x) => x.stare === 'NU POT VERIFICA')) return 'INCOMPLET'
  return r.length ? 'TRECE' : 'INCOMPLET'
}

/** Toate porțile, una după alta. Kelion cheamă asta ÎNAINTE să schimbe ceva
 *  (starea de plecare) și DUPĂ (dovada că n-a stricat nimic).
 *  Verdictul agregat se scrie și în jurnal — de acolo îl citește poarta de
 *  implementare (`dovadaPortilor`), ca „am rulat testele" să nu fie o vorbă. */
export async function ruleazaPortile(doar?: string[]): Promise<RezultatPoarta[]> {
  const lista = doar?.length ? PORTI.filter((p) => doar.includes(p.nume)) : PORTI
  const out: RezultatPoarta[] = []
  for (const p of lista) out.push(await ruleazaPoarta(p))
  const complet = !doar?.length || doar.length >= PORTI.length
  await masoara(SEMNATURA_PORTI, async () => ({
    verdict: verdictPortilor(out),
    complet,
    porti: out.map((x) => `${x.poarta}=${x.stare}`).join(' '),
  }))
  return out
}

/** Semnătura sub care se scrie verdictul porților în jurnal. Poarta de
 *  implementare caută EXACT șirul ăsta — nu o descriere aproximativă. */
export const SEMNATURA_PORTI = 'PORȚI (verdict agregat)'
/** Cât timp mai e valabilă o rulare de porți ca dovadă. După atât, codul s-a
 *  putut schimba de sub ea — o dovadă expirată nu mai e dovadă. */
export const DOVADA_VALABILA_MIN = 30

export interface DovadaPorti {
  /** Se poate implementa? Doar cu porți rulate COMPLET, recent, și TRECE. */
  poateImplementa: boolean
  motiv: string
}

/**
 * DOVADA CERUTĂ ÎNAINTE DE ORICE IMPLEMENTARE (Adrian, 8 aug: „va trebui să
 * folosească OBLIGATORIU toate testele și să măsoare orice răspuns").
 *
 * Nu e o rugăminte în prompt — e o poartă în cod: uneltele care schimbă softul
 * (deschis PR, îmbinat PR) o întreabă întâi pe asta. Fără o rulare COMPLETĂ de
 * porți, recentă, cu verdict TRECE, nu se implementează. Un prompt se uită; o
 * poartă nu.
 */
export async function dovadaPortilor(): Promise<DovadaPorti> {
  const randuri = await jurnalMasuratori(JURNAL_MAX)
  const ale = randuri.filter((r) => r.cum === SEMNATURA_PORTI && r.masurat)
  const ultim = ale[ale.length - 1]
  if (!ultim) {
    return {
      poateImplementa: false,
      motiv: 'nu ai rulat NICIODATĂ porțile. Rulează `ruleaza_portile` întâi — fără măsurătoare nu se implementează.',
    }
  }
  const vechimeMin = Math.round((Date.now() - Date.parse(ultim.la)) / 60000)
  if (!Number.isFinite(vechimeMin) || vechimeMin > DOVADA_VALABILA_MIN) {
    return {
      poateImplementa: false,
      motiv: `ultima rulare de porți e veche de ${vechimeMin} min (valabilă ${DOVADA_VALABILA_MIN} min). Codul s-a putut schimba de sub ea — rulează din nou ruleaza_portile.`,
    }
  }
  if (!/"complet":true/.test(ultim.rezumat)) {
    return { poateImplementa: false, motiv: 'ultima rulare a fost PARȚIALĂ. Rulează TOATE porțile, nu o parte.' }
  }
  if (/"verdict":"PICĂ"/.test(ultim.rezumat)) {
    return { poateImplementa: false, motiv: `porțile PICĂ: ${ultim.rezumat}. Repară întâi, apoi implementează.` }
  }
  if (/"verdict":"INCOMPLET"/.test(ultim.rezumat)) {
    return {
      poateImplementa: false,
      motiv: `verdict INCOMPLET (porți nemăsurate): ${ultim.rezumat}. „Nu știu" nu e „e bine" — rulează-le până ies toate.`,
    }
  }
  return { poateImplementa: true, motiv: `porți TRECE, măsurate acum ${vechimeMin} min` }
}

// ── RAPORTUL — unde se vede diferența dintre „e bine" și „nu pot verifica" ───

/** Scrie o măsurătoare în cuvinte. Forma picată NU produce niciodată o cifră. */
export function raport<T>(m: Masuratoare<T>): string {
  if (m.masurat) return `${m.cum}: ${rezumaValoare(m.valoare)} (${m.ms} ms, ${m.la})`
  return `${m.cum}: NU POT VERIFICA — ${m.motiv} (încercat ${m.ms} ms, ${m.la})`
}

/** Verdictul porților, în formă citibilă. „NU POT VERIFICA" rămâne separat de
 *  „PICĂ": una înseamnă „e stricat", cealaltă „nu știu", și nu se amestecă. */
export function raportPorti(r: RezultatPoarta[]): string {
  const linii = r.map((x) =>
    x.stare === 'NU POT VERIFICA'
      ? `  ?  ${x.poarta}: NU POT VERIFICA — ${x.motiv}`
      : `  ${x.stare === 'TRECE' ? '✓' : '✗'}  ${x.poarta}: ${x.stare} (${x.ms} ms)`,
  )
  const necunoscute = r.filter((x) => x.stare === 'NU POT VERIFICA').length
  const picate = r.filter((x) => x.stare === 'PICĂ').length
  const verdict = picate
    ? `PICĂ (${picate} poartă/porți)`
    : necunoscute
      ? `INCOMPLET — ${necunoscute} nemăsurate; NU pot spune că e bine`
      : 'TRECE'
  return `${linii.join('\n')}\n  VERDICT: ${verdict}`
}

// ── COMPARAȚIA ÎNAINTE/DUPĂ — pasul 4 al procedurii ─────────────────────────

/** Compară două măsurători ale ACELEIAȘI metode. Dacă vreuna n-a reușit, NU
 *  există diferență de raportat — nu se scade dintr-o valoare inexistentă. */
export function compara(inainte: Masuratoare<number>, dupa: Masuratoare<number>): string {
  if (!inainte.masurat) return `nu pot compara: măsurătoarea DINAINTE a picat — ${inainte.motiv}`
  if (!dupa.masurat) return `nu pot compara: măsurătoarea DE DUPĂ a picat — ${dupa.motiv}`
  const d = dupa.valoare - inainte.valoare
  const semn = d > 0 ? '+' : ''
  const procent = inainte.valoare !== 0 ? ` (${semn}${((d / inainte.valoare) * 100).toFixed(1)}%)` : ''
  return `${inainte.cum}: ${inainte.valoare} → ${dupa.valoare} (${semn}${d}${procent})`
}

// ── VÂNĂTOAREA DE BUGURI (Adrian, 8 aug: „nu se pot căuta automat toate bugurile
// și err? să le rezolvi și să le remăsori?") ─────────────────────────────────
//
// Răspunsul cinstit: o parte DA, complet automat; restul nu, și e important să
// se știe care e care.
//
// SE POATE AUTOMAT: erorile reale ale utilizatorilor (adunate din browser în
// `client_errors`), tipurile (tsc), tiparele de bug din analizor (oxlint), codul
// abandonat, duplicatul, testele picate. Alea se caută, se numără și se remăsoară
// după reparație.
//
// NU SE POATE AUTOMAT: bugul de LOGICĂ pe care niciun test nu-l acoperă și
// niciun analizor nu-l vede — „face ce i s-a cerut?". Ăla se prinde doar
// măsurând comportamentul, nu citind codul. De-aia vânătoarea nu spune niciodată
// „nu sunt buguri": spune ce a găsit ȘI ce n-a putut căuta.
//
// CAPCANA EVITATĂ AICI, EXPLICIT: `listClientErrorGroups` întoarce listă goală
// și când baza e căzută. Adică exact tiparul „£0.00" — zero care înseamnă „n-am
// putut citi". De-aia se verifică ÎNTÂI că baza răspunde; dacă nu, erorile sunt
// „NU POT VERIFICA", niciodată „0".

export interface Vanatoare {
  /** Erori reale de la utilizatori — sau motivul pentru care nu se pot citi. */
  eroriUtilizatori: Masuratoare<{ grupuri: number; total: number; exemple: string[] }>
  /** Tiparele de bug găsite de analizor. */
  analizor: RezultatPoarta
  /** Porțile obișnuite (tipuri, teste, exporturi, sintaxă). */
  porti: RezultatPoarta[]
}

export async function vaneazaBuguri(oreInapoi = 48): Promise<Vanatoare> {
  const eroriUtilizatori = await masoara(`erori reale din browser, ultimele ${oreInapoi}h`, async () => {
    // ÎNTÂI dovada că baza răspunde. Fără ea, o listă goală nu înseamnă nimic.
    const { loadKv: ping } = await import('../db.js')
    await ping('__ping_vanatoare__')
    const { listClientErrorGroups } = await import('../db.js')
    const g = await listClientErrorGroups(oreInapoi, 30)
    return {
      grupuri: g.length,
      total: g.reduce((s, x) => s + (Number(x.n) || 0), 0),
      exemple: g.slice(0, 5).map((x) => `${x.n}× ${x.message}`),
    }
  })
  const analizor = await ruleazaPoarta(
    { nume: 'analizor', comanda: 'npx', argumente: ['oxlint', '--deny', 'no-unused-vars'], in: 'backend' },
    300,
  )
  const porti = await ruleazaPortile(['tipuri', 'teste', 'exporturi', 'sintaxa'])
  return { eroriUtilizatori, analizor, porti }
}

/** Raportul vânătorii. Nu spune NICIODATĂ „nu sunt buguri" — spune ce a găsit ȘI
 *  ce n-a putut căuta, ca omul să știe cât din tablou lipsește. */
export function raportVanatoare(v: Vanatoare): string {
  const l: string[] = ['VÂNĂTOARE DE BUGURI:']
  l.push(
    v.eroriUtilizatori.masurat
      ? v.eroriUtilizatori.valoare.grupuri === 0
        ? '  ✓ erori de la utilizatori: 0 (baza a răspuns — deci chiar zero)'
        : `  ✗ erori de la utilizatori: ${v.eroriUtilizatori.valoare.grupuri} feluri, ${v.eroriUtilizatori.valoare.total} apariții\n${v.eroriUtilizatori.valoare.exemple.map((e) => `      ${e}`).join('\n')}`
      : `  ?  erori de la utilizatori: NU POT VERIFICA — ${v.eroriUtilizatori.motiv}`,
  )
  l.push(raportPorti([v.analizor, ...v.porti]))
  l.push('')
  l.push('CE NU S-A CĂUTAT: bugul de logică pe care niciun test nu-l acoperă.')
  l.push('Automatizarea găsește ce se poate număra; restul se prinde măsurând comportamentul.')
  return l.join('\n')
}
