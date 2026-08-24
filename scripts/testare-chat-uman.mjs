#!/usr/bin/env node
// ── TESTARE CHAT UMAN REALĂ — lovește endpointurile live, NU simulare browser.
//
// Adrian (owner): „testare ca un user pe toate funcțiile din chat, ca un user uman,
// nu Playwright/simulare".
//
// Cum rulezi:
//   1. Loghează-te în originul configurat ca owner.
//   2. Copiază cookie-ul `kelionai_session` din DevTools → Application → Cookies.
//   3. RULEAZĂ:
//      KELION_SESSION=... URL=https://example.invalid node scripts/testare-chat-uman.mjs
//
// Teste automate (fără cost dacă le dezactivezi):
//   - /api/version, /api/health (public)
//   - /api/chat/history (autentificat)
//   - /api/chat text (autentificat) — scump dacă rulezi pe cloud plătit
//   - /api/chat cu imagine (autentificat, dacă KELION_IMAGE_PATH e setat) — scump
//   - /api/admin/erori (autentificat) — doar admin
//
// Teste manuale (tu, ca user uman, în browser) — lista e tipărită la final.

import { readFileSync } from 'node:fs'

const fetch = globalThis.fetch
const product = JSON.parse(readFileSync(new URL('../config/product.json', import.meta.url), 'utf8'))

const URL = (process.env.URL || product.publicAppOrigin).replace(/\/$/, '')
const COOKIE = process.env.KELIONAI_SESSION || process.env.KELION_SESSION
const RUN_CHAT = !/^(0|false|no)$/i.test(process.env.KELION_CHAT_TEST ?? '0')
const IMAGE_PATH = process.env.KELION_IMAGE_PATH || ''
const TIMEOUT_MS = Number(process.env.KELION_TIMEOUT ?? 20_000)

const S1X1_B64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII='

function report(ok, nume, detalii = '') {
  const icon = ok ? '✓' : '✗'
  console.log(`[TEST] ${icon} ${nume}${detalii ? ' — ' + detalii : ''}`)
  return ok
}

async function get(path, { admin = false } = {}) {
  const headers = { accept: 'application/json' }
  if (COOKIE) headers.cookie = `kelionai_session=${COOKIE}`
  const t = Date.now()
  try {
    const r = await fetch(`${URL}${path}`, { method: 'GET', headers, signal: AbortSignal.timeout(TIMEOUT_MS) })
    const text = await r.text()
    return { status: r.status, text, ms: Date.now() - t, ok: r.status === 200 }
  } catch (e) {
    return { status: 0, text: '', ms: Date.now() - t, ok: false, err: String(e.message ?? e) }
  }
}

async function postChat(body, { admin = false } = {}) {
  const headers = { 'content-type': 'application/json' }
  if (COOKIE) headers.cookie = `kelionai_session=${COOKIE}`
  const t = Date.now()
  try {
    const r = await fetch(`${URL}/api/chat`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    // SSE: citim primii câțiva bytes ca dovadă că s-a deschis streamul.
    const text = await r.text()
    return { status: r.status, text: text.slice(0, 160), ms: Date.now() - t, ok: r.status === 200 }
  } catch (e) {
    return { status: 0, text: '', ms: Date.now() - t, ok: false, err: String(e.message ?? e) }
  }
}

async function main() {
  console.log(`[TEST] Lovește live: ${URL}`)
  if (!COOKIE) {
    console.log('[TEST] ⚠ Niciun KELIONAI_SESSION. Se rulează DOAR probele publice.')
    console.log('[TEST] Pentru teste autentificate, pune cookie-ul: KELIONAI_SESSION=xyz node scripts/testare-chat-uman.mjs')
  } else {
    console.log('[TEST] Cookie setat. Se rulează și teste autentificate.')
  }

  const r1 = await get('/api/version')
  report(r1.ok, 'public: /api/version', `${r1.status} în ${r1.ms}ms ${r1.text.slice(0, 80)}`)

  const r2 = await get('/api/health')
  report(r2.ok, 'public: /api/health', `${r2.status} în ${r2.ms}ms ${r2.text.slice(0, 80)}`)

  const r3 = await get('/api/chat/history')
  if (COOKIE) {
    report(r3.ok, 'auth: /api/chat/history', `${r3.status} în ${r3.ms}ms`)
  }

  if (COOKIE && RUN_CHAT) {
    const textBody = {
      messages: [{ role: 'user', content: 'spune doar "ok"', lang: 'ro' }],
      now: new Date().toISOString(),
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Bucharest',
    }
    const c1 = await postChat(textBody)
    report(c1.ok, 'auth: /api/chat text', `${c1.status} în ${c1.ms}ms ${c1.err || ''}`)

    if (IMAGE_PATH) {
      const fs = await import('node:fs')
      let img = ''
      try {
        img = `data:image/jpeg;base64,${fs.readFileSync(IMAGE_PATH).toString('base64')}`
      } catch (e) {
        console.log(`[TEST] ⚠ Nu pot citi imaginea ${IMAGE_PATH}: ${e.message}`)
      }
      if (img) {
        const imgBody = {
          messages: [{ role: 'user', content: 'ce vezi?', lang: 'ro' }],
          image: img,
          now: new Date().toISOString(),
          tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Bucharest',
        }
        const c2 = await postChat(imgBody)
        report(c2.ok, 'auth: /api/chat imagine', `${c2.status} în ${c2.ms}ms ${c2.err || ''}`)
      }
    }

    const admin = await get('/api/admin/erori')
    report(admin.ok, 'admin: /api/admin/erori', `${admin.status} în ${admin.ms}ms`)
  } else if (!COOKIE && RUN_CHAT) {
    console.log('[TEST] ⚠ Chat-ul text/imagine e omis fără cookie.')
  }

  console.log('')
  console.log('─ TESTARE MANUALĂ (tu, ca user uman, în browser) ─')
  console.log('1. Text: scrie "salut" și verifică răspuns sub 1s.')
  console.log('2. Voce: apasă microfonul, spune o comandă, verifică că aude și răspunde.')
  console.log('3. Imagine: Copiază/lipăște o poză (Ctrl+V) în chat, întreabă ce vede.')
  console.log('4. Cameră: pornește camera, arată obiect, verifică că recunoaște.')
  console.log('5. Unelte: ca admin, scrie "vezi erorile", "vezi logurile" — verifică răspuns.')
  console.log('6. Constructor: scrie "deschide ordin pentru test" — verifică PR.')
  console.log('7. Update: așteaptă publicare nouă, verifică bara de sus 0-100% și blocare.')
  console.log('')
  console.log('Pentru probe plătite: setează KELION_CHAT_TEST=1 și KELIONAI_SESSION=...')
}

main().catch((e) => { console.error('[TEST] Eroare:', e); process.exit(1) })
