import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { chmodSync, readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  createModelControl, createPublicationBarrier, probeModelState, probeWorkerState, readWorkerPause,
  validateProviderConfig, requestProviderCatalog,
} from './constructor-model-control.mjs'
import { signServiceRequest } from './lib/service-auth.mjs'

const SECRET = Buffer.from('c'.repeat(64), 'utf8')
const MODEL = { id: 'opencode-free/big-pickle', label: 'Big Pickle', provider: 'opencode-free' }
const CONFIG = {
  autoupdate: false, share: 'disabled', model: MODEL.id, small_model: MODEL.id,
  enabled_providers: ['opencode-free'],
  provider: {
    'opencode-free': {
      npm: '@ai-sdk/openai-compatible',
      options: { baseURL: 'https://opencode.ai/inference/openai/v1' },
      models: { 'big-pickle': { name: MODEL.label } },
    },
  },
}
const readyDependencies = (overrides = {}) => ({
  probeState: async () => ({ ok: true, model: MODEL, installed: true }),
  deploymentPending: () => false,
  publicationBarrier: { acquire: async () => ({ release: async () => {} }) },
  ...overrides,
})

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
      '--test-name-pattern=^publication lease protejează snapshotul și serializează flock-ul real$',
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
  assert.deepEqual(await barrier.acquire({ observeContention: true }), { contended: true })
  const observed = await listenControl(readyDependencies({
    publicationBarrier: barrier, deploymentPending: () => true,
    probeWorkerState: async () => { throw new Error('must not probe across held publication lock') },
  }))
  try {
    const response = await signedRequest(observed.endpoint, '/v1/worker/state', {})
    assert.equal(response.status, 200)
    assert.deepEqual(response.body, { schema: 1, measuredAt: response.body.measuredAt,
      worker: null, intentionalPause: null, deployGate: true })
    assert.ok(Date.now() - Date.parse(response.body.measuredAt) < 1000)
  } finally { await observed.close() }
  await first.release()
  const second = await barrier.acquire()
  assert.ok(second)
  await second.release()
  chmodSync(path, 0o644)
  assert.equal(await barrier.acquire({ observeContention: true }), null)
  chmodSync(path, 0o600)
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


test('state acceptă numai POST HMAC cu corp byte-exact și refuză replay/tampering', async (context) => {
  const control = await listenControl(readyDependencies())
  context.after(() => control.close())
  const timestamp = String(Math.floor(Date.now() / 1000))
  const nonce = randomUUID()
  const state = await signedRequest(control.endpoint, '/v1/model/state', {}, { timestamp, nonce })
  assert.equal(state.status, 200)
  assert.equal(state.headers['cache-control'], 'no-store')
  assert.deepEqual(state.body, {
    mode: 'manual', defaultProfile: 'fast', status: 'ready', activeProfile: 'fast',
    requestedProfile: null, requestId: null, installedProfiles: ['fast'], model: MODEL,
  })
  assert.equal((await signedRequest(control.endpoint, '/v1/model/state', {}, { timestamp, nonce })).status, 401)
  assert.equal((await signedRequest(control.endpoint, '/v1/model/state', {}, { raw: Buffer.from('{ }') })).status, 422)
  assert.equal((await signedRequest(control.endpoint, '/v1/model/state', { x: 1 })).status, 422)
  assert.equal((await signedRequest(control.endpoint, '/v1/model/state', {}, { method: 'GET' })).status, 404)
  assert.equal((await signedRequest(control.endpoint, '/v1/model/state', {}, { contentType: 'text/plain' })).status, 415)
  const tamperNonce = randomUUID()
  const signature = signServiceRequest(SECRET, timestamp, tamperNonce, 'POST', '/v1/model/state', Buffer.from('{}'))
  assert.equal((await signedRequest(control.endpoint, '/v1/model/state', {}, {
    raw: Buffer.from('{"x":1}'), timestamp, nonce: tamperNonce, signature,
  })).status, 401)
})

