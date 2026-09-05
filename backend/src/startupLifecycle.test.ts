import { describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import { mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const require = createRequire(import.meta.url)
const indexUrl = new URL(process.env.KELION_STARTUP_COMPILED === '1'
  ? '../dist/index.js' : './index.ts', import.meta.url).href
const backendRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const revision = '7'.repeat(40)

// This process imports the complete, unmodified application and its real
// Fastify plugins/routes. Diagnostics and timer wrappers only observe calls;
// they delegate to the real implementation without faking time or callbacks.
const applicationProbe = String.raw`
import { channel } from 'node:diagnostics_channel'
let app
const send = (value) => new Promise((resolve, reject) => {
  process.send(value, (error) => error ? reject(error) : resolve())
})
const interval = globalThis.setInterval
const clear = globalThis.clearInterval
let monitor
globalThis.setInterval = function (callback, milliseconds, ...args) {
  const timer = interval(callback, milliseconds, ...args)
  if (callback.name === 'monitorTick') {
    monitor = timer
    void send({ event: 'monitor-started', milliseconds })
  }
  return timer
}
globalThis.clearInterval = function (timer) {
  const result = clear(timer)
  if (timer === monitor) void send({ event: 'monitor-cleared' })
  return result
}
channel('fastify.initialization').subscribe(({ fastify }) => {
  if (app) throw new Error('unexpected_second_fastify_instance')
  app = fastify
  app.addHook('onClose', async () => { await send({ event: 'close-hook' }) })
})
process.on('message', async (message) => {
  if (message !== 'close') throw new Error('unexpected_probe_command')
  await app.close()
  await send({ event: 'controlled-close-complete' })
  process.exit(0)
})
await import(process.env.KELION_STARTUP_INDEX_URL)
const address = app.server.address()
if (!address || typeof address === 'string') throw new Error('missing_real_listen_socket')
await send({ event: 'listening', port: address.port })
`

type ProbeEvent = { event: string; port?: number; milliseconds?: number }
type Exit = { code: number | null; signal: NodeJS.Signals | null }

function launchApplication(candidate: boolean) {
  const directory = mkdtempSync(join(tmpdir(), 'kelion-startup-'))
  const activationFile = join(directory, 'active-release')
  const events: ProbeEvent[] = []
  let output = ''
  let exited: Exit | null = null
  let startupError: Error | null = null
  const child = spawn(process.execPath, [
    '--import', pathToFileURL(require.resolve('tsx')).href,
    '--input-type=module', '--eval', applicationProbe,
  ], {
    cwd: backendRoot,
    // Deliberately not process.env: no .env, DB, mail, AI, OAuth or host
    // credentials may leak into this complete application startup fixture.
    env: {
      PATH: process.env.PATH,
      NODE_ENV: 'test',
      HOME: directory,
      TMPDIR: directory,
      DOTENV_CONFIG_PATH: join(directory, 'no-dotenv-file'),
      PORT: '0',
      BIND_HOST: '127.0.0.1',
      GIT_COMMIT_SHA: revision,
      RELEASE_CANDIDATE_MODE: candidate ? '1' : '0',
      RELEASE_ID: revision,
      RELEASE_ACTIVATION_FILE: activationFile,
      KELION_STARTUP_INDEX_URL: indexUrl,
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  })
  child.stdout.on('data', (chunk: Buffer) => { output = (output + chunk.toString()).slice(-32_768) })
  child.stderr.on('data', (chunk: Buffer) => { output = (output + chunk.toString()).slice(-32_768) })
  child.on('message', (event: ProbeEvent) => { events.push(event) })
  child.on('error', (error) => { startupError = error })
  const completion = new Promise<Exit>((resolveExit) => {
    child.on('close', (code, signal) => {
      exited = { code, signal }
      resolveExit(exited)
    })
  })
  const count = (name: string) => events.filter(({ event }) => event === name).length
  const waitFor = async (predicate: () => boolean, label: string, timeout = 15_000) => {
    const deadline = Date.now() + timeout
    while (!predicate()) {
      if (startupError) throw startupError
      if (exited) throw new Error(label + ': process exited ' + JSON.stringify(exited) + '\n' + output)
      if (Date.now() >= deadline) throw new Error(label + ': timeout\n' + output)
      await delay(25)
    }
  }
  const waitForExit = async () => {
    await Promise.race([
      completion,
      delay(5_000).then(() => { throw new Error('controlled close timed out\n' + output) }),
    ])
    return exited
  }
  const request = async (pathname: string) => {
    const port = events.find(({ event }) => event === 'listening')?.port
    if (!port) throw new Error('application has not opened its listening socket')
    try {
      const response = await fetch('http://127.0.0.1:' + port + pathname, { signal: AbortSignal.timeout(2_000) })
      return { status: response.status, body: await response.json() }
    } catch (error) {
      throw new Error('application request failed\n' + output, { cause: error })
    }
  }
  const marker = (value: string) => {
    const temporary = join(directory, 'next-release')
    writeFileSync(temporary, value + '\n')
    renameSync(temporary, activationFile)
  }
  const dispose = async () => {
    if (!exited) {
      child.kill('SIGKILL')
      await completion
    }
    rmSync(directory, { recursive: true, force: true })
  }
  return { child, events, count, waitFor, waitForExit, request, marker, dispose,
    revoke: () => rmSync(activationFile), output: () => output }
}

describe('complete application startup lifecycle', () => {
  it.each([
    { candidate: false, background: 1 },
    { candidate: true, background: 0 },
  ])('starts the real application and closes cleanly (candidate=$candidate)', async ({ candidate, background }) => {
    const probe = launchApplication(candidate)
    try {
      await probe.waitFor(() => probe.count('listening') === 1, 'complete application import')
      expect(await probe.request('/health')).toEqual({ status: 200, body: { status: 'ok' } })
      expect((await probe.request('/api/version')).body.commit).toBe(revision)
      const proof = await probe.request('/api/release-proof')
      // No database or worker socket is configured: never invent readiness.
      expect(proof.status).toBe(503)
      expect(proof.body.ready).toBe(false)
      expect(proof.body.candidate).toBe(candidate)
      expect(proof.body.sideEffectsActive).toBe(!candidate)
      expect(probe.count('monitor-started')).toBe(background)
      probe.child.send('close')
      expect(await probe.waitForExit()).toEqual({ code: 0, signal: null })
      expect(probe.count('close-hook')).toBe(1)
      expect(probe.count('controlled-close-complete')).toBe(1)
      expect(probe.count('monitor-cleared')).toBe(background)
      expect(probe.output()).not.toContain('FST_ERR_INSTANCE_ALREADY_LISTENING')
    } finally {
      await probe.dispose()
    }
  }, 25_000)

  it('activates only the exact candidate, starts background once, and closes on revocation', async () => {
    const probe = launchApplication(true)
    try {
      await probe.waitFor(() => probe.count('listening') === 1, 'candidate application import')
      await delay(1_150)
      expect(probe.count('monitor-started')).toBe(0)
      probe.marker('8'.repeat(40))
      await delay(1_150)
      expect(probe.count('monitor-started')).toBe(0)
      expect((await probe.request('/api/release-proof')).body.release)
        .toEqual({ candidate: true, sideEffectsActive: false })
      probe.marker(revision)
      await probe.waitFor(() => probe.count('monitor-started') === 1, 'background initialization', 4_000)
      await delay(1_150)
      expect(probe.count('monitor-started')).toBe(1)
      expect(await probe.request('/health')).toEqual({ status: 200, body: { status: 'ok' } })
      const activeProof = await probe.request('/api/release-proof')
      expect(activeProof.status).toBe(503)
      expect(activeProof.body.release).toEqual({ candidate: false, sideEffectsActive: true })
      probe.revoke()
      expect(await probe.waitForExit()).toEqual({ code: 0, signal: null })
      expect(probe.count('close-hook')).toBe(1)
      expect(probe.count('monitor-cleared')).toBe(1)
      expect(probe.output()).not.toContain('FST_ERR_INSTANCE_ALREADY_LISTENING')
    } finally {
      await probe.dispose()
    }
  }, 25_000)
})
