#!/usr/bin/env node
import { createHash, createHmac } from 'node:crypto'
import { createReadStream, lstatSync, readFileSync, writeFileSync, chmodSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

function hmac(key, value) {
  return createHmac('sha256', key).update(value, 'utf8').digest('hex')
}

export function databaseFingerprint(databaseUrl, proofKey) {
  const url = new URL(databaseUrl)
  const host = url.hostname.toLowerCase()
  const port = url.port || '5432'
  const database = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
  if (!host || !database || !/^\d{1,5}$/.test(port)) throw new Error('database_identity_invalid')
  return hmac(proofKey, `kelion:database-fingerprint:v1\n${host}\n${port}\n${database}`)
}

export function signedBackupProof({ backupSha256, databaseUrl, proofKey, completedAt }) {
  if (!/^[a-f0-9]{64}$/.test(backupSha256) || proofKey.length < 32 || !Number.isFinite(Date.parse(completedAt))) {
    throw new Error('backup_proof_input_invalid')
  }
  const backupId = `sha256:${backupSha256}`
  const fingerprint = databaseFingerprint(databaseUrl, proofKey)
  const canonical = `kelion:migration-backup-proof:v1\n${backupId}\n${backupSha256}\n${fingerprint}\n${completedAt}`
  return {
    backupId,
    backupSha256,
    databaseFingerprint: fingerprint,
    completedAt,
    signatureHmacSha256: hmac(proofKey, canonical),
  }
}

async function sha256File(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

function regularReadable(path, maxBytes = Number.MAX_SAFE_INTEGER) {
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > maxBytes) throw new Error('backup_proof_file_invalid')
}

export async function main() {
  const backupFile = process.env.KELION_BACKUP_FILE?.trim() ?? ''
  const databaseUrlFile = process.env.KELION_DATABASE_URL_FILE?.trim() ?? ''
  const proofKeyFile = process.env.KELION_PROOF_KEY_FILE?.trim() ?? ''
  const outputFile = process.env.KELION_PROOF_OUTPUT_FILE?.trim() ?? ''
  if (![backupFile, databaseUrlFile, proofKeyFile, outputFile].every(Boolean)) throw new Error('backup_proof_paths_required')
  regularReadable(backupFile)
  regularReadable(databaseUrlFile, 65_536)
  regularReadable(proofKeyFile, 65_536)
  const proof = signedBackupProof({
    backupSha256: await sha256File(backupFile),
    databaseUrl: readFileSync(databaseUrlFile, 'utf8').trim(),
    proofKey: readFileSync(proofKeyFile, 'utf8').trim(),
    completedAt: new Date().toISOString(),
  })
  writeFileSync(outputFile, `${JSON.stringify(proof)}\n`, { encoding: 'ascii', mode: 0o600, flag: 'wx' })
  chmodSync(outputFile, 0o600)
  process.stdout.write('migration_backup_proof_created\n')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`migration backup proof failed: ${error instanceof Error ? error.message : 'unknown'}\n`)
    process.exit(1)
  })
}
