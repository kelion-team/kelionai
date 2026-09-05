import { describe, expect, it } from 'vitest'
import { parseStoresData } from './lib/admin'

describe('admin stores API contract', () => {
  it('accepts the current server response without an obsolete downloads ledger', () => {
    expect(parseStoresData({
      stores: [{
        key: 'linux',
        name: 'Linux',
        store: 'Web app',
        url: 'https://kelionai.app/health',
        listed: true,
        reason: null,
        checkedAt: '2026-09-05T08:00:00Z',
      }],
    })).toEqual({
      stores: [{
        key: 'linux',
        name: 'Linux',
        store: 'Web app',
        url: 'https://kelionai.app/health',
        listed: true,
        reason: null,
        checkedAt: '2026-09-05T08:00:00Z',
      }],
    })
  })

  it('fails closed when a store row has an invalid shape', () => {
    expect(parseStoresData({ stores: [{ key: 'linux', listed: 'yes' }] })).toBeNull()
  })
  it('retains unknown measurements without converting them to false', () => {
    const store = { key: 'example', name: 'Example', store: 'Store', url: 'https://example.test', listed: null, reason: 'http_503', checkedAt: '2026-09-05T08:00:00Z' }
    expect(parseStoresData({ stores: [store] })?.stores[0].listed).toBeNull()
    expect(parseStoresData({ stores: [{ ...store, reason: null }] })).toBeNull()
    expect(parseStoresData({ stores: [{ ...store, checkedAt: 'invalid' }] })).toBeNull()
  })
})
