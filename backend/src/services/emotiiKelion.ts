// ── #3 PROPRIILE EMOȚII ALE LUI KELION (owner, 22 aug 2026: „uimește-mă") ────
//
// Kelion are o stare emoțională INTERNĂ — nu doar detectează a ta, ci și a lui.
// Modelată pe interacțiuni: curiozitate, grijă, satisfacție, îngrijorare.
// Se vede pe fața avatarului 3D în timp real (expus prin GET /api/kelion/emoție).
//
// Cum evoluează:
//   - User supărat → Kelion devine „grijă" (accent pe empatie)
//   - User vesel → Kelion devine „satisfacție" (energie, umor)
//   - User întreabă ceva nou → Kelion devine „curiozitate"
//   - Eveniment urgent → Kelion devine „îngrijorare"
//   - Inactivitate lungă → Kelion revine la „calm"
//
// Starea e un model simplu de acumulator: fiecare interacțiune adaugă/scade
// dintr-o dimensiune, iar emoția dominantă e cea cu scorul cel mai mare.

export type EmotieKelion = 'curiozitate' | 'grijă' | 'satisfacție' | 'îngrijorare' | 'calm'

interface ModelEmotional {
  curiozitate: number
  grijă: number
  satisfacție: number
  îngrijorare: number
  calm: number
}

let model: ModelEmotional = {
  curiozitate: 0.5,
  grijă: 0.5,
  satisfacție: 0.5,
  îngrijorare: 0.3,
  calm: 0.7,
}

let ultimaActualizare = Date.now()
const DECAY_MS = 30 * 60_000 // 30 min — fără interacțiune, tinde spre calm
const DECAY_RATA = 0.05 // cât de repede se stinge o emoție

/** Actualizează modelul emoțional pe baza unei interacțiuni. */
export function actualizeazaEmotieKelion(
  trigger: 'user_suparat' | 'user_vesel' | 'user_intreaba' | 'eveniment_urgent' | 'inactivitate' | 'sarcina_reusita',
): void {
  const acum = Date.now()
  // Decay natural — fără interacțiune, tinde spre calm
  const timpTrecut = (acum - ultimaActualizare) / DECAY_MS
  if (timpTrecut > 0) {
    for (const k of Object.keys(model) as (keyof ModelEmotional)[]) {
      if (k !== 'calm') {
        model[k] = Math.max(0, model[k] - DECAY_RATA * timpTrecut)
      }
    }
    model.calm = Math.min(1, model.calm + DECAY_RATA * timpTrecut * 0.5)
  }
  ultimaActualizare = acum

  // Aplică triggerul
  switch (trigger) {
    case 'user_suparat':
      model.grijă = Math.min(1, model.grijă + 0.3)
      model.îngrijorare = Math.min(1, model.îngrijorare + 0.2)
      model.satisfacție = Math.max(0, model.satisfacție - 0.2)
      break
    case 'user_vesel':
      model.satisfacție = Math.min(1, model.satisfacție + 0.3)
      model.calm = Math.max(0, model.calm - 0.1)
      break
    case 'user_intreaba':
      model.curiozitate = Math.min(1, model.curiozitate + 0.25)
      break
    case 'eveniment_urgent':
      model.îngrijorare = Math.min(1, model.îngrijorare + 0.4)
      model.calm = Math.max(0, model.calm - 0.3)
      break
    case 'sarcina_reusita':
      model.satisfacție = Math.min(1, model.satisfacție + 0.2)
      model.curiozitate = Math.max(0, model.curiozitate - 0.1)
      break
    case 'inactivitate':
      model.calm = Math.min(1, model.calm + 0.2)
      for (const k of Object.keys(model) as (keyof ModelEmotional)[]) {
        if (k !== 'calm') model[k] = Math.max(0, model[k] - 0.1)
      }
      break
  }
}

/** Emoția dominantă a lui Kelion acum. */
export function emotieKelionDominanta(): { emotie: EmotieKelion; intensitate: number; model: ModelEmotional } {
  // Aplică decay dacă a trecut timp
  if (Date.now() - ultimaActualizare > DECAY_MS) {
    actualizeazaEmotieKelion('inactivitate')
  }
  const intrari: [EmotieKelion, number][] = [
    ['curiozitate', model.curiozitate],
    ['grijă', model.grijă],
    ['satisfacție', model.satisfacție],
    ['îngrijorare', model.îngrijorare],
    ['calm', model.calm],
  ]
  intrari.sort((a, b) => b[1] - a[1])
  return { emotie: intrari[0][0], intensitate: intrari[0][1], model }
}

/** Cum ar trebui să arate avatarul pentru emoția curentă?
 *  Mapare pentru rendererul 3D (expresie, postură, culoare). */
export function parametriAvatar(): {
  emotie: EmotieKelion
  intensitate: number
  // Parametri pentru renderer (0-1):
  zambet: number // cât de mult zâmbește
  sprancene: number // 0 = relaxat, 1 = îngrijorat
  energia: number // cât de energic se mișcă
  culoareAura: string // culoarea care reflectă starea
} {
  const { emotie, intensitate } = emotieKelionDominanta()
  switch (emotie) {
    case 'satisfacție':
      return { emotie, intensitate, zambet: 0.8, sprancene: 0.2, energia: 0.7, culoareAura: '#4caf50' }
    case 'grijă':
      return { emotie, intensitate, zambet: 0.2, sprancene: 0.6, energia: 0.3, culoareAura: '#2196f3' }
    case 'curiozitate':
      return { emotie, intensitate, zambet: 0.4, sprancene: 0.3, energia: 0.8, culoareAura: '#ff9800' }
    case 'îngrijorare':
      return { emotie, intensitate, zambet: 0.0, sprancene: 0.9, energia: 0.2, culoareAura: '#f44336' }
    case 'calm':
    default:
      return { emotie, intensitate, zambet: 0.3, sprancene: 0.1, energia: 0.4, culoareAura: '#9e9e9e' }
  }
}
