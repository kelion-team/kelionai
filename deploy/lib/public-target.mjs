import { BlockList, isIP } from 'node:net'
import { resolve4, resolve6 } from 'node:dns/promises'
import { domainToASCII } from 'node:url'

const blockedV4 = new BlockList()
for (const [network, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) blockedV4.addSubnet(network, prefix, 'ipv4')

const blockedV6 = new BlockList()
for (const [network, prefix] of [
  ['::', 128], ['::1', 128], ['::ffff:0:0', 96], ['64:ff9b:1::', 48],
  ['100::', 64], ['2001::', 23], ['2001:db8::', 32], ['fc00::', 7],
  ['fe80::', 10], ['fec0::', 10], ['ff00::', 8],
]) blockedV6.addSubnet(network, prefix, 'ipv6')

export function isPublicAddress(address) {
  const family = isIP(address)
  if (family === 4) return !blockedV4.check(address, 'ipv4')
  if (family === 6) return !blockedV6.check(address, 'ipv6')
  return false
}

export function canonicalHostname(raw) {
  const unwrapped = String(raw ?? '').replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (!unwrapped || unwrapped.length > 253 || unwrapped.toLowerCase() === 'localhost') {
    throw new Error('target_host_blocked')
  }
  if (isIP(unwrapped)) return unwrapped
  const ascii = domainToASCII(unwrapped).toLowerCase()
  if (!ascii || ascii.length > 253 || !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(ascii)) {
    throw new Error('target_host_invalid')
  }
  return ascii
}

export function parsePublicUrl(raw, { allowWebSocket = false } = {}) {
  const url = new URL(String(raw ?? ''))
  const allowed = allowWebSocket ? ['http:', 'https:', 'ws:', 'wss:'] : ['http:', 'https:']
  if (!allowed.includes(url.protocol) || url.username || url.password || url.hash) throw new Error('target_url_blocked')
  url.hostname = canonicalHostname(url.hostname)
  const defaultPort = url.protocol === 'http:' || url.protocol === 'ws:' ? 80 : 443
  const port = url.port ? Number(url.port) : defaultPort
  if (![80, 443].includes(port)) throw new Error('target_port_blocked')
  return { url, port }
}

export async function resolvePinnedTarget(hostname) {
  const host = canonicalHostname(hostname)
  if (isIP(host)) {
    if (!isPublicAddress(host)) throw new Error('target_address_blocked')
    return { hostname: host, address: host, family: isIP(host), ttl: 0 }
  }
  const answers = []
  const [v4, v6] = await Promise.all([
    resolve4(host, { ttl: true }).catch(() => []),
    resolve6(host, { ttl: true }).catch(() => []),
  ])
  for (const item of v4) answers.push({ address: item.address, family: 4, ttl: item.ttl })
  for (const item of v6) answers.push({ address: item.address, family: 6, ttl: item.ttl })
  if (!answers.length || answers.some((item) => !isPublicAddress(item.address))) {
    throw new Error('target_address_blocked')
  }
  answers.sort((a, b) => a.family - b.family || a.address.localeCompare(b.address))
  return { hostname: host, ...answers[0] }
}
