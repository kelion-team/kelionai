#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { sign } from 'node:crypto'
import { pathToFileURL } from 'node:url'

const endpointRegistry = JSON.parse(readFileSync(new URL('../config/endpoints.json', import.meta.url), 'utf8'))

function registryBase(name) {
  const value = endpointRegistry?.version === 1 ? endpointRegistry.external?.[name] : null
  const parsed = new URL(String(value ?? ''))
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') {
    throw new Error('endpoint_registry_invalid')
  }
  return parsed.origin
}

const APP_STORE_API_BASE = registryBase('appStoreConnectApiBase')

const base64urlJson = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')

export function integerBuild(value, name) {
  if (!/^[1-9][0-9]{0,9}$/.test(String(value ?? ''))) throw new Error(`${name}_invalid`)
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) throw new Error(`${name}_invalid`)
  return parsed
}

function token({ keyId, issuerId, privateKey }) {
  if (!/^[A-Za-z0-9]+$/.test(keyId) || !/^[0-9a-f-]{20,}$/i.test(issuerId)) throw new Error('appstore_identity_invalid')
  const now = Math.floor(Date.now() / 1000)
  const header = base64urlJson({ alg: 'ES256', kid: keyId, typ: 'JWT' })
  const payload = base64urlJson({ iss: issuerId, iat: now, exp: now + 600, aud: 'appstoreconnect-v1' })
  const input = `${header}.${payload}`
  const signature = sign('sha256', Buffer.from(input), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url')
  return `${input}.${signature}`
}

async function appStoreJson(path, bearer) {
  const response = await fetch(`${APP_STORE_API_BASE}${path}`, {
    headers: { authorization: `Bearer ${bearer}`, accept: 'application/json' },
  })
  if (!response.ok) throw new Error(`appstore_http_${response.status}`)
  return response.json()
}

export async function verifyNextBuild() {
  const bundleId = String(process.env.IOS_BUNDLE_ID ?? '')
  const expected = integerBuild(process.env.IOS_BUILD_NUMBER, 'build_number')
  const keyFile = String(process.env.ASC_KEY_FILE ?? '')
  if (!/^[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)+$/.test(bundleId) || !keyFile) throw new Error('appstore_input_invalid')
  const bearer = token({
    keyId: String(process.env.ASC_KEY_ID ?? ''),
    issuerId: String(process.env.ASC_ISSUER_ID ?? ''),
    privateKey: readFileSync(keyFile, 'utf8'),
  })
  const apps = await appStoreJson(`/v1/apps?filter%5BbundleId%5D=${encodeURIComponent(bundleId)}&limit=2`, bearer)
  if (!Array.isArray(apps.data) || apps.data.length !== 1) throw new Error('appstore_app_not_unique')
  const builds = await appStoreJson(`/v1/builds?filter%5Bapp%5D=${encodeURIComponent(apps.data[0].id)}&sort=-uploadedDate&limit=1`, bearer)
  if (!Array.isArray(builds.data)) throw new Error('appstore_builds_invalid')
  if (builds.data.length) {
    const current = integerBuild(builds.data[0]?.attributes?.version, 'appstore_build')
    if (expected <= current) throw new Error('build_number_not_monotonic')
  }
  process.stdout.write('App Store build number: monotonic și eligibil.\n')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  verifyNextBuild().catch((error) => {
    process.stderr.write(`App Store build check failed: ${error instanceof Error ? error.message : 'unknown'}\n`)
    process.exit(1)
  })
}
