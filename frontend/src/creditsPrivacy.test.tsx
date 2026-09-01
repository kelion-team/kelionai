import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Credits from './pages/Credits'
import { fetchBalance } from './lib/billing'

afterEach(() => vi.unstubAllGlobals())

describe('privacy and integrity of the credits page', () => {
  it('renders an anonymous-safe sign-in state without wallet or ledger content', () => {
    const html = renderToStaticMarkup(<Credits authenticated={false} />)

    expect(html).toContain('Sign in to view your balance')
    expect(html).toContain('href="/login?next=/credite"')
    expect(html).not.toContain('Current balance')
    expect(html).not.toContain('Transaction history')
    expect(html).not.toContain('Secure Revolut checkout')
  })

  it('rejects negative or contradictory wallet snapshots instead of displaying them', async () => {
    const validBase = {
      credits: 12,
      percent: 60,
      currency: 'GBP',
      firstTopUp: false,
      scutit: false,
      debitMinor: 1,
      creditsUsed: 8,
      minorUnit: 2,
      lowCreditPaymentPrompt: null,
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(validBase), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...validBase, credits: -10_280 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ...validBase,
        scutit: true,
        debitMinor: 1,
      }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchBalance()).resolves.toMatchObject({ credits: 12, scutit: false })
    await expect(fetchBalance()).resolves.toBeNull()
    await expect(fetchBalance()).resolves.toBeNull()
  })
})
