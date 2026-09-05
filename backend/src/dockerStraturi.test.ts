import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DOCKERFILE = new URL('../../Dockerfile', import.meta.url)

function instructionPosition(source: string, prefix: string): number {
  const lines = source.split('\n')
  let offset = 0
  for (const line of lines) {
    if (line.startsWith(prefix)) return offset
    offset += line.length + 1
  }
  expect.fail(`Dockerfile nu conține instrucțiunea: ${prefix}`)
}

describe('Dockerfile web — cache determinist și runtime minimal', () => {
  const source = fs.readFileSync(DOCKERFILE, 'utf8')

  it('instalează lockfile-urile cu npm ci înaintea surselor', () => {
    const backendLock = instructionPosition(source, 'COPY backend/package.json backend/package-lock.json')
    const frontendLock = instructionPosition(source, 'COPY frontend/package.json frontend/package-lock.json')
    const backendInstall = instructionPosition(source, 'RUN cd backend && npm ci')
    const frontendInstall = instructionPosition(source, 'RUN cd frontend && npm ci')
    const backendSource = instructionPosition(source, 'COPY backend ./backend')
    const frontendSource = instructionPosition(source, 'COPY frontend ./frontend')

    expect(backendLock).toBeLessThan(backendInstall)
    expect(frontendLock).toBeLessThan(frontendInstall)
    expect(backendInstall).toBeLessThan(backendSource)
    expect(frontendInstall).toBeLessThan(frontendSource)
    expect(source).not.toMatch(/npm install(?:\s|\\)/)
  })

  it('păstrează pachetul local DOMException atât la instalare, cât și la runtime', () => {
    const backendInstall = instructionPosition(source, 'RUN cd backend && npm ci')
    const vendorInstall = instructionPosition(source, 'COPY backend/vendor/node-domexception ./backend/vendor/node-domexception')
    const runtime = source.slice(instructionPosition(source, 'FROM ${NODE_IMAGE} AS runtime'))

    expect(vendorInstall).toBeLessThan(backendInstall)
    expect(runtime).toContain('COPY --chown=node:node --from=constructie /build/backend/vendor ./backend/vendor')
  })

  it('runtime-ul primește doar artefactele necesare, nu repository-ul', () => {
    const runtime = source.slice(instructionPosition(source, 'FROM ${NODE_IMAGE} AS runtime'))
    expect(runtime).toContain('/build/backend/dist ./backend/dist')
    expect(runtime).toContain('/build/backend/migrations ./backend/migrations')
    expect(runtime).toContain('/build/frontend/dist ./frontend/dist')
    expect(runtime).toContain('/build/config ./config')
    expect(runtime).not.toMatch(/^COPY \. \.\s*$/m)
    expect(runtime).not.toContain('/build/.github')
    expect(runtime).not.toContain('/build/deploy')
    expect(runtime).not.toContain('/build/scripts')
  })

  it('rulează non-root și verifică numai liveness', () => {
    expect(source).toMatch(/^USER node\s*$/m)
    expect(source).toContain("fetch('http://127.0.0.1:8080/livez')")
    expect(source).not.toContain("fetch('http://127.0.0.1:8080/readyz')")
  })

  it('transmite commitul checkout-ului verificat în buildul UI și verifică artefactul înainte de semnare', () => {
    const stage = source.slice(instructionPosition(source, 'FROM dependinte AS constructie'),
      instructionPosition(source, 'FROM dependinte AS module-runtime'))
    expect(stage).toContain('ARG GIT_COMMIT_SHA')
    expect(stage).toContain('RUN cd frontend && GIT_COMMIT_SHA="$GIT_COMMIT_SHA" npm run build')
    const workflow = fs.readFileSync(new URL('../../.github/workflows/build-images.yml', import.meta.url), 'utf8')
    const build = workflow.indexOf('docker build --pull --build-arg "GIT_COMMIT_SHA=$RELEASE_SHA"')
    const checkoutProof = workflow.indexOf('[ "$(git rev-parse HEAD)" = "$RELEASE_SHA" ]')
    const artifactProof = workflow.indexOf('const file = "/app/frontend/dist/ui-build.json";')
    const publication = workflow.indexOf('      - name: Publică și semnează digestele OCI')
    expect(checkoutProof).toBeGreaterThan(-1)
    expect(build).toBeGreaterThan(checkoutProof)
    expect(artifactProof).toBeGreaterThan(build)
    expect(publication).toBeGreaterThan(artifactProof)
    expect(workflow).toContain('--entrypoint node kelion-release-app -e')
    expect(workflow).toContain("' \"$RELEASE_SHA\"")
  })

  it.each([
    ['exact', { schema: 1, commit: 'a'.repeat(40) }, true],
    ['stale', { schema: 1, commit: 'b'.repeat(40) }, false],
    ['missing local SHA', { schema: 1, commit: null }, false],
    ['short SHA', { schema: 1, commit: 'a'.repeat(7) }, false],
    ['wrong protocol', { schema: 2, commit: 'a'.repeat(40) }, false],
    ['extra property', { schema: 1, commit: 'a'.repeat(40), expected: 'a'.repeat(40) }, false],
    ['null', null, false],
  ])('poarta release UI verifică bytes JSON: %s', (_name, value, valid) => {
    const workflow = fs.readFileSync(new URL('../../.github/workflows/build-images.yml', import.meta.url), 'utf8')
    const program = workflow.match(/--entrypoint node kelion-release-app -e '\n([\s\S]*?)\n          ' "\$RELEASE_SHA"/)?.[1]
    expect(program).toBeDefined()
    const directory = fs.mkdtempSync(join(tmpdir(), 'kelion-release-ui-proof-'))
    try {
      const file = join(directory, 'ui-build.json')
      fs.writeFileSync(file, JSON.stringify(value))
      // Execute the exact release verifier, redirecting its one immutable image
      // path to this test's private file. No Docker or host path is touched.
      const imagePath = '"/app/frontend/dist/ui-build.json"'
      expect(program!.split(imagePath)).toHaveLength(2)
      const fixtureProgram = program!.replace(imagePath, JSON.stringify(file))
      const run = () => execFileSync(process.execPath, ['-e', fixtureProgram, 'a'.repeat(40)],
        { encoding: 'utf8', stdio: 'pipe', timeout: 10_000 })
      if (valid) expect(JSON.parse(run())).toEqual({ ok: true, event: 'release_ui_build_verified', commit: 'a'.repeat(40) })
      else expect(run).toThrow()
    } finally {
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })
})
