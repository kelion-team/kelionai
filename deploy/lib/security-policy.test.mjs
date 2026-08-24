import assert from 'node:assert/strict'
import { test } from 'node:test'
import { randomBytes, randomUUID } from 'node:crypto'
import { canonicalServiceRequest, createServiceVerifier, signServiceRequest } from './service-auth.mjs'
import { isPublicAddress, parsePublicUrl } from './public-target.mjs'

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
