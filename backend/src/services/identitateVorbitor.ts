// ── VERDICTUL VORBITORULUI — cine e la tastatură/microfon, la FIECARE frază ───
//
// Cerința (Adrian, 5 aug, „problemă de maximă securitate"): la fiecare frază se
// identifică vorbitorul după TIMBRU + FAȚĂ. Dacă nu e titularul contului →
// puteri OFF + provocare activă (cine ești, autorizare, dovadă). Regula e
// PERMANENTĂ și se aplică pe FIECARE cont, cu referințele contului respectiv;
// drepturile NU se amestecă între conturi (un oaspete autorizat pe un cont NU
// are drepturi pe altul — apelantul cheamă funcția cu referințele CONTULUI curent).
//
// Această funcție e PURĂ (fără DB, fără rețea) ca să fie probată la bit: decide
// verdictul din potrivirile deja calculate + fereastra de confirmare. Cine face
// citirile (voiceprint/faceprint/oaspeți) e chat.ts; aici doar JUDECĂM.

export type VerdictVorbitor = 'titular' | 'oaspete' | 'strain'

export interface IntrareVerdict {
  /** Vocea se potrivește cu a titularului? true/false din măsurătoare; null = fără mostră de voce. */
  vocePotrivita: boolean | null
  /** Fața se potrivește cu a titularului? true/false; null = fără mostră de față. */
  fataPotrivita: boolean | null
  /** Mostra (voce sau față) se potrivește cu un OASPETE deja autorizat pe ACEST cont. */
  oaspeteCunoscut: boolean
  /** Când a fost ultima confirmare a titularului (ms epoch); 0 = niciodată. */
  confirmatTitularLa: number
  /** Acum (ms epoch). */
  acum: number
  /** Cât ține o confirmare fără mostră nouă (ms). */
  fereastraMs: number
}

export interface RezultatVerdict {
  verdict: VerdictVorbitor
  /** A fost decis pe fereastra de confirmare (fără mostră nouă), nu pe o potrivire acum. */
  peFereastra: boolean
}

/** Titular DOAR dacă o mostră chiar se potrivește ACUM, sau (fără mostră) dacă
 *  titularul a fost confirmat în fereastră. O mostră care NU se potrivește scoate
 *  titularul PE LOC, oricât de recentă ar fi fereastra — altfel un impostor ar
 *  „moșteni" fereastra titularului. */
export function verdictVorbitor(x: IntrareVerdict): RezultatVerdict {
  const areMostra = x.vocePotrivita !== null || x.fataPotrivita !== null
  // O mostră care se potrivește (voce SAU față) = titular confirmat acum.
  if (x.vocePotrivita === true || x.fataPotrivita === true) {
    return { verdict: 'titular', peFereastra: false }
  }
  // Există mostră, dar NU e a titularului → nu poate fi titular (nici pe fereastră).
  if (areMostra) {
    return { verdict: x.oaspeteCunoscut ? 'oaspete' : 'strain', peFereastra: false }
  }
  // Fără mostră: dacă titularul a fost confirmat recent, rămâne titular pe fereastră.
  const inFereastra = x.confirmatTitularLa > 0 && x.acum - x.confirmatTitularLa <= x.fereastraMs
  if (inFereastra) return { verdict: 'titular', peFereastra: true }
  // Fără mostră ȘI fără confirmare recentă → nu putem confirma → tratăm ca străin
  // (provocare + puteri OFF), ca „orice voce = titular" să NU se mai întâmple.
  return { verdict: 'strain', peFereastra: false }
}

/** Fereastra implicită de confirmare fără mostră nouă: 15 minute. */
export const FEREASTRA_CONFIRMARE_MS = 15 * 60_000
