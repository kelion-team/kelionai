// ── MOTORUL DE BIT (Adrian, 4 aug: „cât e muzică trebuie să aibă un motor de
// sincronizare bitrate pe dans") ────────────────────────────────────────────
//
// Nucleul PUR și testabil: primește energia audio (banda de bas) eșantion cu
// eșantion și decide când a lovit un BIT, dacă e MUZICĂ prezentă și ce TEMPO
// (BPM). Fără AudioContext aici — legarea la microfon stă în dansMuzica.ts, ca
// algoritmul să poată fi verificat cu teste (energie sintetică → biți).
//
// Cum: prag ADAPTIV pe energia de bas (media alunecătoare × sensibilitate). Un
// bit = vârf de energie peste prag, dar nu mai des decât perioada refractară
// (plafon ~240 BPM). MUZICĂ = biți REGULAȚI în ultimele câteva secunde (nu un
// zgomot izolat). BPM = din mediana intervalelor dintre biți.

export interface StareBit {
  /** Un bit tocmai a lovit ACUM (în acest eșantion). */
  bit: boolean
  /** Muzică prezentă: biți regulați susținuți (nu vorbă, nu zgomot izolat). */
  muzica: boolean
  /** Tempo estimat, biți/minut (0 = încă necunoscut). */
  bpm: number
}

export interface OptiuniMotorBit {
  /** De câte ori peste medie trebuie să sară energia ca să fie bit (1.3–2.0). */
  sensibilitate?: number
  /** Cel mai scurt interval între biți, ms (plafon de tempo). 250ms ≈ 240 BPM. */
  refractarMs?: number
  /** Câți biți recenți păstrăm pentru tempo + „e muzică". */
  fereastra?: number
}

/** Creează un motor de bit. Apelezi `pas(energie, acumMs)` la fiecare cadru;
 *  întoarce starea. `energie` = 0..1 (energia benzii de bas, normalizată). */
export function creeazaMotorBit(opt: OptiuniMotorBit = {}): {
  pas: (energie: number, acumMs: number) => StareBit
} {
  const sensibilitate = opt.sensibilitate ?? 1.45
  const refractarMs = opt.refractarMs ?? 250
  const fereastra = opt.fereastra ?? 8

  let media = 0 // media alunecătoare a energiei
  let ultimulBit = -Infinity // ms
  const intervale: number[] = [] // ms între biți recenți
  const momente: number[] = [] // momentele biților recenți (ms)

  return {
    pas(energie: number, acumMs: number): StareBit {
      // Media alunecătoare (EMA) — se adaptează la volumul camerei.
      media = media === 0 ? energie : media * 0.92 + energie * 0.08

      let bit = false
      const destulDeTare = energie > 0.02 // sub asta e liniște, nu bit
      if (destulDeTare && energie > media * sensibilitate && acumMs - ultimulBit >= refractarMs) {
        bit = true
        if (ultimulBit > -Infinity) intervale.push(acumMs - ultimulBit)
        ultimulBit = acumMs
        momente.push(acumMs)
        while (intervale.length > fereastra) intervale.shift()
        while (momente.length > fereastra + 1) momente.shift()
      }

      // Uită biții mai vechi de ~4s — „muzica s-a oprit" trebuie să se vadă.
      while (momente.length && acumMs - momente[0] > 4000) {
        momente.shift()
        if (intervale.length) intervale.shift()
      }

      // Tempo din mediana intervalelor (robustă la un interval aiurea).
      let bpm = 0
      if (intervale.length >= 3) {
        const sortate = [...intervale].sort((a, b) => a - b)
        const median = sortate[Math.floor(sortate.length / 2)]
        if (median > 0) bpm = Math.round(60000 / median)
      }

      // MUZICĂ = biți regulați și recenți: cel puțin 4 biți în ultimele 4s și un
      // tempo plauzibil (50–200 BPM). Așa o vorbă ritmată izolată nu declanșează.
      const muzica = momente.length >= 4 && bpm >= 50 && bpm <= 200

      return { bit, muzica, bpm: muzica ? bpm : 0 }
    },
  }
}
