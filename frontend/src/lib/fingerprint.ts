// A light device fingerprint for the free-trial anti-reuse speed-bump. This is
// NOT a biometric and NOT unique — it only makes casual re-use (refresh, new
// tab) harder. A hash of stable browser signals plus a canvas render. A
// determined visitor (new browser/device, incognito+VPN) can still get another
// trial; the daily cap is what actually bounds the cost.
export async function deviceFingerprint(): Promise<string> {
  const parts: string[] = [
    navigator.userAgent,
    navigator.language,
    (navigator.languages ?? []).join(','),
    `${screen.width}x${screen.height}x${screen.colorDepth}`,
    String(new Date().getTimezoneOffset()),
    Intl.DateTimeFormat().resolvedOptions().timeZone ?? '',
    String(navigator.hardwareConcurrency ?? ''),
    String((navigator as { deviceMemory?: number }).deviceMemory ?? ''),
  ]
  try {
    const c = document.createElement('canvas')
    c.width = 200
    c.height = 40
    const ctx = c.getContext('2d')
    if (ctx) {
      ctx.textBaseline = 'top'
      ctx.font = '14px Arial'
      ctx.fillStyle = '#f60'
      ctx.fillRect(0, 0, 200, 40)
      ctx.fillStyle = '#069'
      ctx.fillText('Kelionai demo', 2, 2)
      parts.push(c.toDataURL())
    }
  } catch {
    /* canvas blocked — skip it */
  }
  return sha256Hex(parts.join('|'))
}

async function sha256Hex(s: string): Promise<string> {
  try {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
    return [...new Uint8Array(buf)]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
      .slice(0, 32)
  } catch {
    let h = 0
    for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
    return (h >>> 0).toString(16)
  }
}
