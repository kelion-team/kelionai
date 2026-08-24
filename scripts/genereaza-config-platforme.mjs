#!/usr/bin/env node
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function citesteProdus() {
  const raw = JSON.parse(readFileSync(resolve(REPO, 'config/product.json'), 'utf8'))
  const requiredStrings = [
    'appName', 'appVersion', 'publicAppOrigin', 'githubRepository', 'supportEmail',
    'nativeScheme', 'androidApplicationId', 'iosBundleId', 'iosTeamId', 'desktopBundleId',
  ]
  for (const field of requiredStrings) {
    if (typeof raw[field] !== 'string' || !raw[field].trim()) throw new Error(`config/product.json: ${field} invalid`)
  }
  const origin = new URL(raw.publicAppOrigin)
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) {
    throw new Error('config/product.json: publicAppOrigin trebuie să fie un origin HTTPS exact')
  }
  if (!/^[a-z][a-z0-9+.-]*$/.test(raw.nativeScheme)) throw new Error('config/product.json: nativeScheme invalid')
  if (!Array.isArray(raw.nativeOrigins) || raw.nativeOrigins.length !== 3) throw new Error('config/product.json: nativeOrigins invalid')
  for (const value of raw.nativeOrigins) {
    const native = new URL(String(value))
    const localShell = (
      (native.protocol === 'capacitor:' && native.hostname === 'localhost')
      || (native.protocol === 'tauri:' && native.hostname === 'localhost')
      || (native.protocol === 'http:' && native.hostname === 'tauri.localhost')
    )
    if (!localShell || !['', '/'].includes(native.pathname) || native.search || native.hash) throw new Error('config/product.json: nativeOrigins invalid')
  }
  if (raw.nativeRedirects?.ios !== `${raw.publicAppOrigin}/auth/native/complete` || raw.nativeRedirects?.desktop !== `${raw.nativeScheme}://auth/native/complete`) {
    throw new Error('config/product.json: nativeRedirects nu derivă din origin/schemă')
  }
  if (![raw.androidApplicationId, raw.iosBundleId, raw.desktopBundleId].every((value) => /^(?:[a-z][a-z0-9]*\.)+[a-z][a-z0-9]*$/i.test(value))) {
    throw new Error('config/product.json: bundle identifier invalid')
  }
  if (!Number.isSafeInteger(raw.androidVersionCode) || raw.androidVersionCode < 1) throw new Error('config/product.json: androidVersionCode invalid')
  if (!Array.isArray(raw.androidCertificateSha256) || raw.androidCertificateSha256.length < 2 || raw.androidCertificateSha256.some((value) => !/^(?:[A-F0-9]{2}:){31}[A-F0-9]{2}$/.test(value))) {
    throw new Error('config/product.json: androidCertificateSha256 invalid')
  }
  if (!/^[A-Z0-9]{10}$/.test(raw.iosTeamId)) throw new Error('config/product.json: iosTeamId invalid')
  return Object.freeze({ ...raw, publicUrl: origin })
}

export const product = citesteProdus()

export function nativeCsp() {
  const wsOrigin = `wss://${product.publicUrl.host}`
  return [
    "default-src 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    `form-action 'self' ${product.publicAppOrigin}`,
    "frame-ancestors 'none'",
    "script-src 'self' 'wasm-unsafe-eval' blob:",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://flagcdn.com",
    "font-src 'self' data:",
    "media-src 'self' data: blob:",
    `connect-src 'self' ipc: http://ipc.localhost ${product.publicAppOrigin} ${wsOrigin}`,
    "worker-src 'self' blob:",
    "child-src 'self' blob:",
    "frame-src 'self' blob: https://www.youtube.com https://embed.waze.com https://embed.windy.com https://www.openstreetmap.org",
    "manifest-src 'self'",
  ].join('; ')
}

export function androidManifestConfig() {
  const origin = product.publicAppOrigin
  return {
    packageId: product.androidApplicationId,
    host: product.publicUrl.host,
    name: product.appName,
    launcherName: product.appName,
    display: 'standalone',
    themeColor: '#0B0A14',
    themeColorDark: '#000000',
    navigationColor: '#0B0A14',
    navigationColorDark: '#0B0A14',
    navigationDividerColor: '#0B0A14',
    navigationDividerColorDark: '#0B0A14',
    backgroundColor: '#0B0A14',
    enableNotifications: false,
    startUrl: '/',
    iconUrl: `${origin}/icons/icon-512.png`,
    maskableIconUrl: `${origin}/icons/icon-512-maskable.png`,
    splashScreenFadeOutDuration: 300,
    appVersionName: product.appVersion,
    appVersionCode: product.androidVersionCode,
    shortcuts: [],
    generatorApp: 'bubblewrap-cli',
    webManifestUrl: `${origin}/manifest.webmanifest`,
    fallbackType: 'customtabs',
    features: {},
    alphaDependencies: { enabled: false },
    enableSiteSettingsShortcut: true,
    isChromeOSOnly: false,
    isMetaQuest: false,
    fullScopeUrl: `${origin}/`,
    minSdkVersion: 21,
    orientation: 'portrait',
    fingerprints: product.androidCertificateSha256,
    additionalTrustedOrigins: [],
    retainedBundles: [],
    protocolHandlers: [],
    displayOverride: [],
    appVersion: product.appVersion,
  }
}

