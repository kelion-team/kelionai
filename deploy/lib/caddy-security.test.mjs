import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const caddy = readFileSync(new URL('../Caddyfile', import.meta.url), 'utf8')
const frontendIndex = readFileSync(new URL('../../frontend/index.html', import.meta.url), 'utf8')
const prVerify = readFileSync(new URL('../../.github/workflows/pr-verify.yml', import.meta.url), 'utf8')
const composeProxy = readFileSync(new URL('../compose.proxy.yml', import.meta.url), 'utf8')
const deploy = readFileSync(new URL('../deploy.sh', import.meta.url), 'utf8')
const CADDY_IMAGE = 'caddy:2@sha256:98eb57d882ccd5213d1688764db10c1ca2c58a1ca3a6717a3411ad798f7a423a'

function directive(policy, name) {
  return policy.split(';').map((value) => value.trim()).find((value) => value.startsWith(`${name} `)) ?? ''
}

test('header-ele publice păstrează OAuth, media și izolarea de bază', () => {
  assert.match(caddy, /Strict-Transport-Security "max-age=[0-9]+; includeSubDomains"/)
  assert.match(caddy, /X-Content-Type-Options "nosniff"/)
  assert.match(caddy, /Referrer-Policy "strict-origin-when-cross-origin"/)
  assert.match(caddy, /Cross-Origin-Opener-Policy "same-origin-allow-popups"/)
  assert.match(caddy, /Cross-Origin-Resource-Policy "same-site"/)
  assert.match(caddy, /Permissions-Policy "[^"]*camera=\(self\)[^"]*microphone=\(self\)[^"]*browsing-topics=\(\)"/)
})

test('CSP este enforced, autorizează exact runtime-ul offline și refuză script/connect arbitrar', () => {
  const policy = /^\s*Content-Security-Policy "([^"]+)"/m.exec(caddy)?.[1]
  assert.ok(policy)
  assert.match(policy, /default-src 'self'/)
  assert.match(policy, /object-src 'none'/)
  assert.match(policy, /form-action 'self'/)
  const scripts = directive(policy, 'script-src')
  assert.match(scripts, /'self'/)
  assert.match(scripts, /'wasm-unsafe-eval'/)
  assert.doesNotMatch(scripts, /'unsafe-inline'|blob:|https?:|\*/)
  assert.equal(directive(policy, 'script-src-attr'), "script-src-attr 'none'")
  assert.match(policy, /worker-src 'self' blob:/)
  assert.match(policy, /media-src 'self' data: blob: https:/)
  const connect = directive(policy, 'connect-src')
  // GLTFLoader transforms the avatar's embedded PNGs into object URLs and its
  // ImageBitmapLoader reads those URLs with fetch(). That is governed by
  // connect-src (not img-src), so blob: is required for the complete RPM
  // material package while arbitrary remote HTTP/WebSocket origins stay denied.
  assert.equal(connect, "connect-src 'self' blob: wss://{$PUBLIC_APP_DOMAIN} https://huggingface.co https://*.hf.co https://raw.githubusercontent.com")
  assert.match(connect, /(?:^|\s)blob:(?:\s|$)/)
  assert.doesNotMatch(connect, /(?:^|\s)(?:https:|wss:)(?:\s|$)|api\.openai\.com|googleapis|example\.com/)
  assert.doesNotMatch(caddy, /^\s*Content-Security-Policy-Report-Only /m)
  // COEP ar bloca resurse cross-origin fără CORP/CORS. Se adaugă numai după
  // probele de browser pentru media, OAuth și modelele offline.
  assert.doesNotMatch(caddy, /Cross-Origin-Embedder-Policy/)
})

test('hashul CSP autorizează numai JSON-LD-ul inline exact', () => {
  const match = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(frontendIndex)
  assert.ok(match)
  const hash = createHash('sha256').update(match[1]).digest('base64')
  const policy = /^\s*Content-Security-Policy "([^"]+)"/m.exec(caddy)?.[1] ?? ''
  assert.match(policy, new RegExp(`script-src [^;]*'sha256-${hash.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`))
  assert.equal((frontendIndex.match(/<script(?![^>]*\bsrc=)/g) ?? []).length, 1)
})

test('toate sursele artefactelor offline sunt acoperite fără CDN de script', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../frontend/src/offline-kit.manifest.json', import.meta.url), 'utf8'))
  const origins = new Set()
  for (const artifact of manifest.runtimeSources ?? []) {
    if (artifact.url) origins.add(new URL(artifact.url).origin)
  }
  for (const component of Object.values(manifest.components ?? {})) {
    for (const artifact of component.artifacts ?? []) {
      const url = artifact.url ?? `${component.repository}/resolve/${component.revisionSha}/${artifact.path}`
      origins.add(new URL(url).origin)
    }
  }
  assert.deepEqual([...origins].sort(), ['https://huggingface.co', 'https://raw.githubusercontent.com'])
  const policy = /^\s*Content-Security-Policy "([^"]+)"/m.exec(caddy)?.[1] ?? ''
  assert.match(directive(policy, 'connect-src'), /https:\/\/huggingface\.co/)
  assert.match(directive(policy, 'connect-src'), /https:\/\/\*\.hf\.co/)
  assert.match(directive(policy, 'connect-src'), /https:\/\/raw\.githubusercontent\.com/)
})

test('proxy-ul nu creează un jurnal implicit de IP-uri', () => {
  assert.doesNotMatch(caddy, /^\s*log\s*\{/m)
  assert.match(caddy, /trusted_proxies_strict/)
  assert.match(caddy, /request_header -CF-IPCountry/)
})

test('validarea CI montează upstream-ul exact în calea importată de Caddy', () => {
  assert.match(caddy, /import \/etc\/caddy\/upstream\/kelion-upstream\.caddy/)
  assert.match(
    prVerify,
    /kelion-upstream\.caddy\.example:\/etc\/caddy\/upstream\/kelion-upstream\.caddy:ro/,
  )
})

test('toate etapele folosesc același digest Caddy verificat', () => {
  for (const [name, source] of [['CI', prVerify], ['compose proxy', composeProxy], ['deploy', deploy]]) {
    const images = source.match(/caddy:2@sha256:[a-f0-9]{64}/g) ?? []
    assert.ok(images.length > 0, `${name} nu fixează imaginea Caddy`)
    assert.deepEqual([...new Set(images)], [CADDY_IMAGE], `${name} folosește alt digest Caddy`)
  }
})

test('validarea Caddy non-root poate traversa și citi directorul temporar', () => {
  assert.match(
    deploy,
    /temporary_proxy=\$\(mktemp -d[^\n]+\)[\s\S]*?chmod 0755 "\$temporary_proxy"[\s\S]*?chmod 0644 "\$temporary_proxy\/kelion-upstream\.caddy"[\s\S]*?docker run --rm --network kelion-proxy --user 1000:1000/,
  )
  assert.match(
    prVerify,
    /docker run --rm --network none --user 1000:1000 --read-only \\\n\s*--cap-drop ALL --cap-add NET_BIND_SERVICE --security-opt no-new-privileges/,
  )
  assert.match(
    deploy,
    /docker run --rm --network kelion-proxy --user 1000:1000 --read-only \\\n\s*--cap-drop ALL --cap-add NET_BIND_SERVICE --security-opt no-new-privileges/,
  )
  assert.match(composeProxy, /user: "1000:1000"[\s\S]*?\/tmp:size=16m,mode=0700,uid=1000,gid=1000/)
  assert.match(composeProxy, /cap_drop: \[ALL\][\s\S]*?cap_add: \[NET_BIND_SERVICE\]/)
})
