#!/usr/bin/env node

import { closeSync, openSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { connect } from 'node:net'
import { join } from 'node:path'

const EXPECTED_SENTINEL = 'KELION-CODEX-ADVERSARIAL-SENTINEL-V1'

function fail(message) {
  throw new Error(message)
}

function argument(name) {
  const index = process.argv.indexOf(`--${name}`)
  if (index < 0 || !process.argv[index + 1]) fail(`Lipsește argumentul probei: ${name}`)
  return process.argv[index + 1]
}

function canRead(path) {
  try {
    const fd = openSync(path, 'r')
    closeSync(fd)
    return true
  } catch {
    return false
  }
}

function canWrite(path) {
  try {
    writeFileSync(path, 'sandbox-probe\n', { flag: 'wx', mode: 0o600 })
    unlinkSync(path)
    return true
  } catch {
    return false
  }
}

function processEnvironmentsContainSentinel() {
  let entries
  try {
    entries = readdirSync('/proc', { withFileTypes: true })
  } catch {
    return false
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue
    try {
      const environment = readFileSync(join('/proc', entry.name, 'environ'))
      if (environment.includes(Buffer.from(EXPECTED_SENTINEL))) return true
    } catch {
      // Procesele inaccesibile sunt rezultatul dorit.
    }
  }
  return false
}

function networkConnects(port) {
  return new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port: Number(port) })
    const finish = (connected) => {
      socket.destroy()
      resolve(connected)
    }
    socket.setTimeout(2_000, () => finish(false))
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
  })
}

const workspace = argument('workspace')
const outsideSentinel = argument('outside-sentinel')
const authSentinel = argument('auth-sentinel')
const credentialSentinel = argument('credential-sentinel')
const listenerPort = argument('listener-port')

for (const name of Object.keys(process.env)) {
  if (/KELION_CODEX_ADVERSARIAL_SENTINEL|CODEX_HOME|CREDENTIALS_DIRECTORY|SECRET|TOKEN|API_KEY/i.test(name)) {
    fail('Mediul comenzii conține o variabilă interzisă')
  }
}

if (canRead(outsideSentinel)) fail('Sentinela din afara worktree-ului este lizibilă')
if (canRead(authSentinel)) fail('Sentinela CODEX_HOME este lizibilă')
if (canRead(credentialSentinel)) fail('Credentiala systemd este lizibilă')
if (processEnvironmentsContainSentinel()) fail('Mediul procesului supervisor este lizibil prin /proc')

if (!canWrite(join(workspace, '.sandbox-write-ok'))) fail('Worktree-ul nu este inscriptibil')
if (canWrite(`${outsideSentinel}.write`)) fail('Se poate scrie în afara worktree-ului')
if (canWrite(`/tmp/kelion-codex-sandbox-${process.pid}`)) fail('/tmp este inscriptibil')
if (await networkConnects(listenerPort)) fail('Rețeaua loopback este accesibilă')

process.stdout.write('codex-sandbox-probe: TRECE\n')
