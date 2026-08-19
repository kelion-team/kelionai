// ── AUTOVERIFICAREA INTELIGENTĂ (owner, 19 aug) ──────────────────────────────
// „ceva inteligent bazat pe AI" care verifică singur că Kelion FACE toate
// funcțiile — și, când nu merge, spune și DE CE („verifică și de ce nu merge"),
// cu recomandare fermă. Kelion se testează pe el însuși, măsurat, nu presupus.
//
// SURSA e registrul UNIC de capabilități (brainCapabilities.CAPABILITIES) — nu o
// listă scrisă de mână; o funcție nouă apare aici singură.
//
// SIGURANȚA (banii + producția, owner): funcțiile de CITIRE se probează REAL
// (execuție); funcțiile cu EFECT (build, email, ștergere, plată) NU se execută
// orb — se verifică doar CABLAJUL + dependența, fără efect/cost. Verdictul e
// MĂSURAT (regula #1): „nu pot verifica" cinstit, niciodată „merge" fabricat.
//
// Nucleul (tipFunctie + interpreteazaProba) e PUR și probat; execuția reală și
// diagnosticul AI vin ca dependențe injectate (testabil, fără rețea în teste).

import { CAPABILITIES, grupaExecutieUnealta, type Capability } from './brainCapabilities.js'

export type VerdictFunctie = 'merge' | 'stricat' | 'nu_pot_verifica'
export type TipFunctie = 'citire' | 'efect'

export interface RezultatProba {
  ok: boolean
  rezultat?: string // ce a întors real (scurt)
  eroare?: string // motivul erorii, dacă a picat
}

export interface VerificareFunctie {
  functie: string
  categorie: string
  face: string
  tip: TipFunctie
  verdict: VerdictFunctie
  deCe: string // MĂSURAT — mai ales DE CE nu merge
  recomandare: string // fermă (doar când nu merge)
  dovada: string // ce a întors real, scurt
}

export interface RaportAutoverificare {
  total: number
  merg: number
  stricate: number
  nepotverifica: number
  functii: VerificareFunctie[]
}

/** Citire (probă reală sigură) vs efect (dry-run, fără efect). Sursa: registrul
 *  de execuție paralelă (grupaExecutieUnealta: undefined = citire independentă). */
export function tipFunctie(nume: string): TipFunctie {
  return grupaExecutieUnealta(nume) === undefined ? 'citire' : 'efect'
}

/** PURĂ: din rezultatul MĂSURAT al unei probe → verdict + DE CE + recomandare
 *  fermă. Aici stă inteligența deterministă: clasifică eroarea în cauză reală
 *  (auth / lipsă cheie / rețea / serviciu jos / cablaj), nu doar „nu merge". */
export function interpreteazaProba(
  functie: string,
  tip: TipFunctie,
  p: RezultatProba,
): { verdict: VerdictFunctie; deCe: string; recomandare: string } {
  const e = String(p.eroare ?? '').toLowerCase()
  const r = String(p.rezultat ?? '')

  // ── FUNCȚIE CU EFECT: la test NU se execută (nu ardem bani / nu facem acțiuni).
  // Verificăm doar cablajul — p.ok = e înregistrată + dispecerul o știe.
  if (tip === 'efect') {
    if (p.ok)
      return {
        verdict: 'merge',
        deCe: 'cablată corect; funcție cu EFECT — probă sigură (dry-run), nu se execută la test ca să nu producă efect/cost',
        recomandare: '',
      }
    return {
      verdict: 'stricat',
      deCe: p.eroare || 'funcția nu e înregistrată / dispecerul n-o cunoaște',
      recomandare: 'REPARĂ cablajul: adaug-o în registru + în dispecerul de unelte, apoi re-verifică.',
    }
  }

  // ── FUNCȚIE DE CITIRE: probată REAL. Clasificăm rezultatul măsurat.
  if (p.eroare) {
    // AUTH: nu e stricat, e lipsă de sesiune/drepturi — onest „nu pot verifica".
    if (/\b401\b|\b403\b|unauthorized|forbidden|autentific|sesiun|nu ești admin/.test(e))
      return {
        verdict: 'nu_pot_verifica',
        deCe: 'cere autentificare/drepturi (nu se poate proba fără sesiunea reală)',
        recomandare: 'Verifică logat, din chat; nu e o stricăciune de cod.',
      }
    // CREDENȚIALE lipsă (Google/Serper/cheie): nu merge, dar cauza e clară.
    if (/token|refresh|no.?credential|api.?key|cheie|serper|google.*(auth|token)|reconnect|neconectat/.test(e))
      return {
        verdict: 'nu_pot_verifica',
        deCe: 'lipsește cheia/tokenul necesar (ex. Google/Serper) — nu e stricat codul, e configurarea',
        recomandare: 'FERM: reconectează contul / pune cheia lipsă, apoi re-verifică.',
      }
    // REȚEA / SERVICIU JOS: chiar nu merge acum.
    if (/econnrefused|econnreset|etimedout|timeout|network|fetch failed|getaddrinfo|\b5\d\d\b|service unavailable|not respond|nu r[ăa]spunde/.test(e))
      return {
        verdict: 'stricat',
        deCe: `serviciul nu răspunde (rețea/timeout): ${p.eroare?.slice(0, 120)}`,
        recomandare: 'FERM: verifică serviciul din spate (e jos/încet); re-probează după ce revine.',
      }
    // BINAR/FIȘIER lipsă:
    if (/enoent|not found|command not found|no such file/.test(e))
      return {
        verdict: 'stricat',
        deCe: `lipsește un binar/fișier necesar: ${p.eroare?.slice(0, 120)}`,
        recomandare: 'FERM: instalează/repune dependența lipsă pe host, apoi re-verifică.',
      }
    // Altă eroare — reală, de reparat.
    return {
      verdict: 'stricat',
      deCe: `a picat: ${p.eroare?.slice(0, 140)}`,
      recomandare: 'FERM: deschide funcția din cod pe cauza din motiv și repar-o.',
    }
  }

  // Fără eroare, dar rezultat gol / auto-declarat eșec → nu pot confirma (regula #1).
  if (!r.trim() || /\berror\b|e[șs]uat|nu pot|imposibil|\bfail\b/i.test(r))
    return {
      verdict: 'nu_pot_verifica',
      deCe: r.trim() ? `rezultat neconcludent: ${r.slice(0, 120)}` : 'rezultat gol — nimic măsurabil întors',
      recomandare: 'Re-probează cu o intrare reală; dacă rămâne gol, funcția nu produce nimic.',
    }

  // Rezultat plauzibil → MERGE (probat real).
  return { verdict: 'merge', deCe: 'probat real — a întors un rezultat valid', recomandare: '' }
}

