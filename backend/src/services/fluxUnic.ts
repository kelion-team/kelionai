// ── NU SE SCRIE DE DOUĂ ORI ACELAȘI LUCRU ───────────────────────────────────
//
// Adrian, 31 iul: „în chat se balează răspunsul lui scris de mai multe ori, e
// greșit, el nu mă aude din prima?" — apoi: „scrie aceeași frază nonstop".
//
// NU e că nu aude. Cauza, găsită în cod:
//
//   orchestrator.ts rulează până la 8 RUNDE (model → unealtă → model → …), iar
//   chat.ts:1809 trimite la client, prin `onText`, FIECARE bucată din FIECARE
//   rundă. Nimic nu compara runda nouă cu ce se spusese deja. Când modelul se
//   împotmolește — repetă aceeași frază și cheamă aceeași unealtă — fraza se
//   scrie o dată pe rundă. De opt ori. „Nonstop", exact cum arată.
//
// Filtrul de aici e partea vizibilă a reparației: ce a ajuns o dată la om nu
// mai ajunge a doua oară. (Cealaltă parte e în orchestrator: bucla se rupe când
// o rundă nu aduce nimic nou — altfel tot plătim opt runde ca să tăiem șapte.)
//
// PRINCIPIUL DE PROIECTARE, fiindcă aici se poate greși urât: e mai bine să
// scape o repetare decât să se înghită text adevărat. Un răspuns tăiat e mult
// mai rău decât unul spus de două ori. De aceea se compară EXACT (substring,
// fără normalizări deștepte care ar putea confunda două fraze asemănătoare) și
// de aceea există pragul de mai jos.

/** Sub atâtea caractere, o repetare se lasă să treacă.
 *
 *  Un „Da." sau „Gata." poate apărea de zece ori într-o conversație, absolut
 *  legitim, și e mereu substring a ce s-a spus înainte. Dacă am tăia și așa
 *  ceva, un răspuns final scurt ar dispărea complet de pe ecran — adică fix
 *  boala pe care o reparăm, doar pe dos. Duplicarea care deranjează e o FRAZĂ
 *  întreagă, nu un cuvânt. */
export const PRAG_REPETITIE = 40

export interface FiltruRepetitie {
  /** Ce trebuie trimis clientului pentru bucata primită. `''` = nimic. */
  bucata(txt: string): string
  /** Închide runda. Întoarce ce a mai rămas de trimis (`''` dacă runda a fost
   *  o repetare și se aruncă). */
  inchideRunda(): string
  /** Runda tocmai închisă n-a adus NIMIC nou (semnal de împotmolire). */
  rundaAFostGoala(): boolean
  /** Tot ce a ajuns efectiv la client, peste toate rundele. */
  emis(): string
}

export function filtruRepetitie(): FiltruRepetitie {
  let emis = ''
  // Ce a produs runda curentă și încă nu știm dacă e nou sau repetare.
  let asteptare = ''
  // Runda a divergat de ce se spusese deja → de-acum curge liber, fără cost.
  let curge = false
  // A adus runda ÎN CURS ceva nou? Se resetează la fiecare `inchideRunda`.
  let aduseNou = false
  // Verdictul ultimei runde ÎNCHISE — ăsta e semnalul de împotmolire pe care
  // îl citește orchestratorul. Separat de `aduseNou`, altfel ar răspunde despre
  // toată tura, nu despre runda care tocmai s-a terminat.
  let ultimaRundaGoala = false

  return {
    bucata(txt: string): string {
      if (!txt) return ''
      if (curge) {
        emis += txt
        return txt
      }
      asteptare += txt
      // Încă e cuprins în ce s-a spus deja → ținem, poate e o repetare.
      // (La prima rundă `emis` e gol, iar ''.includes(orice) e false, deci
      // primul cuvânt curge instant — latența nu are de suferit.)
      if (emis.includes(asteptare)) return ''
      // A divergat. Trimitem DOAR partea nouă: căutăm cel mai lung început
      // care fusese deja spus și tăiem exact atât.
      let k = asteptare.length
      while (k > 0 && !emis.includes(asteptare.slice(0, k))) k--
      const nou = asteptare.slice(k)
      asteptare = ''
      curge = true
      aduseNou = true
      emis += nou
      return nou
    },

    inchideRunda(): string {
      let iese = ''
      if (asteptare) {
        // Runda întreagă a încăput în ce se spusese deja.
        if (asteptare.length >= PRAG_REPETITIE) {
          // Repetare adevărată → se aruncă. ASTA e reparația.
        } else {
          // Prea scurtă ca să fim siguri („Da.", „Gata.") → o lăsăm să treacă.
          iese = asteptare
          emis += iese
          aduseNou = true
        }
      }
      asteptare = ''
      curge = false
      ultimaRundaGoala = !aduseNou
      aduseNou = false
      return iese
    },

    rundaAFostGoala(): boolean {
      return ultimaRundaGoala
    },

    emis(): string {
      return emis
    },
  }
}
