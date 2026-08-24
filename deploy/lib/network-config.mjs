function ipv4Integer(value) {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/.test(value)) {
    throw new Error('ipv4_invalid')
  }
  const octets = value.split('.').map(Number)
  if (octets.some((octet) => octet > 255)) throw new Error('ipv4_invalid')
  return octets.reduce((result, octet) => ((result << 8) | octet) >>> 0, 0)
}

export function validateHttpProxyInSubnet(rawProxyUrl, rawSubnet) {
  if (typeof rawSubnet !== 'string') throw new Error('browser_proxy_configuration')
  const match = /^(.*)\/(\d{1,2})$/.exec(rawSubnet)
  if (!match) throw new Error('browser_proxy_configuration')
  const network = ipv4Integer(match[1])
  const prefix = Number(match[2])
  if (prefix < 24 || prefix > 30) throw new Error('browser_proxy_configuration')
  const mask = (0xffffffff << (32 - prefix)) >>> 0
  if (((network & mask) >>> 0) !== network) throw new Error('browser_proxy_configuration')

  let proxy
  try { proxy = new URL(String(rawProxyUrl ?? '')) } catch { throw new Error('browser_proxy_configuration') }
  if (proxy.protocol !== 'http:' || proxy.username || proxy.password || proxy.port !== '3128'
    || proxy.pathname !== '/' || proxy.search || proxy.hash) throw new Error('browser_proxy_configuration')
  const address = ipv4Integer(proxy.hostname)
  const broadcast = (network | (~mask >>> 0)) >>> 0
  if (((address & mask) >>> 0) !== network || address === network || address === broadcast) {
    throw new Error('browser_proxy_configuration')
  }
  return proxy.origin
}
