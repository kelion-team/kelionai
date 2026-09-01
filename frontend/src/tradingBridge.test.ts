import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { postTradingMessage, trustedTradingMessage } from './lib/tradingBridge'

const aici = dirname(fileURLToPath(import.meta.url))

function fixture() {
  const postMessage = vi.fn()
  const contentWindow = { postMessage } as unknown as Window
  const iframe = { contentWindow } as HTMLIFrameElement
  const querySelector = vi.fn().mockReturnValue(iframe)
  const doc = { querySelector } as unknown as Document
  return { contentWindow, doc, postMessage, querySelector }
}

describe('trading iframe bridge', () => {
  it('acceptă numai originul aplicației și contentWindow-ul iframe-ului Trading', () => {
    const { contentWindow, doc } = fixture()
    const origin = 'https://kelion.example'
    expect(trustedTradingMessage({ origin, source: contentWindow }, origin, doc)).toBe(true)
    expect(trustedTradingMessage({ origin: 'https://evil.example', source: contentWindow }, origin, doc)).toBe(false)
    expect(trustedTradingMessage({ origin, source: {} as Window }, origin, doc)).toBe(false)
  })

  it('trimite numai către iframe-ul Trading etichetat', () => {
    const { doc, postMessage, querySelector } = fixture()
    expect(postTradingMessage({ kelion: 'niveluri' }, 'https://kelion.example', doc)).toBe(true)
    expect(querySelector).toHaveBeenCalledWith('iframe.workspace-frame[data-kelion-kind="tranzactii"]')
    expect(postMessage).toHaveBeenCalledWith({ kelion: 'niveluri' }, 'https://kelion.example')
  })

  it('MonitorPagina etichetează iframe-ul cu kind-ul validat', () => {
    const stage = readFileSync(join(aici, 'pages/Stage.tsx'), 'utf8')
    expect(stage).toContain('data-kelion-kind={kind}')
  })
})
