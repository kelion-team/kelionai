export interface DeployState {
  status: 'idle' | 'running' | 'success' | 'failed'
  jobId: string | null
  step: string
  stepIndex: number
  totalSteps: number
  percent: number
  message: string
  startedAt: string | null
  updatedAt: string
  error: string | null
  commit: string | null
  liveVersion: string | null
}

export type DeployStatusPayload =
  | { kind: 'state'; state: DeployState }
  | { kind: 'unavailable' }
  | { kind: 'invalid' }

export interface DeployProgressSnapshot {
  state: DeployState
  unavailable: boolean
}

export function parseDeployStatusPayload(value: unknown): DeployStatusPayload {
  if (!value || typeof value !== 'object') return { kind: 'invalid' }
  const payload = value as { ok?: unknown; state?: unknown; error?: unknown }
  if (payload.ok === false && payload.error === 'deploy_state_unavailable') {
    return { kind: 'unavailable' }
  }
  if (payload.ok !== true || !payload.state || typeof payload.state !== 'object') {
    return { kind: 'invalid' }
  }
  const state = payload.state as Partial<DeployState>
  const validStatus = state.status === 'idle'
    || state.status === 'running'
    || state.status === 'success'
    || state.status === 'failed'
  const validNullableString = (candidate: unknown): boolean => candidate === null || typeof candidate === 'string'
  if (!validStatus
    || !validNullableString(state.jobId)
    || typeof state.step !== 'string'
    || typeof state.stepIndex !== 'number'
    || typeof state.totalSteps !== 'number'
    || typeof state.percent !== 'number'
    || typeof state.message !== 'string'
    || !validNullableString(state.startedAt)
    || typeof state.updatedAt !== 'string'
    || !validNullableString(state.error)
    || !validNullableString(state.commit)
    || !validNullableString(state.liveVersion)) return { kind: 'invalid' }
  return { kind: 'state', state: state as DeployState }
}

export function transitionDeployProgress(
  current: DeployProgressSnapshot,
  payload: DeployStatusPayload,
): DeployProgressSnapshot {
  if (payload.kind === 'state') return { state: payload.state, unavailable: false }
  if (payload.kind === 'unavailable') return { state: current.state, unavailable: true }
  return current
}
