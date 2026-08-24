function runtimeNativ(): boolean {
  return typeof location !== 'undefined' && location.protocol !== 'http:' && location.protocol !== 'https:'
}

export interface OfflineRuntimeStatus {
  ready: boolean
  totalBytes: number
}

const unavailableRuntime = (): OfflineRuntimeStatus => ({ ready: false, totalBytes: 0 })

async function activeServiceWorker(timeoutMs = 5_000): Promise<ServiceWorker | null> {
  if (typeof navigator === 'undefined' || !navigator.serviceWorker) return null
  if (navigator.serviceWorker.controller) return navigator.serviceWorker.controller
  const registration = await Promise.race([
    navigator.serviceWorker.getRegistration().catch(() => undefined),
    new Promise<undefined>((resolve) => globalThis.setTimeout(resolve, timeoutMs)),
  ])
  return registration?.active ?? null
}

function requestRuntimeWorker<T>(
  worker: ServiceWorker,
  type: string,
  fallback: T,
  parse: (data: Record<string, unknown>) => T | undefined,
): Promise<T> {
  const channel = new MessageChannel()
  return new Promise<T>((resolve) => {
    let settled = false
    const finish = (value: T): void => {
      if (settled) return
      settled = true
      window.clearTimeout(timeout)
      channel.port1.close()
      resolve(value)
    }
    const timeout = window.setTimeout(() => finish(fallback), 30_000)
    channel.port1.onmessage = (event: MessageEvent<Record<string, unknown>>) => {
      const value = parse(event.data ?? {})
      if (value !== undefined) finish(value)
    }
    worker.postMessage({ type }, [channel.port2])
  })
}

/** Cere workerului să verifice și să cache-uiască runtime-urile locale grele
 * numai după consimțământul explicit al instalării kitului. */
export async function cacheOfflineRuntimeAssets(
  signal?: AbortSignal,
  onProgress?: (doneBytes: number, totalBytes: number) => void,
): Promise<OfflineRuntimeStatus> {
  if (runtimeNativ()) return { ready: true, totalBytes: 0 }
  if (signal?.aborted || typeof navigator === 'undefined' || !navigator.serviceWorker) return unavailableRuntime()

  const worker = await activeServiceWorker()
  if (!worker) return unavailableRuntime()

  const id = crypto.randomUUID()
  const channel = new MessageChannel()
  return new Promise<OfflineRuntimeStatus>((resolve) => {
    let settled = false
    const finish = (value: OfflineRuntimeStatus): void => {
      if (settled) return
      settled = true
      window.clearTimeout(timeout)
      signal?.removeEventListener('abort', cancel)
      channel.port1.close()
      resolve(value)
    }
    const cancel = (): void => {
      worker.postMessage({ type: 'kelion-cancel-offline-runtime', id })
      finish(unavailableRuntime())
    }
    const timeout = window.setTimeout(cancel, 10 * 60_000)
    channel.port1.onmessage = (event: MessageEvent<{
      type?: string
      done?: number
      total?: number
      doneBytes?: number
      totalBytes?: number
      ready?: boolean
    }>) => {
      if (event.data?.type === 'progress' && Number.isSafeInteger(event.data.doneBytes) && Number.isSafeInteger(event.data.totalBytes)) {
        onProgress?.(event.data.doneBytes ?? 0, event.data.totalBytes ?? 0)
      } else if (event.data?.type === 'done') {
        finish({
          ready: event.data.ready === true,
          totalBytes: Number.isSafeInteger(event.data.totalBytes) ? Math.max(0, event.data.totalBytes ?? 0) : 0,
        })
      } else if (event.data?.type === 'cancelled' || event.data?.type === 'error') finish(unavailableRuntime())
    }
    signal?.addEventListener('abort', cancel, { once: true })
    worker.postMessage({ type: 'kelion-cache-offline-runtime', id }, [channel.port2])
  })
}

/** Cere persistența numai în urma gestului explicit de instalare. Un refuz este
 * raportat, nu transformat într-o promisiune falsă de disponibilitate în avion. */
export async function requestPersistentOfflineStorage(): Promise<'granted' | 'native' | 'denied' | 'unsupported'> {
  // În shellurile native modelele sunt în sandboxul persistent al aplicației;
  // StorageManager este o API web și absența ei nu trebuie să blocheze kitul.
  if (runtimeNativ()) return 'native'
  const storage = typeof navigator !== 'undefined'
    ? (navigator as Navigator & { storage?: StorageManager }).storage
    : undefined
  if (!storage?.persist || !storage.persisted) return 'unsupported'
  try {
    if (await storage.persisted()) return 'granted'
    return await storage.persist() ? 'granted' : 'denied'
  } catch {
    return 'denied'
  }
}

/** Șterge runtime-urile opt-in și markerul lor prin worker, cu ACK verificabil. */
export async function removeOfflineRuntimeAssets(): Promise<boolean> {
  if (runtimeNativ()) return true
  if (typeof navigator === 'undefined' || !navigator.serviceWorker) return false
  const worker = await activeServiceWorker()
  if (!worker) return false
  return requestRuntimeWorker(worker, 'kelion-remove-offline-runtime', false, (data) =>
    data.type === 'done' ? true : data.type === 'error' ? false : undefined)
}

/** Inventar local-only: nu repară și nu pornește fetch. */
export async function checkOfflineRuntimeAssets(): Promise<OfflineRuntimeStatus> {
  if (runtimeNativ()) return { ready: true, totalBytes: 0 }
  if (typeof navigator === 'undefined' || !navigator.serviceWorker) return unavailableRuntime()
  const worker = await activeServiceWorker()
  if (!worker) return unavailableRuntime()
  return requestRuntimeWorker(worker, 'kelion-check-offline-runtime', unavailableRuntime(), (data) => ({
    ready: data.type === 'done' && data.ready === true,
    totalBytes: Number.isSafeInteger(data.totalBytes) ? Math.max(0, Number(data.totalBytes)) : 0,
  }))
}
