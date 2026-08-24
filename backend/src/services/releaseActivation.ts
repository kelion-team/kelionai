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