export function tauriConfig() {
  const oauthStart = `${product.publicAppOrigin}/auth/native/authorize*`
  return {
    $schema: 'https://schema.tauri.app/config/2',
    productName: product.appName,
    version: product.appVersion,
    identifier: product.desktopBundleId,
    build: {
      beforeDevCommand: 'npm run bundle:web',
      beforeBuildCommand: 'npm run bundle:web',
      frontendDist: '../dist',
    },
    plugins: { 'deep-link': { desktop: { schemes: [product.nativeScheme] } } },
    app: {
      windows: [{ label: 'main', title: product.appName, width: 1280, height: 800, minWidth: 900, minHeight: 600, center: true, resizable: true }],
      security: {
        freezePrototype: true,
        csp: nativeCsp(),
        capabilities: [{
          identifier: 'main-local-bundle',
          description: 'Bundle local: callback OAuth și browser de sistem limitat la endpointul first-party.',
          windows: ['main'],
          permissions: [
            'core:event:default',
            'deep-link:default',
            { identifier: 'opener:allow-open-url', allow: [{ url: oauthStart }] },
          ],
        }],
      },
    },
    bundle: {
      active: true,
      targets: ['nsis'],
      createUpdaterArtifacts: false,
      publisher: 'AE Studio',
      copyright: '© 2026 AE Studio',
      category: 'Productivity',
      shortDescription: 'Your brilliant AI assistant — it sees, hears and speaks.',
      longDescription: 'Kelionai is a brilliant personal AI assistant that sees, hears and speaks with you in dozens of languages.',
      icon: ['icons/32x32.png', 'icons/128x128.png', 'icons/128x128@2x.png', 'icons/icon.ico'],
      windows: { nsis: { installMode: 'currentUser', languages: ['English', 'Romanian'] } },
    },
  }
}

export function assetLinks() {
  return [{
    relation: ['delegate_permission/common.handle_all_urls'],
    target: {
      namespace: 'android_app',
      package_name: product.androidApplicationId,
      sha256_cert_fingerprints: product.androidCertificateSha256,
    },
  }]
}

export function appleAssociation() {
  return {
    applinks: {
      apps: [],
      details: [{
        appIDs: [`${product.iosTeamId}.${product.iosBundleId}`],
        components: [{ '/': new URL(product.nativeRedirects.ios).pathname, comment: 'Callback opac one-time pentru autentificarea nativă.' }],
      }],
    },
  }
}

function scrieAtomic(path, continut) {
  const full = resolve(REPO, path)
  mkdirSync(dirname(full), { recursive: true })
  const temporary = `${full}.tmp`
  writeFileSync(temporary, continut, { encoding: 'utf8', mode: 0o600 })
  renameSync(temporary, full)
}

function json(path, value) {
  scrieAtomic(path, `${JSON.stringify(value, null, 2)}\n`)
}

function genereazaWebDist() {
  json('frontend/dist/.well-known/assetlinks.json', assetLinks())
  json('frontend/dist/.well-known/apple-app-site-association', appleAssociation())
}

function genereazaAndroid() {
  json('android/twa-manifest.json', androidManifestConfig())
}

function genereazaDesktop() {
  json('desktop/src-tauri/tauri.conf.json', tauriConfig())
}

function genereazaIos() {
  const entitlements = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>\n\t<key>com.apple.developer.associated-domains</key>\n\t<array>\n\t\t<string>applinks:${product.publicUrl.host}</string>\n\t</array>\n</dict>\n</plist>\n`
  scrieAtomic('ios/ios/App/App/App.entitlements', entitlements)
  const profile = process.env.IOS_PROVISIONING_PROFILE_SPECIFIER?.trim()
  if (profile) {
    const options = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>\n\t<key>method</key><string>app-store-connect</string>\n\t<key>teamID</key><string>${product.iosTeamId}</string>\n\t<key>signingStyle</key><string>manual</string>\n\t<key>provisioningProfiles</key>\n\t<dict><key>${product.iosBundleId}</key><string>${profile}</string></dict>\n\t<key>uploadSymbols</key><true/>\n</dict>\n</plist>\n`
    scrieAtomic('ios/ExportOptions.plist', options)
  }
}

const direct = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (direct) {
  const targetIndex = process.argv.indexOf('--target')
  const target = targetIndex >= 0 ? process.argv[targetIndex + 1] : 'check'
  const valid = new Set(['check', 'all', 'web-dist', 'android', 'desktop', 'ios'])
  if (!valid.has(target)) throw new Error('target invalid')
  if (target === 'all' || target === 'web-dist') genereazaWebDist()
  if (target === 'all' || target === 'android') genereazaAndroid()
  if (target === 'all' || target === 'desktop') genereazaDesktop()
  if (target === 'all' || target === 'ios') genereazaIos()
  process.stdout.write(target === 'check' ? 'Config platforme: config/product.json valid.\n' : `Config platforme: ${target} generat determinist.\n`)
}
