import { elibereazaCreierLocal, pregatesteModelOffline, stergeModelOffline } from './creierLocal'
import {
  oprestePregatireaUrechiiOffline,
  pregatesteUrecheaOffline,
  stergeUrecheaOffline,
} from './urecheaOffline'
import {
  offlineKitEstimatedBytes,
  offlineKitManifest,
  type OfflineKitComponent,
} from './offlineKitManifest'
import {
  offlineKitPreflight,
  purgeOfflineComponentArtifacts,
  reconcileOfflineComponent,
  type OfflineKitPreflight,
} from './offlineKitIntegrity'
import { clearOfflineKitReadiness } from './offlineKitReadiness'
import {
  cacheOfflineRuntimeAssets,
  checkOfflineRuntimeAssets,
  removeOfflineRuntimeAssets,
  requestPersistentOfflineStorage,
} from './offlineRuntimeAssets'

export type OfflineKitPhase = 'idle' | 'checking' | 'installing' | 'ready' | 'cancelled' | 'error' | 'removing'

export interface OfflineKitSnapshot {
  phase: OfflineKitPhase
  current: OfflineKitComponent | null
  progress: number
  components: Record<OfflineKitComponent, boolean>
  componentProgress: Record<OfflineKitComponent, number>
  message: string
  preflight: OfflineKitPreflight | null
  persistence: 'unknown' | 'granted' | 'native' | 'denied' | 'unsupported'
  runtimeReady: boolean
  runtimeBytes: number
}

const EMPTY_COMPONENTS: Record<OfflineKitComponent, boolean> = { brain: false, hearing: false }
const STATIC_RUNTIME_BYTES = offlineKitManifest.runtimeSources.reduce((total, artifact) => total + artifact.sizeBytes, 0)
const listeners = new Set<(snapshot: OfflineKitSnapshot) => void>()
let activeInstall: Promise<boolean> | null = null
let activeInstallAbort: AbortController | null = null
let activeRefresh: Promise<OfflineKitSnapshot> | null = null

function emptySnapshot(): OfflineKitSnapshot {
  return {
    phase: 'idle',
    current: null,
    progress: 0,
    components: { ...EMPTY_COMPONENTS },
    componentProgress: { brain: 0, hearing: 0 },
    message: '',
    preflight: null,
    persistence: 'unknown',
    runtimeReady: false,
    runtimeBytes: STATIC_RUNTIME_BYTES,
  }
}

let state: OfflineKitSnapshot = emptySnapshot()

function emit(patch: Partial<OfflineKitSnapshot> = {}): void {
  state = { ...state, ...patch }
  const snapshot = offlineKitSnapshot()
  for (const listener of listeners) listener(snapshot)
}

function updateComponentProgress(component: OfflineKitComponent, value: number): void {
  const componentProgress = {
    ...state.componentProgress,
    [component]: Math.min(1, Math.max(0, value)),
  }
  const sizes = offlineKitManifest.components
  const runtimeBytes = state.runtimeBytes
  const weighted = (
    (state.runtimeReady ? runtimeBytes : 0) +
    componentProgress.brain * sizes.brain.estimatedBytes +
    componentProgress.hearing * sizes.hearing.estimatedBytes
  ) / offlineKitEstimatedBytes(runtimeBytes)
  emit({ componentProgress, progress: weighted })
}

function verifiedProgress(components: Record<OfflineKitComponent, boolean>): Record<OfflineKitComponent, number> {
  return {
    brain: components.brain ? 1 : 0,
    hearing: components.hearing ? 1 : 0,
  }
}

function weightedProgress(componentProgress: Record<OfflineKitComponent, number>, runtimeReady = state.runtimeReady): number {
  const sizes = offlineKitManifest.components
  const runtimeBytes = state.runtimeBytes
  return (
    (runtimeReady ? runtimeBytes : 0) +
    componentProgress.brain * sizes.brain.estimatedBytes +
    componentProgress.hearing * sizes.hearing.estimatedBytes
  ) / offlineKitEstimatedBytes(runtimeBytes)
}

