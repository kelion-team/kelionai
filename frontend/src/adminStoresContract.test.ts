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
      }],
    })).toEqual({
      stores: [{
        key: 'linux',
        name: 'Linux',
        store: 'Web app',
        url: 'https://kelionai.app/health',
        listed: true,
      }],
    })
  })

  it('fails closed when a store row has an invalid shape', () => {
    expect(parseStoresData({ stores: [{ key: 'linux', listed: 'yes' }] })).toBeNull()
  })
})
