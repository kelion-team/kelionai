/** Buffer efemer strict izolat pe utilizator, cu limite per utilizator și globale. */
export class ScopedSensorBuffer<T extends { ts: number }> {
  private readonly buckets = new Map<string, { items: T[]; touchedAt: number }>()

  constructor(
    private readonly maxPerUser: number,
    private readonly maxUsers: number,
    private readonly expiresMs: number,
  ) {}

  private key(email: string): string {
    const key = email.trim().toLowerCase()
    if (!key) throw new Error('sensor_user_missing')
    return key
  }

  private pruneBucket(key: string, now: number): T[] {
    const bucket = this.buckets.get(key)
    if (!bucket) return []
    bucket.items = bucket.items.filter((item) => now - item.ts >= 0 && now - item.ts < this.expiresMs)
    if (!bucket.items.length) {
      this.buckets.delete(key)
      return []
    }
    return bucket.items
  }

  private makeRoom(now: number): void {
    for (const key of this.buckets.keys()) this.pruneBucket(key, now)
    if (this.buckets.size < this.maxUsers) return
    let oldestKey: string | undefined
    let oldest = Number.POSITIVE_INFINITY
    for (const [key, bucket] of this.buckets) {
      if (bucket.touchedAt < oldest) {
        oldest = bucket.touchedAt
        oldestKey = key
      }
    }
    if (oldestKey) this.buckets.delete(oldestKey)
  }

  push(email: string, item: T): void {
    const key = this.key(email)
    const now = Date.now()
    let items = this.pruneBucket(key, now)
    if (!this.buckets.has(key)) this.makeRoom(now)
    items = [...items, item].slice(-this.maxPerUser)
    this.buckets.set(key, { items, touchedAt: now })
  }

  list(email: string): T[] {
    const key = this.key(email)
    const bucket = this.buckets.get(key)
    if (!bucket) return []
    const items = this.pruneBucket(key, Date.now())
    if (items.length) bucket.touchedAt = Date.now()
    return items.map((item) => ({ ...item }))
  }

  clear(): void {
    this.buckets.clear()
  }
}
