import {
  offlineKitArtifacts,
  offlineKitManifest,
  type OfflineArtifact,
  type OfflineKitComponent,
} from './offlineKitManifest'
import {
  forgetOfflineComponent,
  markOfflineComponentReady,
} from './offlineKitReadiness'
import { sha256ResponseBody } from './offlineHash'

export interface OfflineVerification {
  ok: boolean
  component: OfflineKitComponent
  checkedArtifacts: number
  totalArtifacts: number
  reason?: string
}

export interface OfflineKitPreflight {
  ok: boolean
  reason?: 'offline' | 'storage_unavailable' | 'insufficient_storage' | 'webgpu_unavailable' | 'webgpu_feature_missing' | 'webgpu_limit_too_low'
  deviceComponent?: 'brain' | 'hearing'
  requiredBytes: number
  requiredWithHeadroomBytes: number
  availableBytes: number | null
  vramRequiredMB: number
}

type GpuAdapterLike = {
  features?: { has: (feature: string) => boolean }
  limits?: { maxBufferSize?: number }
}

type NavigatorWithGpu = Navigator & {
  gpu?: { requestAdapter: () => Promise<GpuAdapterLike | null> }
}

function normalizeDigest(value: string | null): string | null {
  if (!value) return null
  const normalized = value.trim().replace(/^W\//, '').replace(/^"|"$/g, '').replace(/^sha256:/, '').toLowerCase()
  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : null
}

function artifactUrl(component: OfflineKitComponent, artifact: OfflineArtifact): string {
  if (artifact.url) return artifact.url
  const metadata = offlineKitManifest.components[component]
  return `${metadata.repository}/resolve/${metadata.revisionSha}/${artifact.path}`
}

/** Elimină numai artefactele componentei nereușite, ca runtime-ul să nu
 * refolosească la retry un răspuns corupt rămas în Cache Storage/OPFS. */
export async function purgeOfflineComponentArtifacts(component: OfflineKitComponent): Promise<void> {
  const artifacts = offlineKitArtifacts(component)
  if (typeof caches === 'undefined') return
  await Promise.all(artifacts.map(async (artifact) => {
    const cache = await caches.open(artifact.cache)
    await cache.delete(artifactUrl(component, artifact), { ignoreSearch: true })
  }))
}

async function verifyCachedArtifact(
  component: OfflineKitComponent,
  artifact: OfflineArtifact,
): Promise<string | null> {
  if (typeof caches === 'undefined') return 'cache_api_unavailable'
  const cache = await caches.open(artifact.cache)
  const url = artifactUrl(component, artifact)
  const response = await cache.match(url, { ignoreSearch: true })
  if (!response) return `missing:${artifact.path}`

  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isSafeInteger(declaredLength) && declaredLength >= 0 && declaredLength !== artifact.sizeBytes) {
    return `size:${artifact.path}`
  }
  const etag = normalizeDigest(response.headers.get('x-linked-etag')) ??
    normalizeDigest(response.headers.get('x-xet-hash')) ??
    normalizeDigest(response.headers.get('etag'))
  if (artifact.etag && etag && etag !== artifact.etag && etag !== artifact.sha256) return `etag:${artifact.path}`

  const measured = await sha256ResponseBody(response)
  if (measured.size !== artifact.sizeBytes) return `size:${artifact.path}`
  return measured.sha256 === artifact.sha256 ? null : `sha256:${artifact.path}`
}

export async function verifyOfflineComponent(component: OfflineKitComponent): Promise<OfflineVerification> {
  const artifacts = offlineKitArtifacts(component)
  let checkedArtifacts = 0
  try {
    for (const artifact of artifacts) {
      const reason = await verifyCachedArtifact(component, artifact)
      if (reason) return { ok: false, component, checkedArtifacts, totalArtifacts: artifacts.length, reason }
      checkedArtifacts++
    }
    return { ok: true, component, checkedArtifacts, totalArtifacts: artifacts.length }
  } catch (error) {
    const reason = error instanceof Error ? `verification_error:${error.message.slice(0, 120)}` : 'verification_error'
    return { ok: false, component, checkedArtifacts, totalArtifacts: artifacts.length, reason }
  }
}

