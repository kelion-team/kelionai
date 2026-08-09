// ── ÎNTRERUPĂTORUL MOTOARELOR AUTONOME — OFF BY DEFAULT (Adrian, 9 aug 2026) ──
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

/** Sunt PORNITE motoarele autonome? DEFAULT OFF — orice ≠ '1' înseamnă oprit
 *  (inclusiv cheia inexistentă sau baza necitibilă: „nu știu" = nu ard). */
export async function autonomActiv(): Promise<boolean> {
  return (await loadKv(CHEIE_AUTONOM).catch(() => null)) === '1'
}

/** Pornește/oprește motoarele autonome (admin). `true` = pornit până când e
 *  readus pe `false`; nu pornește nimic de la sine. */
export async function seteazaAutonom(activ: boolean): Promise<void> {
  await saveKv(CHEIE_AUTONOM, activ ? '1' : '0').catch(() => {})
}
