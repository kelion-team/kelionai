import { describe, it, expect } from 'vitest'
import { fetchRecentInbox } from './mailbox.js'

describe('Mailbox service', () => {
  it('returns empty live inbox when mail is not configured', async () => {
    // MAIL_PASS is unset in the test environment, so mailEnabled() is false
    const emails = await fetchRecentInbox(10)
    expect(emails).toEqual([])
  })
})
