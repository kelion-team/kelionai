import { config } from '../config.js'
import type { StorePresence } from '../shared/storePresence.js'

type StoreTarget = Pick<StorePresence, 'key' | 'name' | 'store' | 'url'>
const targets: StoreTarget[] = [
  { key: 'windows', name: 'Windows', store: 'Microsoft Store', url: 'https://apps.microsoft.com/detail/9NBW313FHN44' },
  { key: 'android', name: 'Android', store: 'Google Play', url: 'https://play.google.com/store/apps/details?id=app.kelionai.twa' },
  { key: 'ios', name: 'iOS', store: 'App Store', url: 'https://apps.apple.com/app/id6786766714' },
  { key: 'linux', name: 'Linux', store: `Web app (${new URL(config.publicOrigin).hostname})`, url: `${config.publicOrigin}/health` },
]

export function createStorePresenceReader(
  locations: readonly StoreTarget[], fetcher: typeof fetch = fetch, now: () => number = Date.now,
): () => Promise<StorePresence[]> {
  let cache: { at: number; checks: StorePresence[] } | null = null
  return async () => {
    if (cache && now() - cache.at < 5 * 60_000) return cache.checks
    const checks = await Promise.all(locations.map(async (target): Promise<StorePresence> => {
      let listed: boolean | null = null
      let reason: string | null = null
      try {
        const response = await fetcher(target.url, {
          redirect: 'follow', signal: AbortSignal.timeout(8_000), headers: { 'User-Agent': config.httpUserAgent },
        })
        if (response.ok) listed = true
        else if (response.status === 404 || response.status === 410) listed = false
        else reason = `http_${response.status}`
        await response.body?.cancel().catch(() => {})
      } catch {
        reason = 'transport_unavailable'
      }
      return { ...target, listed, reason, checkedAt: new Date(now()).toISOString() }
    }))
    cache = { at: now(), checks }
    return checks
  }
}

export const checkStores = createStorePresenceReader(targets)
