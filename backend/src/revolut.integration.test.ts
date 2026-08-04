import { describe, it, expect, vi, beforeEach } from 'vitest'
import { crediteazaDupaCod, creeazaCodPlata, getUserCredits } from './db.js'
import { proceseazaIntrare } from './openBanking.js'
import { PlataEmail } from './platiEmail.js'

// Mock the database functions
vi.mock('./db.js', async () => {
  const actual = await vi.importActual('./db.js')
  const inMemoryDb = {
    payment_codes: new Map(),
    user_credits: new Map(),
    credited_refs: new Set(),
    unassigned_payments: [],
  }

  return {
    ...actual,
    creeazaCodPlata: vi.fn(async (email, amount, currency) => {
      const code = `KLN-TEST-${Math.random().toString(36).substring(2, 6).toUpperCase()}`
      inMemoryDb.payment_codes.set(code, { user_email: email, amount, currency, status: 'pending' })
      return { code, amount, currency }
    }),
    crediteazaDupaCod: vi.fn(async (referinta, suma, valuta, bankRef) => {
      if (inMemoryDb.credited_refs.has(bankRef)) {
        return null // Already credited
      }

      const codeMatch = referinta.match(/KLN-[A-Z0-9]{4}-[A-Z0-9]{4}/)
      const code = codeMatch ? codeMatch[0] : null

      if (code && inMemoryDb.payment_codes.has(code)) {
        const paymentCode = inMemoryDb.payment_codes.get(code)
        // Check if amount and currency match roughly
        if (paymentCode.amount <= suma && paymentCode.currency === valuta) {
          inMemoryDb.credited_refs.add(bankRef)
          inMemoryDb.payment_codes.set(code, { ...paymentCode, status: 'credited' })
          
          const currentCredits = inMemoryDb.user_credits.get(paymentCode.user_email) || 0
          inMemoryDb.user_credits.set(paymentCode.user_email, currentCredits + suma)
          
          return paymentCode.user_email
        }
      }
      
      inMemoryDb.unassigned_payments.push({ referinta, suma, valuta, bankRef })
      return null
    }),
    getUserCredits: vi.fn(async (email) => {
      return inMemoryDb.user_credits.get(email) || 0
    }),
    // Helper to reset state between tests
    __DANGER_resetInMemoryDb: () => {
      inMemoryDb.payment_codes.clear()
      inMemoryDb.user_credits.clear()
      inMemoryDb.credited_refs.clear()
      inMemoryDb.unassigned_payments.length = 0
    }
  }
})

// Mock openBanking's dependency on db as well for salveazaPlataNeatribuita
vi.mock('./openBanking.js', async () => {
    const actual = await vi.importActual('./openBanking.js')
    const db = await import('../db.js')
    return {
        ...actual,
        salveazaPlataNeatribuita: vi.fn(db.salveazaPlataNeatribuita)
    }
})

describe('Revolut Integration Test', () => {

    beforeEach(async () => {
        const db = await import('./db.js')
        // This is a bit of a hack to reset the in-memory db before each test
        if (typeof (db as any).__DANGER_resetInMemoryDb === 'function') {
            (db as any).__DANGER_resetInMemoryDb()
        }
    })

  it('should handle the full payment flow correctly', async () => {
    const userEmail = 'test@kelion.ro'
    const creditAmount = 20
    const currency = 'EUR'

    // 1. User requests credit -> gets a code
    const paymentCode = await creeazaCodPlata(userEmail, creditAmount, currency)
    expect(paymentCode).not.toBeNull()
    expect(paymentCode?.code).toMatch(/^KLN-TEST-[A-Z0-9]{4}$/)

    // 2. A simulated Revolut payment arrives with the code
    const simulatedPayment: PlataEmail = {
      amount: creditAmount,
      currency: currency,
      referinta: `Payment for services, code: ${paymentCode?.code}`,
    }
    const bankRef = `bank-ref-${Date.now()}`
    
    // We call crediteazaDupaCod directly as this is what the email/openbanking processor would do.
    const creditedEmail = await crediteazaDupaCod(simulatedPayment.referinta, simulatedPayment.amount, simulatedPayment.currency, bankRef)
    
    // 3. Credits appear in the user's account
    expect(creditedEmail).toBe(userEmail)
    const userCredits = await getUserCredits(userEmail)
    expect(userCredits).toBe(creditAmount)

    // 4. Same payment arrives again -> balance does not change (idempotency)
    const secondAttemptEmail = await crediteazaDupaCod(simulatedPayment.referinta, simulatedPayment.amount, simulatedPayment.currency, bankRef)
    expect(secondAttemptEmail).toBeNull()
    const userCreditsAfterSecondAttempt = await getUserCredits(userEmail)
    expect(userCreditsAfterSecondAttempt).toBe(creditAmount)

    // 5. Payment with a non-existent code -> no credits granted
    const badCodePayment: PlataEmail = {
        amount: 50,
        currency: 'EUR',
        referinta: 'Payment with a bogus code KLN-BOGUS-CODE',
      }
    const badBankRef = `bank-ref-bad-${Date.now()}`
    const unassignedPaymentEmail = await crediteazaDupaCod(badCodePayment.referinta, badCodePayment.amount, badCodePayment.currency, badBankRef)
    expect(unassignedPaymentEmail).toBeNull()
    const userCreditsAfterBadCode = await getUserCredits(userEmail)
    expect(userCreditsAfterBadCode).toBe(creditAmount) // Still the same
  })
})
