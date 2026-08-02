// ── CURSA: PRIMUL CÂȘTIGĂTOR, NU TOȚI LA LINIA DE SOSIRE ────────────────────
//
// Măsurat live, 2 aug (jurnalul de producție, ture reale): cursa modelelor
// ușoare aștepta cu `Promise.all` TOȚI concurenții — adică răspunsul ajungea
// la om abia când termina și cel mai LENT concurent. Dovadă din log:
//
//   14:49:08 POST /api/chat → 14:49:26 câștigător anunțat = 18,6s
//   (gemini-direct răspunsese în câteva secunde, dar gemma-4-26b:free a
//    întors gol abia la 18,6s — și până atunci aștepta și omul.)
//
// Un concurent lent sau mort nu mai ține ostatic câștigătorul: primul
// răspuns BUN (non-null) închide cursa; ceilalți aleargă în fundal până la
// capăt (slotul lor se eliberează în `finally`, memoria de eșecuri se
// notează în interiorul fiecărui concurent — nimic nu se pierde).
//
// Pur și testat: promisiuni → prima valoare non-null, sau null dacă toate
// întorc null / lista e goală.

/**
 * Așteaptă PRIMUL rezultat non-null dintre concurenți (nu pe toți).
 * Concurenții pierdători continuă în fundal — promisiunile lor rămân
 * handled (fiecare are lanțul lui), deci nu apar unhandled rejections:
 * respingătorii se tratează la apelant, în interiorul concurentului.
 */
export async function primulCastigator<T>(
  concurenti: Promise<T | null>[],
): Promise<T | null> {
  if (concurenti.length === 0) return null
  return new Promise<T | null>((resolve) => {
    let ramasi = concurenti.length
    let decis = false
    for (const p of concurenti) {
      // Fiecare concurent ÎȘI tratează propria respingere la apelant
      // (în chat.ts concurentul e deja împachetat try/catch → întoarce null);
      // aici ne apărăm oricum, ca o respingere brută să nu omoare cursa.
      void p.then(
        (c) => {
          ramasi--
          if (!decis && c !== null && c !== undefined) {
            decis = true
            resolve(c)
          } else if (ramasi === 0 && !decis) {
            decis = true
            resolve(null)
          }
        },
        () => {
          ramasi--
          if (ramasi === 0 && !decis) {
            decis = true
            resolve(null)
          }
        },
      )
    }
  })
}
