import { beforeEach, describe, expect, it, vi } from 'vitest'

const fakes = vi.hoisted(() => ({
  installed: { brain: false, hearing: false },
  installHearing: vi.fn(async () => true),
  installBrain: vi.fn(async () => true),
  removeHearing: vi.fn(async () => {}),
  removeBrain: vi.fn(async () => {}),
  stopHearing: vi.fn(),
  releaseBrain: vi.fn(async () => {}),
  clearReadiness: vi.fn(),
  purge: vi.fn(async () => {}),
  runtimeCache: vi.fn(async () => ({ ready: true, totalBytes: 42 })),
  runtimeRemove: vi.fn(async () => true),
  runtimeReady: false,
  persistentStorage: vi.fn(async () => 'granted' as const),
}))

vi.mock('./lib/urecheaOffline', () => ({
  pregatesteUrecheaOffline: async (...args: unknown[]) => {
    const ok = await fakes.installHearing(...args)
    if (ok) fakes.installed.hearing = true
    return ok
  },
  oprestePregatireaUrechiiOffline: fakes.stopHearing,
  stergeUrecheaOffline: fakes.removeHearing,
}))

vi.mock('./lib/creierLocal', () => ({
  pregatesteModelOffline: async (...args: unknown[]) => {
    const ok = await fakes.installBrain(...args)
    if (ok) fakes.installed.brain = true
    return ok
  },
  stergeModelOffline: fakes.removeBrain,
  elibereazaCreierLocal: fakes.releaseBrain,
}))

vi.mock('./lib/offlineKitIntegrity', () => ({
  reconcileOfflineComponent: vi.fn(async (component: 'brain' | 'hearing') => ({
    ok: fakes.installed[component],
    component,
    checkedArtifacts: fakes.installed[component] ? 1 : 0,
    totalArtifacts: 1,
    reason: fakes.installed[component] ? undefined : 'missing',
  })),
  offlineKitPreflight: vi.fn(async () => ({
    ok: true,
    requiredBytes: 1,
    requiredWithHeadroomBytes: 2,
    availableBytes: 3,
    vramRequiredMB: 1,
  })),
  purgeOfflineComponentArtifacts: fakes.purge,
}))

vi.mock('./lib/offlineKitReadiness', () => ({ clearOfflineKitReadiness: fakes.clearReadiness }))
vi.mock('./lib/offlineRuntimeAssets', () => ({
  cacheOfflineRuntimeAssets: async (...args: unknown[]) => {
    const status = await fakes.runtimeCache(...args)
    if (status.ready) fakes.runtimeReady = true
    return status
  },
  removeOfflineRuntimeAssets: async (...args: unknown[]) => {
    const ok = await fakes.runtimeRemove(...args)
    if (ok) fakes.runtimeReady = false
    return ok
  },
  checkOfflineRuntimeAssets: vi.fn(async () => ({ ready: fakes.runtimeReady, totalBytes: 42 })),
  requestPersistentOfflineStorage: fakes.persistentStorage,
}))

beforeEach(() => {
  vi.resetModules()
  fakes.installed = { brain: false, hearing: false }
  fakes.runtimeReady = false
  vi.clearAllMocks()
  fakes.installHearing.mockResolvedValue(true)
  fakes.installBrain.mockResolvedValue(true)
  fakes.removeHearing.mockImplementation(async () => { fakes.installed.hearing = false })
  fakes.removeBrain.mockImplementation(async () => { fakes.installed.brain = false })
})

describe('offline kit lifecycle', () => {
  it('anularea oprește instalarea și o reluare nouă poate finaliza kitul', async () => {
    let releaseFirst: ((value: boolean) => void) | null = null
    fakes.installHearing.mockImplementationOnce((options: { signal: AbortSignal }) => new Promise<boolean>((resolve) => {
      releaseFirst = resolve
      options.signal.addEventListener('abort', () => resolve(false), { once: true })
    }))
    const kit = await import('./lib/kitOffline')
    const controller = new AbortController()
    const first = kit.installOfflineKit(controller.signal)
    await vi.waitFor(() => expect(fakes.installHearing).toHaveBeenCalled())
    controller.abort()
    releaseFirst?.(false)

    expect(await first).toBe(false)
    expect(kit.offlineKitSnapshot().phase).toBe('cancelled')

    expect(await kit.installOfflineKit()).toBe(true)
    expect(fakes.runtimeCache).toHaveBeenCalled()
    expect(fakes.runtimeCache.mock.invocationCallOrder[0]).toBeLessThan(fakes.installHearing.mock.invocationCallOrder[0])
    expect(kit.offlineKitSnapshot().phase).toBe('ready')
    expect(Object.values(kit.offlineKitSnapshot().components).every(Boolean)).toBe(true)
    expect(fakes.stopHearing).toHaveBeenCalled()
    expect(fakes.releaseBrain).toHaveBeenCalled()
    expect(fakes.stopHearing.mock.invocationCallOrder[0]).toBeLessThan(fakes.installBrain.mock.invocationCallOrder[0])
  })

  it('remove șterge cele două modele și revine la stare goală', async () => {
    const kit = await import('./lib/kitOffline')
    expect(await kit.installOfflineKit()).toBe(true)

    await kit.removeOfflineKit()

    expect(fakes.stopHearing).toHaveBeenCalled()
    expect(fakes.removeBrain).toHaveBeenCalledOnce()
    expect(fakes.removeHearing).toHaveBeenCalledOnce()
    expect(fakes.clearReadiness).toHaveBeenCalledOnce()
    expect(fakes.runtimeRemove).toHaveBeenCalledOnce()
    expect(kit.offlineKitSnapshot()).toMatchObject({
      phase: 'idle',
      progress: 0,
      components: { brain: false, hearing: false },
    })
  })

  it('fails closed before downloading when persistent storage cannot be granted', async () => {
    fakes.persistentStorage.mockResolvedValueOnce('denied')
    const kit = await import('./lib/kitOffline')

    expect(await kit.installOfflineKit()).toBe(false)
    expect(fakes.runtimeCache).not.toHaveBeenCalled()
    expect(kit.offlineKitSnapshot()).toMatchObject({
      phase: 'error',
      message: 'persistent_storage_denied',
    })
  })

  it('curăță numai componentele neverificate înainte de retry', async () => {
    fakes.installed = { brain: false, hearing: true }
    const kit = await import('./lib/kitOffline')

    expect(await kit.installOfflineKit()).toBe(true)
    expect(fakes.purge).toHaveBeenCalledTimes(1)
    expect(fakes.purge).toHaveBeenCalledWith('brain')
    expect(fakes.installBrain).toHaveBeenCalledOnce()
    expect(fakes.installHearing).not.toHaveBeenCalled()
  })
})
