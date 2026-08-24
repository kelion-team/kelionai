import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { extname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const aici = resolve(fileURLToPath(new URL('.', import.meta.url)))
const DIST_IMPLICIT = resolve(aici, '../dist')

function fisiereRecursiv(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    return entry.isDirectory() ? fisiereRecursiv(full) : [full]
  })
}

function esteAssetShell(cale) {
  const ext = extname(cale).toLowerCase()
  if (esteRuntimeOffline(cale)) return false
  if (cale.startsWith('assets/')) return ['.js', '.css'].includes(ext)
  if (cale.startsWith('models/')) return ext === '.bin' || ext === '.json'
  if (cale.startsWith('anim/')) return ext === '.glb'
  if (cale.startsWith('icons/')) return ext === '.png'
  return ['manifest.webmanifest', 'kelion-logo.png', 'kelion-rpm.glb'].includes(cale)
}

function esteRuntimeOffline(cale) {
  const ext = extname(cale).toLowerCase()
  if (cale.startsWith('ort/')) return ext === '.wasm' || ext === '.mjs'
  if (!cale.startsWith('assets/')) return false
  return ext === '.wasm' || /\/offline-runtime-[^/]+\.js$/u.test(cale) ||
    /\/urecheaOffline\.worker-[^/]+\.js$/u.test(cale)
}

function urluriRevizuite(cai, distDir, indexPath) {
  return [...cai]
    .sort((a, b) => a.localeCompare(b))
    .map((url) => {
      const fisier = url === '/' ? indexPath : join(distDir, url.slice(1))
      const revizie = createHash('sha256').update(readFileSync(fisier)).digest('hex').slice(0, 16)
      return `${url}?v=${revizie}`
    })
}

function inventarRuntime(cai, distDir) {
  return [...cai].sort((a, b) => a.localeCompare(b)).map((url) => {
    const fisier = join(distDir, url.slice(1))
    const sha256 = createHash('sha256').update(readFileSync(fisier)).digest('hex')
    return { url: `${url}?v=${sha256}`, sizeBytes: statSync(fisier).size, sha256 }
  })
}

