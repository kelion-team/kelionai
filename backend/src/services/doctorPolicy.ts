import type { ConstructorAutomationAuthority, DoctorCode, DoctorEvidence, DoctorGrantRequest, DoctorRepairScope } from '../shared/doctor.js'

// Technical consent ceilings, not throughput promises. Exposed by the server
// so clients never invent their own permitted duration or spending authority.
export const DOCTOR_LIMITS = { maxDurationHours: 24, maxJobs: 5, maxWindowHours: 24 } as const
export const DOCTOR_LEASE_SECONDS = 90

/** A closure must use a fresh successful server probe from the same bounded
 * lease window. Historical observations and client assertions never suffice. */
export function doctorVerifiedSymptom(evidence: DoctorEvidence | null, code: DoctorCode, releaseSha: string, now = Date.now()): boolean {
  const checkedAt = evidence ? Date.parse(evidence.checkedAt) : Number.NaN
  return Boolean(evidence && evidence.code === code && evidence.releaseSha === releaseSha
    && /^[0-9a-f]{40}$/.test(releaseSha) && evidence.result === 'healthy'
    && evidence.reason === 'contract_verified' && evidence.httpStatus === 200
    && Number.isFinite(checkedAt) && checkedAt <= now && now-checkedAt <= DOCTOR_LEASE_SECONDS*1_000)
}

export const DOCTOR_PROBES = {
  public_health: { path: '/api/health', summary: 'Contractul public de sănătate', files: 'backend/src/services/publicRuntimeContract.ts' },
  agent_registry: { path: '/api/a2a', summary: 'Registrul public al agenților specializați', files: 'backend/src/services/publicAgentContract.ts' },
  release_version: { path: '/api/version', summary: 'Versiunea publică a release-ului activ', files: 'backend/src/services/publicRuntimeContract.ts' },
  constructor_worker_offline: { path: null, summary: 'Heartbeatul workerului Constructor', files: '' },
  constructor_publisher_offline: { path: null, summary: 'Heartbeatul publisherului Constructor', files: '' },
  constructor_release_offline: { path: null, summary: 'Heartbeatul release-ului Constructor', files: '' },
  chat_output_missing: { path: null, summary: 'Kelion a raportat lipsa răspunsului chat', files: '' },
  audio_session_failure: { path: null, summary: 'Kelion a raportat o eroare a sesiunii audio', files: '' },
  camera_unavailable: { path: null, summary: 'Kelion a raportat vederea indisponibilă', files: '' },
  memory_unavailable: { path: null, summary: 'Kelion a raportat memoria indisponibilă', files: '' },
} as const satisfies Record<DoctorCode, { path: string | null; summary: string; files: string }>

export function doctorExecutionScope(code: DoctorCode): DoctorRepairScope | null {
  if (code !== 'public_health' && code !== 'agent_registry' && code !== 'release_version') return null
  return { code,allowedPaths:[DOCTOR_PROBES[code].files,code === 'agent_registry'
    ? 'backend/src/doctorPublicAgents.regression.test.ts' : 'backend/src/doctorPublicRuntime.regression.test.ts'] }
}

export function constructorAutomationAuthority(origin: unknown, raw: unknown): ConstructorAutomationAuthority {
  if (origin === 'admin' && raw === null) return { automationOrigin:'admin',repairScope:null }
  if (origin !== 'doctor' || !raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('constructor_automation_scope_invalid')
  const value = raw as Record<string,unknown>
  const code = doctorCode(value.code)
  const scope = code ? doctorExecutionScope(code) : null
  if (!scope || Object.keys(value).length !== 2 || !Array.isArray(value.allowedPaths)
    || JSON.stringify(value.allowedPaths) !== JSON.stringify(scope.allowedPaths)) throw new Error('constructor_automation_scope_invalid')
  return { automationOrigin:'doctor',repairScope:scope }
}

export function doctorCode(value: unknown): DoctorCode | null {
  return typeof value === 'string' && Object.hasOwn(DOCTOR_PROBES, value) ? value as DoctorCode : null
}

export function validDoctorGrant(value: unknown): value is DoctorGrantRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const v = value as Record<string, unknown>
  return Object.keys(v).length === 4 && v.scope === 'measured-code-repair'
    && (v.durationHours === null || (Number.isInteger(v.durationHours) && Number(v.durationHours) >= 1 && Number(v.durationHours) <= DOCTOR_LIMITS.maxDurationHours))
    && Number.isInteger(v.maxJobs) && Number(v.maxJobs) >= 1 && Number(v.maxJobs) <= DOCTOR_LIMITS.maxJobs
    && Number.isInteger(v.windowHours) && Number(v.windowHours) >= 1 && Number(v.windowHours) <= DOCTOR_LIMITS.maxWindowHours
}

