import type { ConstructorStrategy } from './constructorStrategist.js'
import {
  constructorModelOutcome,
  constructorModelOutcomeNextAction,
  type ConstructorModelOutcome,
} from './constructorContinuity.js'

export type ConstructorIncidentState =
  | 'open'
  | 'diagnosing'
  | 'repairing'
  | 'blocked'
  | 'verifying'
  | 'closed'

export type ConstructorCauseCode =
  | 'semantic_non_code'
  | 'provider_auth'
  | 'provider_credit'
  | 'ci_failure'
  | 'test_failure'
  | 'build_failure'
  | 'no_changes'
  | 'timeout'
  | 'brain_unavailable'
  | 'unknown'

export interface ConstructorFailureAnalysis {
  stage: string
  causeCode: ConstructorCauseCode
  causeSummary: string
  nextAction: string
  state: Exclude<ConstructorIncidentState, 'closed'>
  responsible: 'kelion'
}

export interface ConstructorIncident {
  id: number
  jobId: number
  fingerprint: string
  state: ConstructorIncidentState
  stage: string
  causeCode: ConstructorCauseCode
  causeSummary: string
  evidence: string
  responsible: string
  nextAction: string
  verification: string | null
  lesson: string | null
  recurrenceCount: number
  strategy: ConstructorStrategy | null
  strategyActionFingerprint: string | null
  strategyEvidenceFingerprint: string | null
  strategyDecisionCount: number
  strategyPending: boolean
  openedAt: string
  updatedAt: string
  closedAt: string | null
}

const tail = (text: string, max = 600): string =>
  String(text ?? '').replaceAll('\u0000', '').trim().slice(-max)

function stageFrom(log: string, progress: string): string {
  const source = `${progress}\n${log}`
  if (/ci\b|github actions|check run|verificare independent/i.test(source)) return 'ci'
  if (/test|vitest|jest|pytest|assert/i.test(source)) return 'tests'
  if (/typecheck|tsc|lint|oxlint|eslint/i.test(source)) return 'quality_gate'
  if (/build|compil|vite|webpack/i.test(source)) return 'build'
  if (/worker_failure:(?:worker_internal_failure|codex_exec_failed)|opencode/i.test(source)) return 'local_executor'
  if (/llama\.cpp|qwen3?|creier|brain|model/i.test(source)) return 'local_inference'
  if (/worker_unresolved:no_changes|(?:edit|modific|patch|fără nicio modificare|nu ai scris nimic)/i.test(source)) return 'implementation'
  if (/clone|checkout|git\b|branch/i.test(source)) return 'repository'
  return progress.trim() ? progress.trim().slice(0, 120) : 'unknown_stage'
}

function canonicalOutcomeAnalysis(outcome: ConstructorModelOutcome): ConstructorFailureAnalysis {
  const responsible = 'kelion' as const
  const nextAction = constructorModelOutcomeNextAction(outcome)
  switch (outcome.reasonCode) {
    case 'no_changes':
      return {
        stage: 'implementation', responsible, nextAction, state: 'diagnosing',
        causeCode: 'no_changes', causeSummary: outcome.reason,
      }
    case 'test_failure':
      return {
        stage: 'tests', responsible, nextAction, state: 'diagnosing',
        causeCode: 'test_failure', causeSummary: outcome.reason,
      }
    case 'quality_gate_failure':
      return {
        stage: 'quality_gate', responsible, nextAction, state: 'diagnosing',
        causeCode: 'build_failure', causeSummary: outcome.reason,
      }
    case 'execution_timeout':
      return {
        stage: 'local_executor', responsible, nextAction, state: 'diagnosing',
        causeCode: 'timeout', causeSummary: outcome.reason,
      }
    case 'brain_unavailable':
      return {
        stage: 'local_inference', responsible, nextAction, state: 'diagnosing',
        causeCode: 'brain_unavailable', causeSummary: outcome.reason,
      }
    case 'worker_internal_failure':
      return {
        stage: 'local_executor', responsible, nextAction, state: 'diagnosing',
        causeCode: 'unknown', causeSummary: outcome.reason,
      }
  }
}

