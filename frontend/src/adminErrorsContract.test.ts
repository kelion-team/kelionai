import { describe, expect, it } from 'vitest'
import { parseEroriAdmin } from './lib/admin'

describe('Admin Errors fail-closed contract', () => {
  it('acceptă liste goale numai când ambele surse sunt prezente explicit', () => {
    expect(parseEroriAdmin({ browser: [], sistem: [] })).toEqual({ browser: [], sistem: [] })
  })

  it('nu transformă o sursă lipsă sau un rând invalid în zero erori', () => {
    expect(parseEroriAdmin({ browser: [] })).toBeNull()
    expect(parseEroriAdmin({ sistem: [] })).toBeNull()
    expect(parseEroriAdmin({ browser: null, sistem: [] })).toBeNull()
    expect(parseEroriAdmin({
      browser: [{ text: 'boom', severitate: 'critic' }],
      sistem: [],
    })).toBeNull()
  })

  it('acceptă forma completă măsurată de backend', () => {
    const payload = {
      browser: [{
        text: 'boom',
        ceEste: 'eroare client',
        severitate: 'critic',
        categorie: 'Browser',
        cate: 2,
        cine: null,
        cand: '2026-08-26T12:00:00.000Z',
      }],
      sistem: [{
        sursa: 'ordin',
        text: 'ordin eșuat',
        ceEste: 'constructor',
        severitate: 'important',
        categorie: 'Constructor',
      }],
    }
    expect(parseEroriAdmin(payload)).toEqual(payload)
  })
})
