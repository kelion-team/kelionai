import { offlineKitRevision, type OfflineKitComponent } from './offlineKitManifest'

const STORAGE_KEY = 'kelion.offline.kit.readiness'

type ComponentReadiness = { revision: string; verifiedAt: string }
type ReadinessRecord = {
  schemaVersion: 2
  components: Partial<Record<OfflineKitComponent, ComponentReadiness>>
}

function emptyRecord(): ReadinessRecord {
  return { schemaVersion: 2, components: {} }
}

function readRecord(): ReadinessRecord {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return emptyRecord()
    const value = JSON.parse(raw) as Partial<ReadinessRecord>
    if (value.schemaVersion !== 2 || !value.components || typeof value.components !== 'object') return emptyRecord()
    const components: ReadinessRecord['components'] = {}
    for (const component of ['brain', 'hearing'] as const) {
      const entry = value.components[component]
      if (entry && typeof entry.revision === 'string' && typeof entry.verifiedAt === 'string') components[component] = entry
    }
    return { schemaVersion: 2, components }
  } catch {
    return emptyRecord()
  }
}

function writeRecord(value: ReadinessRecord): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

/** Markerul indică doar ultima verificare completă; apelantul revalidează artefactele la pornire. */
export function offlineComponentReady(component: OfflineKitComponent): boolean {
  return readRecord().components[component]?.revision === offlineKitRevision(component)
}

export function markOfflineComponentReady(component: OfflineKitComponent): boolean {
  const next = readRecord()
  next.components[component] = { revision: offlineKitRevision(component), verifiedAt: new Date().toISOString() }
  if (!writeRecord(next)) return false
  return offlineComponentReady(component)
}

export function forgetOfflineComponent(component: OfflineKitComponent): void {
  const next = readRecord()
  delete next.components[component]
  writeRecord(next)
}

export function clearOfflineKitReadiness(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Storage can be unavailable in restricted contexts.
  }
}
