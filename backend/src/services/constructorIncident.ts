import type { ConstructorStrategy } from './constructorStrategist.js'

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
  if (/(?:edit|modific|patch|fără nicio modificare|nu ai scris nimic)/i.test(source)) return 'implementation'
  if (/clone|checkout|git\b|branch/i.test(source)) return 'repository'
  if (/creier|brain|model|provider/i.test(source)) return 'planning_brain'
  return progress.trim() ? progress.trim().slice(0, 120) : 'unknown_stage'
}

export function classifyConstructorFailure(logRaw: string, progressRaw = ''): ConstructorFailureAnalysis {
  const log = tail(logRaw, 20_000)
  const progress = tail(progressRaw, 500)
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
  if (/invalid x-api-key|authentication_error|API key not valid|API_KEY_INVALID|\b(401|403)\b.*(key|token|auth)/i.test(log)) {
    return {
      ...base,
      causeCode: 'provider_auth',
      causeSummary: 'Furnizorul a respins autentificarea; repetarea codului nu poate repara configurația.',
      nextAction: 'Verifică numele și publicarea secretului fără a-i expune valoarea, apoi reia o singură dată și cere CI verde.',
      state: 'blocked',
    }
  }
  if (/FĂRĂ CREDIT API|credit balance is too low|requires more credits|insufficient.*credit|payment required|\b402\b/i.test(log)) {
    return {
      ...base,
      causeCode: 'provider_credit',
      causeSummary: 'Execuția a fost blocată de creditul furnizorului, nu de cod.',
      nextAction: 'Oprește retry-urile, raportează exact furnizorul și reia numai după confirmarea creditului disponibil.',
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
      nextAction: 'Compară ordinul cu repo-ul, numește fișierele țintă și reformulează pașii tehnici înainte de o singură reluare.',
      state: 'diagnosing',
    }
  }
  if (/timeout|timed out|ETIMEDOUT|abandoned: 3 attempts exhausted|timp.*depăș/i.test(log)) {
    return {
      ...base,
      causeCode: 'timeout',
      causeSummary: 'Execuția nu a raportat progres în limita permisă sau și-a epuizat încercările.',
      nextAction: 'Identifică pasul fără heartbeat, separă sarcina sau repară timeout-ul cauzal; nu repeta orbește același ordin.',
      state: 'diagnosing',
    }
  }
  if (/creier|brain|r[ăa]spuns gol|model (invalid|refuzat|nu)|provider.*(unavailable|error)|indisponibil/i.test(log)) {
    return {
      ...base,
      causeCode: 'brain_unavailable',
      causeSummary: 'Planificatorul/modelul nu a produs un rezultat executabil.',
      nextAction: 'Verifică disponibilitatea și răspunsul structurat al creierului, apoi folosește fallback-ul autorizat fără buclă de retry.',
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

export function constructorIncidentLesson(
  incident: Pick<ConstructorIncident, 'causeSummary' | 'nextAction'>,
  verification: string,
): string {
  return `Cauză: ${incident.causeSummary} Prevenție: ${incident.nextAction} Verificare: ${verification}`.slice(0, 4000)
}