function urluriLocaleDinBundle(text) {
  const gasite = new Set()
  for (const match of text.matchAll(/["'`](\/[^"'`#?]*)["'`]/g)) gasite.add(match[1])
  return gasite
}

export function urluriLocaleDinIndex(html) {
  const gasite = new Set()
  for (const match of html.matchAll(/\b(?:src|href)=["'](\/[^"'#?]*)/g)) {
    gasite.add(match[1])
  }
  return [...gasite].sort()
}

export function colecteazaPrecache(distDir = DIST_IMPLICIT) {
  const indexPath = join(distDir, 'index.html')
  if (!existsSync(indexPath)) throw new Error(`Lipsește build-ul: ${indexPath}`)
  const toate = fisiereRecursiv(distDir)
    .map((full) => ({ full, cale: relative(distDir, full).split(sep).join('/') }))
  const existente = new Set(toate.filter(({ cale }) => esteAssetShell(cale)).map(({ cale }) => `/${cale}`))
  const runtimeOffline = new Set(toate.filter(({ cale }) => esteRuntimeOffline(cale)).map(({ cale }) => `/${cale}`))
  const indexUrls = urluriLocaleDinIndex(readFileSync(indexPath, 'utf8'))
  for (const url of indexUrls) {
    const cale = url.slice(1)
    if (!existsSync(join(distDir, cale))) {
      throw new Error(`index.html indică un asset inexistent: ${url}`)
    }
    existente.add(url)
  }
  for (const { full, cale } of toate) {
    if (!cale.startsWith('assets/') || !['.js', '.css'].includes(extname(cale).toLowerCase())) continue
    for (const url of urluriLocaleDinBundle(readFileSync(full, 'utf8'))) {
      const asset = url.slice(1)
      const assetPath = join(distDir, asset)
      if (!asset || asset.split('/').includes('..') || asset === 'sw.js' || esteRuntimeOffline(asset) ||
          !existsSync(assetPath) || !statSync(assetPath).isFile()) continue
      existente.add(url)
    }
  }
  existente.add('/')
  existente.add('/index.html')
  const urls = urluriRevizuite(existente, distDir, indexPath)
  const offlineRuntime = inventarRuntime(runtimeOffline, distDir)

  const hash = createHash('sha256')
  for (const url of urls) hash.update(`${url}\0`)
  return { urls, offlineRuntime, version: `kelionai-shell-${hash.digest('hex').slice(0, 16)}` }
}

export function calePrecache(url) {
  return new URL(url, 'https://kelionai.invalid').pathname
}

export function injecteazaPrecache(swSource, manifest) {
  const shellLine = /^const SHELL = .*\/\/ __KELION_SHELL_VERSION__$/m
  const precacheLine = /^const PRECACHE_SHELL = .*\/\/ __KELION_PRECACHE__$/m
  const runtimeLine = /^const PRECACHE_OFFLINE_RUNTIME = .*\/\/ __KELION_OFFLINE_RUNTIME__$/m
  if (!shellLine.test(swSource) || !precacheLine.test(swSource) || !runtimeLine.test(swSource)) {
    throw new Error('Markerii de precache lipsesc din dist/sw.js')
  }
  return swSource
    .replace(shellLine, `const SHELL = ${JSON.stringify(manifest.version)} // __KELION_SHELL_VERSION__`)
    .replace(precacheLine, `const PRECACHE_SHELL = ${JSON.stringify(manifest.urls)} // __KELION_PRECACHE__`)
    .replace(runtimeLine, `const PRECACHE_OFFLINE_RUNTIME = ${JSON.stringify(manifest.offlineRuntime)} // __KELION_OFFLINE_RUNTIME__`)
}

export function extragePrecache(swSource) {
  const match = /^const PRECACHE_SHELL = (\[.*\]) \/\/ __KELION_PRECACHE__$/m.exec(swSource)
  if (!match) throw new Error('Manifestul injectat nu poate fi citit')
  return JSON.parse(match[1])
}

export function extrageRuntimeOffline(swSource) {
  const match = /^const PRECACHE_OFFLINE_RUNTIME = (\[.*\]) \/\/ __KELION_OFFLINE_RUNTIME__$/m.exec(swSource)
  if (!match) throw new Error('Manifestul runtime offline nu poate fi citit')
  return JSON.parse(match[1])
}

export function genereazaPrecache(distDir = DIST_IMPLICIT, verifica = false) {
  const swPath = join(distDir, 'sw.js')
  if (!existsSync(swPath)) throw new Error(`Lipsește service workerul: ${swPath}`)
  const manifest = colecteazaPrecache(distDir)
  const rezultat = injecteazaPrecache(readFileSync(swPath, 'utf8'), manifest)
  writeFileSync(swPath, rezultat)

  if (verifica) {
    const injectate = extragePrecache(readFileSync(swPath, 'utf8'))
    const runtimeInjectat = extrageRuntimeOffline(readFileSync(swPath, 'utf8'))
    if (JSON.stringify(injectate) !== JSON.stringify(manifest.urls)) {
      throw new Error('Manifestul precache injectat diferă de fișierele din dist')
    }
    if (JSON.stringify(runtimeInjectat) !== JSON.stringify(manifest.offlineRuntime)) {
      throw new Error('Manifestul runtime offline injectat diferă de fișierele din dist')
    }
    for (const url of urluriLocaleDinIndex(readFileSync(join(distDir, 'index.html'), 'utf8'))) {
      if (!injectate.some((entry) => calePrecache(entry) === url)) {
        throw new Error(`Assetul din index nu este precached: ${url}`)
      }
    }
  }
  return manifest
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const manifest = genereazaPrecache(DIST_IMPLICIT, process.argv.includes('--verify'))
  const bytes = manifest.urls.reduce((total, url) => {
    const cale = calePrecache(url)
    if (cale === '/') return total
    return total + statSync(join(DIST_IMPLICIT, cale.slice(1))).size
  }, 0)
  const offlineBytes = manifest.offlineRuntime.reduce((total, asset) => total + asset.sizeBytes, 0)
  process.stdout.write(`Precache shell: ${manifest.urls.length} URL-uri, ${(bytes / 1024 / 1024).toFixed(1)} MiB; runtime offline opt-in: ${manifest.offlineRuntime.length} URL-uri, ${(offlineBytes / 1024 / 1024).toFixed(1)} MiB; ${manifest.version}\n`)
}
