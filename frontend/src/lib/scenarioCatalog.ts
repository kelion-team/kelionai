import type { FacialLabel } from './facialQueue'

// Scenarii apelabile de creier prin eticheta [GEST nume_scenariu].
// Fiecare scenariu = listă ordonată de pași; un pas = clip Ready Player Me,
// cât timp stă activ, plus o expresie facială ARKit opțională. Prioritatea
// hotărăște dacă un scenariu în desfășurare poate fi întrerupt de altul.
export interface ScenarioStep {
  clip: string
  durationMs: number
  expression?: FacialLabel
}

export interface Scenario {
  name: string
  priority: number
  steps: ScenarioStep[]
}

export const SCENARIOS: Record<string, Scenario> = {
  salut: {
    name: 'salut',
    priority: 5,
    steps: [
      { clip: 'expresie-1', durationMs: 1600, expression: 'smile' },
      { clip: 'variatie', durationMs: 1200, expression: 'warmth' },
    ],
  },
  explicatie: {
    name: 'explicatie',
    priority: 4,
    steps: [
      { clip: 'talk', durationMs: 2400, expression: 'raisedBrow' },
      { clip: 'expresie-4', durationMs: 1400, expression: 'think' },
    ],
  },
  multumire: {
    name: 'multumire',
    priority: 4,
    steps: [
      { clip: 'expresie-2', durationMs: 1600, expression: 'warmth' },
      { clip: 'expresie-1', durationMs: 1200, expression: 'smile' },
    ],
  },
  surprindere: {
    name: 'surprindere',
    priority: 6,
    steps: [
      { clip: 'expresie-3', durationMs: 1200, expression: 'surprise' },
      { clip: 'expresie-4', durationMs: 1200, expression: 'raisedBrow' },
    ],
  },
}

export function getScenario(name: string): Scenario | undefined {
  return SCENARIOS[name.toLowerCase()]
}

export function isScenario(name: string): boolean {
  return name.toLowerCase() in SCENARIOS
}
