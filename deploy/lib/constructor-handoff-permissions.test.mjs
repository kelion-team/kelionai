import test from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

// This mandatory CI probe runs only inside the dedicated, networkless test
// container. Root provisions its tmpfs fixture; every handoff operation and
// publisher read then runs with different, unprivileged UID/GID identities.
assert.equal(process.platform, 'linux', 'run this probe in the Linux isolation container')
assert.equal(process.getuid(), 0, 'the fixture provisioner must be container root')
assert.equal(fs.existsSync('/.dockerenv'), true, 'do not run identity fixtures on the host')

const source = fs.readFileSync(new URL('../codex-worker.mjs', import.meta.url), 'utf8')
const publicationStart = source.indexOf('function publishHandoff(')
const start = source.indexOf('  const handoffRoot = resolve(HANDOFF_READY', publicationStart)
const end = source.indexOf('  return { handoffId, baseCommit:', start)
assert.ok(publicationStart >= 0 && start > publicationStart && end > start)
const publication = source.slice(start, end)
function extractFunction(name) {
  const begin = source.indexOf(`function ${name}(`)
  const finish = source.indexOf('\n}', begin)
  assert.ok(begin >= 0 && finish > begin)
  return source.slice(begin, finish + 2)
}

const readerSource = `
import * as fs from 'node:fs'; import { join } from 'node:path';
const publisher=process.argv[3]==='publisher';
process.setgroups(publisher?[987]:[]);process.setgid(publisher?985:984);process.setuid(publisher?994:993);
try {
 const patch=fs.readFileSync(join(process.argv[2],'ready','synthetic','patch.diff'),'utf8');
 const receipt=fs.readFileSync(join(process.argv[2],'ready','synthetic','receipt.json'),'utf8');
 console.log(JSON.stringify({ok:true,uid:process.getuid(),gid:process.getgid(),patch,receipt}));
} catch(error){ console.log(JSON.stringify({ok:false,code:error.code,uid:process.getuid()})); }
`
const renameSource = `
import * as fs from 'node:fs'; import { join } from 'node:path';
process.setgroups([987]);process.setgid(986);process.setuid(995);
try {fs.renameSync(join(process.argv[2],'staging'),join(process.argv[2],'replaced'));console.log(JSON.stringify({ok:true}));}
catch(error){console.log(JSON.stringify({ok:false,code:error.code}));}
`
function execute(path, args) {
  const result = spawnSync(process.execPath, [path, ...args], {
    encoding: 'utf8', timeout: 10_000, env: { PATH: '/usr/local/bin:/usr/bin:/bin' },
  })
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}
function fixture(t, withStaging = true) {
  const root = fs.mkdtempSync(join(tmpdir(), 'kelion-handoff-permissions-'))
  fs.chmodSync(root, 0o755)
  const spool = join(root, 'spool')
  t.after(() => {
    // The fixture provisioner deliberately has no DAC_OVERRIDE capability.
    // Remove worker-owned children as the worker, then its root-owned parents.
    const cleanup = spawnSync(process.execPath, ['-e', `
      const fs=require('node:fs'),path=require('node:path');
      process.setgroups([987]);process.setgid(986);process.setuid(995);
      for(const relative of ['ready/synthetic','staging/.synthetic.tmp'])
        fs.rmSync(path.join(process.argv[1],relative),{recursive:true,force:true});
    `, spool], { encoding: 'utf8', timeout: 10_000, env: { PATH: '/usr/local/bin:/usr/bin:/bin' } })
    assert.equal(cleanup.status, 0, cleanup.stderr)
    fs.rmSync(root, { recursive: true, force: true })
  })
  fs.mkdirSync(spool, { mode: 0o750 }); fs.chownSync(spool, 0, 987); fs.chmodSync(spool, 0o750)
  for (const name of withStaging ? ['ready', 'ack', 'retired', 'staging'] : ['ready', 'ack', 'retired']) {
    const path = join(spool, name)
    fs.mkdirSync(path, { mode: 0o2770 }); fs.chownSync(path, 0, 987); fs.chmodSync(path, 0o2770)
    assert.equal(fs.statSync(path).mode & 0o7777, 0o2770, 'fixture setgid must be real')
  }
  const reader = join(root, 'reader.mjs'), rename = join(root, 'rename.mjs')
  fs.writeFileSync(reader, readerSource, { mode: 0o644 }); fs.writeFileSync(rename, renameSource, { mode: 0o644 })
  return { root, spool, reader, rename }
}
function publish(f, fragment = publication) {
  const worker = join(f.root, 'worker.mjs')
  // Extract the actual filesystem block, not a mock of Unix permissions.
  fs.writeFileSync(worker, `
import {mkdirSync,chmodSync,writeFileSync,existsSync,renameSync,rmSync,openSync,fsyncSync,closeSync,statSync} from 'node:fs';
import {join,resolve} from 'node:path';
process.setgroups([987,988]);process.setgid(986);process.setuid(995);process.umask(0o027);
const HANDOFF_READY=join(process.argv[2],'ready'),handoffId='synthetic';
const patchBytes=Buffer.from('synthetic patch\\n'),receiptBytes=Buffer.from('{"synthetic":true}\\n');
const fail=message=>{throw new Error(message)};
class HandoffDurabilityUncertainError extends Error {constructor(cause){super('uncertain');this.cause=cause}}
${extractFunction('fsyncPath')}
${extractFunction('assertDescendant')}
try {
${fragment}
 const file=statSync(join(HANDOFF_READY,handoffId,'patch.diff'));
 const directory=statSync(join(HANDOFF_READY,handoffId));
 console.log(JSON.stringify({ok:true,uid:process.getuid(),gid:process.getgid(),fileUid:file.uid,fileGid:file.gid,fileMode:file.mode&0o7777,childMode:directory.mode&0o7777}));
} catch(error){console.log(JSON.stringify({ok:false,code:error.code,syscall:error.syscall}));}
`, { mode: 0o644 })
  return execute(worker, [f.spool])
}
function assertCanonicalParents(f) {
  assert.equal(fs.statSync(f.spool).mode & 0o7777, 0o750)
  for (const name of ['ready', 'ack', 'retired', 'staging']) {
    const stat = fs.statSync(join(f.spool, name))
    assert.equal(stat.uid, 0); assert.equal(stat.gid, 987); assert.equal(stat.mode & 0o7777, 0o2770)
  }
}

