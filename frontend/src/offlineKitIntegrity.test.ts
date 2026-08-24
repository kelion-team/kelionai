import { beforeEach, describe, expect, it, vi } from 'vitest'
import { offlineKitManifest, type OfflineArtifact } from './lib/offlineKitManifest'
import { pregatesteModelOffline } from './lib/creierLocal'

const hashFakes = vi.hoisted(() => ({ queue: [] as Array<{ size: number; sha256: string }> }))
vi.mock('./lib/offlineHash', () => ({
  sha256ResponseBody: vi.fn(async (response: Response) => hashFakes.queue.shift() ?? ({
    size: Number(response.headers.get('content-length')),
    sha256: response.headers.get('x-test-sha') ?? '',
  })),
}))

const storage = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => void storage.set(key, value),
  removeItem: (key: string) => void storage.delete(key),
})

const { offlineComponentReady } = await import('./lib/offlineKitReadiness')
const { offlineKitPreflight, purgeOfflineComponentArtifacts, reconcileOfflineComponent, verifyOfflineComponent } = await import('./lib/offlineKitIntegrity')

function mockDigests(hashes: string[]): void {
  hashFakes.queue = hashes.map((sha256) => ({
    size: offlineKitManifest.components.brain.artifacts[0].sizeBytes,
    sha256,
  }))
}

function brainUrl(artifact: OfflineArtifact): string {
  const brain = offlineKitManifest.components.brain
  return artifact.url ?? `${brain.repository}/resolve/${brain.revisionSha}/${artifact.path}`
}

function brainCache(options: { missing?: string; wrongSize?: string } = {}): Map<string, Response> {
  const entries = new Map<string, Response>()
  for (const artifact of offlineKitManifest.components.brain.artifacts) {
    if (artifact.path === options.missing) continue
    const size = artifact.path === options.wrongSize ? artifact.sizeBytes - 1 : artifact.sizeBytes
    const headers: Record<string, string> = { 'content-length': String(size), 'x-test-sha': artifact.sha256 }
    if (artifact.etag) headers.etag = `"${artifact.etag}"`
    entries.set(brainUrl(artifact), new Response('', { headers }))
  }
  return entries
}

function installCacheMock(entries: Map<string, Response>): void {
  vi.stubGlobal('caches', {
    open: vi.fn(async () => ({
      match: vi.fn(async (key: string | Request) => {
        const url = typeof key === 'string' ? key : key.url
        return entries.get(url)?.clone()
      }),
    })),
  })
}

function installNavigator(options: {
  quota?: number
  usage?: number
  gpu?: { maxBufferSize: number; shaderF16?: boolean } | null
} = {}): void {
  vi.stubGlobal('navigator', {
    onLine: true,
    storage: {
      estimate: vi.fn(async () => ({ quota: options.quota ?? 4_000_000_000, usage: options.usage ?? 0 })),
    },
    gpu: options.gpu === null
      ? undefined
      : {
          requestAdapter: vi.fn(async () => ({
            features: { has: (feature: string) => feature !== 'shader-f16' || options.gpu?.shaderF16 !== false },
            limits: { maxBufferSize: options.gpu?.maxBufferSize ?? 1_000_000_000 },
          })),
        },
  })
}

beforeEach(() => {
  storage.clear()
  hashFakes.queue = []
  vi.restoreAllMocks()
})

