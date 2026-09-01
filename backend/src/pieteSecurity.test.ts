import { afterEach, describe, expect, it, vi } from 'vitest'
import { cererePiata, dateBinance, dateStooq, dateYahoo } from './services/piete.js'

const jsonResponse = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), {
  ...init,
  headers: { 'content-type': 'application/json', ...init.headers },
})

describe('market data trust boundary', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('accepts only explicit symbols and supported intervals', () => {
    expect(cererePiata(' btcusdt ', '1h')).toEqual({ simbol: 'BTCUSDT', interval: '1h' })
    expect(cererePiata('BTCUSDT<script>', '1h')).toEqual({ error: 'simbol invalid' })
    expect(cererePiata('A'.repeat(15), '1h')).toEqual({ error: 'simbol invalid' })
    expect(cererePiata('BTCUSDT', '5m')).toEqual({ error: 'interval invalid' })
  })

  it('marks a verified Binance result as the only live-feed-capable asset', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ lastPrice: '102.5', priceChangePercent: '1.25' }))
      .mockResolvedValueOnce(jsonResponse([
        [1_700_000_000_000, '100', '103', '99', '101', '12'],
        [1_700_003_600_000, '101', '104', '100', '102.5', '14'],
      ]))
    vi.stubGlobal('fetch', fetchMock)

    const result = await dateBinance('BTCUSDT', '1h')
    expect(result).toMatchObject({
      simbol: 'BTCUSDT',
      assetClass: 'crypto',
      intervalMode: 'intraday',
      liveFeed: { provider: 'binance', symbol: 'BTCUSDT' },
      pret: 102.5,
    })
  })

  it('rejects malformed or unbounded Binance bodies instead of trusting provider JSON', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { headers: { 'content-type': 'text/html' } }))
      .mockResolvedValueOnce(jsonResponse([]))
    vi.stubGlobal('fetch', fetchMock)
    await expect(dateBinance('BTCUSDT', '1h')).resolves.toMatchObject({ error: expect.stringContaining('content_type_invalid') })

    fetchMock.mockReset()
      .mockResolvedValueOnce(jsonResponse({}, { headers: { 'content-length': String(64 * 1024) } }))
      .mockResolvedValueOnce(jsonResponse([]))
    await expect(dateBinance('BTCUSDT', '1h')).resolves.toMatchObject({ error: expect.stringContaining('response_too_large') })
  })

  it('never authorises a browser live feed for Yahoo market data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(jsonResponse({
      chart: {
        result: [{
          meta: { regularMarketPrice: 12, chartPreviousClose: 10 },
          timestamp: [1_700_000_000, 1_700_003_600],
          indicators: { quote: [{ open: [10, 11], high: [12, 13], low: [9, 10], close: [11, 12], volume: [5, 6] }] },
        }],
        error: null,
      },
    })))
    const result = await dateYahoo('AAPL.US', '1h')
    expect(result).toMatchObject({ assetClass: 'market', intervalMode: 'intraday', liveFeed: null, pret: 12 })
  })

  it('bounds and validates Stooq CSV and labels its daily-only capability', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(
      'Date,Open,High,Low,Close,Volume\n2026-08-20,10,12,9,11,5\n2026-08-21,11,13,10,12,6\n',
      { headers: { 'content-type': 'text/csv' } },
    )))
    const result = await dateStooq('AAPL.US')
    expect(result).toMatchObject({ assetClass: 'market', intervalMode: 'daily-only', liveFeed: null, pret: 12 })
  })
})
