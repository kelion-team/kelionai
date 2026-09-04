import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { chmodSync, existsSync, readFileSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  createModelControl,
  createHistoryStore,
  createPublicationBarrier,
  createTransactionStore,
  createWorkerCoordinator,
  detectInstalledProfiles,
  probeModelState,
} from './constructor-model-control.mjs'
import { signServiceRequest } from './lib/service-auth.mjs'

const SECRET = Buffer.from('c'.repeat(64), 'utf8')
const BOOT_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_BOOT_ID = '22222222-2222-4222-8222-222222222222'

function memoryTransactionStore(initial = null) {
  let value = initial
  return {
    read: () => value,
    write: (next) => { value = structuredClone(next) },
    clear: () => { value = null },
    current: () => value,
  }
}

function memoryHistoryStore(initial = { schema: 1, outcomes: [] }) {
  let value = structuredClone(initial)
  return {
    read: () => structuredClone(value),
    write: (next) => { value = structuredClone(next) },
    current: () => structuredClone(value),
  }
}

async function assertRealPublicationBarrier(path) {
  const rootProbeMode = process.env.KELION_REQUIRE_ROOT_PUBLICATION_BARRIER_PROBE ?? '0'
  const sudoProbeChild = process.env.KELION_ROOT_PUBLICATION_BARRIER_PROBE_CHILD ?? '0'
  assert.match(rootProbeMode, /^[01]$/)
  assert.match(sudoProbeChild, /^[01]$/)
  const uid = process.getuid?.()
  // Imaginea gate rulează deliberat ca user non-root și nu conține sudo.
  // Numai pasul PR CI setează opt-in-ul și poate folosi boundary-ul sudo deja
  // obligatoriu; manifestele non-root locale rămân portabile fără să relaxeze
  // validatorul de producție pentru un lock root:root 0600.
  if (sudoProbeChild === '1') {
    assert.equal(uid, 0, 'publication barrier subprocess did not cross the sudo root boundary')
  } else if (uid !== 0) {
    if (rootProbeMode === '0') return
    const probe = spawnSync('/usr/bin/sudo', [
      '--non-interactive',
      '--user=root',
      '/usr/bin/env',
      'KELION_REQUIRE_ROOT_PUBLICATION_BARRIER_PROBE=0',
      'KELION_ROOT_PUBLICATION_BARRIER_PROBE_CHILD=1',
      process.execPath,
      '--test',
      '--test-name-pattern=^publication lease acoperă requested \\+ accepted și serializează flock-ul real$',
      fileURLToPath(import.meta.url),
    ], { encoding: 'utf8', timeout: 30_000 })
    assert.equal(probe.error, undefined, probe.error?.message)
    assert.equal(probe.status, 0, probe.stderr || probe.stdout)
    return
  }

  const barrier = createPublicationBarrier(path)
  const first = await barrier.acquire()
  assert.ok(first)
  assert.equal(await barrier.acquire(), null)
  await first.release()
  const second = await barrier.acquire()
  assert.ok(second)
  await second.release()
}

async function listenControl(dependencies) {
  const root = mkdtempSync(join(tmpdir(), 'constructor-model-control-'))
  const control = createModelControl(SECRET, dependencies)
  await new Promise((resolvePromise, reject) => {
    control.server.once('error', reject)
    control.server.listen(0, '127.0.0.1', resolvePromise)
  })
  const address = control.server.address()
  assert.ok(address && typeof address === 'object')
  return {
    ...control,
    endpoint: { host: '127.0.0.1', port: address.port },
    async close() {
      await new Promise((resolvePromise) => control.server.close(resolvePromise))
      rmSync(root, { recursive: true, force: true })
    },
  }
}

function signedRequest(endpoint, path, value, options = {}) {
  const body = options.raw ?? Buffer.from(JSON.stringify(value), 'utf8')
  const timestamp = options.timestamp ?? String(Math.floor(Date.now() / 1000))
  const nonce = options.nonce ?? randomUUID()
  const signature = options.signature ?? signServiceRequest(SECRET, timestamp, nonce, options.method ?? 'POST', path, body)
  return new Promise((resolvePromise, reject) => {
    const request = http.request({
      ...endpoint,
      method: options.method ?? 'POST',
      path,
      headers: {
        'content-length': body.length,
        'content-type': options.contentType ?? 'application/json',
        'x-kelion-nonce': nonce,
        'x-kelion-signature': signature,
        'x-kelion-timestamp': timestamp,
      },
    }, (response) => {
      const chunks = []
      response.on('data', (chunk) => chunks.push(chunk))
      response.on('end', () => {
        const raw = Buffer.concat(chunks)
        resolvePromise({
          status: response.statusCode,
          headers: response.headers,
          body: JSON.parse(raw.toString('utf8')),
        })
      })
    })
    request.on('error', reject)
    request.end(body)
  })
}

