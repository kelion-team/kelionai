export interface RetryIdempotencyLease {
  keyFor(signature: string): string
  complete(signature: string): void
}

export function createRetryIdempotencyLease(
  makeUuid: () => string = () => crypto.randomUUID(),
): RetryIdempotencyLease {
  let pending: { signature: string; key: string } | null = null
  return {
    keyFor(signature) {
      if (pending?.signature === signature) return pending.key
      const key = makeUuid()
      pending = { signature, key }
      return key
    },
    complete(signature) {
      if (pending?.signature === signature) pending = null
    },
  }
}
