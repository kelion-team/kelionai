// ── PULSUL LUCRĂTORULUI CONSTRUCTORULUI (owner, 19 aug: „vad ca are ordine in
// coada dar nu se apuca aider sau altcineva de reparat, de ce?") ──────────────
// Cauza asta era o CUTIE NEAGRĂ: panoul arăta ordinele în coadă, dar NIMIC despre
// dacă lucrătorul de pe VPS (cron la 2 min → GET /api/constructor/next) mai e VIU.
// Dacă cronul e oprit / workerul iese devreme (env lipsă), nimeni nu cere ordine
// și ele stau în coadă — fără ca app-ul să spună de ce.
//
// PUR + testat (regula #1: nicio stare arătată fără măsurătoare). Din bătaia de
// inimă MĂSURATĂ (ultima dată când workerul a cerut un ordin) + acum, dă verdictul:
// VIU dacă a bătut în ultimele `pragMs` (implicit 5 min: cronul e la 2 min, deci
// >5 min de tăcere = worker/cron mort, sigur), altfel MORT — cu vârsta în secunde,
// ca omul să vadă exact cât de veche e tăcerea. `lastPoll<=0` = n-a bătut niciodată
// (worker nepornit de la ultima repornire a app-ului).

export interface VerdictPulsLucrator {
  /** Timestamp (ms) al ultimei cereri de ordin; 0 = niciodată. */
  lastPoll: number
  /** Vârsta bătăii în secunde, sau null dacă n-a bătut niciodată. */
  ageSec: number | null
  /** Lucrătorul a cerut un ordin recent (sub prag)? */
  viu: boolean
  /** Pragul folosit (ms) — expus ca panoul să spună „de X min". */
  pragMs: number
}

export function verdictPulsLucrator(
  lastPollMs: number,
  acumMs: number,
  pragMs = 5 * 60_000,
): VerdictPulsLucrator {
  const lastPoll = Number.isFinite(lastPollMs) && lastPollMs > 0 ? Math.floor(lastPollMs) : 0
  if (!lastPoll) return { lastPoll: 0, ageSec: null, viu: false, pragMs }
  const ageMs = Math.max(0, acumMs - lastPoll)
  return { lastPoll, ageSec: Math.round(ageMs / 1000), viu: ageMs < pragMs, pragMs }
}
