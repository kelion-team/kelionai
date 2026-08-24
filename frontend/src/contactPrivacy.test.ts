import { describe, expect, it, vi } from 'vitest'
import { redactDiagnostic } from '../../backend/src/shared/diagnosticRedaction'
import { createRetryIdempotencyLease } from './lib/retryIdempotency'

describe('client-side privacy and retry identity', () => {
  it('redacts secrets before a browser diagnostic enters the upload queue', () => {
    const clean = redactDiagnostic('owner@example.com sk-proj-supersecret https://example.com/x?token=bad 10.0.0.5')
    expect(clean).not.toContain('owner@example.com')
    expect(clean).not.toContain('sk-proj-')
    expect(clean).not.toContain('token=bad')
    expect(clean).not.toContain('10.0.0.5')
  })

  it('reuses one contact UUID for retries, rotates after a change, and clears after success', () => {
    const ids = ['123e4567-e89b-42d3-a456-426614174000', '123e4567-e89b-42d3-a456-426614174001', '123e4567-e89b-42d3-a456-426614174002']
    const create = vi.fn(() => ids.shift() ?? '')
    const lease = createRetryIdempotencyLease(create)
    const first = lease.keyFor('same')
    expect(lease.keyFor('same')).toBe(first)
    expect(lease.keyFor('changed')).not.toBe(first)
    lease.complete('changed')
    expect(lease.keyFor('changed')).toBe('123e4567-e89b-42d3-a456-426614174002')
    expect(create).toHaveBeenCalledTimes(3)
  })
})