test('switchul retras nu probează providerul și nu modifică servicii pentru niciun profil', async (context) => {
  let probes = 0
  let leases = 0
  const control = await listenControl(readyDependencies({
    probeState: async () => { probes += 1; throw new Error('must_not_probe') },
    publicationBarrier: { acquire: async () => { leases += 1; throw new Error('must_not_switch') } },
  }))
  context.after(() => control.close())
  for (const profile of ['fast', 'powerful', 'arbitrary']) {
    const result = await signedRequest(control.endpoint, '/v1/model/switch', { requestId: randomUUID(), profile })
    assert.equal(result.status, 410)
    assert.deepEqual(result.body, { error: 'constructor_model_switch_retired' })
  }
  assert.equal(probes, 0)
  assert.equal(leases, 0)
})

test('configurația anonimă aprobată este singura autoritate pentru eticheta afișată', () => {
  assert.deepEqual(validateProviderConfig(CONFIG), MODEL)
  const renamed = structuredClone(CONFIG)
  renamed.provider['opencode-free'].models['big-pickle'].name = 'Approved display label'
  assert.equal(validateProviderConfig(renamed).label, 'Approved display label')
  const invalidChanges = [
    (value) => { value.model = 'opencode/paid-model' },
    (value) => { value.small_model = 'another/model' },
    (value) => { value.enabled_providers.push('other') },
    (value) => { value.provider.other = {} },
    (value) => { value.provider['opencode-free'].options.baseURL = 'http://127.0.0.1:24080/v1' },
    (value) => { value.provider['opencode-free'].options.apiKey = 'not-a-real-key' },
    (value) => { value.provider['opencode-free'].options.headers = { Authorization: 'not-a-real-token' } },
    (value) => { value.provider['opencode-free'].models.fallback = { name: 'Fallback' } },
    (value) => { value.share = 'auto' },
    (value) => { value.provider['opencode-free'].models['big-pickle'].name = '\ninvalid' },
  ]
  for (const change of invalidChanges) {
    const invalid = structuredClone(CONFIG)
    change(invalid)
    assert.throws(() => validateProviderConfig(invalid))
  }
})

test('readiness cere configurație, binar verificat și model exact în catalog, fără inferență', async () => {
  const trace = []
  const dependencies = {
    readConfig: () => { trace.push('config'); return CONFIG },
    verifyBinary: async () => { trace.push('binary'); return true },
    getCatalog: async () => { trace.push('catalog'); return { data: [{ id: 'big-pickle' }] } },
  }
  assert.deepEqual(await probeModelState(dependencies), { ok: true, model: MODEL, installed: true })
  assert.deepEqual(trace, ['config', 'binary', 'catalog'])
  for (const catalog of [{}, { data: [] }, { data: [{ id: 'other' }] }, { data: [{ id: 'big-pickle' }, { id: 'big-pickle' }] }]) {
    assert.deepEqual(await probeModelState({ ...dependencies, getCatalog: async () => catalog }), {
      ok: false, model: MODEL, installed: true,
    })
  }
  let remoteCalled = false
  const missingBinary = await probeModelState({
    ...dependencies, verifyBinary: async () => false,
    getCatalog: async () => { remoteCalled = true; throw new Error('not allowed') },
  })
  assert.deepEqual(missingBinary, { ok: false, model: MODEL, installed: false })
  assert.equal(remoteCalled, false)
  assert.deepEqual(await probeModelState({ readConfig: () => { throw new Error('secret-path-must-not-leak') } }), {
    ok: false, model: null, installed: false,
  })
  assert.deepEqual(await probeModelState({ ...dependencies, getCatalog: async () => { throw new Error('network detail') } }), {
    ok: false, model: MODEL, installed: true,
  })
})

function mockCatalogTransport(deliver) {
  const observed = {}
  return {
    observed,
    get(url, options, callback) {
      observed.url = String(url)
      observed.options = options
      const request = new EventEmitter()
      request.destroy = () => { observed.requestDestroyed = true }
      const response = new EventEmitter()
      response.destroy = () => { observed.responseDestroyed = true }
      queueMicrotask(() => deliver(callback, response))
      return request
    },
  }
}

