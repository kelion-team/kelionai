import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SURSA = resolve(REPO, 'frontend/dist')
const PRODUCT = JSON.parse(readFileSync(resolve(REPO, 'config/product.json'), 'utf8'))
const PUBLIC_APP_ORIGIN = String(PRODUCT.publicAppOrigin ?? '')
const PUBLIC_URL = new URL(PUBLIC_APP_ORIGIN)
if (PUBLIC_URL.protocol !== 'https:' || PUBLIC_URL.username || PUBLIC_URL.password || PUBLIC_URL.pathname !== '/' || PUBLIC_URL.search || PUBLIC_URL.hash) {
  throw new Error('config/product.json: publicAppOrigin trebuie să fie un origin HTTPS exact.')
}
const PUBLIC_WS_ORIGIN = `wss://${PUBLIC_URL.host}`
const TINTE = Object.freeze({
  ios: resolve(REPO, 'ios/native-dist'),
  desktop: resolve(REPO, 'desktop/dist'),
})

const RADACINI_RUNTIME = new Set([
  'anim',
  'assets',
  'favicon.svg',
  'icons',
  'index.html',
  'kelion-logo.png',
  'kelion-rpm.glb',
  'leaflet',
  'lwc',
  'manifest.webmanifest',
  'models',
  'ort',
])
const RADACINI_EXCLUSE = new Set(['.well-known', 'downloads', 'robots.txt', 'sitemap.xml', 'sw.js'])
const EXTENSII_RUNTIME = new Set(['.bin', '.css', '.data', '.glb', '.html', '.js', '.json', '.png', '.svg', '.wasm', '.webmanifest'])

// CSP-ul nativ permite numai bundle-ul local, backendul Kelion și suprafețele
// iframe deja validate de workspace. `ipc:` este transportul intern Tauri;
// nu este o destinație de rețea. Nu există CDN-uri de cod sau origin wildcard.
export const CSP_NATIV = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  `form-action 'self' ${PUBLIC_APP_ORIGIN}`,
  "frame-ancestors 'none'",
  "script-src 'self' 'wasm-unsafe-eval' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://flagcdn.com",
  "font-src 'self' data:",
  "media-src 'self' data: blob:",
  `connect-src 'self' ipc: http://ipc.localhost ${PUBLIC_APP_ORIGIN} ${PUBLIC_WS_ORIGIN}`,
  "worker-src 'self' blob:",
  "child-src 'self' blob:",
  "frame-src 'self' blob: https://www.youtube.com https://embed.waze.com https://embed.windy.com https://www.openstreetmap.org",
  "manifest-src 'self'",
].join('; ')

function caleRelativa(cale) {
  return relative(SURSA, cale).split(sep).join('/')
}

function fisiere(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = resolve(dir, entry.name)
    if (entry.isSymbolicLink()) throw new Error(`Symlink interzis în bundle: ${caleRelativa(full)}`)
    return entry.isDirectory() ? fisiere(full) : [full]
  })
}

function verificaSursa() {
  if (!existsSync(resolve(SURSA, 'index.html'))) {
    throw new Error('Lipsește frontend/dist/index.html; rulează mai întâi build-ul frontend.')
  }
  for (const entry of readdirSync(SURSA, { withFileTypes: true })) {
    if (!RADACINI_RUNTIME.has(entry.name) && !RADACINI_EXCLUSE.has(entry.name)) {
      throw new Error(`Rădăcină neclasificată în frontend/dist: ${entry.name}`)
    }
  }
  for (const full of fisiere(SURSA)) {
    const root = caleRelativa(full).split('/')[0]
    if (!RADACINI_RUNTIME.has(root)) continue
    if (!EXTENSII_RUNTIME.has(extname(full).toLowerCase())) {
      throw new Error(`Extensie nepermisă în bundle-ul nativ: ${caleRelativa(full)}`)
    }
  }
}

function curataHtmlPentruNativ(html, platforma) {
  const faraSeoExecutabil = html
    .replace(/\s*<meta name="google-site-verification"[^>]*>/gi, '')
    .replace(/\s*<link rel="canonical"[^>]*>/gi, '')
    .replace(/\s*<meta property="og:[^"]+"[^>]*>/gi, '')
    .replace(/\s*<meta name="twitter:[^"]+"[^>]*>/gi, '')
    .replace(/\s*<script type="application\/ld\+json">[\s\S]*?<\/script>/gi, '')

  if (/<meta\s+http-equiv=["']refresh["']/i.test(faraSeoExecutabil)) {
    throw new Error('Redirectul meta-refresh este interzis în bundle-ul nativ.')
  }
  if (/<(?:script|link)\b[^>]*(?:src|href)=["']https?:\/\//i.test(faraSeoExecutabil)) {
    throw new Error('Codul sau stilul remote este interzis în bundle-ul nativ.')
  }

  const meta = [
    `    <meta name="kelion-native-platform" content="${platforma}" />`,
    `    <meta name="kelion-api-origin" content="${PUBLIC_APP_ORIGIN}" />`,
    `    <meta http-equiv="Content-Security-Policy" content="${CSP_NATIV}" />`,
  ].join('\n')
  if (!faraSeoExecutabil.includes('</head>')) throw new Error('index.html nu are </head>.')
  return faraSeoExecutabil.replace('</head>', `${meta}\n  </head>`)
}

function copiazaRadacina(nume, destinatie) {
  const source = resolve(SURSA, nume)
  if (!existsSync(source)) throw new Error(`Asset runtime lipsă: ${nume}`)
  const destination = resolve(destinatie, nume)
  mkdirSync(dirname(destination), { recursive: true })
  cpSync(source, destination, { recursive: true, force: true, dereference: false })
}

export function pregatesteBundle(platforma) {
  const destinatie = TINTE[platforma]
  if (!destinatie) throw new Error('Ținta trebuie să fie ios sau desktop.')
  const parinteAsteptat = platforma === 'ios' ? resolve(REPO, 'ios') : resolve(REPO, 'desktop')
  if (dirname(destinatie) !== parinteAsteptat || !destinatie.startsWith(`${REPO}${sep}`)) {
    throw new Error(`Țintă nesigură refuzată: ${destinatie}`)
  }

  verificaSursa()
  // Singurele ștergeri recursive admise sunt cele două directoare generate,
  // rezolvate exact mai sus și aflate sub rădăcina repo-ului.
  if (existsSync(destinatie)) rmSync(destinatie, { recursive: true, force: true })
  mkdirSync(destinatie, { recursive: true })
  for (const root of [...RADACINI_RUNTIME].sort()) copiazaRadacina(root, destinatie)

  const index = resolve(destinatie, 'index.html')
  writeFileSync(index, curataHtmlPentruNativ(readFileSync(index, 'utf8'), platforma))

  const bytes = fisiere(destinatie).reduce((total, file) => total + statSync(file).size, 0)
  process.stdout.write(`Bundle ${platforma}: ${fisiere(destinatie).length} fișiere, ${(bytes / 1024 / 1024).toFixed(1)} MiB, exclusiv runtime local.\n`)
  return destinatie
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const pozitie = process.argv.indexOf('--target')
  const platforma = pozitie >= 0 ? process.argv[pozitie + 1] : undefined
  pregatesteBundle(platforma)
}
