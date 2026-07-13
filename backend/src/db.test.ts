import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock pg Pool before importing db.ts so we can control the query results.
const queryMock = vi.fn()
const connectMock = vi.fn()

vi.mock('pg', () => ({
  default: {
    Pool: class MockPool {
      query = queryMock
      connect = connectMock
    },
  },
}))

// Mock config so dbEnabled() returns true without needing a real DATABASE_URL.
vi.mock('./config.js', () => ({
  config: {
    databaseUrl: 'postgres://test:test@localhost/test',
    isProd: false,
  },
}))

import { finalizeAllWorkOrders, saveWorkOrder } from './db.js'

describe('Work order bulk finalize', () => {
  beforeEach(() => {
    queryMock.mockReset()
  })

  it('finalizeAllWorkOrders marks every non-terminal order as finalized', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ n: '3' }] })
    const count = await finalizeAllWorkOrders()
    expect(count).toBe(3)
    const sql = queryMock.mock.calls[0]![0] as string
    expect(sql).toContain('UPDATE work_orders')
    expect(sql).toContain("status='finalized'")
    expect(sql).toContain("status NOT IN ('certified','finalized')")
  })

  it('saveWorkOrder inserts a new pending order', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] })
    await saveWorkOrder('job-1', 'test order')
    const [sql, params] = queryMock.mock.calls[0]!
    expect(sql).toContain('INSERT INTO work_orders')
    expect(params).toEqual(['job-1', 'test order'])
  })
})
