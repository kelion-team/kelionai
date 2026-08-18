import { type ErrorObject } from 'ajv'
import { createHash } from 'node:crypto'
import type { ConstructorIncident } from './constructorIncident.js'
import { compileJsonSchema } from './ajvCompat.js'

export const CONSTRUCTOR_STRATEGY_ID = 'kelion.strategy/v1' as const

export type StrategyPhase = 'diagnose' | 'repair' | 'verify'
export type StrategyExecutor = 'brain_tools' | 'constructor' | 'blocked'

export interface ConstructorStrategy {
  protocol: typeof CONSTRUCTOR_STRATEGY_ID
  incidentId: number
  objective: string
  acceptanceCriteria: string[]
  facts: string[]
  unknowns: string[]
  hypotheses: Array<{
    statement: string
    evidenceFor: string[]
    evidenceAgainst: string[]
    confidence: number
  }>
  options: Array<{
    id: string
    action: string
    successProbability: number
    cost: 'free' | 'low' | 'medium' | 'high'
    risk: 'low' | 'medium' | 'high'
    requires: string[]
  }>
  missingCapability: {
    name: string
    reason: string
    canBuildSafely: boolean
    buildAction: string | null
  } | null
  decision: {
    optionId: string
    rationale: string
    phase: StrategyPhase
    executor: StrategyExecutor
    action: string
    reformulatedOrder: string | null
    expectedEvidence: string[]
  }
  stopConditions: string[]
  replanWhen: string[]
}

const text = { type: 'string', minLength: 3, maxLength: 4000 } as const
const textList = { type: 'array', minItems: 1, maxItems: 12, items: text } as const

export const CONSTRUCTOR_STRATEGY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'protocol', 'incidentId', 'objective', 'acceptanceCriteria', 'facts', 'unknowns',
    'hypotheses', 'options', 'missingCapability', 'decision', 'stopConditions', 'replanWhen',
  ],
  properties: {
    protocol: { const: CONSTRUCTOR_STRATEGY_ID },
    incidentId: { type: 'integer', minimum: 1 },
    objective: text,
    acceptanceCriteria: textList,
    facts: textList,
    unknowns: { type: 'array', maxItems: 12, items: text },
    hypotheses: {
      type: 'array', minItems: 1, maxItems: 8,
      items: {
        type: 'object', additionalProperties: false,
        required: ['statement', 'evidenceFor', 'evidenceAgainst', 'confidence'],
        properties: {
          statement: text,
          evidenceFor: { type: 'array', maxItems: 10, items: text },
          evidenceAgainst: { type: 'array', maxItems: 10, items: text },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
        },
      },
    },
    options: {
      type: 'array', minItems: 2, maxItems: 8,
      items: {
        type: 'object', additionalProperties: false,
        required: ['id', 'action', 'successProbability', 'cost', 'risk', 'requires'],
        properties: {
          id: { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,39}$' },
          action: text,
          successProbability: { type: 'number', minimum: 0, maximum: 1 },
          cost: { enum: ['free', 'low', 'medium', 'high'] },
          risk: { enum: ['low', 'medium', 'high'] },
          requires: { type: 'array', maxItems: 12, items: text },
        },
      },
    },
    missingCapability: {
      anyOf: [
        { type: 'null' },
        {
          type: 'object', additionalProperties: false,
          required: ['name', 'reason', 'canBuildSafely', 'buildAction'],
          properties: {
            name: text,
            reason: text,
            canBuildSafely: { type: 'boolean' },
            buildAction: { anyOf: [{ type: 'null' }, text] },
          },
        },
      ],
    },
    decision: {
      type: 'object', additionalProperties: false,
      required: ['optionId', 'rationale', 'phase', 'executor', 'action', 'reformulatedOrder', 'expectedEvidence'],
      properties: {
        optionId: { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,39}$' },
        rationale: text,
        phase: { enum: ['diagnose', 'repair', 'verify'] },
        executor: { enum: ['brain_tools', 'constructor', 'blocked'] },
        action: text,
        reformulatedOrder: { anyOf: [{ type: 'null' }, { type: 'string', minLength: 20, maxLength: 6000 }] },
        expectedEvidence: textList,
      },
    },
    stopConditions: textList,
    replanWhen: textList,
  },
} as const

const validate = compileJsonSchema<ConstructorStrategy>(CONSTRUCTOR_STRATEGY_SCHEMA, false)

