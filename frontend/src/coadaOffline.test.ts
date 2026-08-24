import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  adaugaIstoricLocal,
  adaugaTureSync,
  anuntAmanat,
  aplicaRezultatSync,
  citesteAmanate,
  citesteIstoricLocal,
  citesteSyncDurabil,
  citesteTureRespinse,
  finalizeazaAmanataAmbigua,
  marcheazaAmanataNotificata,
  necesitaNet,
  salveazaTureLocale,
  stergeAmanata,
} from './lib/coadaOffline'
import { bindClientStateToAccount } from './lib/clientState'
import { purgeOfflineDatabase } from './lib/offlineStore'

const ACCOUNT = '11111111-1111-4111-8111-111111111111'
const values = new Map<string, string>()
vi.stubGlobal('localStorage', {
  get length() { return values.size },
  key: (index: number) => [...values.keys()][index] ?? null,
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => void values.set(key, value),
  removeItem: (key: string) => void values.delete(key),
  clear: () => values.clear(),
})

beforeEach(async () => {
  values.clear()
  await purgeOfflineDatabase()
  await bindClientStateToAccount(ACCOUNT)
})

async function syncTurns() {
  return (await citesteSyncDurabil()).ture
}

async function addTurn(turn: { rol: 'user' | 'assistant'; text: string; t: number }) {
  return (await adaugaTureSync([turn]))?.[0] ?? null
}

async function addDeferred(request: { intrebare: string; t: number }) {
  return (await salveazaTureLocale([], {
    sincronizeaza: false,
    amanata: request,
  }))?.amanata ?? null
}

describe('offline intent helpers', () => {
  it('separă cererile de rețea de conversația locală', () => {
    expect(necesitaNet('caută vremea în Londra')).toBe(true)
    expect(necesitaNet('trimite un email lui Adrian')).toBe(true)
    expect(necesitaNet('care e cursul valutar acum')).toBe(true)
    expect(necesitaNet('dă-mi ruta spre casă')).toBe(true)
    expect(necesitaNet('salut, ce faci?')).toBe(false)
    expect(necesitaNet('spune-mi o glumă')).toBe(false)
    expect(necesitaNet('')).toBe(false)
  })

  it('anunță civilizat răspunsul amânat', () => {
    const result = anuntAmanat('care e vremea?', 'E însorit, 22°C.', 'ro')
    expect(result).toContain('Îți pot spune acum')
    expect(result).toContain('care e vremea?')
    expect(result).toContain('E însorit, 22°C.')
  })
})

