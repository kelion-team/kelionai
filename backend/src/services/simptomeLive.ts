// ── OCHII AUTOVINDECĂRII: eșecurile MUTE, transformate în ordine de reparație ──
//
// Adrian, 12 aug: „vreau autonomia si kelion sa vada tot ce pica". Stratul de
// jos (recordSimptomLive / simptomeLiveRecente, în db.ts) FACE VIZIBIL ce pică
// tăcut. Aici sunt cele două piese PURE — fără bază de date, deci ușor de probat:
//   • `pareCerereVizuala` — decide dacă o cerere „chiar voia să vadă", ca să NU
//     notăm „fără vedere" când camera e legitim oprită (regula #1: nu punem în
//     cârcă un eșec care nu e eșec);
//   • `ordinSimptomLive` — scrie ordinul cu care Kelion AJUNGE la exact ce a
//     picat: mergi la cauză, citește logurile, decide, repară.

/** „Chiar a cerut să vadă?" Heuristica pentru DECIZIA DE ÎNREGISTRARE pe voce —
 *  separată intenționat de VISION_INTENT din chat.ts (aia rutează imaginea în
 *  turul scris; asta doar hotărăște dacă un cadru lipsă e un eșec de raportat).
 *  Un „cât e ceasul" fără cadru nu e o vedere picată; un „ce vezi pe ecran"
 *  fără cadru, da. */
export function pareCerereVizuala(text: string): boolean {
  const t = String(text || '').toLowerCase()
  if (!t) return false
  return /\b(vezi|vede|vedea|ved|uita|uite|uit[ăa]|priv|arat|arăt|ecran|camer|imag|foto|poz|fa[țt]|chip|cit[eiș]|scri[se] pe|ce (e|scrie|apare) (pe|în|in)|look|see|read this|what('?s| is) (on|in))/i.test(
    t,
  )
}
