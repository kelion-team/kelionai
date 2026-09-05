import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Run the real hook with only React scheduling and browser/network I/O doubled.
// SSR rendering is covered separately with the actual React renderer.
const hooks = vi.hoisted(() => ({ states: [] as unknown[], refs: [] as { current: unknown }[],
  effects: [] as { deps?: unknown[]; cleanup?: () => void }[], pending: [] as (() => void)[],
  stateIndex: 0, refIndex: 0, effectIndex: 0, request: vi.fn() }))
vi.mock('react', () => ({
  useState(initial: unknown) {
    const index = hooks.stateIndex++
    if (!(index in hooks.states)) hooks.states[index] = typeof initial === 'function' ? initial() : initial
    return [hooks.states[index], (next: unknown) => { hooks.states[index] = typeof next === 'function' ? next(hooks.states[index]) : next }]
  },
  useRef(initial: unknown) {
    const index = hooks.refIndex++
    return hooks.refs[index] ?? (hooks.refs[index] = { current: initial })
  },
  useEffect(effect: () => undefined | (() => void), deps?: unknown[]) {
    const index = hooks.effectIndex++, old = hooks.effects[index]
    if (!old || !deps || deps.some((value, i) => !Object.is(value, old.deps?.[i]))) {
      hooks.pending.push(() => { old?.cleanup?.(); hooks.effects[index] = { deps, cleanup: effect() || undefined } })
    }
  },
}))
vi.mock('./lib/transport', () => ({ apiFetch: hooks.request }))
import { useConstructorMonitor } from './lib/useConstructorMonitor'

type Pending = { signal: AbortSignal; resolve: (response: Response) => void; reject: (error: Error) => void }
const requests: Pending[] = []
let windowEvents: EventTarget, documentEvents: EventTarget
let online: { onLine: boolean }
const served = '2026-09-05T12:00:00.000Z'
const payload = (offset = 0) => ({ servedAt: new Date(Date.parse(served) + offset).toISOString(), checkedAt: served,
  lastSuccessfulCheck: served, error: null, cases: [], externalRemediations: [] })
function MonitorHarness() {
  hooks.stateIndex = 0; hooks.refIndex = 0; hooks.effectIndex = 0
  const value = useConstructorMonitor()
  for (const effect of hooks.pending.splice(0)) effect()
  return value
}
const render = MonitorHarness
async function flush() { for (let i = 0; i < 8; i++) await Promise.resolve() }
function answer(index: number, value: unknown = payload(), status = 200) {
  requests[index].resolve(new Response(JSON.stringify(value), { status }))
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance'] })
  hooks.states = []; hooks.refs = []; hooks.effects = []; hooks.pending = []; hooks.request.mockReset(); requests.length = 0
  windowEvents = new EventTarget(); documentEvents = new EventTarget(); online = { onLine: true }
  vi.stubGlobal('navigator', online)
  vi.stubGlobal('window', Object.assign(windowEvents, { setTimeout, clearTimeout, setInterval, clearInterval }))
  vi.stubGlobal('document', Object.assign(documentEvents, { visibilityState: 'visible' }))
  hooks.request.mockImplementation((_url: string, options: RequestInit) => new Promise<Response>((resolve, reject) => {
    const signal = options.signal as AbortSignal
    requests.push({ signal, resolve, reject })
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
  }))
})
afterEach(async () => {
  for (const effect of hooks.effects) effect?.cleanup?.()
  await flush()
  vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals()
})

describe('Constructor monitor read loop', () => {
  it('starts unknown and sends only the fixed authenticated read request', async () => {
    expect(render()).toMatchObject({ snapshot: null, connected: false })
    expect(hooks.request).toHaveBeenCalledTimes(1)
    expect(hooks.request.mock.calls[0][0]).toBe('/api/admin/constructor/monitor')
    expect(hooks.request.mock.calls[0][1]).toMatchObject({ credentials: 'include', cache: 'no-store', signal: expect.any(AbortSignal) })
    answer(0); await flush()
    expect(render()).toMatchObject({ connected: true, snapshot: { servedAt: served } })
  })
  it('includes request transit time conservatively instead of resetting evidence age on receipt', async () => {
    render(); await vi.advanceTimersByTimeAsync(1500); answer(0); await flush()
    expect(render().elapsedMs).toBe(1500)
    await vi.advanceTimersByTimeAsync(500)
    expect(render().elapsedMs).toBe(2000)
  })
  it('pending HTTP times out at 8 seconds and cannot manufacture an initial success', async () => {
    render(); await vi.advanceTimersByTimeAsync(8000); await flush()
    expect(requests[0].signal.aborted).toBe(true)
    expect(render()).toMatchObject({ connected: false, snapshot: null })
  })
  it('a later pending HTTP request disconnects but retains the historical successful snapshot', async () => {
    render(); answer(0); await flush(); render()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(requests).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(8000); await flush()
    expect(requests[1].signal.aborted).toBe(true)
    expect(render()).toMatchObject({ connected: false, snapshot: { servedAt: served } })
  })
  it('offline disconnects immediately and reconnect does not accept an old servedAt', async () => {
    render(); answer(0); await flush(); render()
    online.onLine = false; windowEvents.dispatchEvent(new Event('offline')); await flush()
    expect(render().connected).toBe(false)
    online.onLine = true; windowEvents.dispatchEvent(new Event('online'))
    answer(1); await flush()
    expect(render().connected).toBe(false)
    windowEvents.dispatchEvent(new Event('online')); answer(2, payload(1)); await flush()
    expect(render()).toMatchObject({ connected: true, snapshot: { servedAt: payload(1).servedAt } })
  })
  it('does not send a request while navigator is offline', () => {
    online.onLine = false
    expect(render().connected).toBe(false)
    expect(requests).toHaveLength(0)
  })
  it.each(['malformed', 'http-error'] as const)('fails closed on %s after a valid observation', async (mode) => {
    render(); answer(0); await flush(); render()
    await vi.advanceTimersByTimeAsync(10_000)
    answer(1, mode === 'malformed' ? { servedAt: 'bad' } : payload(10_000), mode === 'http-error' ? 503 : 200)
    await flush()
    expect(render()).toMatchObject({ connected: false, snapshot: { servedAt: served } })
  })
  it('ignores a response from a generation superseded while its JSON body was pending', async () => {
    render()
    let finishBody!: (value: unknown) => void
    requests[0].resolve({ ok: true, json: () => new Promise(resolve => { finishBody = resolve }) } as Response)
    await flush()
    documentEvents.dispatchEvent(new Event('visibilitychange'))
    expect(requests[0].signal.aborted).toBe(true)
    answer(1, payload(1000)); await flush()
    finishBody(payload(2000)); await flush()
    expect(render().snapshot?.servedAt).toBe(payload(1000).servedAt)
  })
  it('unmount aborts the request, removes listeners and leaves no polling work', async () => {
    render()
    for (const effect of hooks.effects) effect?.cleanup?.()
    hooks.effects = []
    await flush(); await vi.advanceTimersByTimeAsync(60_000)
    windowEvents.dispatchEvent(new Event('online')); documentEvents.dispatchEvent(new Event('visibilitychange'))
    expect(requests[0].signal.aborted).toBe(true)
    expect(requests).toHaveLength(1)
    expect(vi.getTimerCount()).toBe(0)
  })
})
