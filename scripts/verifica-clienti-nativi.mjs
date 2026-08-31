import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { androidManifestConfig, appleAssociation, assetLinks, constructorTauriConfig, product, tauriConfig } from './genereaza-config-platforme.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const citeste = (path) => readFileSync(resolve(REPO, path), 'utf8')
const publicOrigin = product.publicAppOrigin
const erori = []
const cere = (conditie, mesaj) => { if (!conditie) erori.push(mesaj) }

const iosConfig = citeste('ios/capacitor.config.ts')
cere(!/\bserver\s*:\s*\{/.test(iosConfig), 'iOS: blocul server ar transforma aplicația în shell remote')
cere(!/allowNavigation\s*:|\burl\s*:\s*['"]https?:\/\//.test(iosConfig), 'iOS: origin remote sau allowNavigation în configurația Capacitor')
cere(/webDir:\s*['"]native-dist['"]/.test(iosConfig), 'iOS: webDir nu este bundle-ul local generat')
cere(!existsSync(resolve(REPO, 'ios/www/index.html')), 'iOS: placeholderul istoric remote ios/www/index.html încă există')

const desktopConfig = tauriConfig()
const constructorDesktopConfig = constructorTauriConfig()
cere(desktopConfig.build?.frontendDist === '../dist', 'Tauri: frontendDist nu este directorul local desktop/dist')
cere(!desktopConfig.build?.devUrl, 'Tauri: devUrl remote este interzis în configurația de release')
cere((desktopConfig.app?.windows ?? []).every((window) => !/^https?:/i.test(String(window.url ?? ''))), 'Tauri: o fereastră încarcă URL remote')
const csp = JSON.stringify(desktopConfig.app?.security?.csp ?? '')
cere(csp.includes("default-src 'self'") && csp.includes(publicOrigin), 'Tauri: CSP strict/backend allowlist lipsește')
cere(!desktopConfig.plugins?.updater, 'Tauri: updaterul silențios nu este permis fără pipeline separat auditat')
cere(desktopConfig.plugins?.['deep-link']?.desktop?.schemes?.includes(product.nativeScheme), 'Tauri: schema de callback OAuth nu este înregistrată')
cere(constructorDesktopConfig.build?.frontendDist === '../dist', 'Constructor Tauri: frontendDist nu este bundle-ul local')
cere(!constructorDesktopConfig.build?.devUrl, 'Constructor Tauri: devUrl remote este interzis')
cere(constructorDesktopConfig.identifier === product.constructorDesktopBundleId && constructorDesktopConfig.identifier !== desktopConfig.identifier, 'Constructor Tauri: bundle identifier distinct lipsește')
cere(constructorDesktopConfig.plugins?.['deep-link']?.desktop?.schemes?.includes(product.constructorNativeScheme), 'Constructor Tauri: schema OAuth distinctă lipsește')
cere(!constructorDesktopConfig.plugins?.['deep-link']?.desktop?.schemes?.includes(product.nativeScheme), 'Constructor Tauri: schema aplicației Kelion nu poate fi revendicată')
cere(['msi', 'nsis'].every((target) => constructorDesktopConfig.bundle?.targets?.includes(target)), 'Constructor Tauri: pachetele MSI și NSIS nu sunt ambele activate')

const capability = desktopConfig.app?.security?.capabilities?.[0]
cere(!capability.remote, 'Tauri: capabilitățile nu pot fi acordate originilor remote')
cere(JSON.stringify(capability.permissions).includes(`${publicOrigin}/auth/native/authorize*`), 'Tauri: openerul OAuth nu are allowlist first-party exact')
cere(!JSON.stringify(capability.permissions).includes('opener:default'), 'Tauri: opener:default este prea larg')

const desktopRust = `${citeste('desktop/src-tauri/src/main.rs')}\n${citeste('desktop/src-tauri/src/shell.rs')}`
cere(!/updater|download_and_install/.test(desktopRust), 'Tauri: codul updaterului vechi încă există')
cere(/on_navigation/.test(desktopRust), 'Tauri: lipsește gardul pentru navigări top-level remote')
const constructorRust = citeste('constructor-desktop/src-tauri/src/main.rs')
cere(/desktop\/src-tauri\/src\/shell\.rs/.test(constructorRust), 'Constructor Tauri: nu reutilizează shell-ul nativ verificat')
const desktopCargo = citeste('desktop/src-tauri/Cargo.toml')
const desktopCargoLock = citeste('desktop/src-tauri/Cargo.lock')
const constructorCargo = citeste('constructor-desktop/src-tauri/Cargo.toml')
const constructorCargoLock = citeste('constructor-desktop/src-tauri/Cargo.lock')
cere(/keyring\s*=\s*\{\s*version\s*=\s*"=4\.1\.5"/.test(desktopCargo), 'Tauri: keyring trebuie fixat la o versiune exactă')
cere(/name = "keyring"\s+version = "4\.1\.5"/.test(desktopCargoLock), 'Tauri: Cargo.lock nu fixează keyring 4.1.5')
cere(!/name = "tauri-plugin-updater"/.test(desktopCargoLock), 'Tauri: Cargo.lock păstrează updaterul retras')
cere(/keyring\s*=\s*\{\s*version\s*=\s*"=4\.1\.5"/.test(constructorCargo), 'Constructor Tauri: keyring trebuie fixat la o versiune exactă')
cere(/name = "keyring"\s+version = "4\.1\.5"/.test(constructorCargoLock), 'Constructor Tauri: Cargo.lock nu fixează keyring 4.1.5')
cere(!/name = "tauri-plugin-updater"/.test(constructorCargoLock), 'Constructor Tauri: Cargo.lock păstrează updaterul retras')

const twa = androidManifestConfig()
cere(twa.fallbackType === 'customtabs', 'Android: fallback-ul TWA trebuie să fie Custom Tabs, nu WebView')
cere(Array.isArray(twa.fingerprints) && twa.fingerprints.length >= 2, 'Android: lipsesc fingerprinturile upload + Play signing')
const androidManifest = citeste('android/app/src/main/AndroidManifest.xml')
cere(/android:usesCleartextTraffic="false"/.test(androidManifest), 'Android: cleartext traffic nu este blocat')
cere(!/WebViewFallbackActivity/.test(androidManifest), 'Android: activitatea WebView fallback trebuie eliminată')
cere(/FocusActivity"\s+android:exported="false"/.test(androidManifest), 'Android: FocusActivity trebuie explicit neexportată')
cere(/ACCESS_NETWORK_STATE/.test(androidManifest), 'Android: fallback-ul primei porniri offline nu poate verifica rețeaua')
const androidLauncher = citeste('android/app/src/main/java/app/kelionai/twa/LauncherActivity.java')
cere(!/putBoolean\(|launched_successfully|firstTimeLaunchTwa/.test(androidLauncher), 'Android: prima lansare nu poate fi marcată reușită înainte ca TWA să fie încărcată')

const generatedAssetLinks = assetLinks()
const fingerprints = generatedAssetLinks.flatMap((entry) => entry.target?.sha256_cert_fingerprints ?? [])
cere(twa.fingerprints.every((fingerprint) => fingerprints.includes(fingerprint)), 'Android: twa-manifest și assetlinks.json au fingerprinturi diferite')
const association = appleAssociation()
cere(association.applinks.details.some((detail) => detail.appIDs.includes(`${product.iosTeamId}.${product.iosBundleId}`)), 'iOS: asocierea Universal Link nu derivă din config')

const wrapper = citeste('android/gradle/wrapper/gradle-wrapper.properties')
cere(wrapper.includes('distributionSha256Sum=f397b287023acdba1e9f6fc5ea72d22dd63669d59ed4a289a29b1a76eee151c6'), 'Android: distribuția Gradle 8.11.1 nu are SHA-256 oficial fixat')

const verificationMetadataPath = resolve(REPO, 'android/gradle/verification-metadata.xml')
const verificationKeyringPath = resolve(REPO, 'android/gradle/verification-keyring.gpg')
const verificationKeysPath = resolve(REPO, 'android/gradle/verification-keyring.keys')
cere(existsSync(verificationMetadataPath), 'Android: lipsește verification-metadata.xml pentru dependențele Gradle')
cere(existsSync(verificationKeyringPath) && statSync(verificationKeyringPath).size > 1_024, 'Android: keyringul binar Gradle lipsește sau este gol')
cere(existsSync(verificationKeysPath) && statSync(verificationKeysPath).size > 1_024, 'Android: exportul cheilor Gradle lipsește sau este gol')
if (existsSync(verificationMetadataPath)) {
  const verificationMetadata = readFileSync(verificationMetadataPath, 'utf8')
  cere(/<verify-metadata>true<\/verify-metadata>/.test(verificationMetadata), 'Android: verificarea metadata Gradle nu este obligatorie')
  cere(/<verify-signatures>true<\/verify-signatures>/.test(verificationMetadata), 'Android: verificarea semnăturilor Gradle nu este obligatorie')
  cere((verificationMetadata.match(/<sha256\b/g) ?? []).length >= 100, 'Android: metadata Gradle nu acoperă dependențele cu suficiente checksum-uri SHA-256')
  cere(!/<trusted-artifacts?>\b/.test(verificationMetadata), 'Android: allowlistul larg trusted-artifact poate ocoli checksum-urile')
}

const androidBuild = citeste('android/app/build.gradle')
cere(/compileSdkVersion\s+36\b/.test(androidBuild), 'Android: compileSdk trebuie fixat la API 36')
cere(/buildToolsVersion\s+['"]35\.0\.0['"]/.test(androidBuild), 'Android: build-tools trebuie fixat explicit la 35.0.0')

const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: REPO, encoding: 'utf8' })
  .split('\0')
  .filter(Boolean)
  .filter((path) => existsSync(resolve(REPO, path)))
const executabile = tracked.filter((path) => ['.aab', '.apk', '.appx', '.exe', '.ipa', '.msi', '.msix', '.msixbundle'].includes(extname(path).toLowerCase()))
cere(executabile.length === 0, `Artefacte executabile urmărite în Git: ${executabile.join(', ')}`)
const generateOnly = new Set([
  'android/twa-manifest.json',
  'desktop/src-tauri/tauri.conf.json',
  'constructor-desktop/src-tauri/tauri.conf.json',
  'ios/ExportOptions.plist',
  'ios/ios/App/App/App.entitlements',
  'frontend/public/.well-known/assetlinks.json',
  'frontend/public/.well-known/apple-app-site-association',
])
const generatedTracked = tracked.filter((path) => generateOnly.has(path.replaceAll('\\', '/')))
cere(generatedTracked.length === 0, `Config generat urmărit în Git: ${generatedTracked.join(', ')}`)

if (erori.length) {
  process.stderr.write(`Clienți nativi nesiguri (${erori.length}):\n- ${erori.join('\n- ')}\n`)
  process.exit(1)
}
process.stdout.write('Clienți nativi: bundle local iOS/Tauri, OAuth extern, TWA verificat și artefacte Git 0.\n')