function readyDependencies(overrides = {}) {
  return {
    installedProfiles: async () => ['fast', 'powerful'],
    probeState: async () => ({ ok: true, profile: 'fast', alias: 'qwen3.6-35b-a3b-local' }),
    coordinator: {
      capture: async () => ({ enabled: 'enabled', active: 'active' }),
      quiesce: async (snapshot) => ({ ok: true, snapshot }),
      restore: async () => true,
    },
    transactionStore: memoryTransactionStore(),
    historyStore: memoryHistoryStore(),
    deploymentPending: () => false,
    publicationBarrier: { acquire: async () => ({ release: async () => {} }) },
    bootId: BOOT_ID,
    spawnSwitch: () => new EventEmitter(),
    ...overrides,
  }
}

test('state acceptă numai POST HMAC cu corp byte-exact și refuză replay/tampering', async (context) => {
  const control = await listenControl(readyDependencies())
  context.after(() => control.close())

  const timestamp = String(Math.floor(Date.now() / 1000))
  const nonce = randomUUID()
  const state = await signedRequest(control.endpoint, '/v1/model/state', {}, { timestamp, nonce })
  assert.equal(state.status, 200)
  assert.equal(state.headers['cache-control'], 'no-store')
  assert.deepEqual(state.body, {
    mode: 'manual',
    defaultProfile: 'fast',
    status: 'ready',
    activeProfile: 'fast',
    requestedProfile: null,
    requestId: null,
    installedProfiles: ['fast', 'powerful'],
  })

  const replay = await signedRequest(control.endpoint, '/v1/model/state', {}, { timestamp, nonce })
  assert.equal(replay.status, 401)
  assert.deepEqual(replay.body, { error: 'unauthorized' })

  const spaced = Buffer.from('{ }', 'utf8')
  const nonCanonical = await signedRequest(control.endpoint, '/v1/model/state', {}, { raw: spaced })
  assert.equal(nonCanonical.status, 422)

  const original = Buffer.from('{}', 'utf8')
  const tampered = Buffer.from('{"x":1}', 'utf8')
  const tamperTimestamp = String(Math.floor(Date.now() / 1000))
  const tamperNonce = randomUUID()
  const signature = signServiceRequest(SECRET, tamperTimestamp, tamperNonce, 'POST', '/v1/model/state', original)
  const rejected = await signedRequest(control.endpoint, '/v1/model/state', {}, {
    raw: tampered,
    timestamp: tamperTimestamp,
    nonce: tamperNonce,
    signature,
  })
  assert.equal(rejected.status, 401)

  assert.equal((await signedRequest(control.endpoint, '/v1/model/state', {}, { method: 'GET' })).status, 404)
  assert.equal((await signedRequest(control.endpoint, '/v1/model/state?verbose=1', {})).status, 404)
})

test('switchul răspunde 202, pornește un singur helper și publică ready numai după probă și timer restore', async (context) => {
  const child = new EventEmitter()
  let spawns = 0
  let activeProfile = 'fast'
  let restoreCalls = 0
  let releaseCapture
  const transactionStore = memoryTransactionStore()
  const captureGate = new Promise((resolvePromise) => { releaseCapture = resolvePromise })
  const control = await listenControl(readyDependencies({
    probeState: async () => ({
      ok: true,
      profile: activeProfile,
      alias: activeProfile === 'fast' ? 'qwen3.6-35b-a3b-local' : 'qwen3.5-122b-a10b-local',
    }),
    spawnSwitch(profile) {
      assert.equal(profile, 'powerful')
      spawns += 1
      return child
    },
    coordinator: {
      capture: async () => {
        await captureGate
        return { enabled: 'enabled', active: 'active' }
      },
      quiesce: async (snapshot) => ({ ok: true, snapshot }),
      restore: async (snapshot) => {
        assert.deepEqual(snapshot, { enabled: 'enabled', active: 'active' })
        restoreCalls += 1
        return true
      },
    },
    transactionStore,
  }))
  context.after(() => control.close())
  const requestId = randomUUID()

  const accepted = await signedRequest(control.endpoint, '/v1/model/switch', { requestId, profile: 'powerful' })
  assert.equal(accepted.status, 202)
  assert.deepEqual(accepted.body, { accepted: true, requestId, profile: 'powerful' })
  assert.equal(spawns, 0, 'ACK-ul trebuie să preceadă orice operație systemd lentă și spawnul')
  assert.deepEqual(transactionStore.current(), {
    schema: 2,
    requestId,
    profile: 'powerful',
    intent: 'switch',
    phase: 'accepted',
    bootId: BOOT_ID,
    timerSnapshot: null,
    createdAt: transactionStore.current().createdAt,
  })

  const switching = await signedRequest(control.endpoint, '/v1/model/state', {})
  assert.equal(switching.body.status, 'switching')
  assert.equal(switching.body.requestId, requestId)
  assert.equal(switching.body.requestedProfile, 'powerful')
  releaseCapture()
  await new Promise((resolvePromise) => setImmediate(resolvePromise))
  await new Promise((resolvePromise) => setImmediate(resolvePromise))
  assert.equal(spawns, 1)

  const duplicate = await signedRequest(control.endpoint, '/v1/model/switch', { requestId, profile: 'powerful' })
  assert.equal(duplicate.status, 202)
  assert.equal(spawns, 1)
  const conflict = await signedRequest(control.endpoint, '/v1/model/switch', { requestId: randomUUID(), profile: 'fast' })
  assert.equal(conflict.status, 409)
  assert.deepEqual(conflict.body, { error: 'switch_in_progress' })

  activeProfile = 'powerful'
  child.emit('close', 0, null)
  await new Promise((resolvePromise) => setImmediate(resolvePromise))
  await new Promise((resolvePromise) => setImmediate(resolvePromise))
  assert.equal(restoreCalls, 1)
  const ready = await signedRequest(control.endpoint, '/v1/model/state', {})
  assert.equal(ready.body.status, 'ready')
  assert.equal(ready.body.activeProfile, 'powerful')
  assert.equal(ready.body.requestId, null)

  const completedReplay = await signedRequest(control.endpoint, '/v1/model/switch', { requestId, profile: 'powerful' })
  assert.equal(completedReplay.status, 202)
  assert.equal(spawns, 1)
})

