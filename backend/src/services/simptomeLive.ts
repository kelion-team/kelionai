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

/** Ordinul de reparație pentru un simptom viu. Pur (fără I/O) — testabil. Îl
 *  ține scurt și îndreptat spre CAUZĂ, nu spre simptom; îi cere lui Kelion să
 *  ajungă exact la ce a picat, cu logurile la vedere, și să DECIDĂ singur. */
export function ordinSimptomLive(
  fel: string,
  message: string,
  count: number,
  sampleUrl = '',
): string {
  const context =
    fel === 'fara-vedere'
      ? `ATENȚIE (regula #1): întâi stabilește dacă e un BUG REAL (captura de cadru pică deși ` +
        `camera ar trebui să dea imagine) sau ceva NORMAL (camera oprită de user). Dacă e normal, ` +
        `spune-o limpede în PR și NU strica nimic — a te opri cu motiv nu e eșec.\n\n`
      : fel === 'chat-mut'
        ? `Ăsta e exact simptomul „aplicația nu răspunde": userul a cerut ceva și creierul n-a ` +
          `întors text (sau ușa a picat). Nu-l trata ca pe un incident izolat până nu măsori.\n\n`
        : ''
  return (
    `AUTO-VINDECARE LIVE — un eșec REAL prins automat pe aplicația vie ` +
    `(fel: ${fel}, văzut de ${count} ${count === 1 ? 'dată' : 'ori'} în ultimele ore). ` +
    `NU e o eroare raportată din browser — e ceva ce a picat TĂCUT pe server/UI și a fost ` +
    `făcut vizibil ca să ajungi la el.\n\n` +
    `CE A PICAT, EXACT:\n${message}\n` +
    (sampleUrl ? `Unde: ${sampleUrl}\n` : '') +
    `\n${context}` +
    `MERGI LA CAUZĂ, nu la simptom:\n` +
    `  1. Găsește în sursă calea EXACTĂ care a produs asta (search_source/read_source pe mesaj).\n` +
    `  2. Citește server_logs (errorsOnly=false) și runbook_log din jurul momentului — vezi ce s-a ` +
    `     întâmplat de fapt, nu ce bănuiești.\n` +
    `  3. Decide singur CAUZA REALĂ (una), rescrie curat modulul responsabil — fără petice.\n` +
    `  4. Scrie un test care apără exact comportamentul reparat.\n\n` +
    `Verifică ÎNAINTE de PR: cd backend && npm run typecheck && npm test; ` +
    `cd frontend && npm run build (dacă atingi frontend).`
  )
}

/** Praguri pe FEL: câte apariții în fereastră înainte să pornească o reparație.
 *  Un 5xx sau un chat mut sunt eșecuri clare (prag mic, 2); „fără vedere" cere
 *  RECURENȚĂ (5) ca un simplu „camera oprită" să nu nască un ordin degeaba. */
export const PRAG_SIMPTOM: Record<string, number> = {
  'fara-vedere': 5,
}
export const PRAG_SIMPTOM_IMPLICIT = 2

export function pragPentru(fel: string): number {
  return PRAG_SIMPTOM[fel] ?? PRAG_SIMPTOM_IMPLICIT
}
