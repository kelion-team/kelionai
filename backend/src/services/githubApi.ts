import { config } from '../config.js'

// GitHub health/recovery probes share this validated repository locator. The
// credential remains server-side and is never returned in responses.
export const REPO = config.githubRepo
export const GITHUB_API = `https://api.github.com/repos/${REPO}`

export function ghToken(): string {
  return config.githubToken
}
