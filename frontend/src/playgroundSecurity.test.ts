import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { izoleazaHtmlPlayground } from './lib/workspace'

describe('playground HTML izolat', () => {
  it('păstrează aplicația inline, dar injectează CSP înaintea scriptului', () => {
    const html = izoleazaHtmlPlayground('<script>document.body.dataset.rulat="da"</script><html><head><title>x</title></head></html>')
    expect(html.indexOf('Content-Security-Policy')).toBeLessThan(html.indexOf('<script>'))
    expect(html).toContain("script-src 'unsafe-inline'")
    expect(html).toContain("connect-src 'none'")
    expect(html).toContain("form-action 'none'")
    expect(html).toContain("base-uri 'none'")
    expect(html).toContain("img-src data: blob:")
    expect(html).toContain('document.body.dataset.rulat="da"')
  })

  it('iframe-ul nu acordă origin, formulare, popup-uri sau modale', () => {
    const aici = dirname(fileURLToPath(import.meta.url))
    const stage = readFileSync(join(aici, 'pages/Stage.tsx'), 'utf8')
    const sandboxuri = [...stage.matchAll(/sandbox="([^"]+)"/g)].map((m) => m[1])
    expect(sandboxuri).toContain('allow-scripts allow-pointer-lock')
    for (const sandbox of sandboxuri.filter((s) => s.includes('allow-pointer-lock'))) {
      expect(sandbox).not.toMatch(/allow-same-origin|allow-forms|allow-popups|allow-modals/)
    }
  })
})
