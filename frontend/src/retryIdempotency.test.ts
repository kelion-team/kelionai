import { describe, expect, it } from 'vitest'
import { createRetryIdempotencyLease } from './lib/retryIdempotency'

describe('idempotency for retried user actions', () => {
  it('reuses the key only while retrying the same unfinished action', () => {
    const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333']
    const lease = createRetryIdempotencyLease(() => ids.shift() as string)

    const first = lease.keyFor('same payload')
    expect(lease.keyFor('same payload')).toBe(first)
    expect(lease.keyFor('changed payload')).toBe('22222222-2222-4222-8222-222222222222')

    lease.complete('changed payload')
    expect(lease.keyFor('changed payload')).toBe('33333333-3333-4333-8333-333333333333')
  })

  it('keeps upload and adaptation attempts in independent leases', () => {
    const adapt = createRetryIdempotencyLease(() => '11111111-1111-4111-8111-111111111111')
    const upload = createRetryIdempotencyLease(() => '22222222-2222-4222-8222-222222222222')
    expect(adapt.keyFor('cv + job')).toBe(adapt.keyFor('cv + job'))
    expect(upload.keyFor('file digest')).toBe(upload.keyFor('file digest'))
    expect(adapt.keyFor('cv + job')).not.toBe(upload.keyFor('file digest'))
  })
})
