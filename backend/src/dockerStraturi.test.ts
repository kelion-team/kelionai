import { describe, expect, it } from 'vitest'
import fs from 'node:fs'

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
})
