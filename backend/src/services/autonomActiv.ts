// ── ÎNTRERUPĂTORUL MOTOARELOR AUTONOME — ON BY DEFAULT (owner, 12 aug 2026) ───
// ORDIN NOU (12 aug, verbatim: „dă drumul la autonomie"): default-ul e ON,
// anulând ordinul din 9 aug de mai jos. Plafonul de $10/zi rămâne activ.
// Istoricul de mai jos e păstrat ca CONTEXT (de ce a existat frâna), nu ca stare
// curentă — ordinul valabil e ON, sus.
//
// ── (VECHI, 9 aug 2026 — context) DE CE A EXISTAT FRÂNA OFF ──────────────────
//
// Ownerul, cu creditul scăzând fără să atingă nimic: „nu am folosit 1 sec de la
// ultima alimentare cu credit… clar altceva arde". MĂSURAT: buclele autonome
// (iscoade, pietar, backfill-embeddings, autonomia orară care umple coada
// constructorului, self-heal, triaj) rulează 24/24 pe cheia Gemini a ownerului
// și cheltuiau credit FĂRĂ niciun user. Mai rău: multe nu treceau prin
// `recordCost`, deci pastila arăta ~0 în timp ce Google factura — de-aia zicea
// „creditul afișat pe aplicație e fals".
//
// Ordinul ownerului, verbatim: „off default, dacă nu trebuie nu se
// autoactivează; la sfârșit de cerință se revine în starea OFF."
//
// Ăsta e comutatorul-master, ținut SEPARAT de `isOpsPaused` (aia oprea doar
// autonomia + operațiile GitHub, avea default PORNIT și nu acoperea patrulele).
// Aici DEFAULT-ul e OFF: cheia lipsă sau orice ≠ '1' = oprit. Fiecare motor îl
// verifică la fiecare tură; când e OFF, tura e un no-op ieftin (o citire KV,
// zero tokeni). Se pornește la cerere din admin, iar cine termină o cerință
// poate readuce OFF (folosire unică).

import { loadKv, saveKv } from '../db.js'

export const CHEIE_AUTONOM = 'autonom:activ'

/** Sunt PORNITE motoarele autonome? DEFAULT ON din 12 aug 2026 (owner, verbatim:
 *  „dă drumul la autonomie" + „nu e corect fără excepții"). ON FĂRĂ NICIO
 *  EXCEPȚIE: DOAR '0'/'false' explicit din admin oprește; orice altceva —
 *  cheia lipsă SAU baza necitibilă — = PORNIT. Plafonul de bani ($10/zi,
 *  `plafonConstructor`) rămâne activ ca protecție. */
export async function autonomActiv(): Promise<boolean> {
  const v = await loadKv(CHEIE_AUTONOM).catch(() => null)
  return v !== '0' && v !== 'false'
}

/** Pornește/oprește motoarele autonome (admin). `true` = pornit până când e
 *  readus pe `false`; nu pornește nimic de la sine. */
export async function seteazaAutonom(activ: boolean): Promise<void> {
  await saveKv(CHEIE_AUTONOM, activ ? '1' : '0').catch(() => {})
}
