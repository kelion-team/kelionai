import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../..', import.meta.url))
const generator = 'scripts/generate-constructor-doctor-capability.mjs'
const output = 'backend/dist/constructor-doctor-capability.json'
const sources = {
  guardSha256: 'deploy/lib/doctor-repair-scope.mjs',
  workerSha256: 'deploy/codex-worker.mjs',
  publisherSha256: 'deploy/constructor-publisher.mjs',
} as const
const temporaryRoots: string[] = []
const sha256 = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex')

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'kelion-doctor-build-'))
  temporaryRoots.push(directory)
  mkdirSync(join(directory, 'scripts'))
  mkdirSync(join(directory, 'backend'))
  copyFileSync(join(root, generator), join(directory, generator))
  for (const path of Object.values(sources)) {
    mkdirSync(dirname(join(directory, path)), { recursive: true })
    // Valid bytes, deliberately invalid JavaScript: the generator must not run
    // deployment modules, inspect their exports, or transform their content.
    writeFileSync(join(directory, path), `fixture:${path}\r\n\0raw bytes\n`)
  }
  return directory
}

function run(directory: string, args: string[] = []) {
  return execFileSync(process.execPath, [join(directory, generator), ...args], {
    cwd: tmpdir(), encoding: 'utf8', stdio: 'pipe', timeout: 10_000,
    env: { ...process.env, DOCTOR_GUARD_SHA256: 'a'.repeat(64), DOCTOR_WORKER_SHA256: 'b'.repeat(64),
      DOCTOR_PUBLISHER_SHA256: 'c'.repeat(64), GIT_COMMIT_SHA: 'd'.repeat(40) },
  })
}

afterEach(() => { for (const directory of temporaryRoots.splice(0)) rmSync(directory, { recursive: true, force: true }) })

describe('immutable Constructor Doctor capability build', () => {
  it('generates exactly the three raw-byte hashes, independent of cwd and environment, deterministically', () => {
    const directory = fixture()
    run(directory)
    const first = readFileSync(join(directory, output), 'utf8')
    expect(JSON.parse(first)).toEqual({ protocol: 2, ...Object.fromEntries(Object.entries(sources)
      .map(([key, path]) => [key, sha256(readFileSync(join(directory, path)))])) })
    expect(first.endsWith('\n')).toBe(true)
    run(directory)
    expect(readFileSync(join(directory, output), 'utf8')).toBe(first)
  })

  it.each(Object.entries(sources))('a change in %s changes only that measured field', (key, path) => {
    const directory = fixture()
    run(directory)
    const before = JSON.parse(readFileSync(join(directory, output), 'utf8'))
    const changed = `different bytes in ${path}\n`
    writeFileSync(join(directory, path), changed)
    run(directory)
    expect(JSON.parse(readFileSync(join(directory, output), 'utf8'))).toEqual({ ...before, [key]: sha256(changed) })
  })

  it.each(['missing', 'directory', 'empty'] as const)('fails the build for a %s source and never writes a manifest', (kind) => {
    const directory = fixture()
    const source = join(directory, sources.guardSha256)
    rmSync(source)
    if (kind === 'directory') mkdirSync(source)
    if (kind === 'empty') writeFileSync(source, '')
    expect(() => run(directory)).toThrow()
    expect(() => readFileSync(join(directory, output))).toThrow()
  })

  it('rejects CLI overrides instead of accepting another trust source', () => {
    const directory = fixture()
    expect(() => run(directory, ['--guard-sha256', 'a'.repeat(64)])).toThrow()
    expect(() => readFileSync(join(directory, output))).toThrow()
  })

  it('rejects a linked source directory and leaves the destination outside the build untouched', () => {
    const directory = fixture()
    const external = mkdtempSync(join(tmpdir(), 'kelion-doctor-external-'))
    temporaryRoots.push(external)
    writeFileSync(join(external, 'doctor-repair-scope.mjs'), 'outside reviewed tree')
    rmSync(join(directory, 'deploy/lib'), { recursive: true })
    symlinkSync(external, join(directory, 'deploy/lib'), process.platform === 'win32' ? 'junction' : 'dir')
    expect(() => run(directory)).toThrow()
    expect(readFileSync(join(external, 'doctor-repair-scope.mjs'), 'utf8')).toBe('outside reviewed tree')
    expect(() => readFileSync(join(directory, output))).toThrow()
  })

  it('normal local and Docker builds generate the manifest before copying its read-only runtime artifact', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'backend/package.json'), 'utf8'))
    expect(pkg.scripts.build).toBe(`tsc && node ../${generator}`)
    const docker = readFileSync(join(root, 'Dockerfile'), 'utf8')
    const buildAt = docker.indexOf('RUN cd backend && npm run build')
    for (const copy of [
      `COPY ${generator} ./${generator}`,
      'COPY deploy/lib/doctor-repair-scope.mjs ./deploy/lib/doctor-repair-scope.mjs',
      'COPY deploy/codex-worker.mjs deploy/constructor-publisher.mjs ./deploy/',
    ]) {
      expect(docker.indexOf(copy)).toBeGreaterThan(-1)
      expect(docker.indexOf(copy)).toBeLessThan(buildAt)
    }
    const runtime = docker.slice(docker.indexOf('FROM ${NODE_IMAGE} AS runtime'))
    expect(runtime).toContain(`COPY --chown=root:root --chmod=0444 --from=constructie /build/${output} ./${output}`)
    expect(runtime).not.toContain('/build/deploy')
    expect(runtime).not.toContain('/build/scripts')
    // The image's expected bytes cannot be replaced by the web process in the
    // canonical deployment, which mounts the entire application read-only.
    const appCompose = readFileSync(join(root, 'deploy/compose.production.yml'), 'utf8').split('\n  postgres:')[0]
    expect(appCompose).toMatch(/^    read_only: true$/m)
  })
})