describe('offline kit integrity', () => {
  it('pinuiește biblioteca WebLLM la un commit și folosește același URL în motor', () => {
    const wasm = offlineKitManifest.components.brain.artifacts.find((artifact) => artifact.cache === 'webllm/wasm')
    expect(wasm?.url).toMatch(/^https:\/\/raw\.githubusercontent\.com\/mlc-ai\/binary-mlc-llm-libs\/[a-f0-9]{40}\//)
    expect(wasm?.url).not.toContain('/main/')

    const source = String.raw`${pregatesteModelOffline}`
    expect(source).toContain('model_lib: modelLibrary.url')
  })

  it('marchează brain gata numai după toate dimensiunile și digesturile pin-uite', async () => {
    const artifacts = offlineKitManifest.components.brain.artifacts
    installCacheMock(brainCache())

    const result = await reconcileOfflineComponent('brain')

    expect(result).toMatchObject({ ok: true, checkedArtifacts: artifacts.length, totalArtifacts: artifacts.length })
    expect(offlineComponentReady('brain')).toBe(true)
  })

  it('șterge readiness după evacuarea unui singur artefact', async () => {
    const artifacts = offlineKitManifest.components.brain.artifacts
    const entries = brainCache()
    installCacheMock(entries)
    expect((await reconcileOfflineComponent('brain')).ok).toBe(true)

    entries.delete(brainUrl(artifacts[0]))
    const evicted = await reconcileOfflineComponent('brain')

    expect(evicted.ok).toBe(false)
    expect(evicted.reason).toBe(`missing:${artifacts[0].path}`)
    expect(offlineComponentReady('brain')).toBe(false)
  })

  it('respinge un cache parțial, o dimensiune greșită și un hash corupt', async () => {
    const first = offlineKitManifest.components.brain.artifacts[0]
    installCacheMock(brainCache({ missing: first.path }))
    expect((await verifyOfflineComponent('brain')).reason).toBe(`missing:${first.path}`)

    installCacheMock(brainCache({ wrongSize: first.path }))
    expect((await verifyOfflineComponent('brain')).reason).toBe(`size:${first.path}`)

    installCacheMock(brainCache())
    mockDigests(['0'.repeat(64)])
    expect((await verifyOfflineComponent('brain')).reason).toBe(`sha256:${first.path}`)
  })

  it('șterge exact cache-urile brain corupte înainte de redescărcare', async () => {
    const deleted: Array<{ cache: string; url: string }> = []
    vi.stubGlobal('caches', {
      open: vi.fn(async (cache: string) => ({
        delete: vi.fn(async (url: string) => {
          deleted.push({ cache, url })
          return true
        }),
      })),
    })

    await purgeOfflineComponentArtifacts('brain')

    expect(deleted).toHaveLength(offlineKitManifest.components.brain.artifacts.length)
    expect(new Set(deleted.map((entry) => entry.cache))).toEqual(new Set(['webllm/config', 'webllm/model', 'webllm/wasm']))
    expect(deleted.map((entry) => entry.url)).toEqual(
      offlineKitManifest.components.brain.artifacts.map(brainUrl),
    )
  })

})

describe('offline kit preflight', () => {
  const noneInstalled = { brain: false, hearing: false }

  it('blochează înainte de GPU când spațiul plus rezerva nu încape', async () => {
    installNavigator({ quota: 100_000_000, usage: 0, gpu: { maxBufferSize: 1_000_000_000 } })
    const result = await offlineKitPreflight(noneInstalled)
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('insufficient_storage')
    expect(result.requiredWithHeadroomBytes).toBeGreaterThan(result.availableBytes ?? 0)
  })

  it('blochează un dispozitiv fără WebGPU sau cu limita de buffer prea mică', async () => {
    installNavigator({ gpu: null })
    expect((await offlineKitPreflight(noneInstalled)).reason).toBe('webgpu_unavailable')

    installNavigator({ gpu: { maxBufferSize: 1 } })
    expect((await offlineKitPreflight(noneInstalled)).reason).toBe('webgpu_limit_too_low')
  })

  it('verifică separat cerința shader-f16 a auzului local', async () => {
    installNavigator({ gpu: { maxBufferSize: 1_000_000_000, shaderF16: false } })
    expect(await offlineKitPreflight(noneInstalled)).toMatchObject({
      ok: false,
      reason: 'webgpu_feature_missing',
      deviceComponent: 'hearing',
    })
  })

  it('acceptă tierul mobil numai după storage și adapter compatibile', async () => {
    installNavigator({ gpu: { maxBufferSize: 1_000_000_000 } })
    const result = await offlineKitPreflight(noneInstalled)
    expect(result.ok).toBe(true)
    expect(result.vramRequiredMB).toBe(offlineKitManifest.components.brain.deviceRequirements.vramRequiredMB)
  })
})
