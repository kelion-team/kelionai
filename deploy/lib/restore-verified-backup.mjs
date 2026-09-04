#!/usr/bin/env node
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import {
  chmodSync,
  closeSync,
  constants,
  createReadStream,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const PROOF_KEYS = [
  'backupId',
  'backupSha256',
  'completedAt',
  'databaseFingerprint',
  'signatureHmacSha256',
]
const MANIFEST_KEYS = ['ciphertextSha256', 'format', 'hmacSha256']
const RESTORE_JOURNAL_KEYS = [
  'backupPath',
  'backupSha256',
  'backupSizeBytes',
  'destinationDatabase',
  'failedDatabase',
  'host',
  'kind',
  'phase',
  'port',
  'quarantineDatabase',
  'schema',
  'scratchDatabase',
  'scratchOid',
  'targetOid',
  'user',
]
const BACKUP_NAME = /^kelion-\d{4}-\d{2}-\d{2}_\d{6}\.dump\.enc$/
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_$]{0,62}$/
const HEX_SHA256 = /^[a-f0-9]{64}$/
const PROOF_MAX_AGE_MS = 24 * 60 * 60 * 1000
const RESTORE_PHASES = new Set(['restoring', 'swapping', 'rolling_back', 'committed'])

function failure(code) {
  throw new Error(code)
}

function exactKeys(value, expected, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) failure(code)
  const actual = Object.keys(value).sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) failure(code)
}

export function parseCanonicalJson(text, code = 'authenticated_json_invalid') {
  let value
  try {
    value = JSON.parse(text)
  } catch {
    failure(code)
  }
  const canonical = JSON.stringify(value)
  // Reject duplicate members, whitespace variants and trailing material. The
  // producer writes compact JSON, so accepting only the parsed member order's
  // compact representation removes parser-dependent ambiguity.
  if (text !== canonical && text !== `${canonical}\n`) failure(code)
  return value
}

function decodeUrlComponent(value) {
  try {
    return decodeURIComponent(value)
  } catch {
    failure('database_url_invalid')
  }
}

export function parseLocalSocketDatabaseUrl(databaseUrl) {
  let url
  try {
    url = new URL(databaseUrl)
  } catch {
    failure('database_url_invalid')
  }
  const entries = [...url.searchParams.entries()]
  const hosts = entries.filter(([key]) => key === 'host').map(([, value]) => value)
  const ports = entries.filter(([key]) => key === 'port').map(([, value]) => value)
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol)
    || url.hostname !== 'localhost'
    || url.hash
    || entries.some(([key]) => !['host', 'port'].includes(key))
    || hosts.length !== 1
    || hosts[0] !== '/var/run/postgresql'
    || ports.length > 1
  ) failure('database_url_outside_local_socket_contract')

  const database = decodeUrlComponent(url.pathname.replace(/^\/+/, ''))
  const user = decodeUrlComponent(url.username)
  const password = decodeUrlComponent(url.password)
  const urlPort = url.port || '5432'
  const port = ports[0] || urlPort
  if (
    !IDENTIFIER.test(database)
    || !IDENTIFIER.test(user)
    || ['postgres', 'template0', 'template1'].includes(database)
    || !/^\d{1,5}$/.test(port)
    || Number(port) < 1
    || Number(port) > 65_535
    || database.includes('/')
    || [database, user, password].some((value) => /[\0\r\n]/.test(value))
  ) failure('database_identity_invalid')
  // Existing signed migration proofs bind url.port (or 5432), while libpq can
  // also receive a query port. Refuse two identities instead of validating one
  // port and connecting to another.
  if (ports.length === 1 && ports[0] !== urlPort) failure('database_port_ambiguous')
  return { database, host: hosts[0], password, port, user }
}

function hmacHex(key, value) {
  return createHmac('sha256', key).update(value).digest('hex')
}

function equalHex(left, right) {
  return HEX_SHA256.test(left)
    && HEX_SHA256.test(right)
    && timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'))
}

export function databaseFingerprint(identity, proofKey) {
  if (proofKey.length < 32) failure('restore_proof_key_invalid')
  return hmacHex(
    proofKey,
    `kelion:database-fingerprint:v1\nlocalhost\n${identity.port}\n${identity.database}`,
  )
}

