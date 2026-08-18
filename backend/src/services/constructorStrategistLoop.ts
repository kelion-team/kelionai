import type {
  ConstructorCauseCode,
  ConstructorIncident,
  ConstructorIncidentState,
} from './constructorIncident.js'
import {
  buildConstructorStrategistPrompt,
  constructorEvidenceFingerprint,
  mayExecuteConstructorStrategy,
  parseConstructorStrategy,
  type ConstructorStrategy,
} from './constructorStrategist.js'

export interface ConstructorStrategistKnowledge {
  open: ConstructorIncident[]
  lessons: string[]
}

type ActiveIncidentState = Exclude<ConstructorIncidentState, 'open' | 'closed'>

export interface ConstructorStrategistUpdate {
  state: ActiveIncidentState
  stage?: string
  causeCode?: ConstructorCauseCode
  causeSummary?: string
  evidence: string
  nextAction: string
  strategy?: ConstructorStrategy
  strategyActionFingerprint?: string
  strategyEvidenceFingerprint?: string
  strategyPending?: boolean
}

export interface ConstructorStrategistDependencies {
  think: (prompt: string) => Promise<string>
  executeBrainAction: (strategy: ConstructorStrategy, incident: ConstructorIncident) => Promise<string>
  retryJob: (jobId: number, reformulatedOrder?: string) => Promise<{ status: string } | null>
  updateIncident: (id: number, fields: ConstructorStrategistUpdate) => Promise<unknown>
  capabilityInventory: string
  constructorBusy: boolean
  now?: () => number
  notifyBlocked?: (incident: ConstructorIncident, action: string) => Promise<void>
}

export interface ConstructorStrategistStepResult {
  started: boolean
  message: string
}

const stateForPhase = (phase: ConstructorStrategy['decision']['phase']): ActiveIncidentState =>
  phase === 'diagnose' ? 'diagnosing' : phase === 'repair' ? 'repairing' : 'verifying'

export function buildConstructorStrategyExecutionPrompt(
  strategy: ConstructorStrategy,
  incident: ConstructorIncident,
): string {
  return `EXECUTĂ DECIZIA STRATEGULUI PENTRU INCIDENTUL #${incident.id}, ORDINUL #${incident.jobId}.\n\n` +
    `OBIECTIV: ${strategy.objective}\n` +
    `ACȚIUNE: ${strategy.decision.action}\n` +
    `DOVADA CERUTĂ: ${strategy.decision.expectedEvidence.join('; ')}\n` +
    (strategy.missingCapability
      ? `CAPACITATE LIPSĂ: ${strategy.missingCapability.name}; construibilă sigur=${strategy.missingCapability.canBuildSafely}; ` +
        `acțiune=${strategy.missingCapability.buildAction ?? 'blocată'}\n`
      : '') +
    `Nu crea alt ordin din log. Folosește uneltele, execută acțiunea și raportează numai fapte și dovezi observate.`
}

/** One durable MAPE-K strategy step. It never closes an incident; only the job
 * terminal reporter can close after done+CI green. */
