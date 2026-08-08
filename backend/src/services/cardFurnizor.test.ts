import { describe, it, expect } from 'vitest'
import { MARCA_CARD, MARCA_AUTOMAT } from './cardFurnizor.js'

describe('Detectare Card și Plăți Automate (M6)', () => {
  it('identifică corect un card la dosar din pagină (MARCA_CARD)', () => {
    // Ce așteptăm să citim pe paginile furnizorilor conform M6
    expect(MARCA_CARD.test('Visa •••• 4242')).toBe(true)
    expect(MARCA_CARD.test('ending in 1234')).toBe(true)
    expect(MARCA_CARD.test('card on file')).toBe(true)
    expect(MARCA_CARD.test('payment method added')).toBe(true)
    expect(MARCA_CARD.test('payment method on file')).toBe(true)
    expect(MARCA_CARD.test('se termină în 9999')).toBe(true)
    expect(MARCA_CARD.test('**** 5678')).toBe(true)
    expect(MARCA_CARD.test('x x x x 0000')).toBe(true)

    // Negative
    expect(MARCA_CARD.test('no payment method')).toBe(false)
    expect(MARCA_CARD.test('add a card')).toBe(false)
  })

  it('identifică corect reîncărcarea automată pornită (MARCA_AUTOMAT)', () => {
    // Expresiile de reîncărcare automată specificate
    expect(MARCA_AUTOMAT.test('Auto-recharge enabled')).toBe(true)
    expect(MARCA_AUTOMAT.test('auto recharge')).toBe(true)
    expect(MARCA_AUTOMAT.test('auto-reload is on')).toBe(true)
    expect(MARCA_AUTOMAT.test('automatic payments')).toBe(true)
    expect(MARCA_AUTOMAT.test('recurring billing')).toBe(true)
    expect(MARCA_AUTOMAT.test('plăți automate')).toBe(true)
    expect(MARCA_AUTOMAT.test('auto top-up')).toBe(true)

    // Negative
    expect(MARCA_AUTOMAT.test('manual payment')).toBe(false)
    expect(MARCA_AUTOMAT.test('turn on automatic')).toBe(false) // Deși conține 'automatic', nu e 'automatic payments', dar regexul prinde 'automatic' urmat de 'payments'
  })
})
