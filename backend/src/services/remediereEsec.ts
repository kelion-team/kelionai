// ── REMEDIEREA AUTOMATĂ A EȘECULUI (owner, 19 aug) ───────────────────────────
// „kelion cind esueaza un ordin, imediat trebuie sa faca analiza si sa decida cum
// continua si remediaza" + „da pentru b, vreau AUTOMAT, atentie cu evaluarea
// creierului si cu decizia creierului, cu recomandari CLARE si FERME".
//
// La eșec HARD (status='failed'), Kelion decide IMEDIAT — nu așteaptă reluarea
// manuală. Decizie PURĂ, deterministă, cu recomandare CLARĂ și FERMĂ, și cu grija
// cerută la BANI și la CREIER:
//   • eroare PERMANENTĂ (pungă goală / cheie respinsă / plan fără fonduri) →
//     OPREȘTE (reîncercarea arde degeaba);
//   • prea multe auto-remedieri deja → RAPORTEAZĂ (plasă anti-buclă — nu arde/nu
//     buclează la infinit);
//   • VINA CREIERULUI (modelul n-a produs nimic / indisponibil / throttle) →
//     REIA; escaladează pe PLĂTIT doar dacă rezerva e gata (altfel free + „pune
//     cheia ca să existe rezervă"); NU dăm bani degeaba;
//   • VINA CODULUI (poartă/build/test roșu) → REIA pe ACELAȘI creier (nu-i vina
//     lui — nu escalada), cu instrucțiune de reparare a cauzei;
//   • necunoscut → RAPORTEAZĂ diagnosticul (nu reîncerca ORB).
//
// Contorul de auto-remedieri se ține în afară (kv per job), fiindcă logul jobului
// se REscrie la fiecare raport — deci îl primim ca parametru, pur.

export type ClasaEsec = 'permanent' | 'creier' | 'cod' | 'necunoscut'
export type ActiuneRemediere = 'oprire' | 'reia' | 'raporteaza'

export interface Remediere {
  actiune: ActiuneRemediere
  clasa: ClasaEsec
  /** REIA recomandând creierul PLĂTIT — DOAR vină-creier + rezervă paid gata. */
  escaladeazaCreier: boolean
  motiv: string
  /** Recomandare CLARĂ și FERMĂ (owner). Începe cu verbul deciziei. */
  recomandare: string
}

/** Câte auto-remedieri s-a permis să facă un ordin înainte să raporteze ownerul
 *  (plasă anti-buclă / anti-ardere de bani). Owner: „vreau automat" — dar nu la
 *  infinit: după atâtea, se oprește și ceri om. */
export const MAX_AUTO_REMEDIERI = 2

export function decideRemediereEsec(
  log: string,
  paidDisponibil: boolean,
  nrRemedieriDeja: number,
): Remediere {
  const t = String(log || '')

  // 1) PERMANENT (bani/cheie/plan) — reîncercarea NU ajută, arde degeaba.
  if (/F[ĂA]R[ĂA] CREDIT API|credit balance is too low|\bextra usage\b|\b402\b/i.test(t))
    return {
      actiune: 'oprire',
      clasa: 'permanent',
      escaladeazaCreier: false,
      motiv: 'plan/pungă fără fonduri (402 / extra usage)',
      recomandare: 'OPREȘTE. Pune fonduri la furnizor sau alege un model INCLUS în plan — reîncercarea arde bani degeaba.',
    }
  if (/invalid.*api.?key|authentication_error|API key not valid|API_KEY_INVALID|cheie.*respins|\b401\b/i.test(t))
    return {
      actiune: 'oprire',
      clasa: 'permanent',
      escaladeazaCreier: false,
      motiv: 'cheie respinsă (401)',
      recomandare: 'OPREȘTE. Reface cheia (e config, nu cod), apoi reia manual.',
    }

  // 2) PLASA ANTI-BUCLĂ — destule auto-remedieri deja: nu mai reîncerca automat.
  if (nrRemedieriDeja >= MAX_AUTO_REMEDIERI)
    return {
      actiune: 'raporteaza',
      clasa: 'necunoscut',
      escaladeazaCreier: false,
      motiv: `${nrRemedieriDeja} auto-remedieri fără succes`,
      recomandare: `RAPORTEAZĂ ownerului: ordinul a picat după ${MAX_AUTO_REMEDIERI} remedieri automate — reformulează-l sau împarte-l; auto-reluarea s-a OPRIT ca să nu bucleze / nu ardă.`,
    }

  // 3) VINA CREIERULUI (nu codul): model n-a produs nimic / indisponibil / throttle.
  //    ATENȚIE (owner): escaladez pe PLĂTIT doar dacă rezerva e gata; altfel free +
  //    recomand punerea cheii — nu inventez un paid inexistent, nu ard bani orb.
  if (
    /f[ăa]r[ăa] nicio modificare|n-a modificat nimic|\bno.?change\b|\bno.?edit\b|r[ăa]spuns gol|creier.*indispon|model (invalid|refuzat|nu poate)|throttl|sugrumat|\b429\b|rate.?limit|overload|RESOURCE_?EXHAUSTED/i.test(t)
  ) {
    return paidDisponibil
      ? {
          actiune: 'reia',
          clasa: 'creier',
          escaladeazaCreier: true,
          motiv: 'modelul FREE n-a dus sarcina (fără modificare / indisponibil)',
          recomandare: 'REIA pe creierul PLĂTIT (rezerva cloud) — codul e OK, e MODELUL. Escaladare fermă free→paid.',
        }
      : {
          actiune: 'reia',
          clasa: 'creier',
          escaladeazaCreier: false,
          motiv: 'modelul FREE n-a dus sarcina, FĂRĂ rezervă paid',
          recomandare: 'REIA pe free cu instrucțiune fermă. RECOMAND: pune cheia Ollama + model cloud, ca astfel de ordine să aibă rezervă PLĂTITĂ.',
        }
  }

  // 4) VINA CODULUI (poartă/build/test roșu) — reparabil, ACELAȘI creier (nu-i vina lui).
  if (
    /build.*picat|teste?.*ro[șs]|poart[ăa]|\btsc\b|jscpd|exporturi|sintax|boot.*picat|verificarea a picat|typescript|type error/i.test(t)
  )
    return {
      actiune: 'reia',
      clasa: 'cod',
      escaladeazaCreier: false,
      motiv: 'poartă/build roșu — reparabil în cod',
      recomandare: 'REIA cu ACELAȘI creier + instrucțiune de reparare a cauzei. NU escalada creierul — nu e vina lui, e codul.',
    }

  // 5) NECUNOSCUT — nu reîncerca ORB.
  return {
    actiune: 'raporteaza',
    clasa: 'necunoscut',
    escaladeazaCreier: false,
    motiv: 'cauză neclasificată',
    recomandare: 'RAPORTEAZĂ ownerului diagnosticul — nu reîncerca orb până nu-i clar de ce a picat.',
  }
}
