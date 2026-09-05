import { describe, expect, it } from 'vitest'
import {
  parseContactMessagesAdmin,
  parseInboundAdmin,
  parseMailboxLiveAdmin,
  parseNotificariAdmin,
} from './lib/admin'

describe('Admin inbox payload contracts', () => {
  const parsers = [
    { parse: parseInboundAdmin, key: 'emails' },
    { parse: parseContactMessagesAdmin, key: 'messages' },
    { parse: parseNotificariAdmin, key: 'notificari' },
  ] as const

  it('accepts an explicitly measured empty list', () => {
    for (const { parse, key } of parsers) {
      expect(parse({ [key]: [] })).toEqual([])
    }
  })

  it('rejects missing, null, and malformed list fields instead of inventing zero rows', () => {
    for (const { parse, key } of parsers) {
      expect(parse({})).toBeNull()
      expect(parse({ [key]: null })).toBeNull()
      expect(parse({ [key]: 'none' })).toBeNull()
      expect(parse(null)).toBeNull()
    }
  })

  it('preserves rows from a measured array', () => {
    for (const { parse, key } of parsers) {
      expect(parse({ [key]: [{ id: 7 }] })).toEqual([{ id: 7 }])
    }
  })

  it('requires the complete live-mailbox envelope before accepting an empty inbox', () => {
    expect(parseMailboxLiveAdmin({ ok: true, motiv: null, emails: [] }))
      .toEqual({ ok: true, motiv: null, emails: [] })
    expect(parseMailboxLiveAdmin({ ok: false, motiv: 'imap_unavailable', emails: [] }))
      .toEqual({ ok: false, motiv: 'imap_unavailable', emails: [] })

    expect(parseMailboxLiveAdmin({ ok: true, motiv: null })).toBeNull()
    expect(parseMailboxLiveAdmin({ ok: 'true', motiv: null, emails: [] })).toBeNull()
    expect(parseMailboxLiveAdmin({ ok: true, motiv: 7, emails: [] })).toBeNull()
  })
})
