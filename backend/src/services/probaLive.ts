// ── PROBA CARE EXERSEAZĂ CHATUL VIU (nu unit-test din spate) ──────────────────
//
// Adrian, 12 aug: „testele se creează pentru chatul LIVE, nu din spate, că nu
// ajută cu nimic" · „convertește testele pentru chatul live dacă chiar vrei să
// demonstrezi buna intenție".
//
// Are dreptate: un unit-test cu mock-uri nu dovedește că vorbește aplicația. De
// aia proba asta NU e un test din spate — RULEAZĂ PE SERVERUL VIU, singură, la
// interval, și chiar cere creierului de chat un răspuns real (`brainComplete` —
// exact funcția pe care o cheamă calea chatului la escaladare). Dacă nu vine
// niciun răspuns, scrie un simptom la care self-heal ajunge — deci „chatul mut"
// e prins FĂRĂ ca un om să dea peste el.
//
// Onest despre ce probează: creierul-generează (sursa reală a muțeniei — credit/
// cotă/model), nu întreg stratul SSE (ăla e prins de teul de log pe orice 5xx).
// Cauza billing (credit epuizat / cotă) NU e un bug de cod — se ÎNREGISTREAZĂ ca
// vizibilă, dar self-heal N-o trimite constructorului (nu poate repara banii).

import { brainComplete } from './brain.js'
import { geminiLive } from './geminiDirect.js'
import { recordSimptomLive, saveKv } from '../db.js'
import { autonomActiv } from './autonomActiv.js'
import { plafonConstructor } from './autonomie.js'
import { isOpsPaused } from './runbooks.js'

export interface StareProba {
  la: string
  ok: boolean
  detaliu: string
}

/** Persistă ultima probă în KV (`proba:chat`) — vizibilă în admin și pentru
 *  Kelion prin db_query/uneltele de stare; întoarce starea pentru apelant. */
async function pune(s: StareProba): Promise<StareProba> {
  await saveKv('proba:chat', JSON.stringify(s)).catch(() => {})
  return s
}

/** O trecere a probei. Întoarce starea; efectul lateral e simptomul (dacă e cazul). */
export async function probaChatLive(): Promise<StareProba> {
  const acum = new Date().toISOString()

  // Nu probăm (și nu cheltuim) dacă autonomia e oprită sau ești pe pauză.
  if (!(await autonomActiv().catch(() => false)) || (await isOpsPaused().catch(() => false))) {
    return pune({ la: acum, ok: true, detaliu: 'sărită — autonomie oprită' })
  }
  // Nici peste plafonul zilnic de bani (proba costă o tură mică de creier).
  const pl = await plafonConstructor().catch(() => ({ activ: false, plafon: 0, cheltuit: 0 }))
  if (pl.activ && pl.cheltuit >= pl.plafon) {
    return pune({ la: acum, ok: true, detaliu: 'sărită — plafon zilnic atins' })
  }

  // 1) Servește creierul? (sondă ieftină, cache 5 min — desparte billing de un bug.)
  const g = await geminiLive().catch(() => null)
  if (g && g.ok && !g.serving) {
    const cauza =
      g.reason === 'depleted'
        ? 'credit Google epuizat'
        : g.reason === 'quota'
          ? 'cotă atinsă (trecător)'
          : String(g.reason ?? 'necunoscut')
    // Vizibil, DAR nu e bug de cod → self-heal îl sare (vezi FARA_REPARATIE).
    await recordSimptomLive('creier-indisponibil', `proba live chat: creierul nu servește — ${cauza}`).catch(() => {})
    return pune({ la: acum, ok: false, detaliu: `creierul nu servește: ${cauza}` })
  }

  // 2) Cererea reală: produce chatul un răspuns? (tokens minimi, cost mic)
  const raspuns = await brainComplete('Probă internă a chatului. Răspunde cu un singur cuvânt: ok', 24).catch(() => '')
  if (!raspuns.trim()) {
    // Creierul e sus (pasul 1) dar tura n-a întors text = exact „chatul mut".
    await recordSimptomLive('chat-mut', 'proba live: creierul de chat n-a întors niciun text la o cerere trivială').catch(() => {})
    return pune({ la: acum, ok: false, detaliu: 'creierul servește dar tura a fost mută (chat mut)' })
  }
  return pune({ la: acum, ok: true, detaliu: `răspuns real: „${raspuns.slice(0, 40)}"` })
}