function updateRuntimeProgress(doneBytes: number, totalBytes: number): void {
  const runtimeBytes = totalBytes > 0 ? totalBytes : state.runtimeBytes
  const componentProgress = state.componentProgress
  const sizes = offlineKitManifest.components
  const progress = (
    Math.min(runtimeBytes, Math.max(0, doneBytes)) +
    componentProgress.brain * sizes.brain.estimatedBytes +
    componentProgress.hearing * sizes.hearing.estimatedBytes
  ) / offlineKitEstimatedBytes(runtimeBytes)
  emit({ runtimeBytes, progress })
}

export function offlineKitSnapshot(): OfflineKitSnapshot {
  return {
    ...state,
    components: { ...state.components },
    componentProgress: { ...state.componentProgress },
    preflight: state.preflight ? { ...state.preflight } : null,
  }
}

export function subscribeOfflineKit(listener: (snapshot: OfflineKitSnapshot) => void): () => void {
  listeners.add(listener)
  listener(offlineKitSnapshot())
  return () => listeners.delete(listener)
}

export function offlineKitComponentReady(component: OfflineKitComponent): boolean {
  return state.components[component]
}

/** Verifică inventarul real din Cache Storage și OPFS; markerul nu este suficient. */
export function refreshOfflineKit(): Promise<OfflineKitSnapshot> {
  if (activeRefresh) return activeRefresh
  activeRefresh = (async () => {
    const previousPhase = state.phase
    if (previousPhase !== 'installing') emit({ phase: 'checking', current: null, message: '' })
    const components = { ...EMPTY_COMPONENTS }
    for (const component of ['hearing', 'brain'] as const) {
      components[component] = (await reconcileOfflineComponent(component)).ok
    }
    const componentProgress = verifiedProgress(components)
    const runtime = await checkOfflineRuntimeAssets()
    const runtimeBytes = runtime.totalBytes > 0 ? runtime.totalBytes : state.runtimeBytes
    const allReady = runtime.ready && Object.values(components).every(Boolean)
    state = {
      ...state,
      phase: previousPhase === 'installing' ? 'installing' : allReady ? 'ready' : 'idle',
      current: null,
      components,
      runtimeReady: runtime.ready,
      runtimeBytes,
      componentProgress,
      progress: weightedProgress(componentProgress, runtime.ready),
      message: '',
    }
    emit()
    return offlineKitSnapshot()
  })().finally(() => {
    activeRefresh = null
  })
  return activeRefresh
}