export async function runConstructorStrategistStep(
  knowledge: ConstructorStrategistKnowledge,
  deps: ConstructorStrategistDependencies,
): Promise<ConstructorStrategistStepResult | null> {
  const incident = knowledge.open[0]
  if (!incident) return null
  const now = deps.now ?? Date.now
  const evidenceFingerprint = constructorEvidenceFingerprint(incident.evidence)

  if (
    !incident.strategyPending &&
    incident.strategyActionFingerprint &&
    incident.strategyEvidenceFingerprint === evidenceFingerprint
  ) {
    return {
      started: false,
      message: `incident #${incident.id}: aceeași strategie este blocată până apare dovadă nouă; nu repet acțiunea`,
    }
  }
  if (
    incident.state === 'blocked' &&
    incident.causeCode === 'brain_unavailable' &&
    now() - Date.parse(incident.updatedAt) < 15 * 60_000
  ) {
    return {
      started: false,
      message: `incident #${incident.id}: strategul este temporar indisponibil; retry controlat după 15 minute`,
    }
  }

  let strategy = incident.strategyPending ? incident.strategy : null
  if (!strategy) {
    const raw = await deps.think(
      buildConstructorStrategistPrompt(incident, knowledge.lessons, deps.capabilityInventory),
    ).catch((error: Error) => `STRATEGIST_ERROR: ${error.message}`)
    const parsed = parseConstructorStrategy(raw)
    if (!parsed.ok || parsed.strategy.incidentId !== incident.id) {
      const error = parsed.ok ? 'strategy_incident_mismatch' : parsed.error
      await deps.updateIncident(incident.id, {
        state: 'blocked',
        causeCode: 'brain_unavailable',
        evidence: `${incident.evidence}\n[strategist_invalid] ${error}`.slice(-4000),
        nextAction: 'Strategul trebuie să producă un contract valid înainte de orice altă execuție; retry controlat după 15 minute.',
        strategyPending: false,
      })
      return { started: false, message: `incident #${incident.id}: decizia creierului este invalidă — ${error}` }
    }
    strategy = parsed.strategy
    await deps.updateIncident(incident.id, {
      state: stateForPhase(strategy.decision.phase),
      evidence: incident.evidence,
      nextAction: strategy.decision.action,
      strategy,
      strategyPending: true,
    })
  }

  const guard = mayExecuteConstructorStrategy(
    strategy,
    incident.strategyActionFingerprint,
    incident.strategyEvidenceFingerprint,
    incident.evidence,
  )
  if (!guard.allowed) {
    await deps.updateIncident(incident.id, {
      state: 'blocked', evidence: incident.evidence,
      nextAction: 'Colectează dovadă nouă sau alege o strategie diferită; acțiunea identică este interzisă.',
      strategyActionFingerprint: guard.actionFingerprint,
      strategyEvidenceFingerprint: guard.evidenceFingerprint, strategyPending: false,
    })
    return { started: false, message: `incident #${incident.id}: acțiune identică blocată — lipsește dovada nouă` }
  }

  if (strategy.decision.executor === 'blocked') {
    await deps.updateIncident(incident.id, {
      state: 'blocked', evidence: incident.evidence, nextAction: strategy.decision.action,
      strategyActionFingerprint: guard.actionFingerprint,
      strategyEvidenceFingerprint: guard.evidenceFingerprint, strategyPending: false,
    })
    await deps.notifyBlocked?.(incident, strategy.decision.action)
    return { started: false, message: `incident #${incident.id}: blocat justificat — ${strategy.decision.action.slice(0, 180)}` }
  }

  if (deps.constructorBusy) {
    return { started: false, message: `incident #${incident.id}: strategia este decisă și persistentă; așteaptă ordinul activ înainte de execuție` }
  }

  if (strategy.decision.executor === 'constructor') {
    const retried = await deps.retryJob(incident.jobId, strategy.decision.reformulatedOrder ?? undefined)
    const executionEvidence = retried
      ? `Strategul a autorizat retry-ul ordinului #${incident.jobId} cu ordin reformulat; stare=${retried.status}.`
      : `Retry-ul strategic al ordinului #${incident.jobId} a fost refuzat de lacătul DB.`
    await deps.updateIncident(incident.id, {
      state: retried ? 'repairing' : 'blocked',
      evidence: `${incident.evidence}\n[strategy_execution] ${executionEvidence}`.slice(-4000),
      nextAction: retried
        ? `Monitorizează ordinul #${incident.jobId}; cere CI verde și replanning la orice dovadă de eșec.`
        : 'Verifică starea incidentului și dovada cerută înainte de o nouă decizie.',
      strategyActionFingerprint: guard.actionFingerprint,
      strategyEvidenceFingerprint: guard.evidenceFingerprint, strategyPending: false,
    })
    return { started: Boolean(retried), message: `incident #${incident.id}: ${executionEvidence}` }
  }

  const result = await deps.executeBrainAction(strategy, incident)
    .catch((error: Error) => `EXECUTION_ERROR: ${error.message}`)
  const blocked = /^\s*AȘTEPT APROBAREA|EXECUTION_ERROR:/i.test(result)
  await deps.updateIncident(incident.id, {
    state: blocked ? 'blocked' : stateForPhase(strategy.decision.phase),
    evidence: `${incident.evidence}\n[strategy_execution] ${result}`.slice(-4000),
    nextAction: blocked ? result.slice(0, 1000) : 'Strategul reanalizează rezultatul și dovada nouă; nu repetă acțiunea executată.',
    strategyActionFingerprint: guard.actionFingerprint,
    strategyEvidenceFingerprint: guard.evidenceFingerprint, strategyPending: false,
  })
  return { started: true, message: `incident #${incident.id}: ${result.slice(0, 260)}` }
}