export function classifyConstructorFailure(logRaw: string, progressRaw = ''): ConstructorFailureAnalysis {
  const log = tail(logRaw, 20_000)
  const progress = tail(progressRaw, 500)
  const canonicalOutcome = constructorModelOutcome(log)
  if (canonicalOutcome) return canonicalOutcomeAnalysis(canonicalOutcome)
  const stage = stageFrom(log, progress)
  const base = { stage, responsible: 'kelion' as const }

  if (/semantic[_ -]?non[_ -]?code|diagnostic\/non-code|cerere non-code|ordin_respins|nu este (o )?sarcin[ăa] de cod/i.test(log)) {
    return {
      ...base,
      causeCode: 'semantic_non_code',
      causeSummary: 'Solicitarea nu era o modificare implementabilă și a fost rutată greșit spre constructor.',
      nextAction: 'Arhivează ordinul fără retry, verifică clasificatorul de intrare și adaugă cazul ca regresie semantică.',
      state: 'diagnosing',
    }
  }
  // Aceste două coduri pot exista în incidente persistate de workerul vechi.
  // Constructorul OpenCode/Qwen local nu le mai emite și nu transformă texte
  // cloud arbitrare în incidente curente de autentificare sau credit.
  if (/worker_failure:provider_auth/i.test(log)) {
    return {
      ...base,
      causeCode: 'provider_auth',
      causeSummary: 'Un worker retras a persistat un incident legacy de autentificare; acesta nu descrie executorul local curent.',
      nextAction: 'Nu relua vechea cale. Confirmă data incidentului și reexecută ordinul numai prin OpenCode cu Qwen local.',
      state: 'blocked',
    }
  }
  if (/worker_failure:provider_credit/i.test(log)) {
    return {
      ...base,
      causeCode: 'provider_credit',
      causeSummary: 'Un worker retras a persistat un incident legacy de credit; acesta nu descrie executorul local curent.',
      nextAction: 'Nu alimenta și nu relua vechea cale. Reexecută ordinul numai prin OpenCode cu Qwen local.',
      state: 'blocked',
    }
  }
  if (/ci[^\n]{0,80}(red|roșu|failed|failure)|github actions[^\n]{0,80}(failed|failure)/i.test(log)) {
    return {
      ...base,
      causeCode: 'ci_failure',
      causeSummary: 'Verificarea independentă CI a respins schimbarea.',
      nextAction: 'Citește check-ul CI și logul exact, repară cauza, apoi rulează din nou până la CI verde.',
      state: 'diagnosing',
    }
  }
  if (/(test|vitest|jest|pytest|assert)[^\n]{0,100}(failed|failure|picat|error)|\bfailed tests?\b/i.test(log)) {
    return {
      ...base,
      causeCode: 'test_failure',
      causeSummary: 'Cel puțin un test a demonstrat că rezultatul nu respectă contractul.',
      nextAction: 'Identifică primul test relevant, repară cauza fără skip și verifică testul focalizat plus suita completă.',
      state: 'diagnosing',
    }
  }
  if (/(build|compil|typecheck|tsc|lint|oxlint|eslint)[^\n]{0,100}(failed|failure|picat|error)|\bexit code [1-9]/i.test(log)) {
    return {
      ...base,
      causeCode: 'build_failure',
      causeSummary: 'O poartă de build, tipuri sau lint a respins rezultatul.',
      nextAction: 'Extrage prima eroare cauzală, repară fișierul indicat și rerulează toate porțile înainte de închidere.',
      state: 'diagnosing',
    }
  }
  if (/fără nicio modificare|nu ai scris nimic|no changes|working tree clean|aSchimbat.?false/i.test(log)) {
    return {
      ...base,
      causeCode: 'no_changes',
      causeSummary: 'Executorul nu a produs nicio modificare verificabilă pentru ordin.',
      nextAction: 'Compară ordinul cu repo-ul, numește fișierele țintă și stabilește cauza înaintea oricărei decizii manuale.',
      state: 'diagnosing',
    }
  }
  if (/worker_failure:execution_timeout|timeout|timed out|ETIMEDOUT|abandoned: 3 attempts exhausted|timp.*depăș/i.test(log)) {
    return {
      ...base,
      causeCode: 'timeout',
      causeSummary: 'Execuția nu a raportat progres în limita permisă sau și-a epuizat încercările.',
      nextAction: 'Identifică pasul fără heartbeat, separă sarcina sau repară timeout-ul cauzal; nu repeta orbește același ordin.',
      state: 'diagnosing',
    }
  }
  if (/worker_failure:brain_unavailable|llama\.cpp|qwen3?|127\.0\.0\.1:24080|ECONNREFUSED|connection refused|failed to connect|fetch failed|creier local|brain unavailable|r[ăa]spuns gol|model (invalid|refuzat|nu|unavailable|not found)/i.test(log)) {
    return {
      ...base,
      causeCode: 'brain_unavailable',
      causeSummary: 'Serverul local llama.cpp sau modelul Qwen nu a produs un rezultat executabil.',
      nextAction: 'Verifică private-ai-llm.service, endpointurile loopback /health și /v1/models, apoi jurnalul privat OpenCode; remediază local, fără fallback cloud.',
      state: 'diagnosing',
    }
  }
  if (/worker_failure:(?:worker_internal_failure|codex_exec_failed)/i.test(log)) {
    return {
      ...base,
      causeCode: 'unknown',
      causeSummary: 'Executorul a raportat un eșec intern generic, iar cauza exactă nu este demonstrată de codul public.',
      nextAction: 'Citește jurnalul privat al jobului, verifică OpenCode și serviciul local llama.cpp, apoi clasifică numai cauza susținută de dovadă.',
      state: 'diagnosing',
    }
  }
  return {
    ...base,
    causeCode: 'unknown',
    causeSummary: 'Cauza nu poate fi stabilită sigur din raportul disponibil; nu este permisă inventarea ei.',
    nextAction: 'Citește jurnalul complet, progresul, sursa și porțile; formulează și testează ipoteze până când există o cauză susținută de dovadă.',
    state: 'diagnosing',
  }
}
