import { readFileSync } from 'node:fs'
import { config } from '../config.js'

/**
 * A candidate may serve readiness without running mailbox/jobs. The deployer
 * atomically writes the exact release id into a read-only mounted marker only
 * after traffic has switched to that slot.
 */
export function releaseSideEffectsEnabled(): boolean {
  if (!config.release.candidateMode) return true
  if (!config.release.activationFile || !config.release.id) return false
  try {
    return activationMarkerMatches(
      config.release.id,
      readFileSync(config.release.activationFile, 'utf8'),
    )
  } catch {
    return false
  }
}

export type ReleaseRuntimeState = Readonly<{
  candidate: boolean
  sideEffectsActive: boolean
}>

export function activationMarkerMatches(releaseId: string, marker: string): boolean {
  return releaseId.length > 0 && marker.trim() === releaseId
}

/**
 * `candidate` describes the current release state exposed to operators, not
 * the immutable boot policy.  A process booted in candidate mode stops being
 * a candidate only after its exact release id is present in the activation
 * marker.  Keeping both fields derived from the same observation prevents the
 * impossible `candidate:true, sideEffectsActive:true` state.
 */
export function releaseRuntimeState(
  sideEffectsActive = releaseSideEffectsEnabled(),
): ReleaseRuntimeState {
  return {
    candidate: !sideEffectsActive,
    sideEffectsActive,
  }
}

export function isActiveReleaseState(state: ReleaseRuntimeState): boolean {
  return state.candidate === false && state.sideEffectsActive === true
}

export function isReleaseProofReady(
  ready: boolean,
  state: ReleaseRuntimeState,
  commit: string,
): boolean {
  return ready === true
    && isActiveReleaseState(state)
    && /^[0-9a-f]{40}$/.test(commit)
}

/**
 * Once an active blue/green process loses the activation marker it must really
 * terminate. Merely setting process.exitCode leaves open sockets/timers alive
 * and prevents the deployer from deterministically restarting the old slot.
 */
export function shutdownDeactivatedRelease(
  close: () => Promise<unknown>,
  exit: (code: number) => void = (code) => process.exit(code),
): void {
  let finished = false
  const finish = (): void => {
    if (finished) return
    finished = true
    clearTimeout(deadline)
    exit(0)
  }
  const deadline = setTimeout(finish, 10_000)
  deadline.unref()
  void Promise.resolve().then(close).then(finish, finish)
}
