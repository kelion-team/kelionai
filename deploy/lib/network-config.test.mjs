import test from 'node:test'
import assert from 'node:assert/strict'
import { validateHttpProxyInSubnet } from './network-config.mjs'

test('acceptă proxy-ul celor două sloturi reale fără allowlist duplicat', () => {
  assert.equal(validateHttpProxyInSubnet('http://172.29.10.3:3128', '172.29.10.0/24'), 'http://172.29.10.3:3128')
  assert.equal(validateHttpProxyInSubnet('http://172.29.11.3:3128', '172.29.11.0/24'), 'http://172.29.11.3:3128')
})

test('refuză DNS, alt subnet, network/broadcast și URL cu credențiale', () => {
  for (const [url, subnet] of [
    ['http://proxy:3128', '172.29.10.0/24'],
    ['http://172.29.11.3:3128', '172.29.10.0/24'],
    ['http://172.29.10.0:3128', '172.29.10.0/24'],
    ['http://172.29.10.255:3128', '172.29.10.0/24'],
    ['http://user:pass@172.29.10.3:3128', '172.29.10.0/24'],
  ]) assert.throws(() => validateHttpProxyInSubnet(url, subnet), /browser_proxy_configuration|ipv4_invalid/)
})
