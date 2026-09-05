#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto'
import { lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Build input only: no environment, network, heartbeat or runtime configuration
// can supply the expected hashes. Hash bytes exactly as the installer receives
// them; in particular, never normalize line endings or evaluate these modules.
const root = realpathSync(fileURLToPath(new URL('..', import.meta.url)))
const sources = [
  ['guardSha256', 'deploy/lib/doctor-repair-scope.mjs'],
  ['workerSha256', 'deploy/codex-worker.mjs'],
  ['publisherSha256', 'deploy/constructor-publisher.mjs'],
]

function regularFile(path, label) {
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink() || realpathSync(path) !== path) {
    throw new Error(`Invalid canonical build file: ${label}`)
  }
  return stat
}

function generate() {
  if (process.argv.length !== 2) throw new Error('This build generator accepts no overrides')
  const manifest = { protocol: 2 }
  for (const [key, relative] of sources) {
    const path = join(root, ...relative.split('/'))
    const before = regularFile(path, relative)
    if (before.size === 0 || before.size > 8 * 1024 * 1024) {
      throw new Error(`Invalid canonical build file size: ${relative}`)
    }
    const bytes = readFileSync(path)
    const after = regularFile(path, relative)
    if (before.ino !== after.ino || before.dev !== after.dev || before.size !== after.size
      || before.mtimeMs !== after.mtimeMs || bytes.length !== before.size) {
      throw new Error(`Build source changed during measurement: ${relative}`)
    }
    manifest[key] = createHash('sha256').update(bytes).digest('hex')
  }

  const backend = join(root, 'backend')
  if (realpathSync(backend) !== backend || !lstatSync(backend).isDirectory()) {
    throw new Error('Invalid canonical backend directory')
  }
  const output = join(backend, 'dist', 'constructor-doctor-capability.json')
  mkdirSync(dirname(output), { recursive: true })
  if (realpathSync(dirname(output)) !== dirname(output)) throw new Error('Invalid build output directory')
  try { regularFile(output, 'constructor-doctor-capability.json') } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  const temporary = `${output}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporary, `${JSON.stringify(manifest)}\n`, { flag: 'wx', mode: 0o644 })
    renameSync(temporary, output)
  } finally {
    rmSync(temporary, { force: true })
  }
  console.log('Generated backend/dist/constructor-doctor-capability.json from canonical source bytes')
}

try { generate() } catch (error) {
  console.error(`Constructor Doctor capability build failed: ${error?.message ?? 'unknown error'}`)
  process.exitCode = 1
}