export function verifyRestoreProof(proof, identity, proofKey, now = Date.now()) {
  exactKeys(proof, PROOF_KEYS, 'restore_proof_shape_invalid')
  const completedAtMs = typeof proof.completedAt === 'string' ? Date.parse(proof.completedAt) : Number.NaN
  const normalizedCompletedAt = Number.isFinite(completedAtMs)
    ? new Date(completedAtMs).toISOString()
    : ''
  const canonicalCompletedAt = typeof proof.completedAt === 'string' && proof.completedAt.includes('.')
    ? proof.completedAt
    : String(proof.completedAt).replace(/Z$/, '.000Z')
  if (
    !HEX_SHA256.test(proof.backupSha256)
    || proof.backupId !== `sha256:${proof.backupSha256}`
    || !HEX_SHA256.test(proof.databaseFingerprint)
    || !HEX_SHA256.test(proof.signatureHmacSha256)
    || typeof proof.completedAt !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(proof.completedAt)
    || !Number.isFinite(completedAtMs)
    || normalizedCompletedAt !== canonicalCompletedAt
    || !Number.isFinite(now)
  ) failure('restore_proof_invalid')
  const expectedFingerprint = databaseFingerprint(identity, proofKey)
  const canonical = `kelion:migration-backup-proof:v1\n${proof.backupId}\n${proof.backupSha256}\n${proof.databaseFingerprint}\n${proof.completedAt}`
  const expectedSignature = hmacHex(proofKey, canonical)
  if (
    !equalHex(proof.databaseFingerprint, expectedFingerprint)
    || !equalHex(proof.signatureHmacSha256, expectedSignature)
  ) failure('restore_proof_authentication_failed')
  if (completedAtMs > now || completedAtMs < now - PROOF_MAX_AGE_MS) {
    failure('restore_proof_invalid_or_stale')
  }
  return proof.backupSha256
}

export function assertSecureFileStat(stat, { label, maxBytes = Number.MAX_SAFE_INTEGER, modes = [0o600], rootGroup = true }) {
  if (
    !stat.isFile()
    || stat.isSymbolicLink()
    || stat.nlink !== 1
    || stat.uid !== 0
    || (rootGroup && stat.gid !== 0)
    || !modes.includes(stat.mode & 0o777)
    || stat.size <= 0
    || stat.size > maxBytes
  ) failure(`${label}_file_security_invalid`)
}

function assertSecureDirectory(path) {
  const stat = lstatSync(path)
  if (
    !stat.isDirectory()
    || stat.isSymbolicLink()
    || stat.uid !== 0
    || stat.gid !== 0
    || (stat.mode & 0o777) !== 0o700
  ) failure('backup_directory_security_invalid')
}

