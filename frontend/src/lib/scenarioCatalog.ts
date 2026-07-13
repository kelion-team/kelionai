import { pushFacial, type FacialLabel } from './facialQueue'

// Catalog reutilizabil de scenarii pentru avatarul Kelion.
// Fiecare scenariu = o secvență de pași care combină un clip RPM (schelet)
// cu o micro-expresie facială și un timp de rulare. Scenariile sunt independente
// de text/voice și pot fi declanșate de oriunde prin `playScenario(name)`.

export interface ScenarioStep {
  /** Numele clipului RPM (exact ca în AvatarModel: CLIP_FILES / LAZY_CLIP_FILES). */
  clip: string
  /** Cât ține pasul, în milisecunde, înainte de a trece la următorul. */
  durationMs: number
  /** Micro-expresia facială declanșată în acest pas (opțional). */
  face?: FacialLabel
  /** Când declanșăm micro-expresia față de începutul pasului (default 0). */
  faceAtMs?: number
}

export interface Scenario {
  name: string
  steps: ScenarioStep[]
}

const SCENARIO_LIST: Scenario[] = [
  {
    name: 'salut',
    steps: [
      // Salut cald, cu mână / plecăciune ușoară (expresie-1) + față caldă.
      { clip: 'expresie-1', durationMs: 2200, face: 'warmth', faceAtMs: 200 },
      // Revine domol într-un repaus gentleman, cu un zâmbet discret.
      { clip: 'variatie-2', durationMs: 1600, face: 'smile', faceAtMs: 400 },
    ],
  },
  {
    name: 'explicatie',
    steps: [
      // Arată înainte, ca și cum ar puncta o idee.
      { clip: 'expresie-2', durationMs: 2400, face: 'think', faceAtMs: 200 },
      // Vorbește cu gesturi mici, sprâncene ridicate pentru claritate.
      { clip: 'talk', durationMs: 3000, face: 'raisedBrow', faceAtMs: 400 },
      // Aprobare caldă la final, pentru a încheia explicația frumos.
      { clip: 'expresie-11', durationMs: 1800, face: 'warmth', faceAtMs: 200 },
    ],
  },
  {
    name: 'multumire',
    steps: [
      // Mulțumire (expresie-7) cu față caldă.
      { clip: 'expresie-7', durationMs: 2200, face: 'warmth', faceAtMs: 150 },
      // Revine într-un repaus deschis, zâmbind discret.
      { clip: 'variatie-4', durationMs: 1600, face: 'smile', faceAtMs: 300 },
    ],
  },
  {
    name: 'surprindere',
    steps: [
      // Surpriză propriu-zisă (expresie-8) + ochi măriți.
      { clip: 'expresie-8', durationMs: 1800, face: 'surprise', faceAtMs: 100 },
      // Uimire ulterioară (expresie-3) pentru a susține reacția.
      { clip: 'expresie-3', durationMs: 1600, face: 'surprise', faceAtMs: 100 },
    ],
  },
]

export const SCENARIOS: Record<string, Scenario> = Object.fromEntries(
  SCENARIO_LIST.map((s) => [s.name, s]),
)

export const SCENARIO_NAMES: string[] = SCENARIO_LIST.map((s) => s.name)

export function listScenarios(): readonly Scenario[] {
  return SCENARIO_LIST
}

export function isScenarioName(value: unknown): value is string {
  return typeof value === 'string' && value in SCENARIOS
}

function dispatchClip(clip: string): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('kelion-gesture', { detail: clip }))
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason)
      return
    }
    const id = globalThis.setTimeout(resolve, ms)
    const onAbort = (): void => {
      globalThis.clearTimeout(id)
      reject(signal!.reason)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Rulează un scenariu din catalog: trimite fiecare clip pe canalul
 * `kelion-gesture` și micro-expresiile pe `facialQueue`, cu timpii declarați.
 * Returnează un Promise care se rezolvă la final sau respinge la abort.
 */
export async function playScenario(name: string, signal?: AbortSignal): Promise<void> {
  const scenario = SCENARIOS[name]
  if (!scenario) {
    throw new Error(`Scenariu necunoscut: ${name}`)
  }
  for (const step of scenario.steps) {
    if (signal?.aborted) {
      throw signal.reason
    }
    dispatchClip(step.clip)
    const faceAt = step.faceAtMs ?? 0
    if (step.face !== undefined && faceAt >= 0) {
      globalThis.setTimeout(() => {
        if (!signal?.aborted) pushFacial(step.face!)
      }, faceAt)
    }
    await sleep(step.durationMs, signal)
  }
}
