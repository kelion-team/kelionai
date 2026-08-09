// ── VOCEA OMULUI PESTE KELION — BARGE-IN DECIS DE SERVER (9 aug seara) ───────
// Ownerul: „vorbește peste mine". Cleștele întreg, cu măsurători:
//  · Cu barge-in-ul Google pornit, ecoul difuzorului îi tăia LUI vorba
//    („modelul și-a tăiat vorba — a auzit voce peste el", chiar cu pragul
//    START_SENSITIVITY_LOW) → #946 a pus activityHandling: NO_INTERRUPTION.
//  · Cu NO_INTERRUPTION, nimic nu-l mai oprește: când vorbește OMUL peste el,
//    Kelion continuă netulburat — „vorbește peste mine".
// Ieșirea din clește: Google nu știe A CUI e vocea — dar serverul poate cere
// mai mult decât „am auzit ceva": voce SUSȚINUTĂ (≥ SUSTINERE_MS), peste un
// prag absolut de vorbire ȘI dominantă față de podeaua de zgomot. Ecoul
// propriu e deja scăzut de AEC-ul browserului (bucla WebRTC); ruta cheamă
// detectorul DOAR când browserul a raportat AEC activ — fără anulare de ecou,
// „vocea de peste el" ar fi chiar vocea lui și s-ar tăia singur (8 aug).
//
// PODEAUA URMĂREȘTE ZGOMOTUL, NU VORBIREA (auditul de noapte, 9 aug —
// constatare CONFIRMATĂ pe prima formă): EMA simetrică (0.95/0.05) învăța
// chiar ÎNTREBAREA omului cât Kelion tăcea, iar dominanța 3× cerea apoi ~3×
// volumul vorbirii lui normale — barge-in-ul nu se declanșa tocmai în cazul
// comun. Acum adaptarea e ASIMETRICĂ (coboară repede, urcă foarte încet —
// „minimum statistics" în forma simplă): vorbirea, tranzitorie, nu se mai
// absoarbe în podea; zgomotul CONSTANT (ventilator) tot o urcă și tot taie
// verdictul prin dominanță.
//
// Modulul e PUR (fără I/O, fără ceasuri proprii) ca să fie testabil cadru cu
// cadru: primește PCM16 mono și un bool „Kelion se aude acum în difuzor".

/** Prag ABSOLUT de vorbire (RMS 0..1): vorbirea normală la microfon e
 *  ~0.05–0.3; rezidualul de ecou după AEC e sub 0.02. */
export const PRAG_VOCE = 0.04
/** Vocea trebuie să domine podeaua de zgomot de atâtea ori. */
export const DOMINANTA = 1.8
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
  let podea = 0.004 // liniște de cameră, punctul de pornire
  let voceMs = 0
  return {
    proceseazaCadru(cadru, kelionVorbeste) {
      const rms = rmsPcm16(cadru)
      const ms = (cadru.length / 2 / rataHz) * 1000
      // Adaptare ASIMETRICĂ, pe orice cadru: spre liniște repede (0.3), spre
      // tare foarte încet (0.02) — o frază de câteva secunde urcă podeaua doar
      // marginal, un ventilator pornit minute în șir o urcă de tot.
      podea = rms < podea ? podea * 0.7 + rms * 0.3 : podea * 0.98 + rms * 0.02
      const eVoce = rms > PRAG_VOCE && rms > podea * DOMINANTA
      if (!kelionVorbeste || !eVoce) {
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