async function sha256File(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

async function hmacFile(path, key) {
  const hmac = createHmac('sha256', key)
  for await (const chunk of createReadStream(path)) hmac.update(chunk)
  return hmac.digest('hex')
}

export function verifyBackupManifest({ manifest, backupSha256, ciphertextHmacSha256 }) {
  exactKeys(manifest, MANIFEST_KEYS, 'backup_manifest_shape_invalid')
  if (
    manifest.format !== 'kelion-backup-v1'
    || !equalHex(String(manifest.ciphertextSha256 ?? ''), backupSha256)
    || !equalHex(String(manifest.hmacSha256 ?? ''), ciphertextHmacSha256)
  ) failure('backup_manifest_authentication_failed')
}

export function deriveBackupKeys(masterKey) {
  if (masterKey.length < 48) failure('backup_master_key_invalid')
  return {
    authentication: createHmac('sha256', masterKey)
      .update('kelion-backup-authentication-v1')
      .digest(),
    encryption: createHmac('sha256', masterKey)
      .update('kelion-backup-encryption-v1')
      .digest('hex'),
  }
}

export function requireUniqueBackup(matches) {
  if (matches.length !== 1) failure(matches.length ? 'backup_hash_ambiguous' : 'backup_hash_not_found')
  return matches[0]
}

export function deriveRestoreNames({ backupPath, backupSha256, database, user }) {
  if (
    typeof backupPath !== 'string'
    || backupPath !== resolve(backupPath)
    || !BACKUP_NAME.test(basename(backupPath))
    || !HEX_SHA256.test(backupSha256)
    || !IDENTIFIER.test(database)
    || !IDENTIFIER.test(user)
  ) failure('restore_identity_invalid')
  const intent = createHash('sha256')
    .update(`kelion:restore-database-intent:v1\n${backupPath}\n${backupSha256}\n${database}\n${user}`)
    .digest('hex')
    .slice(0, 12)
  return {
    failedDatabase: `kelion_restore_failed_${intent}`,
    quarantineDatabase: `kelion_quarantine_${intent}`,
    scratchDatabase: `kelion_restore_${intent}`,
  }
}

export function validateRestoreJournal(journal, { backupDirectory, identity }) {
  exactKeys(journal, RESTORE_JOURNAL_KEYS, 'restore_journal_shape_invalid')
  const backupRoot = resolve(backupDirectory)
  const backupPath = typeof journal.backupPath === 'string' ? journal.backupPath : ''
  const names = deriveRestoreNames({
    backupPath,
    backupSha256: String(journal.backupSha256 ?? ''),
    database: String(journal.destinationDatabase ?? ''),
    user: String(journal.user ?? ''),
  })
  if (
    journal.schema !== 1
    || journal.kind !== 'restore-verified-backup'
    || !RESTORE_PHASES.has(journal.phase)
    || dirname(backupPath) !== backupRoot
    || backupPath !== join(backupRoot, basename(backupPath))
    || !Number.isSafeInteger(journal.backupSizeBytes)
    || journal.backupSizeBytes <= 0
    || !Number.isSafeInteger(journal.targetOid)
    || journal.targetOid <= 0
    || !(
      journal.scratchOid === null
      || (Number.isSafeInteger(journal.scratchOid) && journal.scratchOid > 0)
    )
    || (['swapping', 'committed'].includes(journal.phase) && journal.scratchOid === null)
    || journal.destinationDatabase !== identity.database
    || journal.host !== identity.host
    || journal.port !== identity.port
    || journal.user !== identity.user
    || journal.scratchDatabase !== names.scratchDatabase
    || journal.quarantineDatabase !== names.quarantineDatabase
    || journal.failedDatabase !== names.failedDatabase
  ) failure('restore_journal_invalid')
  return journal
}

export async function findAuthenticatedBackup({ backupDirectory, backupSha256, masterKey }) {
  assertSecureDirectory(backupDirectory)
  const matches = []
  for (const entry of readdirSync(backupDirectory, { withFileTypes: true })) {
    if (!entry.name.endsWith('.dump.enc')) continue
    if (!BACKUP_NAME.test(entry.name)) failure('backup_filename_invalid')
    const candidate = join(backupDirectory, entry.name)
    const stat = lstatSync(candidate)
    assertSecureFileStat(stat, { label: 'backup', modes: [0o600] })
    if (await sha256File(candidate) === backupSha256) matches.push(candidate)
  }
  const backupPath = requireUniqueBackup(matches)
  const manifestPath = `${backupPath}.mac`
  assertSecureFileStat(lstatSync(manifestPath), { label: 'backup_manifest', maxBytes: 4096, modes: [0o600] })
  const { authentication, encryption } = deriveBackupKeys(masterKey)
  verifyBackupManifest({
    manifest: parseCanonicalJson(readFileSync(manifestPath, 'ascii'), 'backup_manifest_json_invalid'),
    backupSha256,
    ciphertextHmacSha256: await hmacFile(backupPath, authentication),
  })
  return { backupPath, encryption }
}

function readSecureFile(path, options) {
  assertSecureFileStat(lstatSync(path), options)
  return readFileSync(path)
}

function readSecureJournal(path) {
  let before
  let fd
  try {
    before = lstatSync(path)
    assertSecureFileStat(before, {
      label: 'restore_journal',
      maxBytes: 4096,
      modes: [0o600],
    })
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    const opened = fstatSync(fd)
    assertSecureFileStat(opened, {
      label: 'restore_journal',
      maxBytes: 4096,
      modes: [0o600],
    })
    if (opened.dev !== before.dev || opened.ino !== before.ino) {
      failure('restore_journal_file_security_invalid')
    }
    const value = readFileSync(fd)
    const after = lstatSync(path)
    if (
      after.dev !== opened.dev
      || after.ino !== opened.ino
      || after.nlink !== 1
      || after.uid !== 0
      || after.gid !== 0
      || (after.mode & 0o777) !== 0o600
    ) failure('restore_journal_file_security_invalid')
    return value
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (/^restore_journal_[a-z0-9_]+$/.test(message)) throw error
    failure('restore_journal_file_security_invalid')
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

function writeExclusive(path, value, mode) {
  writeFileSync(path, value, { flag: 'wx', mode })
  chmodSync(path, mode)
}

function pgPassEscape(value) {
  return value.replaceAll('\\', '\\\\').replaceAll(':', '\\:')
}

function safeError(error) {
  const message = error instanceof Error ? error.message : ''
  return /^[a-z0-9_]+$/.test(message) ? message : 'restore_validation_failed'
}

export async function main() {
  const paths = {
    backupDirectory: process.env.KELION_BACKUP_DIRECTORY?.trim() ?? '',
    backupKey: process.env.KELION_BACKUP_KEY_FILE?.trim() ?? '',
    databaseUrl: process.env.KELION_DATABASE_URL_FILE?.trim() ?? '',
    encryptionKey: process.env.KELION_RESTORE_ENCRYPTION_KEY_FILE?.trim() ?? '',
    journal: process.env.KELION_RESTORE_JOURNAL_FILE?.trim() ?? '',
    pgpass: process.env.KELION_RESTORE_PGPASS_FILE?.trim() ?? '',
    plan: process.env.KELION_RESTORE_PLAN_FILE?.trim() ?? '',
    proof: process.env.KELION_RESTORE_PROOF_FILE?.trim() ?? '',
    proofKey: process.env.KELION_PROOF_KEY_FILE?.trim() ?? '',
  }
  const journalMode = paths.journal.length > 0
  const requiredPaths = journalMode
    ? [paths.backupDirectory, paths.backupKey, paths.databaseUrl, paths.encryptionKey, paths.journal, paths.pgpass, paths.plan]
    : [paths.backupDirectory, paths.backupKey, paths.databaseUrl, paths.encryptionKey, paths.pgpass, paths.plan, paths.proof, paths.proofKey]
  if (
    requiredPaths.some((value) => !value || /[\0\r\n]/.test(value))
    || Object.values(paths).some((value) => /[\0\r\n]/.test(value))
  ) failure('restore_paths_invalid')

  const databaseUrl = readSecureFile(paths.databaseUrl, {
    label: 'database_url',
    maxBytes: 65_536,
    modes: [0o400, 0o440, 0o600],
    rootGroup: false,
  }).toString('utf8').trim()
  const masterKey = readSecureFile(paths.backupKey, {
    label: 'backup_master_key',
    maxBytes: 65_536,
    modes: [0o600],
  }).toString('utf8').trim()
  const identity = parseLocalSocketDatabaseUrl(databaseUrl)
  let backupSha256
  let expectedBackupPath = ''
  let expectedBackupSize = 0
  let targetOid = null
  let scratchOid = null
  if (journalMode) {
    const journal = validateRestoreJournal(
      parseCanonicalJson(readSecureJournal(paths.journal).toString('ascii'), 'restore_journal_json_invalid'),
      { backupDirectory: paths.backupDirectory, identity },
    )
    backupSha256 = journal.backupSha256
    expectedBackupPath = journal.backupPath
    expectedBackupSize = journal.backupSizeBytes
    targetOid = journal.targetOid
    scratchOid = journal.scratchOid
  } else {
    const proofKey = readSecureFile(paths.proofKey, {
      label: 'restore_proof_key',
      maxBytes: 65_536,
      modes: [0o400, 0o440, 0o600],
      rootGroup: false,
    }).toString('utf8').trim()
    const proof = parseCanonicalJson(readSecureFile(paths.proof, {
      label: 'restore_proof',
      maxBytes: 65_536,
      modes: [0o600],
    }).toString('ascii'), 'restore_proof_json_invalid')
    backupSha256 = verifyRestoreProof(proof, identity, proofKey)
  }
  const { backupPath, encryption } = await findAuthenticatedBackup({
    backupDirectory: paths.backupDirectory,
    backupSha256,
    masterKey,
  })
  const resolvedBackupPath = resolve(backupPath)
  const backupSizeBytes = lstatSync(resolvedBackupPath).size
  if (
    journalMode
    && (resolvedBackupPath !== expectedBackupPath || backupSizeBytes !== expectedBackupSize)
  ) failure('restore_journal_backup_identity_changed')
  const names = deriveRestoreNames({
    backupPath: resolvedBackupPath,
    backupSha256,
    database: identity.database,
    user: identity.user,
  })
  const plan = {
    schema: 1,
    backupPath: resolvedBackupPath,
    backupSha256,
    backupSizeBytes,
    database: identity.database,
    host: identity.host,
    port: identity.port,
    user: identity.user,
    scratchDatabase: names.scratchDatabase,
    scratchOid,
    quarantineDatabase: names.quarantineDatabase,
    failedDatabase: names.failedDatabase,
    targetOid,
  }
  if (basename(plan.backupPath) !== basename(backupPath)) failure('backup_path_invalid')
  writeExclusive(paths.plan, `${JSON.stringify(plan)}\n`, 0o600)
  writeExclusive(paths.encryptionKey, `${encryption}\n`, 0o400)
  writeExclusive(
    paths.pgpass,
    `*:${pgPassEscape(identity.port)}:*:${pgPassEscape(identity.user)}:${pgPassEscape(identity.password)}\n`,
    0o400,
  )
  process.stdout.write('restore_backup_validated\n')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`restore backup validation failed: ${safeError(error)}\n`)
    process.exit(1)
  })
}
