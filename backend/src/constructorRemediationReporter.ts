/**
 * VPS operator entrypoint, delivered by tsc and Docker's backend/dist COPY.
 * In the already verified active app container, root runs:
 * docker exec -i --user 0 <verified-active-container> node /app/backend/dist/constructorRemediationReporter.js register
 * Use report instead of register for a subsequent measured event. Stdin is one
 * JSON envelope {input: ExternalRemediationInput, expectedExecutionId?: UUID};
 * expectedExecutionId is permitted only for an explicitly authorized takeover.
 * Never add --env overrides: inherit the live container's mounted secrets and
 * release marker. Registration is only a baseline, never execution evidence.
 */
const MAX_INPUT_BYTES = 8192
const INPUT_TIMEOUT_MS = 5000
const errors = new Set([
  'constructor_reporter_root_required', 'constructor_reporter_operation_invalid',
  'constructor_reporter_input_invalid', 'constructor_reporter_input_too_large',
  'constructor_reporter_input_timeout', 'constructor_reporter_release_environment_invalid',
  'constructor_reporter_release_inactive', 'constructor_reporter_database_unavailable',
])

async function readInput(): Promise<unknown> {
  if (process.stdin.isTTY) throw new Error('constructor_reporter_input_invalid')
  const bytes = await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    const finish = (error?: Error): void => {
      clearTimeout(deadline)
      process.stdin.off('data', data)
      process.stdin.off('end', end)
      process.stdin.off('error', failed)
      if (error) { process.stdin.destroy(); reject(error) }
      else resolve(Buffer.concat(chunks, size))
    }
    const data = (chunk: Buffer): void => {
      size += chunk.length
      if (size > MAX_INPUT_BYTES) finish(new Error('constructor_reporter_input_too_large'))
      else chunks.push(chunk)
    }
    const end = (): void => finish()
    const failed = (): void => finish(new Error('constructor_reporter_input_invalid'))
    const deadline = setTimeout(() => finish(new Error('constructor_reporter_input_timeout')), INPUT_TIMEOUT_MS)
    process.stdin.on('data', data).once('end', end).once('error', failed)
  })
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) }
  catch { throw new Error('constructor_reporter_input_invalid') }
}

async function main(): Promise<void> {
  let close: (() => Promise<void>) | undefined
  try {
    if (process.platform !== 'linux' || process.getuid?.() !== 0 || process.geteuid?.() !== 0) {
      throw new Error('constructor_reporter_root_required')
    }
    const operation = process.argv[2]
    if (process.argv.length !== 3 || !['register', 'report'].includes(operation)) {
      throw new Error('constructor_reporter_operation_invalid')
    }
    // A short-lived import must not fall through releaseActivation's development
    // default. Require the exact blue/green runtime environment before loading it.
    const sha = process.env.GIT_COMMIT_SHA ?? ''
    if (process.env.NODE_ENV !== 'production' || process.env.RELEASE_CANDIDATE_MODE !== '1'
      || !/^[0-9a-f]{40}$/.test(sha) || process.env.RELEASE_ID !== sha
      || process.env.RELEASE_ACTIVATION_FILE !== '/run/kelion-release/active') {
      throw new Error('constructor_reporter_release_environment_invalid')
    }
    const { config } = await import('./config.js')
    const { releaseSideEffectsEnabled } = await import('./services/releaseActivation.js')
    if (!config.release.candidateMode || config.release.id !== sha
      || config.release.activationFile !== process.env.RELEASE_ACTIVATION_FILE) {
      throw new Error('constructor_reporter_release_environment_invalid')
    }
    if (!releaseSideEffectsEnabled()) throw new Error('constructor_reporter_release_inactive')
    const envelope = await readInput()
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)
      || !Object.hasOwn(envelope, 'input')
      || Object.keys(envelope).some(key => !['input', 'expectedExecutionId'].includes(key))
      || (operation === 'report' && Object.hasOwn(envelope, 'expectedExecutionId'))) {
      throw new Error('constructor_reporter_input_invalid')
    }
    const request = envelope as { input: unknown; expectedExecutionId?: unknown }
    if (request.expectedExecutionId !== undefined && typeof request.expectedExecutionId !== 'string') {
      throw new Error('constructor_reporter_input_invalid')
    }
    const { dbEnabled, inchidePool } = await import('./db.js')
    close = inchidePool
    if (!dbEnabled()) throw new Error('constructor_reporter_database_unavailable')
    const { registerExternalRemediation, recordExternalRemediation } = await import('./services/constructorExternalRemediation.js')
    // Recheck after bounded stdin; both canonical writers independently recheck.
    if (!releaseSideEffectsEnabled()) throw new Error('constructor_reporter_release_inactive')
    let result
    try {
      result = operation === 'register'
        ? await registerExternalRemediation(request.input, request.expectedExecutionId)
        : await recordExternalRemediation(request.input)
    } finally {
      await close()
      close = undefined
    }
    process.stdout.write(JSON.stringify({ ok: true, result }) + '\n')
  } catch (error) {
    if (close) await close().catch(() => undefined)
    const code = error instanceof Error && errors.has(error.message) ? error.message : 'constructor_reporter_failed'
    process.stderr.write(JSON.stringify({ ok: false, error: code }) + '\n')
    process.exitCode = 1
  }
}
void main()
