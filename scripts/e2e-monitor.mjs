#!/usr/bin/env node
// ── E2E MONITOR — SONDE PE LIVE, VĂZUTE DE ACOLO ────────────────────────────
// Adrian: „cum se poate testa aplicația asta dinspre live ca un user normal,
// pe toate părțile, și să se noteze toate err".
//
// Asta e o sondă EXTERNĂ (nu înlocuiește paznicul intern). Rulează pe orice
// mașină cu `node` și lovește originul configurat. Poate rula periodic dintr-un
// 5 minute. Raportează ce NU răspunde 200 + orice JSON care promite ok dar
// conține `error`.
//
// Rulare:
//   URL=https://example.invalid node scripts/e2e-monitor.mjs
// Sau:
//   node scripts/e2e-monitor.mjs --json   (pentru parsing automat)

import { readFileSync, writeFileSync } from 'node:fs'

const fetch = globalThis.fetch
const product = JSON.parse(readFileSync(new URL('../config/product.json', import.meta.url), 'utf8'))

const URL = (process.env.URL || product.publicAppOrigin).replace(/\/$/, '')
const JSON_MODE = process.argv.includes('--json')

const paths = [
  { path: '/', nume: 'landing', ce: 'Homepage HTML' },
  { path: '/livez', nume: 'livez', ce: 'Procesul public răspunde' },
  { path: '/readyz', nume: 'readyz', ce: 'Serviciile obligatorii sunt pregătite' },
  { path: '/api/ping', nume: 'ping', ce: 'Contract API minimal' },
  { path: '/api/health', nume: 'health', ce: 'Sănătate de bază' },
  { path: '/api/version', nume: 'version', ce: 'Versiunea care rulează' },
  { path: '/api/tarife', nume: 'tarife', ce: 'Meniu prețuri public' },
  { path: '/api/billing/balance', nume: 'balance-guest', ce: 'Portofel fără login (401 e OK)' },
  { path: '/api/prefs', nume: 'prefs-guest', ce: 'Preferințe fără login (401 e OK)' },
]

async function get(u) {
  try {
    const response = await fetch(u, { redirect: 'follow', signal: AbortSignal.timeout(10_000) })
    const text = await response.text()
    const body = (() => { try { return JSON.parse(text) } catch { return null } })()
    return { ok: response.status === 200, status: response.status, body, text }
  } catch (error) {
    return { ok: false, status: 0, eroare: String(error instanceof Error ? error.message : error) }
  }
}

async function main() {
  const rezultate = []
  for (const { path, nume, ce } of paths) {
    const r = await get(`${URL}${path}`)
    const falseOk = r.ok && r.body && typeof r.body === 'object' && r.body.error
    const fail = !r.ok || falseOk
    rezultate.push({
      nume,
      ce,
      url: `${URL}${path}`,
      ok: !fail,
      status: r.status,
      eroare: r.eroare,
      bodyError: falseOk ? r.body.error : null,
      body: r.ok && typeof r.body === 'object' ? r.body : null,
    })
  }

  const stricate = rezultate.filter((x) => !x.ok)

  if (JSON_MODE) {
    console.log(JSON.stringify({ la: new Date().toISOString(), total: rezultate.length, stricate: stricate.length, probe: rezultate }, null, 2))
  } else {
    console.log(`[E2E] ${rezultate.length - stricate.length}/${rezultate.length} OK — ${new Date().toISOString()}`)
    for (const r of rezultate) {
      const icon = r.ok ? '✓' : '✗'
      console.log(`  ${icon} ${r.nume} (${r.status}) ${r.eroare || r.bodyError || ''}`)
    }
  }

  // Salvăm ultimul rezultat pentru sonda paznicului, dacă e rulat pe VPS.
  try {
    writeFileSync('e2e-monitor-last.json', JSON.stringify({ la: Date.now(), stricate: stricate.length, rezultate }))
  } catch {
    /* ignore */
  }

  process.exit(stricate.length ? 1 : 0)
}

main()