test('handoff actual păstrează grupul publisher după mkdir/write/fsync/rename', (t) => {
  const f = fixture(t)
  const result = publish(f)
  assert.equal(result.ok, true)
  assert.equal(result.uid, 995); assert.equal(result.gid, 986)
  assert.equal(result.fileUid, 995); assert.equal(result.fileGid, 987)
  assert.equal(result.fileMode, 0o440); assert.equal(result.childMode, 0o2750)
  const read = execute(f.reader, [f.spool, 'publisher'])
  assert.equal(read.ok, true); assert.equal(read.uid, 994); assert.equal(read.gid, 985)
  assert.equal(read.patch, 'synthetic patch\n'); assert.equal(read.receipt, '{"synthetic":true}\n')
  assert.equal(execute(f.reader, [f.spool, 'outsider']).code, 'EACCES')
  assert.equal(execute(f.rename, [f.spool]).code, 'EACCES')
  assertCanonicalParents(f)
})

test('controlul e65 cu chmod0750 reproduce EACCES pentru publisher, nu zero erori inventat', (t) => {
  const f = fixture(t)
  const old = publication.replace('chmodSync(staging, 0o2750)', 'chmodSync(staging, 0o750)')
  const result = publish(f, old)
  assert.equal(result.ok, true); assert.equal(result.fileGid, 986); assert.equal(result.fileMode, 0o440)
  assert.equal(execute(f.reader, [f.spool, 'publisher']).code, 'EACCES')
  assertCanonicalParents(f)
})

test('staging absent reproduce eroarea inițială fără a lărgi drepturile părintelui', (t) => {
  const f = fixture(t, false)
  const result = publish(f)
  assert.equal(result.ok, false); assert.equal(result.code, 'EACCES'); assert.equal(result.syscall, 'mkdir')
  assert.equal(fs.statSync(f.spool).mode & 0o7777, 0o750)
  assert.equal(fs.existsSync(join(f.spool, 'staging')), false)
})
