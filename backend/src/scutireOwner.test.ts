// ── THE OWNER NEVER DEBITS HIMSELF — EVERYWHERE (PR #648, completed) ──────
//
// PR #648 (Aug 2) killed the Jul 25 "everyone pays, even the admin" rule with
// live proof: the admin's own testing drained £5.73 of voice from his own
// wallet in one morning. But it only fixed the VOICE path (realtime.ts). The
// CHAT path kept debiting the owner — the same hole, one screen over: every
// paid chat turn (and every errored turn whose tools had already cost money)
// would have kept draining the admin wallet.
//
// The owner's model: users pay credits, the providers are on the free tier —
// that difference IS his margin. His own usage is RECORDED (recordCost — the
// Money tab keeps honest visibility) but never DEBITED.
//
// This test is source-pattern (like voceAutovindecare.test.ts): the debit
// sites live deep inside a streaming route, and what matters is that BOTH of
// them carry the guard — a booted server would test one path and miss the
// other.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const chat = readFileSync(fileURLToPath(new URL('./routes/chat.ts', import.meta.url)), 'utf8')
const realtime = readFileSync(fileURLToPath(new URL('./routes/realtime.ts', import.meta.url)), 'utf8')

describe('scutirea ownerului (PR #648) e completă — chat + voce', () => {
  it('predicatul unic există și e corect (email === config.adminEmail)', () => {
    expect(chat).toMatch(/export const isOwnerEmail = \(email: string\): boolean => email\.toLowerCase\(\) === config\.adminEmail/)
  })

  it('debitul de chat NORMAL nu lovește ownerul', () => {
    expect(chat).toMatch(/if \(cost > 0 && !isOwnerEmail\(user\.email\)\) \{\s*void debitWallet\(user\.email, cost, `chat:/)
  })

  it('debitul de chat pe EROARE nu lovește ownerul', () => {
    // The error path used to debit unconditionally — tools already run in the
    // turn cost money, and the owner's errored turns drained his wallet too.
    expect(chat).toMatch(/if \(usage\.usd > 0 && !isOwnerEmail\(user\.email\)\) void debitWallet\(user\.email, usage\.usd, `chat-err:/)
  })

  it('NICIUN debitWallet din chat.ts nu mai e neprotejat', () => {
    const all = chat.split('\n')
    const idxs = all
      .map((l, i) => ({ l, i }))
      .filter(({ l }) => l.includes('debitWallet(') && !l.trim().startsWith('//') && !l.includes('import'))
    expect(idxs.length).toBeGreaterThan(0)
    for (const { i } of idxs) {
      // The guard may sit on the same line or on the enclosing `if` just above.
      const window = all.slice(Math.max(0, i - 2), i + 1).join('\n')
      expect(window).toMatch(/!isOwnerEmail\(user\.email\)/)
    }
  })

  it('recordCost rămâne NEcondiționat — vizibilitate reală în Money tab', () => {
    // The Aug 2 rule: "usage is still RECORDED for the Money tab, never
    // DEBITED from the owner". If recordCost got the same guard, the owner's
    // cost view would silently go blind.
    const recordLines = chat.split('\n').filter((l) => l.includes('recordCost(user.email'))
    expect(recordLines.length).toBeGreaterThan(0)
    for (const l of recordLines) expect(l).not.toMatch(/isOwnerEmail/)
  })

  it('calea de voce (realtime.ts) păstrează scutirea din PR #648', () => {
    expect(realtime).toMatch(/const isOwner = user\.email\.toLowerCase\(\) === config\.adminEmail/)
    expect(realtime).toMatch(/if \(!isOwner\) void debitWallet/)
  })
})
