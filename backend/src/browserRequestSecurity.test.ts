import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const browser = readFileSync(fileURLToPath(new URL('./services/browser.ts', import.meta.url)), 'utf8')
const client = readFileSync(fileURLToPath(new URL('./services/browserWorker.ts', import.meta.url)), 'utf8')
const route = readFileSync(fileURLToPath(new URL('./routes/embedCheck.ts', import.meta.url)), 'utf8')
const worker = readFileSync(fileURLToPath(new URL('../../deploy/browser-worker.mjs', import.meta.url)), 'utf8')
const proxy = readFileSync(fileURLToPath(new URL('../../deploy/browser-egress-proxy.mjs', import.meta.url)), 'utf8')

describe('browser network isolation', () => {
  it('keeps Chromium, DNS and outbound page fetches outside the web process', () => {
    expect(browser).not.toMatch(/from ['"]playwright|node:dns|\bfetch\s*\(/)
    expect(route).not.toMatch(/node:dns|\bfetch\s*\(|documentToMarkdown/)
    expect(browser).toContain("callBrowserWorker('/v1/browser/action'")
    expect(route).toContain("callBrowserWorker('/v1/fetch'")
    expect(client).toContain('requestInternalService')
  })

  it('forces the worker through the pinning proxy and authenticates its socket API', () => {
    expect(worker).toContain('createServiceVerifier')
    expect(worker).toContain('proxy: { server: PROXY_URL')
    expect(worker).toContain("serviceWorkers: 'block'")
    expect(worker).toContain('socketPath: FETCH_SOCKET')
    expect(proxy).toContain('resolvePinnedTarget')
  })
})
