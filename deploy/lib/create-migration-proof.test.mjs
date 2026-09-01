import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { databaseFingerprint, signedBackupProof } from './create-migration-proof.mjs'

test('dovada backup este legată HMAC de baza și hashul exact', () => {
  const key = 'k'.repeat(32)
  const backupSha256 = 'a'.repeat(64)
  const databaseUrl = 'postgresql://user@database.internal:5433/kelion'
  const completedAt = '2026-08-24T00:00:00.000Z'
  const fingerprint = databaseFingerprint(databaseUrl, key)
  const expectedFingerprint = createHmac('sha256', key)
    .update('kelion:database-fingerprint:v1\ndatabase.internal\n5433\nkelion')
    .digest('hex')
  assert.equal(fingerprint, expectedFingerprint)
  const proof = signedBackupProof({ backupSha256, databaseUrl, proofKey: key, completedAt })
  assert.equal(proof.backupId, `sha256:${backupSha256}`)
  assert.equal(proof.databaseFingerprint, fingerprint)
  assert.match(proof.signatureHmacSha256, /^[a-f0-9]{64}$/)
  assert.throws(() => signedBackupProof({ backupSha256, databaseUrl: 'not-a-url', proofKey: key, completedAt }))
})
