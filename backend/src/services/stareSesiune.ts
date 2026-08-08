// ── VERIFICĂRILE SE FAC LA LOGARE, NU LA FIECARE ÎNTREBARE (Adrian, 7 aug) ────
//
// „verificarile de plati etc securitate se fac la logare si atit, e clar nu se
// repeta deloc pe intrebari" + „nu viziteaza tot continentul sa raspunda".
//
// MĂSURAT (audit 7 aug, traseul /api/chat): pe FIECARE tură de chat se făceau
// drumuri separate la DB pentru valori care NU depind de întrebare — preferința
// de limbă, meseria activă, gesturile dezactivate, alegerea de model, preferința
// de voce (a TREIA citire pe aceeași tabelă `user_prefs` în aceeași tură!) și
// soldul. Toate se schimbă rar și sunt legate de CONT, nu de ce a întrebat omul.
//
// Aici le ținem în memorie, pe email, cu un TTL scurt ca plasă de siguranță.
// Prima tură după logare le citește o dată; următoarele le iau din memorie, fără
// niciun drum la DB. Când ceva CHIAR se schimbă (limbă nouă confirmată, meserie
// schimbată din panou, sold debitat), invalidăm exact cheia aceea — deci nu se
// serveşte niciodată o valoare veche pe ceva ce s-a schimbat.
//
// CE NU INTRĂ AICI, INTENȚIONAT: `isAdmin`, eticheta de oaspete și lista de
// unelte. Alea sunt decizii de SECURITATE care depind de tura curentă (cine
// vorbește acum), sunt sigilate în teste (adminFaraConfirmari/poartaVoce/
// caleUnica) și se recalculează la fiecare cerere. Viteza nu se ia din
// securitate — se ia din a nu reciti aceleași preferințe de zeci de ori.

/** Ce ține sesiunea despre un cont, între întrebări. */
export interface StareSesiune {
  speechLang: string | null
  meserieId: number | null
  disabledGestures: string[]
  modelChoiceKv: string | null
  voicePref: string | null
  /** Soldul, doar pentru useri plătitori (adminul e scutit — nu se citește deloc). */
  balance: number | null
  /** Când a fost umplută (ms) — pentru TTL. */
  laMs: number
}

/** Plasă de siguranță: chiar fără invalidare explicită, nimic nu stă mai mult de atât. */
export const TTL_SESIUNE_MS = 10 * 60_000

const sesiuni = new Map<string, StareSesiune>()

/** Starea validă a contului, sau null dacă nu e încă citită / a expirat. */
export function stareSesiune(email: string, acumMs: number): StareSesiune | null {
  const s = sesiuni.get(email)
  if (!s) return null
  if (acumMs - s.laMs > TTL_SESIUNE_MS) {
    sesiuni.delete(email)
    return null
  }
  return s
}

/** Pune starea citită o dată (la logare / la prima tură a sesiunii). */
export function pastreazaStareSesiune(email: string, stare: Omit<StareSesiune, 'laMs'>, acumMs: number): void {
  sesiuni.set(email, { ...stare, laMs: acumMs })
}

/**
 * Schimbă O SINGURĂ valoare din starea deja ținută (fără s-o recitim din DB).
 * Exact cazul soldului: după ce tura s-a taxat, scădem în memorie — nu mai
 * facem încă un drum la DB la următoarea întrebare.
 */
export function actualizeazaStareSesiune(email: string, camp: Partial<Omit<StareSesiune, 'laMs'>>): void {
  const s = sesiuni.get(email)
  if (!s) return
  sesiuni.set(email, { ...s, ...camp })
}

/**
 * Uită contul — la deconectare, sau când ceva s-a schimbat din altă parte
 * (meserie schimbată din panou, gesturi debifate de admin, amprentă ștearsă).
 * Următoarea tură recitește o dată, curat.
 */
export function uitaStareSesiune(email: string): void {
  sesiuni.delete(email)
}

/** Uită TOT (setare globală schimbată de admin — ex. gesturile dezactivate). */
export function uitaToateSesiunile(): void {
  sesiuni.clear()
}