describe('IndexedDB history/outbox', () => {
  it('ACK-ul scoate numai outbox-ul și păstrează memoria locală', async () => {
    const first = await addTurn({ rol: 'user', text: 'salut offline', t: 1 })
    const second = await addTurn({ rol: 'assistant', text: 'sunt cu tine', t: 2 })
    expect(await syncTurns()).toHaveLength(2)
    expect(first?.id).toMatch(/^[0-9a-f-]{36}$/i)

    await expect(aplicaRezultatSync({
      ok: true,
      clientStorageId: ACCOUNT,
      ackedIds: [first!.id],
      rejected: [],
    }, [first!], ACCOUNT)).resolves.toEqual({ ok: true, acked: 1, quarantined: 0 })

    expect(await syncTurns()).toEqual([second])
    expect((await citesteIstoricLocal()).map((turn) => turn.text)).toEqual([
      'salut offline',
      'sunt cu tine',
    ])
  })

  it('acceptă numai un rezultat terminal exact pentru lotul trimis', async () => {
    const [first, second] = (await adaugaTureSync([
      { rol: 'user', text: 'unu', t: 1 },
      { rol: 'assistant', text: 'doi', t: 2 },
    ]))!
    await expect(aplicaRezultatSync({
      ok: true, clientStorageId: ACCOUNT, ackedIds: [first.id], rejected: [],
    }, [first, second], ACCOUNT)).resolves.toMatchObject({ ok: false })
    await expect(aplicaRezultatSync({
      ok: true, clientStorageId: ACCOUNT, ackedIds: [first.id, crypto.randomUUID()], rejected: [],
    }, [first, second], ACCOUNT)).resolves.toMatchObject({ ok: false })
    await expect(aplicaRezultatSync({
      ok: true, clientStorageId: ACCOUNT, ackedIds: [second.id, first.id], rejected: [],
    }, [first, second], ACCOUNT)).resolves.toEqual({ ok: true, acked: 2, quarantined: 0 })
  })

  it('scrie atomic user + cerere amânată, apoi assistant separat', async () => {
    const saved = await salveazaTureLocale(
      [{ rol: 'user', text: 'care este vremea?', t: 100 }],
      { sincronizeaza: true, amanata: { intrebare: 'care este vremea?', t: 100 } },
    )
    expect(saved?.ture).toHaveLength(1)
    expect(saved?.amanata?.intrebare).toBe('care este vremea?')
    await addTurn({ rol: 'assistant', text: 'verific la reconectare', t: 101 })
    expect((await syncTurns()).map((turn) => turn.rol)).toEqual(['user', 'assistant'])
    expect(await citesteAmanate()).toHaveLength(1)
  })

  it('nu pierde append-uri concurente între taburi/tranzacții', async () => {
    const left = Array.from({ length: 300 }, (_, index) => ({
      rol: 'user' as const, text: `A-${index}`, t: index + 1,
    }))
    const right = Array.from({ length: 300 }, (_, index) => ({
      rol: 'assistant' as const, text: `B-${index}`, t: index + 1_000,
    }))
    await Promise.all([adaugaTureSync(left), adaugaTureSync(right)])
    const stored = await syncTurns()
    expect(stored).toHaveLength(600)
    expect(new Set(stored.map((turn) => turn.text)).size).toBe(600)
  })

  it('migrează legacy exact o dată și elimină JSON-ul monolitic', async () => {
    const legacyKey = `kelion.offline.sync:${ACCOUNT}`
    values.set(legacyKey, JSON.stringify([
      { id: 'legacy', rol: 'user', text: 'o singură dată', t: 1 },
    ]))
    const firstRead = await syncTurns()
    const secondRead = await syncTurns()
    expect(firstRead).toHaveLength(1)
    expect(secondRead).toEqual(firstRead)
    expect(firstRead[0].id).toMatch(/^[0-9a-f-]{36}$/i)
    expect(values.has(legacyKey)).toBe(false)
  })

  it('respinge supradimensionarea înainte de outbox și nu rupe scrierea precedentă', async () => {
    await addTurn({ rol: 'user', text: 'păstrat', t: 1 })
    await expect(adaugaTureSync([
      { rol: 'user', text: 'x'.repeat(8_001), t: 2 },
      { rol: 'assistant', text: 'nu trebuie să intre', t: 3 },
    ])).resolves.toBeNull()
    expect((await syncTurns()).map((turn) => turn.text)).toEqual(['păstrat'])
  })

  it('păstrează numai 120 de ture sincronizate, dar nu taie outbox-ul pending', async () => {
    const online = Array.from({ length: 140 }, (_, index) => ({
      rol: (index % 2 ? 'assistant' : 'user') as 'user' | 'assistant',
      text: `online-${index}`,
      t: index + 1,
    }))
    await adaugaIstoricLocal(online)
    expect(await citesteIstoricLocal()).toHaveLength(120)
    await adaugaTureSync(Array.from({ length: 130 }, (_, index) => ({
      rol: 'user' as const, text: `pending-${index}`, t: 1_000 + index,
    })))
    expect(await syncTurns()).toHaveLength(130)
    expect((await citesteIstoricLocal()).filter((turn) => turn.text.startsWith('pending-'))).toHaveLength(130)
  })

  it('mută poison în quarantine fără să-l șteargă din istoric', async () => {
    const poison = (await addTurn({ rol: 'user', text: 'vechi', t: 1 }))!
    await expect(aplicaRezultatSync({
      ok: true,
      clientStorageId: ACCOUNT,
      ackedIds: [],
      rejected: [{ id: poison.id, code: 'timestamp_too_old', retryable: false }],
    }, [poison], ACCOUNT)).resolves.toEqual({ ok: true, acked: 0, quarantined: 1 })
    expect(await syncTurns()).toEqual([])
    expect(await citesteTureRespinse()).toMatchObject([{ id: poison.id, code: 'timestamp_too_old' }])
    expect(await citesteIstoricLocal()).toMatchObject([{ id: poison.id, text: 'vechi' }])
  })
})

describe('deferred requests', () => {
  it('citește, marchează notificarea o singură dată și șterge punctual', async () => {
    const first = (await addDeferred({ intrebare: 'vremea?', t: 100 }))!
    const second = (await addDeferred({ intrebare: 'știrile?', t: 200 }))!
    expect(await citesteAmanate()).toHaveLength(2)
    expect(first.id).not.toBe(second.id)
    await expect(marcheazaAmanataNotificata(first.id)).resolves.toBe(true)
    expect((await citesteAmanate()).find((item) => item.id === first.id)?.notifiedAt).toBeTypeOf('number')
    await stergeAmanata(first.id)
    expect(await citesteAmanate()).toMatchObject([{ intrebare: 'știrile?' }])
  })

  it('păstrează retry-ul sigur, dar oprește replay-ul ambiguu', async () => {
    const request = (await addDeferred({ intrebare: 'trimite emailul', t: 300 }))!
    await expect(finalizeazaAmanataAmbigua(request.id, 'server_down')).resolves.toBe(false)
    expect(await citesteAmanate()).toEqual([request])
    await expect(finalizeazaAmanataAmbigua(request.id, 'turn_result_indeterminate')).resolves.toBe(true)
    expect(await citesteAmanate()).toEqual([])
  })
})