/** Instalează numai după acordul explicit din Setări și după preflight complet. */
export function installOfflineKit(
  signal?: AbortSignal,
  options: { allowVolatileStorage?: boolean } = {},
): Promise<boolean> {
  if (activeInstall) return activeInstall
  const internalAbort = new AbortController()
  activeInstallAbort = internalAbort
  const abortInternal = (): void => internalAbort.abort()
  signal?.addEventListener('abort', abortInternal, { once: true })
  const installSignal = internalAbort.signal
  const install = (async () => {
    const before = await refreshOfflineKit()
    const allComponentsReady = Object.values(before.components).every(Boolean)
    if (!allComponentsReady || !before.runtimeReady) {
      const preflight = await offlineKitPreflight(before.components, before.runtimeReady, before.runtimeBytes)
      emit({ preflight })
      if (!preflight.ok) {
        emit({ phase: 'error', message: preflight.reason ?? 'preflight_failed' })
        return false
      }
    }

    const persistence = await requestPersistentOfflineStorage()
    emit({ persistence })
    if (persistence !== 'granted' && persistence !== 'native' && !options.allowVolatileStorage) {
      emit({ phase: 'error', message: `persistent_storage_${persistence}` })
      return false
    }

    emit({ phase: 'installing', current: null, message: 'offline_runtime' })
    try {
      const runtime = await cacheOfflineRuntimeAssets(installSignal, updateRuntimeProgress)
      if (!runtime.ready) {
        if (installSignal.aborted) throw new DOMException('cancelled', 'AbortError')
        throw new Error('offline_runtime_install_failed')
      }
      emit({ runtimeReady: true, runtimeBytes: runtime.totalBytes > 0 ? runtime.totalBytes : state.runtimeBytes })
      if (allComponentsReady) {
        emit({ phase: 'ready', current: null, components: before.components, runtimeReady: true, progress: 1, message: '' })
        return true
      }

      emit({ current: 'hearing' })
      if (!before.components.hearing) {
        await purgeOfflineComponentArtifacts('hearing')
        const installed = await pregatesteUrecheaOffline({
          allowNetwork: true,
          onProgress: (progress) => updateComponentProgress('hearing', progress),
          signal: installSignal,
        })
        if (!installed) throw new Error('hearing_install_failed')
        const verification = await reconcileOfflineComponent('hearing')
        if (!verification.ok) throw new Error(verification.reason ?? 'hearing_integrity_failed')
      }
      updateComponentProgress('hearing', 1)
      // Eliberăm sesiunea ASR/WebGPU înainte de a încărca modelul de răspuns;
      // cele două modele nu trebuie să ocupe simultan memoria dispozitivului.
      oprestePregatireaUrechiiOffline()

      emit({ current: 'brain' })
      if (!before.components.brain) {
        await purgeOfflineComponentArtifacts('brain')
        const installed = await pregatesteModelOffline((progress) => updateComponentProgress('brain', progress), installSignal)
        if (!installed) throw new Error('brain_install_failed')
        const verification = await reconcileOfflineComponent('brain')
        if (!verification.ok) throw new Error(verification.reason ?? 'brain_integrity_failed')
      }
      updateComponentProgress('brain', 1)
      await elibereazaCreierLocal()

      const verified = await refreshOfflineKit()
      if (!verified.runtimeReady || !Object.values(verified.components).every(Boolean)) throw new Error('readiness_not_verified')
      emit({ phase: 'ready', current: null, components: verified.components, progress: 1, message: '' })
      return true
    } catch (error) {
      if (installSignal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
        oprestePregatireaUrechiiOffline()
        await elibereazaCreierLocal()
        emit({ phase: 'cancelled', current: null, message: 'cancelled' })
        return false
      }
      oprestePregatireaUrechiiOffline()
      await elibereazaCreierLocal()
      const message = error instanceof Error ? error.message : 'install_failed'
      emit({ phase: 'error', current: null, message })
      return false
    }
  })()
  activeInstall = install
  void install.then(
    () => {
      signal?.removeEventListener('abort', abortInternal)
      if (activeInstall === install) activeInstall = null
      if (activeInstallAbort === internalAbort) activeInstallAbort = null
    },
    () => {
      signal?.removeEventListener('abort', abortInternal)
      if (activeInstall === install) activeInstall = null
      if (activeInstallAbort === internalAbort) activeInstallAbort = null
    },
  )
  return install
}

export async function removeOfflineKit(): Promise<boolean> {
  activeInstallAbort?.abort()
  if (activeInstall) await activeInstall.catch(() => false)
  emit({ phase: 'removing', current: null, message: '' })
  oprestePregatireaUrechiiOffline()
  await elibereazaCreierLocal()
  const results = await Promise.allSettled([
    stergeModelOffline(),
    stergeUrecheaOffline(),
    removeOfflineRuntimeAssets(),
  ])
  clearOfflineKitReadiness()
  const verified = {
    brain: (await reconcileOfflineComponent('brain')).ok,
    hearing: (await reconcileOfflineComponent('hearing')).ok,
  }
  const runtimeRemoved = results[2].status === 'fulfilled' && results[2].value === true
  const runtimeStatus = await checkOfflineRuntimeAssets()
  const runtimeStillReady = runtimeStatus.ready
  const enginesRemoved = results.slice(0, 2).every((result) => result.status === 'fulfilled')
  if (!runtimeRemoved || runtimeStillReady || !enginesRemoved || Object.values(verified).some(Boolean)) {
    emit({
      phase: 'error',
      current: null,
      components: verified,
      componentProgress: verifiedProgress(verified),
      progress: weightedProgress(verifiedProgress(verified), runtimeStillReady),
      message: 'remove_failed',
      runtimeReady: runtimeStillReady,
      runtimeBytes: runtimeStatus.totalBytes > 0 ? runtimeStatus.totalBytes : state.runtimeBytes,
    })
    return false
  }
  emit(emptySnapshot())
  return true
}
