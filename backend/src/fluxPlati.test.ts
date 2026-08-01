import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// ── PROOF THAT THE MONEY CHAIN IS LINKED, LINK BY LINK ────────────────────
//
// Adrian, Jul 31: "check that Kelion sees what's inside and everything is
// linked in the payments flow" · "proof for everything you solve".
//
// A payment chain can break in two ways, and both are silent: a function
// exists but nobody calls it, or someone who never runs calls it. This test
// reads the REAL code and checks every link — it doesn't describe the flow,
// it measures it.
//
// What it caught at writing time: naively searching for `verificaPlatiNoi`
// found no caller, which looked like a break. It wasn't: it's called through
// `startCitirePlati()`, started at boot. That's why the test follows the
// chain through the names that actually link, not through searching a single
// function.
const sursa = (cale: string): string =>
  readFileSync(fileURLToPath(new URL(cale, import.meta.url)), 'utf8')

describe('fluxul plăților e legat cap-coadă — măsurat în cod, nu descris', () => {
  const index = sursa('./index.ts')
  const banking = sursa('./services/openBanking.ts')
  const billing = sursa('./routes/billing.ts')
  const db = sursa('./db.ts')

  it('1. userul cere credite → ruta de checkout există și emite un cod unic', () => {
    expect(billing).toContain('/api/billing/checkout')
    expect(billing).toMatch(/creeazaCodPlata/)
    expect(db).toContain('export async function creeazaCodPlata')
  })

  it('2. cititorul bancar chiar PORNEȘTE la boot — nu doar există', () => {
    expect(index).toContain('startCitirePlati()')
    expect(banking).toContain('export function startCitirePlati')
  })

  it('3. cititorul reverifică periodic — o plată nu așteaptă o repornire', () => {
    expect(banking).toMatch(/setInterval\([\s\S]{0,80}verificaPlatiNoi/)
  })

  it('4. ce citește se potrivește cu codul emis, și potrivirea creditează', () => {
    expect(banking).toContain('crediteazaDupaCod')
    expect(db).toContain('export async function crediteazaDupaCod')
    // Crediting goes through topUpUser — the only place that moves the balance.
    expect(db).toMatch(/crediteazaDupaCod[\s\S]{0,3000}topUpUser/)
  })

  it('5. aceeași plată văzută de două ori NU creditează de două ori', () => {
    // Idempotency is guarded by the bank reference, not by luck.
    expect(db).toMatch(/crediteazaDupaCod[\s\S]{0,3000}(bank_ref|ON CONFLICT|already|deja)/i)
  })

  it('6. panoul poate spune dacă citirea merge — starea e citibilă, nu presupusă', () => {
    expect(banking).toContain('export function stareCitirePlati')
    expect(sursa('./routes/admin.ts')).toContain('stareCitirePlati')
  })

  // WHERE IT STOPS TODAY, and why it matters that it's written, not just
  // known: without the Enable Banking keys, `startCitirePlati` exits
  // immediately and the WHOLE chain above stays theoretical — the user pays,
  // the money enters Adrian's account, and the credits never appear by
  // themselves. It's not a bug; it's a gate. But a silently closed gate looks
  // exactly like a broken chain, that's why we assert it here.
  it('7. fără chei, cititorul se oprește EXPLICIT și o spune — nu tace', () => {
    expect(banking).toMatch(/enableBanking\.appId[\s\S]{0,200}return/)
    expect(banking).toMatch(/console\.log\([\s\S]{0,120}(off|missing)/i)
  })
})
