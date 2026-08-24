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
    return readFileSync(config.release.activationFile, 'utf8').trim() === config.release.id
  } catch {
    return false
  }
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