/** Reface markerul numai după inventarul complet; artefactele lipsă sau corupte îl șterg. */
export async function reconcileOfflineComponent(component: OfflineKitComponent): Promise<OfflineVerification> {
  const result = await verifyOfflineComponent(component)
  if (!result.ok) {
    forgetOfflineComponent(component)
    return result
  }
  if (!markOfflineComponentReady(component)) {
    return { ...result, ok: false, reason: 'readiness_marker_unavailable' }
  }
  return result
}

export async function offlineKitPreflight(
  installed: Record<OfflineKitComponent, boolean>,
  runtimeInstalled = false,
  runtimeBytes = offlineKitManifest.runtimeSources.reduce((total, artifact) => total + artifact.sizeBytes, 0),
): Promise<OfflineKitPreflight> {
  const requiredBytes = (['brain', 'hearing'] as const)
    .filter((component) => !installed[component])
    .reduce((total, component) => total + offlineKitManifest.components[component].estimatedBytes, 0) +
    (runtimeInstalled ? 0 : Math.max(
      runtimeBytes,
      offlineKitManifest.runtimeSources.reduce((total, artifact) => total + artifact.sizeBytes, 0),
    ))
  const requiredWithHeadroomBytes = requiredBytes > 0
    ? requiredBytes + offlineKitManifest.minimumStorageHeadroomBytes
    : 0
  const base = {
    requiredBytes,
    requiredWithHeadroomBytes,
    availableBytes: null,
    vramRequiredMB: offlineKitManifest.components.brain.deviceRequirements.vramRequiredMB,
  }

  if (typeof navigator === 'undefined' || navigator.onLine === false) return { ...base, ok: false, reason: 'offline' }
  const estimate = await navigator.storage?.estimate?.().catch(() => null)
  if (!estimate || typeof estimate.quota !== 'number' || typeof estimate.usage !== 'number') {
    return { ...base, ok: false, reason: 'storage_unavailable' }
  }
  const availableBytes = Math.max(0, estimate.quota - estimate.usage)
  const withStorage = { ...base, availableBytes }
  if (availableBytes < requiredWithHeadroomBytes) return { ...withStorage, ok: false, reason: 'insufficient_storage' }

  const pendingGpuComponents: Array<readonly [
    'brain' | 'hearing',
    { requiredFeatures: string[]; minimumMaxBufferSize: number },
  ]> = []
  if (!installed.brain) pendingGpuComponents.push(['brain', offlineKitManifest.components.brain.deviceRequirements])
  if (!installed.hearing) pendingGpuComponents.push(['hearing', offlineKitManifest.components.hearing.deviceRequirements])

  if (pendingGpuComponents.length > 0) {
    const gpu = (navigator as NavigatorWithGpu).gpu
    if (!gpu) return { ...withStorage, ok: false, reason: 'webgpu_unavailable', deviceComponent: pendingGpuComponents[0][0] }
    const adapter = await gpu.requestAdapter().catch(() => null)
    if (!adapter) return { ...withStorage, ok: false, reason: 'webgpu_unavailable', deviceComponent: pendingGpuComponents[0][0] }
    for (const [component, requirements] of pendingGpuComponents) {
      if (requirements.requiredFeatures.some((feature) => !adapter.features?.has(feature))) {
        return { ...withStorage, ok: false, reason: 'webgpu_feature_missing', deviceComponent: component }
      }
      if ((adapter.limits?.maxBufferSize ?? 0) < requirements.minimumMaxBufferSize) {
        return { ...withStorage, ok: false, reason: 'webgpu_limit_too_low', deviceComponent: component }
      }
    }
  }

  return { ...withStorage, ok: true }
}
