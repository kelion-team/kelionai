import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  colecteazaPrecache,
  calePrecache,
  extragePrecache,
  extrageRuntimeOffline,
  injecteazaPrecache,
  urluriLocaleDinIndex,
} from '../scripts/genereaza-precache.mjs'

const aici = dirname(fileURLToPath(import.meta.url))
const temporare: string[] = []

afterEach(() => {
  for (const dir of temporare.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('service worker shell precache', () => {
  it('precache-uiește shell-ul, dar separă runtime-urile offline grele până la consimțământ', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kelion-precache-'))
    temporare.push(dir)
    mkdirSync(join(dir, 'assets'))
    writeFileSync(join(dir, 'index.html'), '<link rel="stylesheet" href="/assets/app-a.css"><script src="/assets/app-a.js"></script>')
    writeFileSync(join(dir, 'assets/app-a.css'), 'body{}')
    writeFileSync(join(dir, 'assets/app-a.js'), 'new Worker("worker-a.js"); const logo = "/google-g-logo.svg"')
    writeFileSync(join(dir, 'assets/worker-a.js'), 'self.onmessage=()=>{}')
    writeFileSync(join(dir, 'google-g-logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
    writeFileSync(join(dir, 'unused.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
    writeFileSync(join(dir, 'assets/offline-runtime-a.js'), 'offline')
    writeFileSync(join(dir, 'assets/urecheaOffline.worker-a.js'), 'worker')
    writeFileSync(join(dir, 'assets/runtime-a.wasm'), 'wasm')
    mkdirSync(join(dir, 'ort'))
    writeFileSync(join(dir, 'ort/runtime.wasm'), 'ort')
    writeFileSync(join(dir, 'ort/runtime.mjs'), 'ort-factory')

    const manifest = colecteazaPrecache(dir)
    expect(manifest.urls.map(calePrecache)).toEqual(expect.arrayContaining([
      '/', '/index.html', '/assets/app-a.css', '/assets/app-a.js',
      '/assets/worker-a.js', '/google-g-logo.svg',
    ]))
    expect(manifest.urls.map(calePrecache)).not.toContain('/unused.svg')
    expect(manifest.urls.map(calePrecache)).not.toEqual(expect.arrayContaining([
      '/assets/offline-runtime-a.js', '/assets/urecheaOffline.worker-a.js',
      '/assets/runtime-a.wasm', '/ort/runtime.wasm', '/ort/runtime.mjs',
    ]))
    expect(manifest.offlineRuntime.map((asset) => calePrecache(asset.url))).toEqual(expect.arrayContaining([
      '/assets/offline-runtime-a.js', '/assets/urecheaOffline.worker-a.js',
      '/assets/runtime-a.wasm', '/ort/runtime.wasm', '/ort/runtime.mjs',
    ]))
    expect(manifest.offlineRuntime.every((asset) =>
      /^[a-f0-9]{64}$/u.test(asset.sha256) && asset.url.endsWith(`?v=${asset.sha256}`) && asset.sizeBytes > 0,
    )).toBe(true)
    const sw = injecteazaPrecache(
      "const SHELL = 'dev' // __KELION_SHELL_VERSION__\nconst PRECACHE_SHELL = [] // __KELION_PRECACHE__\nconst PRECACHE_OFFLINE_RUNTIME = [] // __KELION_OFFLINE_RUNTIME__",
      manifest,
    )
    expect(extragePrecache(sw)).toEqual(manifest.urls)
    expect(extrageRuntimeOffline(sw)).toEqual(manifest.offlineRuntime)
    for (const url of urluriLocaleDinIndex(readFileSync(join(dir, 'index.html'), 'utf8'))) {
      expect(extragePrecache(sw).map(calePrecache)).toContain(url)
    }
  })

  it('revizuiește numai assetul schimbat și schimbă versiunea shellului', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kelion-precache-revizie-'))
    temporare.push(dir)
    mkdirSync(join(dir, 'assets'))
    writeFileSync(join(dir, 'index.html'), '<link rel="stylesheet" href="/assets/app.css"><script src="/assets/app.js"></script>')
    writeFileSync(join(dir, 'assets/app.css'), 'body{color:red}')
    writeFileSync(join(dir, 'assets/app.js'), 'console.log("same")')
    const initial = colecteazaPrecache(dir)
    writeFileSync(join(dir, 'assets/app.css'), 'body{color:blue}')
    const schimbat = colecteazaPrecache(dir)

    const peCale = (urls: string[]) => new Map(urls.map((url) => [calePrecache(url), url]))
    const a = peCale(initial.urls)
    const b = peCale(schimbat.urls)
    const diferente = [...a].filter(([path, url]) => b.get(path) !== url).map(([path]) => path)
    expect(diferente).toEqual(['/assets/app.css'])
    expect(schimbat.version).not.toBe(initial.version)
  })

  it('păstrează API/auth network-only, dar le oprește local în avion, și are fallback de navigare', () => {
    const sw = readFileSync(resolve(aici, '../public/sw.js'), 'utf8')
    expect(sw).toMatch(/if \(await cache\.match\(url\)\) continue/)
    expect(sw).toMatch(/adaugate\.map\(\(url\) => cache\.delete\(url\)\)/)
    expect(sw).toMatch(/cache\.match\(pathname, \{ ignoreSearch: true \}\)/)
    expect(sw).toMatch(/url\.pathname\.startsWith\('\/assets\/'\)/)
    expect(sw).not.toContain('PRECACHE_SHELL.includes(url.pathname)')
    expect(sw).toMatch(/url\.pathname\.startsWith\('\/api'\)/)
    expect(sw).toMatch(/url\.pathname\.startsWith\('\/auth'\)/)
    expect(sw).toMatch(/self\.navigator\.onLine === false[\s\S]*status: 503/)
    expect(sw).toMatch(/status: 503[\s\S]*'cache-control': 'no-store'/)
    expect(sw).toMatch(/marcheazaOffline\(\)[\s\S]*assetCurent\(cache, e\.request\)/)
    expect(sw).toMatch(/catch \{[\s\S]*marcheazaOffline\(\)/)
    expect(sw).toMatch(/e\.request\.mode === 'navigate'[\s\S]*assetCurent\(cache, '\/'\)/)
    expect(sw).toContain("e.data?.type === 'kelion-cache-offline-runtime'")
    expect(sw).toContain('offline_runtime_integrity')
    expect(sw).toContain('digestComplet')
    expect(sw).not.toContain('digestScurt')
    expect(sw).not.toMatch(/activate[\s\S]*cacheRuntimeOffline\(\)/)
    expect(sw).not.toMatch(/cache\.put\([^\n]*(?:\/api|\/auth)/)
  })
})
