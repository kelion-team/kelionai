import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { injecteazaPrecache } from '../scripts/genereaza-precache.mjs'

const ORIGIN = 'https://kelion.test'
const ASSETS = 'kelionai-precache-assets-v1'
const MANIFEST = '/__kelion-shell-manifest__'
const source = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8')

type CacheKey = string | Request
type WindowClient = { id: string; visibilityState: 'visible' | 'hidden' }
type WorkerEvent = {
  waitUntil?: (work: Promise<unknown>) => void
  respondWith?: (response: Promise<Response>) => void
  request?: Request
}

function memoryStorage() {
  const stores = new Map<string, Map<string, Response>>()
  const deleted: string[] = []
  const url = (key: CacheKey) => new URL(typeof key === 'string' ? key : key.url, ORIGIN).href
  const storage = {
    keys: async () => [...stores.keys()],
    delete: async (name: string) => { deleted.push(name); return stores.delete(name) },
    open: async (name: string) => {
      if (!stores.has(name)) stores.set(name, new Map())
      const entries = stores.get(name)!
      return {
        match: async (key: CacheKey, options?: { ignoreSearch?: boolean }) => {
          const target = url(key)
          const found = options?.ignoreSearch
            ? [...entries].find(([candidate]) => new URL(candidate).pathname === new URL(target).pathname)?.[1]
            : entries.get(target)
          return found?.clone()
        },
        put: async (key: CacheKey, response: Response) => { entries.set(url(key), response.clone()) },
        delete: async (key: CacheKey) => { deleted.push(url(key)); return entries.delete(url(key)) },
        keys: async () => [...entries.keys()].map((key) => new Request(key)),
      }
    },
  }
  return { storage, deleted }
}

function generation(name: string) {
  return { version: `kelionai-shell-${name}`, urls: [`/assets/lazy-${name}.js?v=${name}`], offlineRuntime: [] }
}

async function seed(memory: ReturnType<typeof memoryStorage>, name: string, installedAt: number) {
  const manifest = generation(name)
  const metadata = await memory.storage.open(manifest.version)
  await metadata.put(MANIFEST, new Response(JSON.stringify({ urls: manifest.urls, installedAt })))
  const assets = await memory.storage.open(ASSETS)
  await assets.put(manifest.urls[0]!, new Response(`chunk ${name}`))
}

function worker(memory: ReturnType<typeof memoryStorage>, name: string, windows: WindowClient[], enumerationFails = false) {
  const handlers = new Map<string, (event: WorkerEvent) => void>()
  const claim = vi.fn(async () => undefined)
  const matchAll = vi.fn(async () => {
    if (enumerationFails) throw new Error('client enumeration unavailable')
    return windows
  })
  const fetch = vi.fn(async () => { throw new TypeError('offline: no network fallback') })
  const self = {
    location: { origin: ORIGIN },
    navigator: { onLine: false },
    clients: { claim, matchAll },
    addEventListener: (type: string, handler: (event: WorkerEvent) => void) => handlers.set(type, handler),
  }
  runInNewContext(injecteazaPrecache(source, generation(name)), {
    self, caches: memory.storage, fetch, URL, Request, Response,
  })
  return {
    claim, matchAll, fetch,
    activate: async () => {
      let completion: Promise<unknown> | undefined
      handlers.get('activate')!({ waitUntil: (work) => { completion = work } })
      expect(completion).toBeDefined()
      await completion
    },
    asset: async (path: string) => {
      let response: Promise<Response> | undefined
      handlers.get('fetch')!({
        request: new Request(new URL(path, ORIGIN)),
        respondWith: (work) => { response = work },
      })
      expect(response).toBeDefined()
      return (await response!).text()
    },
  }
}

describe('PWA generations remain usable by windows that defer updates', () => {
  it.each(['visible', 'hidden'] as const)('serves A offline after B and C activate while its %s window remains open', async (visibilityState) => {
    const memory = memoryStorage()
    const windows: WindowClient[] = [{ id: 'tab-a', visibilityState }]
    await seed(memory, 'a', 1)
    for (const [name, installedAt] of [['b', 2], ['c', 3]] as const) {
      await seed(memory, name, installedAt)
      const current = worker(memory, name, windows)
      await current.activate()
      expect(current.claim).toHaveBeenCalledTimes(1)
      expect(await current.asset('/assets/lazy-a.js')).toBe('chunk a')
      expect(current.fetch).not.toHaveBeenCalled()
    }
    expect(memory.deleted).toEqual([])
    expect(await memory.storage.keys()).toEqual(expect.arrayContaining([
      generation('a').version, generation('b').version, generation('c').version,
    ]))
  })

  it('reclaims A only after enumeration confirms no windows, retaining B/C and installed offline data', async () => {
    const memory = memoryStorage()
    for (const [name, installedAt] of [['a', 1], ['b', 2], ['c', 3]] as const) await seed(memory, name, installedAt)
    const assets = await memory.storage.open(ASSETS)
    const runtimeUrl = '/ort/runtime.wasm?v=installed'
    await assets.put(runtimeUrl, new Response('installed runtime'))
    const runtimeMeta = await memory.storage.open('kelionai-offline-runtime-meta-v1')
    await runtimeMeta.put('/__kelion-offline-runtime-manifest__', new Response(JSON.stringify({ assets: [{ url: runtimeUrl }] })))
    await memory.storage.open('webllm/installed-model')
    const current = worker(memory, 'c', [])
    await current.activate()
    expect(current.matchAll).toHaveBeenCalledWith({ type: 'window', includeUncontrolled: true })
    expect(current.claim).toHaveBeenCalledTimes(1)
    expect(await memory.storage.keys()).not.toContain(generation('a').version)
    expect(await assets.match(generation('a').urls[0]!)).toBeUndefined()
    expect(await current.asset('/assets/lazy-b.js')).toBe('chunk b')
    expect(await current.asset('/assets/lazy-c.js')).toBe('chunk c')
    expect(await (await assets.match(runtimeUrl))!.text()).toBe('installed runtime')
    expect(await memory.storage.keys()).toContain('webllm/installed-model')
    expect(current.fetch).not.toHaveBeenCalled()
  })

  it('defers reclamation when client enumeration fails and still claims clients', async () => {
    const memory = memoryStorage()
    for (const [name, installedAt] of [['a', 1], ['b', 2], ['c', 3]] as const) await seed(memory, name, installedAt)
    const current = worker(memory, 'c', [], true)
    await current.activate()
    expect(current.claim).toHaveBeenCalledTimes(1)
    expect(memory.deleted).toEqual([])
    expect(await current.asset('/assets/lazy-a.js')).toBe('chunk a')
    expect(current.fetch).not.toHaveBeenCalled()
  })
})
