import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { randomBytes, randomUUID } from 'node:crypto'
import { canonicalServiceRequest, createServiceVerifier, signServiceRequest } from './service-auth.mjs'
import { isPublicAddress, parsePublicUrl } from './public-target.mjs'

const cleanup = readFileSync(new URL('../vps-curatenie.sh', import.meta.url), 'utf8')
const deploy = readFileSync(new URL('../deploy.sh', import.meta.url), 'utf8')

test('politica de rețea refuză adrese locale, metadata și porturi interne', () => {
  for (const address of ['127.0.0.1', '10.2.3.4', '169.254.169.254', '172.31.1.1', '192.168.1.1', '::1', 'fc00::1', 'fe80::1', '::ffff:7f00:1']) {
    assert.equal(isPublicAddress(address), false, address)
  }
  assert.equal(isPublicAddress('1.1.1.1'), true)
  assert.equal(isPublicAddress('2606:4700:4700::1111'), true)
  assert.throws(() => parsePublicUrl('http://example.com:22/'), /target_port_blocked/)
  assert.throws(() => parsePublicUrl('http://user@example.com/'), /target_url_blocked/)
})

test('HMAC-ul este legat de corp și nonce-ul nu poate fi rejucat', () => {
  const secret = randomBytes(32)
  const timestamp = String(Math.floor(Date.now() / 1000))
  const nonce = randomUUID()
  const body = Buffer.from('{"ok":true}')
  const signature = signServiceRequest(secret, timestamp, nonce, 'POST', '/v1/test', body)
  assert.match(canonicalServiceRequest(timestamp, nonce, 'POST', '/v1/test', body), /^[0-9]+\n/)
  const verify = createServiceVerifier(secret)
  verify({ timestamp, nonce, signature, method: 'POST', path: '/v1/test', body })
  assert.throws(() => verify({ timestamp, nonce, signature, method: 'POST', path: '/v1/test', body }), /replay/)
})

test('curățenia Docker este serializată integral cu publication lock-ul', () => {
  const openLock = cleanup.indexOf('exec 9<>"$PUBLICATION_LOCK_FILE"')
  const acquireLock = cleanup.indexOf('flock -n 9', openLock)
  const imagePrune = cleanup.indexOf('docker image prune', acquireLock)
  const containerPrune = cleanup.indexOf('docker container prune', imagePrune)
  const builderPrune = cleanup.indexOf('docker builder prune', containerPrune)
  const releaseLock = cleanup.indexOf('flock -u 9', builderPrune)

  assert.match(cleanup, /PUBLICATION_LOCK_FILE=\/root\/kelion\/publicare\.lock/)
  assert.doesNotMatch(cleanup, /maintenance\.lock/)
  assert.ok(openLock >= 0 && acquireLock > openLock)
  assert.ok(imagePrune > acquireLock)
  assert.ok(containerPrune > imagePrune)
  assert.ok(builderPrune > containerPrune)
  assert.ok(releaseLock > builderPrune)
})

test('jurnalul de recovery păstrează fail-closed containerele oprite', () => {
  assert.match(
    cleanup,
    /RECOVERY_JOURNAL=\/root\/kelion\/runtime\/destructive-cutover-recovery\.json/,
  )
  assert.match(
    cleanup,
    /if \[ -e "\$RECOVERY_JOURNAL" \] \|\| \[ -L "\$RECOVERY_JOURNAL" \]; then[\s\S]*container prune skipped:[\s\S]*else[\s\S]*docker container prune --force --filter until=168h[\s\S]*fi/,
  )
})

test('publication lock nu poate fi redirecționat prin symlink', () => {
  assert.match(
    cleanup,
    /\[ -f "\$PUBLICATION_LOCK_FILE" \] && \[ ! -L "\$PUBLICATION_LOCK_FILE" \] \|\| exit 1/,
  )
  assert.match(cleanup, /publication_fd_path=\$\(readlink "\/proc\/self\/fd\/9"\)/)
  assert.match(cleanup, /publication_fd_identity=\$\(stat -Lc '%d:%i' -- "\/proc\/self\/fd\/9"\)/)
  assert.match(cleanup, /\[ ! -L "\$PUBLICATION_LOCK_FILE" \] \|\| exit 1/)
  assert.match(cleanup, /"\$publication_fd_identity" = "\$\(stat -Lc '%d:%i' -- "\$PUBLICATION_LOCK_FILE"\)"/)
  assert.match(cleanup, /stat -Lc '%u:%g:%a:%h' -- "\/proc\/self\/fd\/9"/)
  assert.match(cleanup, /'0:0:600:1'/)
})

test('release-ul instalează atomic curățenia verificată în pathul cronului', () => {
  const installer = /install_cleanup_script\(\) \{([\s\S]*?)\n\}/.exec(deploy)?.[1] ?? ''
  const acquireLock = deploy.indexOf('\nflock 8\n')
  const installCall = deploy.indexOf('\ninstall_cleanup_script\n', acquireLock)
  const maintenance = deploy.indexOf('\n  enter_destructive_maintenance\n', installCall)

  assert.match(deploy, /"\$BUNDLE_DIR\/vps-curatenie\.sh"/)
  assert.match(installer, /mktemp "\$ROOT\/vps-curatenie\.XXXXXX"/)
  assert.match(installer, /install -o root -g root -m 0700 "\$BUNDLE_DIR\/vps-curatenie\.sh" "\$candidate"/)
  assert.match(installer, /cmp -s -- "\$BUNDLE_DIR\/vps-curatenie\.sh" "\$candidate"/)
  assert.match(installer, /mv -f -- "\$candidate" "\$ROOT\/vps-curatenie\.sh"/)
  assert.match(installer, /'0:0:700:1'/)
  assert.ok(acquireLock >= 0 && installCall > acquireLock)
  assert.ok(maintenance > installCall)
})
