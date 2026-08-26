import { describe, it, expect, vi, beforeEach } from 'vitest'
import { notifyAdmin, getAdminNotifications, markAdminNotificationRead } from './adminNotification.js'
import * as dbModule from '../db.js'

describe('adminNotification service', () => {
  let mockRows: any[] = []
  let mockQuery: any

  beforeEach(() => {
    mockRows = []
    mockQuery = vi.fn().mockImplementation((sql: string, params?: any[]) => {
      if (sql.includes('CREATE TABLE')) {
        return Promise.resolve({ rows: [] })
      }
      if (sql.includes('INSERT INTO admin_notifications')) {
        const id = mockRows.length + 1
        const newRow = {
          id,
          type: params?.[0],
          title: params?.[1],
          message: params?.[2],
          payload: params?.[3] ? JSON.parse(params[3]) : null,
          read: false,
          createdAt: new Date().toISOString()
        }
        mockRows.push(newRow)
        return Promise.resolve({ rows: [{ id }] })
      }
      if (sql.includes('SELECT id, type, title')) {
        let result = [...mockRows]
        if (sql.includes('WHERE read = FALSE')) {
          result = result.filter(r => !r.read)
        }
        return Promise.resolve({ rows: result })
      }
      if (sql.includes('UPDATE admin_notifications')) {
        const id = params?.[0]
        const item = mockRows.find(r => r.id === id)
        if (item) {
          item.read = true
          return Promise.resolve({ rowCount: 1 })
        }
        return Promise.resolve({ rowCount: 0 })
      }
      return Promise.resolve({ rows: [] })
    })

    vi.spyOn(dbModule, 'dbEnabled').mockReturnValue(true)
    vi.spyOn(dbModule, 'getPool').mockReturnValue({
      query: mockQuery
    } as any)
  })

  it('notifies admin when a written (scris) request arrives', async () => {
    const id = await notifyAdmin('scris', 'Cerere nouă scrisă', 'Mesaj de la utilizator: Vreau suport', { userId: '123' })
    expect(id).toBe(1)
    expect(mockQuery).toHaveBeenCalled()
  })

  it('notifies admin when a voice (voce) request arrives', async () => {
    const id = await notifyAdmin('voce', 'Cerere vocală nouă', 'Apel vocal primit de la +40700000000', { phone: '+40700000000' })
    expect(id).toBe(1)
  })

  it('notifies admin when an unassigned payment (plata_neatribuita) arrives', async () => {
    const id = await notifyAdmin('plata_neatribuita', 'Plată neatribuită', 'Tranzacție nouă de 100 RON fără cod identificat', { amount: 100, currency: 'RON' })
    expect(id).toBe(1)
  })

  it('retrieves and updates notifications correctly', async () => {
    await notifyAdmin('scris', 'Test 1', 'Mesaj 1')
    await notifyAdmin('voce', 'Test 2', 'Mesaj 2')

    const list = await getAdminNotifications()
    expect(list).toHaveLength(2)

    const marked = await markAdminNotificationRead(1)
    expect(marked).toBe(true)

    const unread = await getAdminNotifications(50, true)
    expect(unread).toHaveLength(1)
    expect(unread?.[0]?.title).toBe('Test 2')
  })
})
