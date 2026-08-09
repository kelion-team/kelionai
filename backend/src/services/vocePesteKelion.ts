// ── VOCEA OMULUI PESTE KELION — BARGE-IN DECIS DE SERVER (9 aug seara) ───────
// Ownerul: „vorbește peste mine". Cleștele întreg, cu măsurători:
//  · Cu barge-in-ul Google pornit, ecoul difuzorului îi tăia LUI vorba
//    („modelul și-a tăiat vorba — a auzit voce peste el", chiar cu pragul
//    START_SENSITIVITY_LOW) → #946 a pus activityHandling: NO_INTERRUPTION.
//  · Cu NO_INTERRUPTION, nimic nu-l mai oprește: când vorbește OMUL peste el,
//    Kelion continuă netulburat — „vorbește peste mine".
// Ieșirea din clește: Google nu știe A CUI e vocea — dar serverul poate cere
// mai mult decât „am auzit ceva": voce SUSȚINUTĂ (≥ SUSTINERE_MS), peste un
// prag absolut ȘI dominantă față de podeaua de zgomot adaptivă. Ecoul propriu
// e deja scăzut de AEC-ul browserului (bucla WebRTC); rezidualul intră în
// podea și nu poate deveni verdict. Ruta cheamă detectorul DOAR când browserul
// a raportat AEC activ — fără anulare de ecou, „vocea de peste el" ar fi chiar
// vocea lui și s-ar tăia singur, exact regresia din 8 aug.
//
// Modulul e PUR (fără I/O, fără ceasuri proprii) ca să fie testabil cadru cu
// cadru: primește PCM16 mono și un bool „Kelion se aude acum în difuzor".

/** Sub RMS-ul ăsta (0..1) nu e voce, orice-ar zice dominanța. */
export const PRAG_MIN_RMS = 0.02
/** Vocea trebuie să fie de atâtea ori peste podeaua de zgomot. */
export const DOMINANTA = 3
/** Atâta voce NEÎNTRERUPTĂ cere verdictul — un cadru de 256 ms nu ajunge,
 *  două da: clinchete, tuse și rafale de ecou rămân sub prag. */
export const SUSTINERE_MS = 350

/** RMS-ul unui cadru PCM16 little-endian, normalizat la 0..1. */
export function rmsPcm16(cadru: Buffer): number {
  const mostre = Math.floor(cadru.length / 2)
  if (!mostre) return 0
  let suma = 0
  for (let i = 0; i < mostre; i++) {
    const v = cadru.readInt16LE(i * 2) / 32768
    suma += v * v
  }
  return Math.sqrt(suma / mostre)
}

export interface DetectorVocePeste {
  /** Un cadru de microfon. `kelionVorbeste` = difuzorul redă vocea lui ACUM
   *  (estimarea rutei). Întoarce true EXACT o dată per izbucnire susținută:
   *  „omul vorbește peste Kelion — taie-i vorba". */
  proceseazaCadru(cadru: Buffer, kelionVorbeste: boolean): boolean
}

export function creeazaDetectorVocePeste(rataHz = 16_000): DetectorVocePeste {
  let podea = 0.004 // liniște de cameră, punctul de pornire al adaptării
  let voceMs = 0
  return {
    proceseazaCadru(cadru, kelionVorbeste) {
      const rms = rmsPcm16(cadru)
      const ms = (cadru.length / 2 / rataHz) * 1000
      const eVoce = rms > PRAG_MIN_RMS && rms > podea * DOMINANTA
      if (!kelionVorbeste) {
        // Cât Kelion tace, TOT ce se aude e ambient (om, ventilator, stradă)
        // — podeaua învață nivelul, ca un zgomot CONSTANT să nu poată tăia.
        podea = podea * 0.95 + rms * 0.05
        voceMs = 0
        return false
      }
      if (!eVoce) {
        // Rezidualul de ecou / liniștea din timpul redării coboară în podea.
        podea = podea * 0.95 + rms * 0.05
        voceMs = 0
        return false
      }
      voceMs += ms
      if (voceMs >= SUSTINERE_MS) {
        voceMs = 0
        return true
      }
      return false
    },
  }
}
