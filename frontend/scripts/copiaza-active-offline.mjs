// ── ACTIVELE KITULUI OFFLINE, COPIATE DIN node_modules LA BUILD ─────────────
//
// Runtime-urile ASR sunt servite local, din versiuni fixate în lockfile. Niciun
// CDN nu face parte din calea modului avion.
//
// De ce COPIE la build și nu fișiere în git: ~50 MB de binare ar umfla repo-ul
// pentru totdeauna; ele EXISTĂ deja în node_modules (versiuni fixate în
// package-lock), și build-ul (local sau Docker) rulează oricum npm install.
// Scriptul e chemat din `npm run build` (și `predev`) — dacă lipsesc sursele,
// PICĂ TARE (exit 1), nu lasă un build fără kit.
import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const radacina = join(dirname(fileURLToPath(import.meta.url)), '..')

// Setul este verificat la build; lipsa unui runtime oprește buildul.
const ACTIVE = [
  ...[
    'ort-wasm-simd-threaded.asyncify.mjs',
    'ort-wasm-simd-threaded.mjs',
    'ort-wasm-simd-threaded.wasm',
  ].map((name) => [
    `node_modules/@huggingface/transformers/node_modules/onnxruntime-web/dist/${name}`,
    `public/ort/${name}`,
  ]),
]

// Runtime-urile 1.18 proveneau din motorul vocal retras și sunt incompatibile
// cu Transformers/ORT 1.26. Curățarea este limitată la aceste două ținte generate.
for (const stale of [
  'public/ort/ort-wasm-simd.wasm',
  'public/ort/ort-wasm.wasm',
  'public/ort/ort-wasm-simd-threaded.jsep.mjs',
  'public/ort/ort-wasm-simd-threaded.jsep.wasm',
  'public/ort/ort-wasm-simd-threaded.jspi.mjs',
  'public/ort/ort-wasm-simd-threaded.jspi.wasm',
  'public/ort/ort-wasm-simd-threaded.asyncify.wasm',
]) {
  await rm(join(radacina, stale), { force: true })
}

const kitManifest = JSON.parse(await readFile(join(radacina, 'src/offline-kit.manifest.json'), 'utf8'))
const runtimeByPath = new Map(kitManifest.runtimeSources.map((artifact) => [artifact.sourcePath, artifact]))

let copiate = 0
for (const [sursa, tinta] of ACTIVE) {
  const de = join(radacina, sursa)
  const la = join(radacina, tinta)
  try {
    await stat(de)
  } catch {
    console.error(`[kit-offline] LIPSĂ sursa ${sursa} — rulează npm install (versiunile sunt fixate în lock)`)
    process.exit(1)
  }
  await mkdir(dirname(la), { recursive: true })
  // Copiem doar dacă ținta lipsește sau diferă ca mărime (build repetat = ieftin).
  try {
    const [a, b] = [await stat(de), await stat(la)]
    if (a.size === b.size) continue
  } catch {
    /* ținta nu există încă */
  }
  await copyFile(de, la)
  copiate++
}
for (const [, target] of ACTIVE) {
  const artifact = runtimeByPath.get(target.replace(/^public\//u, ''))
  if (!artifact) throw new Error(`[kit-offline] ${target} lipsește din manifest`)
  const data = await readFile(join(radacina, target))
  const digest = createHash('sha256').update(data).digest('hex')
  if (data.byteLength !== artifact.sizeBytes || digest !== artifact.sha256) {
    throw new Error(`[kit-offline] integritate invalidă pentru ${target}`)
  }
}
// Vite emite acest WASM direct din ORT către aceeași cale declarată în
// manifest. Îl verificăm la sursă, fără a-l dubla în public/ și dist/.
{
  const name = 'ort-wasm-simd-threaded.asyncify.wasm'
  const artifact = runtimeByPath.get(`ort/${name}`)
  const data = await readFile(join(radacina, `node_modules/@huggingface/transformers/node_modules/onnxruntime-web/dist/${name}`))
  const digest = createHash('sha256').update(data).digest('hex')
  if (!artifact || data.byteLength !== artifact.sizeBytes || digest !== artifact.sha256) {
    throw new Error(`[kit-offline] integritate invalidă pentru runtime-ul emis ${name}`)
  }
}
console.log(`[kit-offline] active pe loc (${copiate} copiate acum, restul erau la zi)`)
