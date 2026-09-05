import { Children, isValidElement, type ReactElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const hooks = vi.hoisted(() => ({
  state: [] as unknown[], refs: [] as { current: unknown }[],
  stateIndex: 0, refIndex: 0, request: vi.fn(),
}))
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useEffect: () => undefined,
  useState: (initial: unknown) => {
    const index = hooks.stateIndex++
    if (!(index in hooks.state)) hooks.state[index] = typeof initial === 'function' ? initial() : initial
    return [hooks.state[index], (next: unknown) => {
      hooks.state[index] = typeof next === 'function' ? next(hooks.state[index]) : next
    }]
  },
  useRef: (initial: unknown) => {
    const index = hooks.refIndex++
    return hooks.refs[index] ?? (hooks.refs[index] = { current: initial })
  },
}))
vi.mock('./lib/transport', () => ({ apiFetch: hooks.request }))
vi.mock('./lib/adminText', () => ({ adminStrings: () => ({ constructorModelVerifiedAt: (at: string) => `Verified engine: ${at}` }) }))
import { AdminConstructor, AdminCreier } from './components/admin/AdminProductie'

type Props = {
  children?: ReactNode; placeholder?: string; type?: string; checked?: boolean; dateTime?: string
  onChange?: (event: { target: { value?: string; checked?: boolean } }) => void
  onSubmit?: (event: { preventDefault: () => void }) => void
}
function elements(children: ReactNode): ReactElement<Props>[] {
  return Children.toArray(children).flatMap((child) => isValidElement<Props>(child)
    ? [child, ...elements(child.props.children)] : [])
}
function render(component: () => ReactNode = AdminConstructor) {
  hooks.stateIndex = 0
  hooks.refIndex = 0
  return elements(component())
}
beforeEach(() => {
  hooks.state = []; hooks.refs = []; hooks.request.mockReset()
  hooks.request.mockResolvedValue(new Response(JSON.stringify({ ok: true, id: 'test-agent' })))
})

afterEach(() => vi.unstubAllEnvs())
describe('specialist creation sends the effort selected in the actual form', () => {
  it.each([[false, 'low'], [true, 'high']] as const)('deep reasoning checkbox %s submits explicit %s', async (checked, effort) => {
    let tree = render()
    tree.find((node) => node.props.placeholder === 'Numele agentului')!.props.onChange!({ target: { value: 'Test agent' } })
    tree = render()
    tree.find((node) => node.props.placeholder === 'Rolul și limitele agentului')!.props.onChange!({ target: { value: 'A sufficiently detailed specialist role' } })
    tree = render()
    const label = tree.find((node) => node.type === 'label' && Children.toArray(node.props.children)
      .some((child) => typeof child === 'string' && child.includes('Raționament aprofundat')))!
    const checkbox = elements(label.props.children).find((node) => node.props.type === 'checkbox')!
    checkbox.props.onChange!({ target: { checked } })
    tree = render()
    const form = tree.find((node) => node.type === 'form' && elements(node.props.children)
      .some((child) => child.props.placeholder === 'Rolul și limitele agentului'))!
    form.props.onSubmit!({ preventDefault: vi.fn() })
    await vi.waitFor(() => expect(hooks.request).toHaveBeenCalledTimes(1))
    const [path, options] = hooks.request.mock.calls[0]!
    expect(path).toBe('/api/enterprise/agent-nou')
    expect(options.method).toBe('POST')
    expect(JSON.parse(options.body)).toEqual({
      nume: 'Test agent', rol: 'A sufficiently detailed specialist role', efort: effort,
    })
  })
})

describe('Constructor operational times share the London formatter without conflating events', () => {
  it.each([
    ['2026-09-05T07:20:00.000Z', '2026-09-05 08:20 BST (London)'],
    ['2026-01-05T07:20:00.000Z', '2026-01-05 07:20 GMT (London)'],
  ])('keeps verified, updated, timeline and heartbeat instants in London: %s', (at, label) => {
    vi.stubEnv('TZ', 'Pacific/Honolulu')
    render()
    hooks.state[0] = [{
      id: 7, status: 'running', constructorStage: 'working', orderText: 'Measured repair',
      updatedAt: at, tokens: 0, prUrl: null, retryable: false, deletable: false,
      continuity: {
        state: 'running', checkpoint: 'working', message: 'Reported work',
        finalProof: { complete: false }, activity: [{ id: 'event', label: 'Measured event', state: 'current', percent: null, at }],
      },
      workCard: {
        id: 'job-7', objective: 'Measured repair', owner: null, actor: null,
        progress: { source: 'unavailable' }, heartbeatAt: at, evidence: { eventCount: 1 },
        acceptanceCriteria: [], contextLinks: [], finalResult: null,
      },
    }]
    const modelIndex = hooks.state.indexOf('necitit', 1)
    expect(modelIndex).toBeGreaterThan(0)
    hooks.state[modelIndex] = { state: 'ready', model: { label: 'Verified engine', id: 'test/model' }, verifiedAt: at }
    const times = render().filter((element) => element.type === 'time')
    expect(times).toHaveLength(4)
    for (const time of times) {
      expect(time.props.dateTime).toBe(at)
      expect(Children.toArray(time.props.children).join('')).toContain(label)
    }
    hooks.state = ['necitit', { worker: { state: 'ready', lastHeartbeat: at } }, 'necitit']
    hooks.refs = []
    const heartbeat = render(AdminCreier).find((element) => element.type === 'time')!
    expect(heartbeat.props.dateTime).toBe(at)
    expect(heartbeat.props.children).toBe(label)
  })
})
