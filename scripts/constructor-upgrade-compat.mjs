import { createHash } from 'node:crypto'
import { constants, closeSync, fstatSync, fsyncSync, ftruncateSync, lstatSync, openSync, readFileSync, realpathSync, writeSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// A real armed upgrade journal pins this exact release. Its immutable runtime
// tuple has nine systemd units after the legacy drop-in was retired, while the
// installer mistakenly counted ten and omitted the root-provisioned handoff
// staging directory. This is a single-release orchestration
// correction, not permission to replace a journal owner or runtime artefact.
const SOURCE_COMMIT = 'e65f0112aa2265fea12bfd248b8da645b428017a'
const ORIGINAL_SHA256 = 'f1a1d60e83bfcd247f8af137f18aa181b30dd5578c6250f68f373c9a9949561e'
const FIXED_SHA256 = 'b3b4a2a6b3189eb0f352c56feed3f5164e0c07fbeaa631bff5901b3a5815d0cd'
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

export function correctPinnedInstaller(sourceCommit, executorCommit, original) {
  if (sourceCommit !== SOURCE_COMMIT || !/^[0-9a-f]{40}$/.test(executorCommit) || executorCommit === sourceCommit
    || !Buffer.isBuffer(original) || sha256(original) !== ORIGINAL_SHA256) throw new Error('constructor_upgrade_compatibility_not_authorized')
  const text = original.toString('utf8')
  const start = text.indexOf('validate_source_systemd_text_files() {')
  const end = text.indexOf('\n}\n', start) + 2
  if (start < 0 || end <= start) throw new Error('constructor_upgrade_compatibility_function_invalid')
  const before = text.slice(start, end)
  const oldPredicate = '[ "$count" -eq 10 ]'
  if (before.split(oldPredicate).length !== 2) throw new Error('constructor_upgrade_compatibility_predicate_invalid')
  const correctedCount = text.slice(0, start) + before.replace(oldPredicate, '[ "$count" -eq 9 ]') + text.slice(end)
  const spoolStart = correctedCount.indexOf('secure_handoff_spool() {')
  const spoolEnd = correctedCount.indexOf('\n}\n', spoolStart) + 2
  if (spoolStart < 0 || spoolEnd <= spoolStart) throw new Error('constructor_upgrade_compatibility_function_invalid')
  const spool = correctedCount.slice(spoolStart, spoolEnd)
  const oldChildren = 'for child in ready ack retired; do'
  if (spool.split(oldChildren).length !== 2) throw new Error('constructor_upgrade_compatibility_spool_invalid')
  const fixed = Buffer.from(correctedCount.slice(0, spoolStart)
    + spool.replace(oldChildren, 'for child in ready ack retired staging; do') + correctedCount.slice(spoolEnd), 'utf8')
  if (sha256(fixed) !== FIXED_SHA256) throw new Error('constructor_upgrade_compatibility_result_invalid')
  return {
    fixed,
    provenance: {
      schema: 1, event: 'constructor_upgrade_compatibility',
      corrections: ['e65-systemd-unit-count', 'e65-handoff-staging-provisioning'],
      sourceCommit, executorCommit, originalInstallerSha256: ORIGINAL_SHA256, fixedInstallerSha256: FIXED_SHA256,
      installedArtifactsChanged: false, journalChanged: false,
    },
  }
}

export function applyPinnedInstallerCorrection(sourceCommit, executorCommit, path) {
  const target = resolve(path)
  const before = lstatSync(target)
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size < 1 || before.size > 2 * 1024 * 1024
    || realpathSync(target) !== target) throw new Error('constructor_upgrade_compatibility_file_invalid')
  const descriptor = openSync(target, constants.O_RDWR | (constants.O_NOFOLLOW ?? 0))
  try {
    const opened = fstatSync(descriptor)
    if (opened.dev !== before.dev || opened.ino !== before.ino) throw new Error('constructor_upgrade_compatibility_file_changed')
    const { fixed, provenance } = correctPinnedInstaller(sourceCommit, executorCommit, readFileSync(descriptor))
    let written = 0
    while (written < fixed.length) {
      const count = writeSync(descriptor, fixed, written, fixed.length - written, written)
      if (count <= 0) throw new Error('constructor_upgrade_compatibility_write_incomplete')
      written += count
    }
    ftruncateSync(descriptor, fixed.length)
    fsyncSync(descriptor)
    const after = lstatSync(target)
    if (after.dev !== opened.dev || after.ino !== opened.ino || after.isSymbolicLink() || after.nlink !== 1) throw new Error('constructor_upgrade_compatibility_file_changed')
    if (sha256(readFileSync(target)) !== FIXED_SHA256) throw new Error('constructor_upgrade_compatibility_write_invalid')
    return provenance
  } finally { closeSync(descriptor) }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 6 || process.argv[2] !== '--apply') throw new Error('constructor_upgrade_compatibility_arguments_invalid')
  process.stdout.write(`${JSON.stringify(applyPinnedInstallerCorrection(process.argv[3], process.argv[4], process.argv[5]))}\n`)
}