/** Only successful read-only HTTP measurements can prove a code contract
 * defect. Authentication, quota, transport and readiness errors are blockers. */
export function classifyDoctorResponse(code: DoctorCode, status: number, body: unknown, releaseSha: string, now: number): DoctorEvidence {
  const result: DoctorEvidence = { code, checkedAt: new Date(now).toISOString(), httpStatus: status, releaseSha,
    result: 'blocked', reason: 'http_dependency_unavailable' }
  if (status !== 200) return result
  const value = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null
  if (typeof value?.error === 'string'
    && /insufficient_quota|unauthorized|forbidden|rate_limit|credential|billing|service_unavailable|db_unavailable/i.test(value.error)) return result
  let valid = false
  if (code === 'public_health') valid = value?.status === 'ok'
  if (code === 'release_version') {
    // The full runtime revision is supplied outside the repairable formatter.
    // Missing or different release evidence cannot authorize a formatter repair.
    if (!/^[0-9a-f]{40}$/.test(releaseSha) || value?.commit !== releaseSha) {
      return { ...result,reason:'release_commit_unverified' }
    }
    valid = value?.v === releaseSha.slice(0, 7) && value?.ver === value?.v
  }
  if (code === 'agent_registry' && value && Array.isArray(value.agents)) {
    const ids = new Set<string>()
    valid = value.count === value.agents.length && value.agents.length > 0 && value.agents.every((agent: unknown) => {
      if (!agent || typeof agent !== 'object' || Array.isArray(agent)) return false
      const a = agent as Record<string, unknown>
      if (typeof a.id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,79}$/.test(a.id) || ids.has(a.id)) return false
      ids.add(a.id)
      return typeof a.nume === 'string' && a.nume.length > 0 && typeof a.rol === 'string' && a.rol.length > 0 && a.url === `/api/a2a/${a.id}`
    })
  }
  return { ...result, result: valid ? 'healthy' : 'defect', reason: valid ? 'contract_verified' : 'response_contract_invalid' }
}

export function doctorRepairOrder(evidence: DoctorEvidence): string | null {
  const probe = DOCTOR_PROBES[evidence.code]
  if (!probe.path || evidence.result !== 'defect' || evidence.reason !== 'response_contract_invalid') return null
  const scope = doctorExecutionScope(evidence.code)!
  return `Repară defectul măsurat al contractului ${evidence.code} în ${probe.files}. `
    + `Domeniu mecanic permis: ${scope.allowedPaths.join('; ')}. Adaugă regresia în fișierul de test nominal; nu modifica alte fișiere. `
    + `Probă server GET ${probe.path}: HTTP ${evidence.httpStatus}, verdict ${evidence.reason}, release ${evidence.releaseSha}. `
    + 'Reproduce contractul invalid printr-un test comportamental înaintea corecției și verifică acel test după corecție. '
    + 'Păstrează funcțiile existente și schema publică documentată. Nu schimba modelele, providerii, autentificarea, facturarea, secretele sau datele utilizatorilor. '
    + 'Nu modifica probele Doctorului pentru a declara succes și nu fabrica rezultate. Folosește Constructorul și porțile normale; publisherul integrează automat după verificările obligatorii GitHub, iar release-ul verifică separat deploy-ul. Nu cere aprobare manuală pentru fiecare PR și nu ocoli protecția GitHub. '
    + `Acceptare: același GET ${probe.path} răspunde cu contract valid pe exact commitul verificat live după deploy.`
}

/** Existing Kelion reporters send a bounded kind; never copy their private
 * detail, URL, log, prompt or user identity into a repair order. */
export function doctorReportedCode(kind: string): DoctorCode | null {
  const map: Record<string, DoctorCode> = {
    'chat-mut': 'chat_output_missing', 'chat-empty': 'chat_output_missing',
    'audio-error': 'audio_session_failure', 'realtime-error': 'audio_session_failure',
    'fara-vedere': 'camera_unavailable', 'memory-error': 'memory_unavailable',
  }
  return Object.hasOwn(map, kind) ? map[kind] : null
}
