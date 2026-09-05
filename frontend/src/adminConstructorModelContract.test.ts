import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchConstructorModelAdmin } from './lib/admin'
import { parseAdminConstructorModelSnapshot } from './lib/adminConstructorContract'
const model = { id: 'fixture/engine', label: 'Configured engine', provider: 'fixture' }
const ready = {
  mode: 'manual', defaultProfile: 'fast', model,
  profiles: [{ id: 'fast', label: model.label, model: model.id, installed: true }],
  activeProfile: 'fast', activeModel: model.id, state: 'ready', requestedProfile: null,
  requestId: null, verifiedAt: '2026-09-05T05:00:00.000Z', error: null,
}
afterEach(() => vi.unstubAllGlobals())
describe('read-only configured Constructor model', () => {
  it('uses the measured engine identity, not names inferred from fast', () => {
    expect(parseAdminConstructorModelSnapshot(ready)?.model).toEqual(model)
    expect(parseAdminConstructorModelSnapshot({ ...ready, model: null })).toBeNull()
  })
  it.each([
    { mode: 'auto' }, { activeProfile: 'powerful' }, { requestedProfile: 'powerful' },
    { profiles: [...ready.profiles, ready.profiles[0]] }, { activeModel: 'other/model' },
    { verifiedAt: 'yesterday' }, { state: 'switching' }, { token: 'private' },
    { model: { ...model, provider: 'other' } }, { model: { ...model, label: 'bad\nvalue' } },
  ])('rejects contradictory or unsafe payload %j', (overrides) => {
    expect(parseAdminConstructorModelSnapshot({ ...ready, ...overrides })).toBeNull()
  })
  it('keeps unavailable configuration visible without claiming active inference', () => {
    expect(parseAdminConstructorModelSnapshot({
      ...ready, activeProfile: null, activeModel: null, verifiedAt: null,
      state: 'unavailable', error: 'constructor_model_unavailable',
    })?.model).toEqual(model)
  })
  it('reads no-store and does not accept an invalid 200 as a verified engine', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(ready)))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...ready, token: 'private' })))
    vi.stubGlobal('fetch', fetchMock)
    expect((await fetchConstructorModelAdmin())?.activeModel).toBe(model.id)
    expect(await fetchConstructorModelAdmin()).toBeNull()
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/constructor/model', expect.objectContaining({ credentials: 'include', cache: 'no-store' }))
  })
  it('retires manual model buttons and does not relabel historic failures with the current model', () => {
    const panel = readFileSync(new URL('./components/admin/AdminProductie.tsx', import.meta.url), 'utf8')
    expect(panel).toContain('constructorModelSnapshot.model?.label')
    expect(panel).toContain("const profileText = 'profilul rularii'")
    expect(panel).not.toContain('selectConstructorModel')
    expect(panel).not.toContain('switchConstructorModelAdmin')
    expect(panel).not.toContain('constructorModelProfileText(outcome.profile)')
    expect(panel).toContain('<ConstructorJobProgress job={j} />')
    expect(panel).toContain('Agent specializat')
  })
})
