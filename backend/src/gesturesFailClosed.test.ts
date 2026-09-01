import { beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'

const state = vi.hoisted(() => ({
  databaseEnabled: true,
  stored: null as string | null,
  failRead: false,
  failWrite: false,
}))

vi.mock('./config.js', () => ({
  config: {
    get databaseUrl() {
      return state.databaseEnabled ? 'postgres://test' : ''
    },
    adminEmail: 'admin@example.com',
    billing: { currency: 'GBP', policyVersion: 'billing-v1', creditMinor: 10 },
    privacy: { backupRetentionDays: 30, financialRetentionYears: 6 },
  },
}))

vi.mock('./dbPool.js', () => ({
  getPool: vi.fn(() => ({
    query: async (sql: string, params?: unknown[]) => {
      if (sql.includes('SELECT value FROM kv_state')) {
        if (state.failRead) throw new Error('gesture_read_failed')
        return { rows: state.stored === null ? [] : [{ value: state.stored }], rowCount: state.stored === null ? 0 : 1 }
      }
      if (sql.includes('INSERT INTO kv_state')) {
        if (state.failWrite) throw new Error('gesture_write_failed')
        state.stored = String(params?.[1] ?? '')
        return { rows: [], rowCount: 1 }
      }
      return { rows: [], rowCount: 0 }
    },
  })),
  conexiuneDb: vi.fn(),
  starePool: vi.fn(),
  inchidePool: vi.fn(),
}))

const { getDisabledGestures, setDisabledGestures } = await import('./db.js')

beforeEach(() => {
  state.databaseEnabled = true
  state.stored = null
  state.failRead = false
  state.failWrite = false
})

function routeHandler(source: string, method: string, path: string): string {
  const registration = new RegExp(`app\\.${method}\\s*(?:<[\\s\\S]{0,3000}?>)?\\s*\\(\\s*'${path}'`)
  const match = registration.exec(source)
  expect(match, `missing route ${method.toUpperCase()} ${path}`).toBeTruthy()
  const rest = source.slice((match as RegExpExecArray).index + (match as RegExpExecArray)[0].length)
  const next = rest.search(/\n {2}app\.(get|post|put|patch|delete)\b/)
  return next === -1 ? rest : rest.slice(0, next)
}

describe('gesture policy storage is fail-closed', () => {
  it('returns [] only for a successful read with no stored key', async () => {
    await expect(getDisabledGestures()).resolves.toEqual([])
  })

  it('rejects a missing database, failed query or corrupt/non-canonical state', async () => {
    state.databaseEnabled = false
    await expect(getDisabledGestures()).rejects.toThrow('gesture_store_unavailable')

    state.databaseEnabled = true
    state.failRead = true
    await expect(getDisabledGestures()).rejects.toThrow('gesture_read_failed')

    state.failRead = false
    for (const corrupt of ['not-json', '{}', '["ok",7]', '["same","same"]', JSON.stringify(['x'.repeat(41)])]) {
      state.stored = corrupt
      await expect(getDisabledGestures()).rejects.toThrow('gesture_state_invalid')
    }
  })

  it('writes through the strict store and returns the exact canonical value', async () => {
    const result = await setDisabledGestures(['expresie-1', 'expresie-1', 'x'.repeat(41)])
    expect(result).toEqual(['expresie-1', 'x'.repeat(40)])
    expect(state.stored).toBe(JSON.stringify(result))
    await expect(getDisabledGestures()).resolves.toEqual(result)

    state.failWrite = true
    await expect(setDisabledGestures(['dans'])).rejects.toThrow('gesture_write_failed')
    state.failWrite = false
    state.databaseEnabled = false
    await expect(setDisabledGestures(['dans'])).rejects.toThrow('db_unavailable')
  })
})

describe('gesture HTTP/runtime contract is fail-closed', () => {
  it('maps both admin and public read failures to 503', () => {
    const admin = fs.readFileSync(new URL('./routes/admin.ts', import.meta.url), 'utf8')
    const prefs = fs.readFileSync(new URL('./routes/prefs.ts', import.meta.url), 'utf8')
    expect(routeHandler(admin, 'get', '/api/admin/gestures')).toContain("reply.code(503).send({ error: 'gesture_state_unreadable' })")
    expect(routeHandler(prefs, 'get', '/api/gestures/state')).toContain("reply.code(503).send({ error: 'gesture_state_unreadable' })")
  })

  it('requires the exact POST body and verifies storage before invalidating sessions/ACK', () => {
    const admin = fs.readFileSync(new URL('./routes/admin.ts', import.meta.url), 'utf8')
    const handler = routeHandler(admin, 'post', '/api/admin/gestures')
    expect(handler).toContain('Object.keys(body).length !== 1')
    expect(handler).toContain("hasOwnProperty.call(body, 'disabled')")
    expect(handler).toContain("reply.code(400).send({ error: 'invalid_body' })")
    expect(handler).toContain('canonical = await setDisabledGestures(list)')
    expect(handler).toContain('const persisted = await getDisabledGestures()')
    expect(handler).toContain("reply.code(503).send({ error: 'gesture_state_unavailable' })")
    expect(handler.indexOf('canonical = await setDisabledGestures(list)')).toBeLessThan(handler.indexOf('uitaToateSesiunile()'))
    expect(handler.indexOf('uitaToateSesiunile()')).toBeLessThan(handler.indexOf('const persisted = await getDisabledGestures()'))
    expect(handler).toContain('reply.send({ ok: true, disabled: canonical })')
  })

  it('suppresses semantic gestures when the runtime policy read fails', () => {
    const chat = fs.readFileSync(new URL('./routes/chat.ts', import.meta.url), 'utf8')
    expect(chat).toContain('getDisabledGestures().catch(() => [...new Set(Object.values(GESTURE_TO_CLIP))])')
    expect(chat).not.toContain('getDisabledGestures().catch(() => [] as string[])')
  })
})