test('catalogul folosește numai GET HTTPS IPv4 fix, fără chei, prompturi sau redirect', async () => {
  const transport = mockCatalogTransport((callback, response) => {
    response.statusCode = 200
    callback(response)
    response.emit('data', Buffer.from('{"data":[{"id":"big-pickle"}]}'))
    response.emit('end')
  })
  assert.deepEqual(await requestProviderCatalog(transport), { data: [{ id: 'big-pickle' }] })
  assert.equal(transport.observed.url, 'https://opencode.ai/zen/v1/models')
  assert.deepEqual(transport.observed.options, {
    agent: false, family: 4, headers: { accept: 'application/json', connection: 'close' },
  })
  for (const status of [301, 401, 429, 500]) {
    const failed = mockCatalogTransport((callback, response) => { response.statusCode = status; callback(response) })
    await assert.rejects(requestProviderCatalog(failed), /provider_catalog_status/)
    assert.equal(failed.observed.responseDestroyed, true)
  }
})

test('catalogul refuză corp oversized, JSON invalid, transport întrerupt și deadline depășit', async (context) => {
  for (const [chunk, code] of [[Buffer.alloc(512 * 1024 + 1), 'size'], [Buffer.from('{'), 'json']]) {
    const transport = mockCatalogTransport((callback, response) => {
      response.statusCode = 200
      callback(response)
      response.emit('data', chunk)
      response.emit('end')
    })
    await assert.rejects(requestProviderCatalog(transport), new RegExp('provider_catalog_' + code))
  }
  const aborted = mockCatalogTransport((callback, response) => {
    response.statusCode = 200
    callback(response)
    response.emit('aborted')
  })
  await assert.rejects(requestProviderCatalog(aborted), /provider_catalog_transport/)
  const pending = mockCatalogTransport(() => {})
  const keepAlive = setTimeout(() => {}, 1_000)
  context.after(() => clearTimeout(keepAlive))
  await assert.rejects(requestProviderCatalog({ ...pending, timeoutMs: 10 }), /provider_catalog_timeout/)
  assert.equal(pending.observed.requestDestroyed, true)
})

test('un provider indisponibil nu este afișat activ sau gata', async (context) => {
  const control = await listenControl(readyDependencies({
    probeState: async () => ({ ok: false, model: MODEL, installed: true }),
  }))
  context.after(() => control.close())
  const response = await signedRequest(control.endpoint, '/v1/model/state', {})
  assert.equal(response.status, 200)
  assert.deepEqual(response.body, {
    mode: 'manual', defaultProfile: 'fast', status: 'unavailable', activeProfile: null,
    requestedProfile: null, requestId: null, installedProfiles: ['fast'], model: MODEL,
  })
})

test('deployment journal blochează citirea înainte și după dobândirea lease-ului', async (context) => {
  for (const blockerCall of [1, 2, 3]) {
    let reads = 0
    let probes = 0
    let releases = 0
    const control = await listenControl(readyDependencies({
      deploymentPending: () => ++reads === blockerCall,
      probeState: async () => { probes += 1; return { ok: true, model: MODEL, installed: true } },
      publicationBarrier: { acquire: async () => ({ release: async () => { releases += 1 } }) },
    }))
    context.after(() => control.close())
    const response = await signedRequest(control.endpoint, '/v1/model/state', {})
    assert.equal(response.status, 503)
    assert.deepEqual(response.body, { error: 'deployment_in_progress' })
    assert.equal(probes, blockerCall === 3 ? 1 : 0)
    assert.equal(releases, blockerCall === 1 ? 0 : 1)
  }
})

test('publication lease protejează snapshotul și serializează flock-ul real', async (context) => {
  const directory = mkdtempSync(join(tmpdir(), 'constructor-provider-lock-'))
  context.after(() => rmSync(directory, { recursive: true, force: true }))
  const path = join(directory, 'publication.lock')
  writeFileSync(path, '', { mode: 0o600 })
  chmodSync(path, 0o600)
  await assertRealPublicationBarrier(path)
  const trace = []
  const control = await listenControl(readyDependencies({
    probeState: async () => { trace.push('probe'); return { ok: true, model: MODEL, installed: true } },
    publicationBarrier: { acquire: async () => {
      trace.push('acquire')
      return { release: async () => { trace.push('release') } }
    } },
  }))
  context.after(() => control.close())
  assert.equal((await signedRequest(control.endpoint, '/v1/model/state', {})).status, 200)
  assert.deepEqual(trace, ['acquire', 'probe', 'release'])
})