export interface DepsAutoverificare {
  /** Probează o funcție de CITIRE, real (execuție). */
  probaCitire: (c: Capability) => Promise<RezultatProba>
  /** Cablajul unei funcții cu EFECT: e înregistrată + dispecerul o știe? */
  esteCablat: (c: Capability) => Promise<boolean> | boolean
  /** (opțional) Diagnostic AI: îmbogățește „de ce nu merge" pe funcțiile picate,
   *  cu cauză + recomandare mai deșteaptă. Primește lista de picate, întoarce
   *  o hartă nume→{deCe, recomandare}. Dacă lipsește / cade, rămâne diagnosticul
   *  determinist (regula #1: nu inventăm). */
  creierDiag?: (
    picate: { functie: string; face: string; deCe: string }[],
  ) => Promise<Record<string, { deCe?: string; recomandare?: string }>>
}

/** Rulează autoverificarea pe TOATE capabilitățile din registru. */
export async function ruleazaAutoverificare(deps: DepsAutoverificare): Promise<RaportAutoverificare> {
  const functii: VerificareFunctie[] = []
  for (const c of CAPABILITIES) {
    const tip = tipFunctie(c.name)
    let proba: RezultatProba
    try {
      proba = tip === 'citire' ? await deps.probaCitire(c) : { ok: !!(await deps.esteCablat(c)) }
    } catch (err) {
      proba = { ok: false, eroare: String((err as Error)?.message ?? err).slice(0, 200) }
    }
    const { verdict, deCe, recomandare } = interpreteazaProba(c.name, tip, proba)
    functii.push({
      functie: c.name,
      categorie: c.category,
      face: c.does,
      tip,
      verdict,
      deCe,
      recomandare,
      dovada: (proba.rezultat ?? proba.eroare ?? '').slice(0, 200),
    })
  }

  // ── DIAGNOSTIC AI (inteligent) pe cele care NU merg — îmbogățește „de ce".
  const picate = functii.filter((f) => f.verdict !== 'merge')
  if (deps.creierDiag && picate.length) {
    try {
      const harta = await deps.creierDiag(picate.map((f) => ({ functie: f.functie, face: f.face, deCe: f.deCe })))
      for (const f of picate) {
        const d = harta?.[f.functie]
        if (d?.deCe) f.deCe = `${f.deCe} · AI: ${d.deCe}`.slice(0, 400)
        if (d?.recomandare) f.recomandare = d.recomandare.slice(0, 300) || f.recomandare
      }
    } catch {
      /* creierul jos → rămâne diagnosticul determinist (regula #1) */
    }
  }

  return {
    total: functii.length,
    merg: functii.filter((f) => f.verdict === 'merge').length,
    stricate: functii.filter((f) => f.verdict === 'stricat').length,
    nepotverifica: functii.filter((f) => f.verdict === 'nu_pot_verifica').length,
    functii,
  }
}
