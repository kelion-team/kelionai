#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readFileSync, readlinkSync } from 'node:fs'
import { extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const RADACINA = fileURLToPath(new URL('..', import.meta.url))

const EXTENSII_COD = new Set([
  '.bat', '.cjs', '.css', '.gradle', '.html', '.java', '.js', '.jsx', '.mjs',
  '.ps1', '.py', '.rs', '.scss', '.sh', '.sql', '.swift', '.ts', '.tsx',
])
const EXTENSII_CONFIG = new Set([
  '.dockerignore', '.example', '.gitattributes', '.gitignore', '.json', '.plist',
  '.properties', '.service', '.storyboard', '.timer', '.toml', '.webmanifest', '.xcconfig',
  '.xml', '.yaml', '.yml', '.pbxproj',
])
const EXTENSII_DOCUMENTE = new Set(['.md', '.txt'])
const EXTENSII_ACTIVE = new Set([
  '.bin', '.data', '.glb', '.icns', '.ico', '.jpg', '.jpeg', '.png',
  '.svg', '.wasm', '.webp',
])
const EXTENSII_LIVRABILE = new Set([
  '.aab', '.apk', '.deb', '.dmg', '.exe', '.msi', '.msix', '.msixbundle', '.rpm',
])

function normalizata(cale) {
  return cale.split(sep).join('/').replaceAll('\\', '/')
}

export function clasificaFisier(caleInitiala) {
  const cale = normalizata(caleInitiala)
  const nume = cale.split('/').at(-1) ?? cale
  const extensie = extname(nume).toLowerCase()

  // Fișiere native cu formate bine definite, dar fără o extensie JSON/XML
  // convențională. Căile sunt intenționat exacte: o regulă generică pentru
  // fișiere fără extensie ar ascunde din nou conținut necunoscut din audit.
  if (cale === 'frontend/public/.well-known/apple-app-site-association') return 'configuratie'
  if (cale === 'ios/ios/App/App/App.entitlements') return 'configuratie'
  if (
    cale === 'android/gradle/verification-keyring.gpg'
    || cale === 'android/gradle/verification-keyring.keys'
  ) return 'dependente-blocate'

  if (/(^|\/)(?:node_modules|dist|build|coverage|target|\.gradle)(?:\/|$)/.test(cale)) {
    return 'generat-sau-cache'
  }
  if (/(^|\/)(?:package-lock\.json|Cargo\.lock|Podfile\.lock|gradle-wrapper\.jar)$/.test(cale)) {
    return 'dependente-blocate'
  }
  if (/(^|\/)(?:[^/]+\.)?(?:test|spec)\.[^/]+$/.test(cale) || /(^|\/)tests?\//.test(cale)) {
    return 'teste'
  }
  if (EXTENSII_LIVRABILE.has(extensie)) return 'livrabil-binar'
  if (/^desktop\/src-tauri\/gen\//.test(cale)) return 'generat-versionat'
  if (EXTENSII_COD.has(extensie)) return 'cod'
  if (
    EXTENSII_CONFIG.has(extensie)
    || /^\.(?:dockerignore|gitattributes|gitignore)$/.test(nume)
    || /^(?:Dockerfile(?:\..+)?|Caddyfile)$/.test(nume)
  ) return 'configuratie'
  if (EXTENSII_DOCUMENTE.has(extensie) || /^(?:LICENSE|NOTICE)(?:\..+)?$/i.test(nume)) return 'documentatie'
  if (EXTENSII_ACTIVE.has(extensie)) return 'activ-binar'
  if (extensie === '.jar' && cale === 'android/gradle/wrapper/gradle-wrapper.jar') return 'dependente-blocate'
  if (!extensie && (cale === '.githooks/pre-push' || cale === 'android/gradlew')) return 'cod'
  if (extensie === '.lock') return 'dependente-blocate'
  return 'necunoscut'
}

export function amprentaInventar(intrari) {
  const hash = createHash('sha256')
  for (const intrare of [...intrari].sort((a, b) => a.cale.localeCompare(b.cale, 'en'))) {
    hash.update(intrare.cale)
    hash.update('\0')
    hash.update(intrare.categorie)
    hash.update('\0')
    hash.update(String(intrare.octeti))
    hash.update('\0')
    hash.update(intrare.sha256)
    hash.update('\n')
  }
  return hash.digest('hex')
}

function duplicarePlatformaNecesara(cai) {
  return cai.every((cale) => cale.startsWith('desktop/src-tauri/icons/ios/')) ||
    cai.every((cale) => cale.startsWith('ios/ios/App/App/Assets.xcassets/Splash.imageset/'))
}

export function duplicariActiveNejustificate(intrari) {
  const peHash = new Map()
  for (const intrare of intrari.filter((item) => item.categorie === 'activ-binar')) {
    const grup = peHash.get(intrare.sha256) ?? []
    grup.push(intrare.cale)
    peHash.set(intrare.sha256, grup)
  }
  return [...peHash.entries()]
    .filter(([, cai]) => cai.length > 1 && !duplicarePlatformaNecesara(cai))
    .map(([sha256, cai]) => ({ sha256, cai: [...cai].sort() }))
}

export function citesteIntrareInventar(caleAbsoluta, stat = lstatSync(caleAbsoluta)) {
  if (stat.isSymbolicLink()) {
    // Inventariem ținta declarată, fără să urmăm legătura. Altfel o legătură
    // către un director produce EISDIR, iar una externă ar scoate auditul din
    // worktree și ar putea citi conținut care nu aparține sursei verificate.
    return Buffer.from(`legatura-simbolica\0${readlinkSync(caleAbsoluta)}`)
  }
  if (stat.isFile()) return readFileSync(caleAbsoluta)
  return null
}

export function construiesteInventar(radacina = RADACINA) {
  const rezultatGit = spawnSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: radacina, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  )
  if (rezultatGit.status !== 0) {
    throw new Error(`git ls-files a eșuat: ${rezultatGit.stderr || rezultatGit.stdout}`)
  }

  const cai = rezultatGit.stdout.split('\0').filter(Boolean).map(normalizata).sort()
  const intrari = []
  const sterse = []
  for (const cale of cai) {
    const absoluta = resolve(radacina, cale)
    if (!existsSync(absoluta)) {
      sterse.push(cale)
      continue
    }
    const stat = lstatSync(absoluta)
    const continut = citesteIntrareInventar(absoluta, stat)
    if (continut === null) continue
    intrari.push({
      cale,
      categorie: clasificaFisier(cale),
      octeti: continut.byteLength,
      sha256: createHash('sha256').update(continut).digest('hex'),
    })
  }

  const categorii = {}
  for (const intrare of intrari) {
    const curenta = categorii[intrare.categorie] ?? { fisiere: 0, octeti: 0 }
    curenta.fisiere += 1
    curenta.octeti += intrare.octeti
    categorii[intrare.categorie] = curenta
  }
  return {
    versiune: 1,
    fisierePrezente: intrari.length,
    fisiereSterseDinArbore: sterse.length,
    octeti: intrari.reduce((total, intrare) => total + intrare.octeti, 0),
    amprentaSha256: amprentaInventar(intrari),
    categorii,
    necunoscute: intrari.filter((intrare) => intrare.categorie === 'necunoscut').map((intrare) => intrare.cale),
    duplicariActiveNejustificate: duplicariActiveNejustificate(intrari),
    sterse,
    intrari,
  }
}

function ruleaza() {
  const inventar = construiesteInventar()
  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify(inventar, null, 2) + '\n')
  } else {
    console.log(`Suprafață audit: ${inventar.fisierePrezente} fișiere prezente, ${inventar.octeti} octeți.`)
    for (const [categorie, valori] of Object.entries(inventar.categorii).sort()) {
      console.log(`  ${categorie}: ${valori.fisiere} fișiere / ${valori.octeti} octeți`)
    }
    console.log(`Amprentă inventar SHA-256: ${inventar.amprentaSha256}`)
    if (inventar.fisiereSterseDinArbore) {
      console.log(`Fișiere urmărite și șterse în schimbarea curentă: ${inventar.fisiereSterseDinArbore}`)
    }
  }

  if (inventar.necunoscute.length) {
    console.error('Fișiere neclasificate — auditul nu poate pretinde acoperire completă:')
    for (const cale of inventar.necunoscute) console.error(`  ${cale}`)
    process.exitCode = 1
  }
  if (inventar.duplicariActiveNejustificate.length) {
    console.error('Active binare duplicate fără justificare de platformă:')
    for (const grup of inventar.duplicariActiveNejustificate) {
      console.error(`  ${grup.sha256}: ${grup.cai.join(', ')}`)
    }
    process.exitCode = 1
  }
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) ruleaza()
