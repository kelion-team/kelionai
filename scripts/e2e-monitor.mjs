#!/usr/bin/env node
// ── E2E MONITOR — SONDE PE LIVE, VĂZUTE DE ACOLO ────────────────────────────
// Adrian: „cum se poate testa aplicația asta dinspre live ca un user normal,
// pe toate părțile, și să se noteze toate err".
//
// Asta e o sondă EXTERNĂ (nu înlocuiește paznicul intern). Rulează pe orice
// mașină cu `node` și lovește kelionai.app. Ideal: pus într-un cron la fiecare
// 5 minute. Raportează ce NU răspunde 200 + orice JSON care promite ok dar
// conține `error`.
//
// Rulare:
//   URL=https://kelionai.app node scripts/e2e-monitor.mjs
// Sau:
//   node scripts/e2e-monitor.mjs --json   (pentru parsing automat)

import { writeFileSync } from 'node:fs'

const fetch = globalThis.fetch

const URL = (process.env.URL || 'https://kelionai.app').replace(/\/$/, '')
const JSON_MODE = process.argv.includes('--json')

const paths = [
  { path: '/', nume: 'landing', ce: 'Homepage HTML' },
  { path: '/api/health', nume: 'health', ce: 'Sănătate de bază' },
  { path: '/api/version', nume: 'version', ce: 'Versiunea care rulează' },
  { path: '/api/tarife', nume: 'tarife', ce: 'Meniu prețuri public' },
  { path: '/api/billing/balance', nume: 'balance-guest', ce: 'Portofel fără login (401 e OK)' },
  { path: '/api/prefs', nume: 'prefs-guest', ce: 'Preferințe fără login (401 e OK)' },
]

function get(u) {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve({ ok: false, status: 0, eroare: 'timeout 10s' }), 10_000)
    fetch(u, { redirect: 'follow' }, (res) => {
      clearTimeout(t)
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        const body = (() => { try { return JSON.parse(text) } catch { return null } })()
        resolve({ ok: res.statusCode === 200, status: res.statusCode, body, text })
      })
    }).on('error', (e) => {
      clearTimeout(t)
      resolve({ ok: false, status: 0, eroare: String(e.message) })
    })
  })
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
