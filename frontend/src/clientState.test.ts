import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  activeClientScope,
  bindClientStateToAccount,
  clearClientAccountScope,
  scopedClientKey,
} from './lib/clientState'
import { adaugaTureSync, citesteAmanate, citesteSyncDurabil, salveazaTureLocale } from './lib/coadaOffline'
import { activateOfflineDatabaseScope, purgeOfflineDatabase, writeLocal } from './lib/offlineStore'

const values = new Map<string, string>()
vi.stubGlobal('localStorage', {
  get length() { return values.size },
  key: (index: number) => [...values.keys()][index] ?? null,
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => void values.set(key, value),
  removeItem: (key: string) => void values.delete(key),
})

const ACCOUNT_A = '11111111-1111-4111-8111-111111111111'
const ACCOUNT_B = '22222222-2222-4222-8222-222222222222'

beforeEach(async () => {
  values.clear()
  await purgeOfflineDatabase()
})

describe('account-scoped sensitive client state', () => {
  it('șterge coada IDB, draftul și scenariul înainte de activarea altui cont', async () => {
    await expect(bindClientStateToAccount(ACCOUNT_A)).resolves.toBe(true)
    await adaugaTureSync([{ rol: 'user', text: 'secret A', t: 1 }])
    await salveazaTureLocale([], {
      sincronizeaza: false,
      amanata: { intrebare: 'email A', t: 2 },
    })
    values.set(scopedClientKey('kelion.draft') as string, 'draft A')
    values.set(scopedClientKey('kelion_scenariu') as string, 'scenario A')

    await expect(bindClientStateToAccount(ACCOUNT_B)).resolves.toBe(true)

    expect(activeClientScope()).toBe(ACCOUNT_B)
    await expect(citesteSyncDurabil()).resolves.toMatchObject({ ok: true, ture: [] })
    await expect(citesteAmanate()).resolves.toEqual([])
    expect([...values.values()].join('\n')).not.toMatch(/secret A|email A|draft A|scenario A/)
  })

  it('logout/ștergere blochează imediat scope-ul și curăță starea sensibilă', async () => {
    await bindClientStateToAccount(ACCOUNT_A)
    await adaugaTureSync([{ rol: 'user', text: 'private', t: 1 }])
    values.set(scopedClientKey('kelion.draft') as string, 'private draft')

    await expect(clearClientAccountScope()).resolves.toBe(true)

    expect(activeClientScope()).toBeNull()
    await expect(citesteSyncDurabil()).resolves.toMatchObject({ ok: false, ture: [] })
    expect([...values.values()].join('\n')).not.toContain('private')
  })

  it('un write vechi nu poate revendica IDB între purge și activarea contului nou', async () => {
    await bindClientStateToAccount(ACCOUNT_A)
    await adaugaTureSync([{ rol: 'user', text: 'A înainte de schimbare', t: 1 }])

    await clearClientAccountScope()
    await expect(writeLocal(ACCOUNT_A, {
      turns: [{ rol: 'user', text: 'write vechi întârziat', t: 2 }],
      queueForSync: true,
    })).resolves.toBeNull()

    await expect(activateOfflineDatabaseScope(ACCOUNT_B)).resolves.toBe(true)
    values.set('kelion.client.active-scope', ACCOUNT_B)
    await expect(citesteSyncDurabil()).resolves.toMatchObject({ ok: true, ture: [] })
  })

  it('refuză emailul sau namespace-ul lipsă', async () => {
    await expect(bindClientStateToAccount('person@example.test')).resolves.toBe(false)
    expect(activeClientScope()).toBeNull()
    expect([...values.values()].join('\n')).not.toContain('person@example.test')
  })

  it('metadata identitară invalidă nu distruge scope-ul curent', async () => {
    await expect(bindClientStateToAccount(ACCOUNT_A)).resolves.toBe(true)
    await adaugaTureSync([{ rol: 'user', text: 'keep after malformed response', t: 1 }])

    await expect(bindClientStateToAccount('')).resolves.toBe(false)
    expect(activeClientScope()).toBe(ACCOUNT_A)
    await expect(citesteSyncDurabil()).resolves.toMatchObject({
      ok: true,
      ture: [{ text: 'keep after malformed response' }],
    })
  })
})
