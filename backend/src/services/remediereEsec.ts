// ── REMEDIEREA AUTOMATĂ A EȘECULUI (owner, 19 aug) ───────────────────────────
// „kelion cind esueaza un ordin, imediat trebuie sa faca analiza si sa decida cum
// continua si remediaza" + „da pentru b, vreau AUTOMAT, atentie cu evaluarea
// creierului si cu decizia creierului, cu recomandari CLARE si FERME".
//
// La eșec HARD (status='failed'), Kelion decide IMEDIAT — nu așteaptă reluarea
// manuală. Decizie PURĂ, deterministă, cu recomandare CLARĂ și FERMĂ. Constructorul
// e FREE-LOCAL unic (creierul cloud plătit a fost SCOS, owner 20 aug) — nu mai există
// escaladare pe plătit; orice reluare rămâne pe creierul LOCAL free:
//   • eroare PERMANENTĂ (config/cheie respinsă) → OPREȘTE (reîncercarea arde degeaba);
//   • prea multe auto-remedieri deja → RAPORTEAZĂ (plasă anti-buclă — nu buclează la
//     infinit);
//   • VINA CREIERULUI (modelul local n-a produs nimic / indisponibil / throttle) →
//     REIA pe creierul LOCAL free cu instrucțiune fermă;
//   • VINA CODULUI (poartă/build/test roșu) → REIA cu instrucțiune de reparare a cauzei;
//   • necunoscut → RAPORTEAZĂ diagnosticul (nu reîncerca ORB).
//
// Contorul de auto-remedieri se ține în afară (kv per job), fiindcă logul jobului
// se REscrie la fiecare raport — deci îl primim ca parametru, pur.

export type ClasaEsec = 'permanent' | 'creier' | 'cod' | 'necunoscut'
export type ActiuneRemediere = 'oprire' | 'reia' | 'raporteaza'

export interface Remediere {
  actiune: ActiuneRemediere
  clasa: ClasaEsec
  motiv: string
  /** Recomandare CLARĂ și FERMĂ (owner). Începe cu verbul deciziei. */
  recomandare: string
}

/** Câte auto-remedieri s-a permis să facă un ordin înainte să raporteze ownerul
 *  (plasă anti-buclă). Owner: „vreau automat" — dar nu la infinit: după atâtea, se
 *  oprește și ceri om. */
export const MAX_AUTO_REMEDIERI = 2

export function decideRemediereEsec(
  log: string,
  nrRemedieriDeja: number,
): Remediere {
  const t = String(log || '')

  // 1) PERMANENT (config/cheie) — reîncercarea NU ajută, arde degeaba.
  if (/F[ĂA]R[ĂA] CREDIT API|credit balance is too low|\bextra usage\b|\b402\b/i.test(t))
    return {
      actiune: 'oprire',
      clasa: 'permanent',
      motiv: 'plan/pungă fără fonduri (402 / extra usage)',
      recomandare: 'OPREȘTE. Reîncercarea arde bani degeaba — cere ownerului să verifice configul furnizorului.',
    }
  if (/invalid.*api.?key|authentication_error|API key not valid|API_KEY_INVALID|cheie.*respins|\b401\b/i.test(t))
    return {
      actiune: 'oprire',
      clasa: 'permanent',
      motiv: 'cheie respinsă (401)',
      recomandare: 'OPREȘTE. Reface cheia (e config, nu cod), apoi reia manual.',
    }

  // 2) PLASA ANTI-BUCLĂ — destule auto-remedieri deja: nu mai reîncerca automat.
  if (nrRemedieriDeja >= MAX_AUTO_REMEDIERI)
    return {
      actiune: 'raporteaza',
      clasa: 'necunoscut',
      motiv: `${nrRemedieriDeja} auto-remedieri fără succes`,
      recomandare: `RAPORTEAZĂ ownerului: ordinul a picat după ${MAX_AUTO_REMEDIERI} remedieri automate — reformulează-l sau împarte-l; auto-reluarea s-a OPRIT ca să nu bucleze.`,
    }

  // 3) VINA CREIERULUI (nu codul): modelul local n-a produs nimic / indisponibil /
  //    throttle. Constructorul e free-local unic → REIA pe creierul LOCAL free (nu
  //    există rezervă plătită pe care să escaladăm, scoasă 20 aug).
  if (
    /f[ăa]r[ăa] nicio modificare|n-a modificat nimic|\bno.?change\b|\bno.?edit\b|r[ăa]spuns gol|creier.*indispon|model (invalid|refuzat|nu poate)|throttl|sugrumat|\b429\b|rate.?limit|overload|RESOURCE_?EXHAUSTED/i.test(t)
  )
    return {
      actiune: 'reia',
      clasa: 'creier',
      motiv: 'modelul LOCAL free n-a dus sarcina (fără modificare / indisponibil / throttle)',
      recomandare: 'REIA pe creierul LOCAL free cu instrucțiune fermă de reparare — constructorul e free-local unic, fără rezervă cloud.',
    }

  // 4) VINA CODULUI (poartă/build/test roșu) — reparabil în cod.
  if (
    /build.*picat|teste?.*ro[șs]|poart[ăa]|\btsc\b|jscpd|exporturi|sintax|boot.*picat|verificarea a picat|typescript|type error/i.test(t)
  )
    return {
      actiune: 'reia',
      clasa: 'cod',
      motiv: 'poartă/build roșu — reparabil în cod',
      recomandare: 'REIA cu instrucțiune de reparare a cauzei — nu e creierul, e codul.',
    }

  // 5) NECUNOSCUT — nu reîncerca ORB.
  return {
    actiune: 'raporteaza',
    clasa: 'necunoscut',
    motiv: 'cauză neclasificată',
    recomandare: 'RAPORTEAZĂ ownerului diagnosticul — nu reîncerca orb până nu-i clar de ce a picat.',
  }
}