test('jurnalul real este atomic, root-only și poate fi recuperat și curățat', () => {
  const root = mkdtempSync(join(tmpdir(), 'constructor-model-journal-'))
  const path = join(root, 'transaction')
  try {
    const ownerUid = process.getuid?.() ?? statSync(root).uid
    const store = createTransactionStore(path, ownerUid)
    const accepted = {
      schema: 2,
      requestId: randomUUID(),
      profile: 'powerful',
      intent: 'switch',
      phase: 'accepted',
      bootId: BOOT_ID,
      timerSnapshot: null,
      createdAt: new Date().toISOString(),
    }
    store.write(accepted)
    assert.deepEqual(store.read(), accepted)
    assert.throws(() => store.write({
      schema: 1,
      requestId: accepted.requestId,
      profile: accepted.profile,
      phase: 'accepted',
      timerSnapshot: null,
      createdAt: accepted.createdAt,
    }), /transaction_schema_invalid/)
    const value = {
      schema: 2,
      requestId: randomUUID(),
      profile: 'powerful',
      intent: 'switch',
      phase: 'timer-snapshotted',
      bootId: BOOT_ID,
      timerSnapshot: { enabled: 'enabled', active: 'active' },
      createdAt: new Date().toISOString(),
    }
    store.write(value)
    const metadata = statSync(path)
    assert.equal(metadata.uid, ownerUid)
    assert.equal(metadata.mode & 0o777, 0o600)
    assert.deepEqual(store.read(), value)
    store.clear()
    assert.equal(existsSync(path), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('istoricul terminal este root-only, bounded și supraviețuiește restartului', async () => {
  const root = mkdtempSync(join(tmpdir(), 'constructor-model-history-'))
  const path = join(root, 'history')
  try {
    const ownerUid = process.getuid?.() ?? statSync(root).uid
    const store = createHistoryStore(path, ownerUid)
    const outcome = {
      requestId: randomUUID(),
      profile: 'fast',
      status: 'ready',
      bootId: BOOT_ID,
      completedAt: new Date().toISOString(),
    }
    store.write({ schema: 1, outcomes: [outcome] })
    assert.equal(statSync(path).uid, ownerUid)
    assert.equal(statSync(path).mode & 0o777, 0o600)
    assert.deepEqual(store.read(), { schema: 1, outcomes: [outcome] })

    let spawns = 0
    const control = createModelControl(SECRET, readyDependencies({
      historyStore: store,
      transactionStore: memoryTransactionStore(),
      spawnSwitch: () => { spawns += 1; return new EventEmitter() },
    }))
    const replay = await control.requestSwitch(outcome.requestId, 'fast')
    assert.equal(replay.statusCode, 202)
    assert.equal(spawns, 0)
    assert.equal((await control.snapshot()).status, 'ready')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('replay failed după restart rămâne failed corelat și nu repornește helperul', async () => {
  const outcome = {
    requestId: randomUUID(),
    profile: 'powerful',
    status: 'failed',
    bootId: BOOT_ID,
    completedAt: new Date().toISOString(),
  }
  let spawns = 0
  const control = createModelControl(SECRET, readyDependencies({
    historyStore: memoryHistoryStore({ schema: 1, outcomes: [outcome] }),
    spawnSwitch: () => { spawns += 1; return new EventEmitter() },
  }))
  const replay = await control.requestSwitch(outcome.requestId, 'powerful')
  assert.equal(replay.statusCode, 202)
  assert.equal(spawns, 0)
  const state = await control.snapshot()
  assert.equal(state.status, 'failed')
  assert.equal(state.requestId, outcome.requestId)
  assert.equal(state.requestedProfile, 'powerful')
})

test('restartul controllerului în același boot reconciliază cererea powerful deja aplicată', async () => {
  const requestId = randomUUID()
  const transactionStore = memoryTransactionStore({
    schema: 2,
    requestId,
    profile: 'powerful',
    intent: 'switch',
    phase: 'switching',
    bootId: BOOT_ID,
    timerSnapshot: { enabled: 'enabled', active: 'active' },
    createdAt: new Date().toISOString(),
  })
  let spawns = 0
  let restored = 0
  const control = createModelControl(SECRET, readyDependencies({
    transactionStore,
    probeState: async () => ({ ok: true, profile: 'powerful', alias: 'qwen3.5-122b-a10b-local' }),
    coordinator: {
      capture: async () => { throw new Error('nu trebuie recapturat') },
      quiesce: async (snapshot) => ({ ok: true, snapshot }),
      restore: async (snapshot) => {
        assert.deepEqual(snapshot, { enabled: 'enabled', active: 'active' })
        restored += 1
        return true
      },
    },
    spawnSwitch: () => { spawns += 1; return new EventEmitter() },
  }))
  assert.equal(await control.recoverInterruptedSwitch(), true)
  assert.equal(spawns, 0)
  assert.equal(restored, 1)
  assert.equal(transactionStore.current(), null)
  assert.equal((await control.snapshot()).activeProfile, 'powerful')
})

test('boot_id nou anulează pending powerful și normalizează exclusiv la fast', async () => {
  const originalRequestId = randomUUID()
  const transactionStore = memoryTransactionStore({
    schema: 2,
    requestId: originalRequestId,
    profile: 'powerful',
    intent: 'switch',
    phase: 'switching',
    bootId: OTHER_BOOT_ID,
    timerSnapshot: { enabled: 'enabled', active: 'active' },
    createdAt: new Date().toISOString(),
  })
  const child = new EventEmitter()
  const historyStore = memoryHistoryStore()
  let activeProfile = 'powerful'
  const spawns = []
  const control = createModelControl(SECRET, readyDependencies({
    transactionStore,
    historyStore,
    probeState: async () => ({
      ok: true,
      profile: activeProfile,
      alias: activeProfile === 'fast' ? 'qwen3.6-35b-a3b-local' : 'qwen3.5-122b-a10b-local',
    }),
    spawnSwitch: (profile) => { spawns.push(profile); return child },
  }))
  assert.equal(transactionStore.current().bootId, BOOT_ID)
  assert.equal(transactionStore.current().intent, 'normalize-fast')
  assert.equal(transactionStore.current().profile, 'fast')
  await control.recoverInterruptedSwitch()
  await new Promise((resolvePromise) => setImmediate(resolvePromise))
  assert.deepEqual(spawns, ['fast'])
  activeProfile = 'fast'
  child.emit('close', 0, null)
  await new Promise((resolvePromise) => setImmediate(resolvePromise))
  await new Promise((resolvePromise) => setImmediate(resolvePromise))
  assert.equal(transactionStore.current(), null)
  const state = await control.snapshot()
  assert.equal(state.status, 'ready')
  assert.equal(state.activeProfile, 'fast')
  const originalOutcome = historyStore.current().outcomes.find(({ requestId }) => requestId === originalRequestId)
  assert.equal(originalOutcome?.status, 'failed')
  assert.equal(originalOutcome?.profile, 'powerful')
  const replay = await control.requestSwitch(originalRequestId, 'powerful')
  assert.equal(replay.statusCode, 202)
  assert.deepEqual(spawns, ['fast'])
})

test('eșecul tombstone-ului old-boot nu suprascrie tranzacția originală', () => {
  const original = {
    schema: 2,
    requestId: randomUUID(),
    profile: 'powerful',
    intent: 'switch',
    phase: 'switching',
    bootId: OTHER_BOOT_ID,
    timerSnapshot: { enabled: 'enabled', active: 'active' },
    createdAt: new Date().toISOString(),
  }
  const transactionStore = memoryTransactionStore(original)
  assert.throws(() => createModelControl(SECRET, readyDependencies({
    transactionStore,
    historyStore: {
      read: () => ({ schema: 1, outcomes: [] }),
      write: () => { throw new Error('disk_full') },
    },
  })), /disk_full/)
  assert.deepEqual(transactionStore.current(), original)
})

test('eșecul helperului păstrează failed după rollback măsurat și restaurează timerul', async (context) => {
  const child = new EventEmitter()
  let restored = 0
  const control = await listenControl(readyDependencies({
    spawnSwitch: () => child,
    coordinator: {
      capture: async () => ({ enabled: 'enabled', active: 'active' }),
      quiesce: async (snapshot) => ({ ok: true, snapshot }),
      restore: async () => { restored += 1; return true },
    },
  }))
  context.after(() => control.close())
  const requestId = randomUUID()
  assert.equal((await signedRequest(control.endpoint, '/v1/model/switch', { requestId, profile: 'powerful' })).status, 202)
  await new Promise((resolvePromise) => setImmediate(resolvePromise))
  child.emit('close', 1, null)
  await new Promise((resolvePromise) => setImmediate(resolvePromise))
  assert.equal(restored, 1)
  const failed = await signedRequest(control.endpoint, '/v1/model/state', {})
  assert.deepEqual(failed.body, {
    mode: 'manual',
    defaultProfile: 'fast',
    status: 'failed',
    activeProfile: 'fast',
    requestedProfile: 'powerful',
    requestId,
    installedProfiles: ['fast', 'powerful'],
  })
})

test('ACK-ul rămâne rapid, apoi controllerul publică failed fără spawn când workerul este activ', async (context) => {
  let spawns = 0
  const control = await listenControl(readyDependencies({
    coordinator: {
      capture: async () => ({ enabled: 'enabled', active: 'active' }),
      quiesce: async (snapshot) => ({ ok: false, error: 'worker_active', snapshot }),
      restore: async () => true,
    },
    spawnSwitch: () => { spawns += 1; return new EventEmitter() },
  }))
  context.after(() => control.close())
  const response = await signedRequest(control.endpoint, '/v1/model/switch', {
    requestId: randomUUID(),
    profile: 'powerful',
  })
  assert.equal(response.status, 202)
  await new Promise((resolvePromise) => setImmediate(resolvePromise))
  const state = await signedRequest(control.endpoint, '/v1/model/state', {})
  assert.equal(state.body.status, 'failed')
  assert.equal(state.body.requestedProfile, 'powerful')
  assert.equal(spawns, 0)
})

test('controllerul nu acceptă un switch nou în timpul cutoverului de deploy', async () => {
  const transactionStore = memoryTransactionStore()
  const control = createModelControl(SECRET, readyDependencies({
    transactionStore,
    deploymentPending: () => true,
  }))
  const result = await control.requestSwitch(randomUUID(), 'powerful')
  assert.deepEqual(result, { statusCode: 503, body: { error: 'deployment_in_progress' } })
  assert.equal(transactionStore.current(), null)
})

test('intentul deploy apărut după requested anulează cererea înainte de accepted și ACK', async () => {
  const transactionStore = memoryTransactionStore()
  let checks = 0
  const control = createModelControl(SECRET, readyDependencies({
    transactionStore,
    deploymentPending: () => ++checks === 2,
  }))
  const result = await control.requestSwitch(randomUUID(), 'powerful')
  assert.deepEqual(result, { statusCode: 503, body: { error: 'deployment_in_progress' } })
  assert.equal(checks, 2)
  assert.equal(transactionStore.current(), null)
})

test('requested neconfirmat în același boot devine failed fără lansarea helperului', async () => {
  const requestId = randomUUID()
  const transactionStore = memoryTransactionStore({
    schema: 2,
    requestId,
    profile: 'powerful',
    intent: 'switch',
    phase: 'requested',
    bootId: BOOT_ID,
    timerSnapshot: null,
    createdAt: new Date().toISOString(),
  })
  const historyStore = memoryHistoryStore()
  let spawns = 0
  const control = createModelControl(SECRET, readyDependencies({
    transactionStore,
    historyStore,
    spawnSwitch: () => { spawns += 1; return new EventEmitter() },
  }))
  assert.equal(await control.recoverInterruptedSwitch(), true)
  assert.equal(spawns, 0)
  assert.equal(transactionStore.current(), null)
  assert.deepEqual(historyStore.current().outcomes.map(({ requestId: id, profile, status }) => ({ id, profile, status })), [
    { id: requestId, profile: 'powerful', status: 'failed' },
  ])
})

test('accepted durabil în același boot este singura fază pre-worker reluată', async () => {
  const transactionStore = memoryTransactionStore({
    schema: 2,
    requestId: randomUUID(),
    profile: 'powerful',
    intent: 'switch',
    phase: 'accepted',
    bootId: BOOT_ID,
    timerSnapshot: null,
    createdAt: new Date().toISOString(),
  })
  const spawns = []
  const control = createModelControl(SECRET, readyDependencies({
    transactionStore,
    spawnSwitch: (profile) => { spawns.push(profile); return new EventEmitter() },
  }))
  assert.equal(await control.recoverInterruptedSwitch(), true)
  await new Promise((resolvePromise) => setImmediate(resolvePromise))
  assert.deepEqual(spawns, ['powerful'])
})

test('recovery-ul accepted rămâne inert sub marker și rulează eventual numai sub publication lease', async () => {
  const transactionStore = memoryTransactionStore({
    schema: 2,
    requestId: randomUUID(),
    profile: 'powerful',
    intent: 'switch',
    phase: 'accepted',
    bootId: BOOT_ID,
    timerSnapshot: null,
    createdAt: new Date().toISOString(),
  })
  const child = new EventEmitter()
  let pending = true
  let held = false
  let acquired = 0
  let released = 0
  let captures = 0
  let quiesces = 0
  let restores = 0
  let spawns = 0
  let activeProfile = 'fast'
  const control = createModelControl(SECRET, readyDependencies({
    transactionStore,
    deploymentPending: () => pending,
    publicationBarrier: {
      async acquire() {
        acquired += 1
        held = true
        return { async release() { held = false; released += 1 } }
      },
    },
    probeState: async () => ({
      ok: true,
      profile: activeProfile,
      alias: activeProfile === 'fast' ? 'qwen3.6-35b-a3b-local' : 'qwen3.5-122b-a10b-local',
    }),
    coordinator: {
      capture: async () => { assert.equal(held, true); captures += 1; return { enabled: 'enabled', active: 'active' } },
      quiesce: async (snapshot) => { assert.equal(held, true); quiesces += 1; return { ok: true, snapshot } },
      restore: async () => { assert.equal(held, true); restores += 1; return true },
    },
    spawnSwitch: () => { assert.equal(held, true); spawns += 1; return child },
  }))

  assert.equal(await control.recoverInterruptedSwitch(), false)
  assert.deepEqual({ acquired, captures, quiesces, restores, spawns }, {
    acquired: 0, captures: 0, quiesces: 0, restores: 0, spawns: 0,
  })
  assert.equal(transactionStore.current().phase, 'accepted')

  pending = false
  assert.equal(await control.recoverInterruptedSwitch(), true)
  assert.deepEqual({ acquired, captures, quiesces, spawns, released }, {
    acquired: 1, captures: 1, quiesces: 1, spawns: 1, released: 0,
  })
  activeProfile = 'powerful'
  child.emit('close', 0, null)
  await new Promise((resolvePromise) => setImmediate(resolvePromise))
  assert.equal(restores, 1)
  assert.equal(released, 1)
  assert.equal(held, false)
  assert.equal(transactionStore.current(), null)
})

test('recovery-ul revalidează markerul după publication lease fără efecte laterale', async () => {
  const transactionStore = memoryTransactionStore({
    schema: 2,
    requestId: randomUUID(),
    profile: 'powerful',
    intent: 'switch',
    phase: 'accepted',
    bootId: BOOT_ID,
    timerSnapshot: null,
    createdAt: new Date().toISOString(),
  })
  let checks = 0
  let releases = 0
  let spawns = 0
  const control = createModelControl(SECRET, readyDependencies({
    transactionStore,
    deploymentPending: () => ++checks === 2,
    publicationBarrier: {
      acquire: async () => ({ release: async () => { releases += 1 } }),
    },
    spawnSwitch: () => { spawns += 1; return new EventEmitter() },
  }))
  assert.equal(await control.recoverInterruptedSwitch(), false)
  assert.equal(checks, 2)
  assert.equal(releases, 1)
  assert.equal(spawns, 0)
  assert.equal(transactionStore.current().phase, 'accepted')
})

test('publication lease acoperă requested + accepted și serializează flock-ul real', async () => {
  let held = false
  let releases = 0
  const transactionStore = memoryTransactionStore()
  const control = createModelControl(SECRET, readyDependencies({
    transactionStore: {
      ...transactionStore,
      write(value) {
        if (['requested', 'accepted'].includes(value.phase)) assert.equal(held, true)
        transactionStore.write(value)
      },
    },
    publicationBarrier: {
      async acquire() {
        assert.equal(held, false)
        held = true
        return {
          async release() {
            assert.equal(held, true)
            held = false
            releases += 1
          },
        }
      },
    },
    deploymentPending: () => {
      assert.equal(held, true)
      return false
    },
  }))
  assert.equal((await control.requestSwitch(randomUUID(), 'powerful')).statusCode, 202)
  assert.equal(transactionStore.current().phase, 'accepted')
  assert.equal(held, false)
  assert.equal(releases, 1)

  const root = mkdtempSync(join(tmpdir(), 'constructor-publication-lock-'))
  const path = join(root, 'publicare.lock')
  try {
    writeFileSync(path, '', { mode: 0o600 })
    chmodSync(path, 0o600)
    await assertRealPublicationBarrier(path)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('serverul HTTP ține publication lease până când răspunsul 202 emite finish', async (context) => {
  const transactionStore = memoryTransactionStore()
  let releases = 0
  const control = await listenControl(readyDependencies({
    transactionStore,
    publicationBarrier: {
      acquire: async () => ({ release: async () => { releases += 1 } }),
    },
  }))
  context.after(() => control.close())

  let unblockEnd
  const endMayContinue = new Promise((resolvePromise) => { unblockEnd = resolvePromise })
  let observeBlockedEnd
  const blockedEndObserved = new Promise((resolvePromise) => { observeBlockedEnd = resolvePromise })
  control.server.prependListener('request', (request, response) => {
    if (request.url !== '/v1/model/switch') return
    const originalEnd = response.end.bind(response)
    response.end = (...args) => {
      observeBlockedEnd()
      void endMayContinue.then(() => originalEnd(...args))
      return response
    }
  })

  const requestId = randomUUID()
  const responsePromise = signedRequest(control.endpoint, '/v1/model/switch', {
    requestId,
    profile: 'powerful',
  })
  await blockedEndObserved
  assert.equal(transactionStore.current().phase, 'accepted')
  assert.equal(releases, 0)
  unblockEnd()
  const response = await responsePromise
  assert.equal(response.status, 202)
  await new Promise((resolvePromise) => setImmediate(resolvePromise))
  assert.equal(releases, 1)
})

test('coordonatorul oprește timerul înainte de worker check și îl restaurează când workerul este activ', async () => {
  const calls = []
  let timerActive = 'active'
  const execute = async (command, args) => {
    assert.equal(command, '/usr/bin/systemctl')
    calls.push([...args])
    if (args[0] === 'stop') timerActive = 'inactive'
    if (args[0] === 'start') timerActive = 'active'
    let stdout = ''
    if (args[0] === 'show' && args.includes('--property=UnitFileState')) stdout = 'enabled'
    else if (args[0] === 'show' && args.includes('--property=ActiveState') && args[1] === 'kelion-codex-worker.timer') stdout = timerActive
    else if (args[0] === 'show' && args.includes('--property=ActiveState') && args[1] === 'kelion-codex-worker.service') stdout = 'activating'
    return { code: 0, signal: null, stdout, failed: false }
  }
  const prepared = await createWorkerCoordinator(execute).prepare()
  assert.deepEqual(prepared, {
    ok: false,
    error: 'worker_active',
    snapshot: { enabled: 'enabled', active: 'active' },
  })
  const stop = calls.findIndex((args) => args[0] === 'stop' && args[1] === 'kelion-codex-worker.timer')
  const worker = calls.findIndex((args) => args[0] === 'show' && args[1] === 'kelion-codex-worker.service')
  const restart = calls.findIndex((args) => args[0] === 'start' && args[1] === 'kelion-codex-worker.timer')
  assert.ok(stop >= 0 && worker > stop && restart > worker)
  assert.equal(timerActive, 'active')
})

test('proba leagă systemd, health și exact un alias llama.cpp cunoscut', async () => {
  const commands = []
  const runCommand = async (command, args) => {
    commands.push([command, ...args])
    if (command === '/usr/bin/ss') {
      return { code: 0, signal: null, stdout: 'LISTEN 0 128 127.0.0.1:24080 0.0.0.0:* users:(("llama-server",pid=4242,fd=7))', failed: false }
    }
    if (args[0] === 'is-active') return { code: 3, signal: null, stdout: 'inactive', failed: false }
    return { code: 0, signal: null, stdout: 'ActiveState=active\nMainPID=4242', failed: false }
  }
  const good = await probeModelState({
    runCommand,
    getJson: async (path) => path === '/health'
      ? { status: 'ok' }
      : { data: [{ id: 'qwen3.5-122b-a10b-local' }] },
    realpath: () => '/opt/private-ai/bin/llama-server',
    readText: () => '7f000000-7f100000 r--s 00000000 00:00 1 /srv/private-ai/models/qwen3.5-122b-a10b-q4_k_m/Qwen3.5-122B-A10B-Q4_K_M-00001-of-00003.gguf\n',
  })
  assert.deepEqual(good, { ok: true, profile: 'powerful', alias: 'qwen3.5-122b-a10b-local' })
  assert.deepEqual(commands[0], ['/usr/bin/systemctl', 'show', 'private-ai-llm.service', '--property=ActiveState', '--property=MainPID'])

  const multiple = await probeModelState({
    runCommand,
    getJson: async (path) => path === '/health'
      ? { status: 'ok' }
      : { data: [{ id: 'qwen3.6-35b-a3b-local' }, { id: 'qwen3.5-122b-a10b-local' }] },
    realpath: () => '/opt/private-ai/bin/llama-server',
    readText: () => '',
    completion: { fastPath: '/srv/private-ai/models/fast.gguf' },
  })
  assert.deepEqual(multiple, { ok: false })
})

test('inventarul raportează fast valid independent de receiptul final 122B', async () => {
  const path = '/srv/private-ai/models/fast-only.gguf'
  const installed = await detectInstalledProfiles({
    completion: null,
    fastModelPath: path,
    fastArtifactsInstalled: (candidate) => candidate === path,
    verifyFastDigest: async (candidate) => candidate === path,
    powerfulArtifactsInstalled: (completion) => completion !== null,
  })
  assert.deepEqual(installed, ['fast'])
})

test('GET idle folosește numai inventarul rapid, iar switchul verifică SHA înainte de helper', async () => {
  let metadataCalls = 0
  let shaCalls = 0
  let spawns = 0
  const control = createModelControl(SECRET, readyDependencies({
    installedProfiles: async () => { metadataCalls += 1; return ['fast', 'powerful'] },
    verifiedProfiles: async () => { shaCalls += 1; return ['fast', 'powerful'] },
    spawnSwitch: () => { spawns += 1; return new EventEmitter() },
  }))
  assert.equal((await control.snapshot()).status, 'ready')
  assert.equal(metadataCalls, 1)
  assert.equal(shaCalls, 0)
  assert.equal(spawns, 0)

  const result = await control.requestSwitch(randomUUID(), 'powerful')
  assert.equal(result.statusCode, 202)
  assert.equal(shaCalls, 0, 'ACK-ul trebuie emis înainte de SHA-256')
  await new Promise((resolvePromise) => setImmediate(resolvePromise))
  assert.equal(shaCalls, 1)
  assert.equal(spawns, 1)
})

test('powerful nu pornește dacă fast nu este verificat pentru rollback', async () => {
  let spawns = 0
  const control = createModelControl(SECRET, readyDependencies({
    verifiedProfiles: async () => ['powerful'],
    spawnSwitch: () => { spawns += 1; return new EventEmitter() },
  }))
  const requestId = randomUUID()
  assert.equal((await control.requestSwitch(requestId, 'powerful')).statusCode, 202)
  await new Promise((resolvePromise) => setImmediate(resolvePromise))
  assert.equal(spawns, 0)
  const state = await control.snapshot()
  assert.equal(state.status, 'failed')
  assert.equal(state.requestId, requestId)
})

test('unitatea și sursa fixează socketul, credentiala și spawn fără shell sau output moștenit', () => {
  const source = readFileSync(new URL('./constructor-model-control.mjs', import.meta.url), 'utf8')
  const unit = readFileSync(new URL('./systemd/kelion-constructor-model-control.service', import.meta.url), 'utf8')
  const workerUnit = readFileSync(new URL('./systemd/kelion-codex-worker.service', import.meta.url), 'utf8')
  const helperSpawn = source.slice(source.indexOf('export function spawnModelSwitch'), source.indexOf('function statePayload'))
  assert.match(helperSpawn, /spawn\(SWITCH_HELPER, \[profile\], \{[\s\S]*shell: false,[\s\S]*stdio: 'ignore'/)
  assert.doesNotMatch(helperSpawn, /stdio:\s*['"]inherit|console[.](?:log|error)|child[.]stdout|child[.]stderr/)
  assert.match(unit, /^User=root$/m)
  assert.match(unit, /^Group=10050$/m)
  assert.match(unit, /^LoadCredential=constructor-model-control-secret:\/root\/kelion\/secrets\/constructor-model-control-secret$/m)
  assert.match(unit, /^RuntimeDirectory=kelion-constructor-model-control$/m)
  assert.match(unit, /^RuntimeDirectoryPreserve=yes$/m)
  assert.doesNotMatch(unit, /^(?:After|Requires)=.*kelion-runtime-config-recovery[.]service$/m)
  assert.match(unit, /^Wants=private-ai-llm[.]service$/m)
  assert.match(unit, /^ConditionPathExists=\/run\/kelion\/runtime-config-recovery[.]ready$/m)
  assert.match(unit, /^ConditionPathExists=!\/run\/kelion\/constructor-activation[.]pending$/m)
  for (const blocker of [
    'constructor-deploy-quiesce[.]journal',
    'constructor-upgrade[.]journal',
    'constructor-max-model[.]journal',
    'runtime-config-cutover[.]journal',
    'constructor-activation[.]journal',
    'constructor-gate-refresh[.]journal',
    'destructive-cutover-recovery[.]json',
    'constructor-unit-migration[.]pending',
  ]) {
    assert.match(unit, new RegExp(`^ConditionPathExists=!/root/kelion/runtime/${blocker}$`, 'm'))
  }
  assert.match(unit, /^BindReadOnlyPaths=\/root\/kelion\/runtime:\/run\/kelion-constructor-model-control\/deploy-journals$/m)
  assert.match(unit, /^BindReadOnlyPaths=\/root\/kelion\/publicare[.]lock:\/run\/kelion-constructor-model-control\/publicare[.]lock$/m)
  assert.match(source, /const RUNTIME_READY_STAMP = '\/run\/kelion\/runtime-config-recovery[.]ready'/)
  assert.match(source, /REACTIVATION_JOURNAL = '[^']*constructor-reactivation[.]journal'/)
  assert.match(source, /DEPLOYMENT_JOURNALS = Object[.]freeze\(\[[\s\S]*constructor-unit-migration[.]pending[\s\S]*REACTIVATION_JOURNAL/)
  assert.match(source, /return !regularFile\(RUNTIME_READY_STAMP,[\s\S]*DEPLOYMENT_JOURNALS[.]some/)
  assert.match(source, /validReactivationJournal\(\)[\s\S]*0o600[\s\S]*constructor-reactivation/)
  assert.match(source, /startupDeploymentEntryExists\(\)[\s\S]*path !== REACTIVATION_JOURNAL \|\| !validReactivationJournal/)
  assert.match(source, /if \(startupDeploymentEntryExists\(\)\) throw new Error\('deployment_in_progress'\)/)
  assert.doesNotMatch(unit, /^ConditionPathExists=.*constructor-reactivation[.]journal$/m,
    'controllerul trebuie să poată porni sub intentul persistent, dar endpointurile rămân blocate')
  assert.match(unit, /^NoNewPrivileges=true$/m)
  assert.match(unit, /^ProtectSystem=strict$/m)
  assert.match(unit, /^RestrictAddressFamilies=AF_UNIX AF_INET AF_NETLINK$/m)
  assert.match(unit, /^ExecStartPre=\/opt\/private-ai\/bin\/constructor-model-switch --prepare-lock$/m)
  assert.match(unit, /^ReadWritePaths=.*\/etc\/private-ai.*\/run\/lock$/m)
  assert.match(unit, /^TimeoutStopSec=180min$/m)
  assert.match(unit, /^KillMode=control-group$/m)
  assert.match(workerUnit, /^SupplementaryGroups=kelion-handoff privateai$/m)
  assert.match(workerUnit, /^ConditionPathExists=!\/root\/kelion\/runtime\/constructor-reactivation[.]journal$/m)
  assert.match(workerUnit, /^ExecStart=\/usr\/bin\/flock --exclusive --wait 9000 \/run\/lock\/private-ai-model-switch[.]lock /m)
})
