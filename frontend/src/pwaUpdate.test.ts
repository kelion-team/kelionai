import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

describe('actualizarea PWA controlată', () => {
  it('nu face polling, XHR, hard reset sau ștergere de storage/cache', () => {
    const source = readFileSync(join(here, 'lib/updateCheck.ts'), 'utf8')
    expect(source).toContain('registration.update()')
    expect(source).toContain("waiting.postMessage('kelion-activate-update')")
    expect(source).not.toMatch(/api\/version|XMLHttpRequest|localStorage\.clear|sessionStorage\.clear|caches\.delete|setInterval/)
  })

  it('workerul așteaptă acordul UI și păstrează cache-urile modelelor', () => {
    const sw = readFileSync(join(here, '../public/sw.js'), 'utf8')
    const install = sw.slice(sw.indexOf("self.addEventListener('install'"), sw.indexOf("self.addEventListener('activate'"))
    expect(install).not.toContain('skipWaiting')
    expect(sw).toContain("e.data === 'kelion-activate-update'")
    expect(sw).toContain('e.waitUntil(self.skipWaiting())')
    expect(sw).toContain("const eModelOffline = (k) => k.startsWith('webllm/') || k === 'transformers-cache'")
  })
})
