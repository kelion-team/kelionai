/** Public-page measurement, not proof of installation or store account approval. */
export interface StorePresence {
  key: string
  name: string
  store: string
  url: string
  listed: boolean | null
  reason: string | null
  checkedAt: string
}