test('controllerul read-only păstrează socketul, credentiala și barierele fără lansări de model', () => {
  const source = readFileSync(new URL('./constructor-model-control.mjs', import.meta.url), 'utf8')
  const unit = readFileSync(new URL('./systemd/kelion-constructor-model-control.service', import.meta.url), 'utf8')
  assert.match(unit, /^User=root$/m)
  assert.match(unit, /^LoadCredential=constructor-model-control-secret:/m)
  assert.match(unit, /^RuntimeDirectoryMode=0750$/m)
  assert.match(unit, /^RuntimeDirectoryPreserve=yes$/m)
  assert.match(unit, /^ExecStartPre=.*constructor-model-switch --prepare-lock$/m)
  assert.match(unit, /^BindReadOnlyPaths=.*deploy-journals$/m)
  assert.match(unit, /^RestrictAddressFamilies=AF_UNIX AF_INET$/m)
  assert.doesNotMatch(unit, /IPAddressDeny=any|AF_INET6|private-ai-llm|ReadWritePaths=.*\/etc/)
  assert.match(source, /startupDeploymentEntryExists\(\)/)
  assert.match(source, /chmodSync\(CONTROL_SOCKET, 0o660\)/)
  assert.equal(source.split("execute('/usr/bin/systemctl', ['show'").length - 1, 1)
  assert.doesNotMatch(source, /llama|qwen|spawnModelSwitch|recoverInterruptedSwitch|createTransactionStore/i)
})


test('host observation uses only fixed read-only systemd units and preserves pause', async () => {
  const calls = []
  const state = await probeWorkerState({ readWorkerPause: () => true,
    runCommand: async (command, args, timeout) => {
      calls.push({ command, args, timeout })
      return { code: 0, signal: null, failed: false,
        stdout: args.at(-1).endsWith('.timer') ? 'LoadState=loaded\nActiveState=inactive' : 'MainPID=0\nLoadState=loaded\nActiveState=inactive' }
    } })
  assert.equal(state.intentionalPause, true)
  assert.deepEqual(state.worker, { timer:'inactive', service:'inactive', mainPid:0 })
  assert.equal(state.deployGate, false)
  assert.equal(calls.length,2)
  assert.ok(calls.every(c => c.command === '/usr/bin/systemctl' && c.args[0] === 'show' && c.timeout === 3000))
})

test('host observation refuses malformed, failed and contradictory process states', async () => {
  for (const stdout of ['LoadState=not-found\nActiveState=inactive', 'LoadState=loaded\nActiveState=active\nMainPID=4',
    'LoadState=loaded\nActiveState=inactive\nActiveState=active', 'garbage']) {
    await assert.rejects(probeWorkerState({ readWorkerPause:()=>false,
      runCommand:async()=>({ code:0,signal:null,failed:false,stdout }) }))
  }
  await assert.rejects(probeWorkerState({readWorkerPause:()=>{throw Error('invalid') }}))
  await assert.rejects(probeWorkerState({readWorkerPause:()=>false,
    runCommand:async()=>({ code:0,signal:null,failed:true,stdout:'' }) }))
})

test('worker host wire requires HMAC and exact empty body and cannot mutate model', async () => {
  const host = {schema:1,measuredAt:new Date().toISOString(),worker:{timer:'inactive',service:'inactive',mainPid:0},intentionalPause:true,deployGate:false}
  let probes=0
  const control = await listenControl(readyDependencies({probeWorkerState:async()=>{probes++;return host}}))
  try {
    const valid = await signedRequest(control.endpoint,'/v1/worker/state',{})
    assert.equal(valid.status,200)
    assert.deepEqual(valid.body,host)
    assert.equal(probes,1)
    assert.equal((await signedRequest(control.endpoint,'/v1/worker/state',{unit:'other'})).status,422)
    assert.equal((await signedRequest(control.endpoint,'/v1/worker/state',{}, {signature:'x'})).status,401)
    assert.equal(probes,1)
  } finally {await control.close()}
})