export function parseConstructorStrategy(raw: string):
  | { ok: true; strategy: ConstructorStrategy }
  | { ok: false; error: string } {
  const source = String(raw ?? '').trim()
  const fenced = source.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  const json = fenced ? fenced[1] : source
  let value: unknown
  try {
    value = JSON.parse(json)
  } catch {
    return { ok: false, error: 'strategy_not_json' }
  }
  if (!validate(value)) {
    const detail = (validate.errors ?? []).map((error: ErrorObject) => `${error.instancePath || '/'} ${error.message}`).join('; ')
    return { ok: false, error: `strategy_schema_invalid: ${detail}`.slice(0, 1200) }
  }
  const strategy = value as ConstructorStrategy
  if (!strategy.options.some((option) => option.id === strategy.decision.optionId)) {
    return { ok: false, error: 'strategy_decision_option_missing' }
  }
  if (strategy.decision.executor === 'constructor' && !strategy.decision.reformulatedOrder) {
    return { ok: false, error: 'strategy_constructor_order_required' }
  }
  if (strategy.missingCapability?.canBuildSafely && !strategy.missingCapability.buildAction) {
    return { ok: false, error: 'strategy_missing_capability_build_action_required' }
  }
  return { ok: true, strategy }
}

const hash = (value: string): string => createHash('sha256').update(value).digest('hex').slice(0, 24)

export function constructorEvidenceFingerprint(evidence: string): string {
  return hash(String(evidence ?? '').replace(/\s+/g, ' ').trim())
}

export function constructorStrategyActionFingerprint(strategy: ConstructorStrategy): string {
  return hash(JSON.stringify({
    phase: strategy.decision.phase,
    executor: strategy.decision.executor,
    action: strategy.decision.action,
    reformulatedOrder: strategy.decision.reformulatedOrder,
    expectedEvidence: strategy.decision.expectedEvidence,
  }))
}

export function mayExecuteConstructorStrategy(
  strategy: ConstructorStrategy,
  previousActionFingerprint: string | null | undefined,
  previousEvidenceFingerprint: string | null | undefined,
  currentEvidence: string,
): { allowed: boolean; reason: string; actionFingerprint: string; evidenceFingerprint: string } {
  const actionFingerprint = constructorStrategyActionFingerprint(strategy)
  const evidenceFingerprint = constructorEvidenceFingerprint(currentEvidence)
  const repeatedWithoutEvidence =
    actionFingerprint === previousActionFingerprint && evidenceFingerprint === previousEvidenceFingerprint
  return {
    allowed: !repeatedWithoutEvidence,
    reason: repeatedWithoutEvidence
      ? 'same_strategy_action_without_new_evidence'
      : 'new_action_or_new_evidence',
    actionFingerprint,
    evidenceFingerprint,
  }
}

export function buildConstructorStrategistPrompt(
  incident: ConstructorIncident,
  lessons: string[],
  capabilityInventory: string,
): string {
  return `Ești STRATEGUL EXECUTIV al autonomiei Kelion. Nu ești un generator de ordine și nu repeți acțiuni.\n\n` +
    `INCIDENT #${incident.id}, ORDIN #${incident.jobId}\n` +
    `stare=${incident.state}; etapă=${incident.stage}; cauză clasificată=${incident.causeCode}\n` +
    `rezumat cauză=${incident.causeSummary}\nresponsabil=${incident.responsible}\n` +
    `acțiune curentă=${incident.nextAction}\nrecurențe=${incident.recurrenceCount}\n` +
    `DOVADĂ DISPONIBILĂ:\n${incident.evidence.slice(-6000)}\n\n` +
    (lessons.length ? `LECȚII VERIFICATE ANTERIOR:\n${lessons.join('\n')}\n\n` : '') +
    `${capabilityInventory}\n\n` +
    `Produce NUMAI JSON conform protocolului ${CONSTRUCTOR_STRATEGY_ID}. ` +
    `Separă faptele de ipoteze. Nu declara o cauză fără dovadă; confidence trebuie să reflecte dovada. ` +
    `Compară minimum două opțiuni după probabilitate, cost și risc. Definește obiectivul și criterii măsurabile. ` +
    `Dacă lipsește o capacitate, numește-o și decide dacă poate fi construită sigur cu uneltele existente. ` +
    `executor=brain_tools pentru diagnostic/reparație prin uneltele Kelion, constructor numai pentru un ordin de cod complet reformulat, ` +
    `blocked pentru bani, secrete inexistente, autoritate sau lipsă de dovadă ce nu poate fi obținută. ` +
    `Nu închide incidentul: închiderea este automată numai după order done și CI verde. ` +
    `Nu repeta acțiunea precedentă fără dovadă nouă. incidentId trebuie să fie ${incident.id}.`
}