test('worker pause validates parent ownership before absence and refuses disappearance races', () => {
  const directory='/etc/kelion', marker=directory+'/codex-worker.paused'
  const parent={isDirectory:()=>true,isSymbolicLink:()=>false,uid:0,gid:0,mode:0o755,dev:1,ino:2}
  const file={isFile:()=>true,isSymbolicLink:()=>false,nlink:1,uid:0,gid:0,mode:0o444,size:9,dev:1,ino:3}
  const missing=()=>{throw Object.assign(Error('absent'),{code:'ENOENT'})}
  const base={lstatSync:p=>p===directory?parent:file,realpathSync:p=>p,openSync:()=>4,
    fstatSync:()=>file,readFileSync:()=> 'schema=1\n',closeSync:()=>{}}
  assert.equal(readWorkerPause(base),true)
  assert.equal(readWorkerPause({...base,lstatSync:p=>p===directory?parent:missing()}),false)
  for(const unsafe of [{uid:1},{gid:1},{mode:0o775},{isSymbolicLink:()=>true},{isDirectory:()=>false}]) {
    assert.throws(()=>readWorkerPause({...base,lstatSync:p=>p===directory?{...parent,...unsafe}:missing()}))
  }
  assert.throws(()=>readWorkerPause({...base,realpathSync:p=>p===directory?'/tmp/else':p}))
  assert.throws(()=>readWorkerPause({...base,openSync:missing}),/absent/)
  let leafReads=0
  assert.throws(()=>readWorkerPause({...base,lstatSync:p=>p===directory?parent:++leafReads===1?file:missing()}),/absent/)
  assert.throws(()=>readWorkerPause({...base,lstatSync:p=>p===directory?parent:{...file,isSymbolicLink:()=>true}}))
  let parentReads=0
  assert.throws(()=>readWorkerPause({...base,lstatSync:p=>p===directory?{...parent,ino:++parentReads===1?2:9}:file}))
  let closed=false
  assert.throws(()=>readWorkerPause({...base,readFileSync:()=> 'schema=2\n',closeSync:()=>{closed=true}}))
  assert.equal(closed,true)
  assert.equal(marker,'/etc/kelion/codex-worker.paused')
})

test('worker observation reports an authenticated held publication barrier without fabricated process state', async (context) => {
  let probes = 0, acquisitions = 0
  const control = await listenControl(readyDependencies({
    deploymentPending: () => true,
    publicationBarrier: { acquire: async (options) => {
      acquisitions += 1
      assert.deepEqual(options, { observeContention: true })
      return { contended: true }
    } },
    probeWorkerState: async () => { probes += 1; throw new Error('must_not_probe_during_gate') },
  }))
  context.after(() => control.close())
  const response = await signedRequest(control.endpoint, '/v1/worker/state', {})
  assert.equal(response.status, 200)
  assert.deepEqual(response.body, { schema: 1, measuredAt: response.body.measuredAt,
    worker: null, intentionalPause: null, deployGate: true })
  assert.ok(Number.isFinite(Date.parse(response.body.measuredAt)))
  assert.equal(probes, 0)
  assert.equal(acquisitions, 1)
  assert.equal((await signedRequest(control.endpoint, '/v1/worker/state', { unit: 'foreign' })).status, 422)
  assert.equal((await signedRequest(control.endpoint, '/v1/worker/state', {}, { signature: 'x' })).status, 401)
  assert.equal(acquisitions, 1)
})

test('worker gate observation never promotes invalid locks or unknown pending state into a measured gate', async (context) => {
  for (const lock of [null, { release: async () => {} }]) {
    const control = await listenControl(readyDependencies({
      deploymentPending: () => true,
      publicationBarrier: { acquire: async () => lock },
      probeWorkerState: async () => { throw new Error('must_not_probe') },
    }))
    context.after(() => control.close())
    const response = await signedRequest(control.endpoint, '/v1/worker/state', {})
    assert.equal(response.status, 503)
    assert.deepEqual(response.body, { error: 'deployment_in_progress' })
  }
})
