// ── AUTOVEDERE: script Playwright care VERIFICĂ ce nu pot testa din terminal ──
// Deschide originul configurat în browser real și verifică:
// 1. Rendering UI (avatar 3D, chat panel, admin panel)
// 2. Camera/webcam (permisiuni + cadre)
// 3. Voce WebSocket (conexiune vocal-live)
// 4. Admin panel (tab-uri, date reale)
//
// Rulează: node scripts/autovedere.mjs
// Necesită: npx playwright install chromium (o singură dată)

import { chromium } from '../backend/node_modules/playwright/index.mjs'
import { readFileSync } from 'node:fs'

const product = JSON.parse(readFileSync(new URL('../config/product.json', import.meta.url), 'utf8'))
const configuredOrigin = new URL(product.publicAppOrigin)

const URL = process.env.KELION_URL || configuredOrigin.origin
const TEST_AUTH = process.env.TEST_AUTH_TOKEN
const SESSION_COOKIE = process.env.KELION_SESSION

const rezultate = []

function log(ok, test, detalii) {
  const simbol = ok ? '✅' : '❌'
  const linie = `${simbol} ${test}: ${detalii}`
  console.log(linie)
  rezultate.push({ ok, test, detalii })
}

async function main() {
  console.log(`\n=== AUTOVEDERE — verificare live pe ${URL} ===\n`)

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--use-fake-ui-for-media-stream', // acceptă automat permisiuni cameră/microfon
      '--use-fake-device-for-media-stream', // folosește webcam/mic fals
    ],
  })

  const context = await browser.newContext({
    permissions: ['camera', 'microphone'],
    viewport: { width: 1280, height: 720 },
  })

  // Injectează cookie de sesiune dacă e dat
  if (SESSION_COOKIE) {
    await context.addCookies([{
      name: 'kelionai_session',
      value: SESSION_COOKIE,
      domain: new URL(URL).hostname,
      path: '/',
    }])
  }

  const page = await context.newPage()

  // Injectează x-test-auth pe TOATE requesturile (ca și cum am fi logat ca admin)
  if (TEST_AUTH) {
    await page.setExtraHTTPHeaders({ 'x-test-auth': TEST_AUTH })
    console.log('  (auth: x-test-auth injectat pe toate requesturile)\n')
  }

  // Colectează erorile de consolă
  const eroriConsola = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') eroriConsola.push(msg.text().slice(0, 200))
  })

  // ── 1. PAGINA PRINCIPALĂ — rendering ──────────────────────────────────────
  console.log('\n── 1. RENDERING UI ──')
  try {
    const resp = await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 })
    log(resp?.status() === 200, 'Pagina principală', `HTTP ${resp?.status()}`)

    // Așteaptă ca React să randeze (până la 10s)
    await page.waitForTimeout(5000)

    // Poarta de consimțământ — „Înainte să intri / Accept captarea pozei / Refuz"
    // Frontend-ul cere consimțământ pentru captarea pozei înainte de a randa UI-ul.
    // Refuz BLOCHEAZĂ aplicația — trebuie „Accept" ca să trecem mai departe.
    // (Playwright folosește fake webcam — nu capturăm poze reale.)
    const acceptBtn = page.locator('button:has-text("Accept")')
    if (await acceptBtn.count() > 0) {
      await acceptBtn.first().click()
      console.log('  (poarta de consimțământ: „Accept" apăsat — UI-ul va randa)')
      await page.waitForTimeout(5000) // așteaptă randarea UI-ului după poartă
    }

    // Avatar 3D — canvas (React randează dinamic după mount)
    const avatar = await page.locator('canvas').count()
    log(avatar > 0, 'Avatar 3D (canvas)', `${avatar} canvas găsite`)

    // Chat panel — input de text sau contenteditable
    const chatInput = await page.locator('textarea, [contenteditable="true"]').count()
    log(chatInput > 0, 'Chat panel (input)', `${chatInput} inputuri găsite`)

    // Verifică dacă există elemente React mount-ate (root div cu conținut)
    const reactContent = await page.locator('#root > *').count()
    log(reactContent > 0, 'React mount-at', `${reactContent} elemente în #root`)

    // Titlu pagină
    const titlu = await page.title()
    log(Boolean(titlu), 'Titlu pagină', `"${titlu}"`)

    // Bundle JS încărcat
    const scripts = await page.locator('script[src]').count()
    log(scripts > 0, 'Bundle JS încărcat', `${scripts} scripturi`)

    // Fără erori 404 pe assets
    const erori404 = eroriConsola.filter(e => /404/.test(e))
    log(erori404.length === 0, 'Fără 404 pe assets', erori404.length > 0 ? erori404.slice(0, 3).join('; ') : 'curat')
  } catch (e) {
    log(false, 'Pagina principală', String(e.message).slice(0, 150))
  }

  // ── 2. CAMERA/WEBCAM ──────────────────────────────────────────────────────
  console.log('\n── 2. CAMERA/WEBCAM ──')
  try {
    // Verifică dacă pagina cere permisiuni de cameră
    const cameraPerm = await page.evaluate(() => {
      return navigator.permissions.query({ name: 'camera' }).then(p => p.state).catch(() => 'nu_pot_verifica')
    })
    log(true, 'Permisiune cameră', `stare: ${cameraPerm}`)

    // Încearcă să acceseze webcam-ul (fake device)
    const cameraResult = await page.evaluate(async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true })
        const track = stream.getVideoTracks()[0]
        const info = track ? `${track.label || 'fără label'} (${track.readyState})` : 'niciun track'
        stream.getTracks().forEach(t => t.stop())
        return { ok: true, info }
      } catch (e) {
        return { ok: false, info: String(e.message || e).slice(0, 150) }
      }
    })
    log(cameraResult.ok, 'Webcam accesat', cameraResult.info)
  } catch (e) {
    log(false, 'Camera', String(e.message).slice(0, 150))
  }

  // ── 3. VOCE — WebSocket vocal-live ────────────────────────────────────────
  console.log('\n── 3. VOCE (WebSocket) ──')
  try {
    // Verifică ruta de stare (injectează TEST_AUTH în page context)
    const stareResp = await page.evaluate(async (token) => {
      try {
        const r = await fetch('/api/vocal-live/stare', { headers: token ? { 'x-test-auth': token } : {} })
        if (!r.ok) return { ok: false, info: `HTTP ${r.status}` }
        const j = await r.json()
        return { ok: true, info: JSON.stringify(j).slice(0, 200) }
      } catch (e) {
        return { ok: false, info: String(e.message || e).slice(0, 150) }
      }
    }, TEST_AUTH)
    log(stareResp.ok, 'Stare voce (GET /api/vocal-live/stare)', stareResp.info)

    // Verifică dacă WebSocket-ul poate fi deschis (fără să trimitem audio)
    const wsResult = await page.evaluate(async () => {
      return new Promise((resolve) => {
        try {
          const wsUrl = window.location.origin.replace('https', 'wss') + '/api/vocal-live'
          const ws = new WebSocket(wsUrl)
          const timeout = setTimeout(() => {
            ws.close()
            resolve({ ok: false, info: 'timeout 5s — WS nu s-a deschis' })
          }, 5000)
          ws.onopen = () => {
            clearTimeout(timeout)
            ws.close()
            resolve({ ok: true, info: 'WS conectat (închis imediat — nu trimitem audio)' })
          }
          ws.onerror = (e) => {
            clearTimeout(timeout)
            resolve({ ok: false, info: 'WS eroare (probabil fără sesiune auth)' })
          }
        } catch (e) {
          resolve({ ok: false, info: String(e.message || e).slice(0, 150) })
        }
      })
    })
    log(wsResult.ok, 'WebSocket vocal-live', wsResult.info)
  } catch (e) {
    log(false, 'Voce', String(e.message).slice(0, 150))
  }

  // ── 4. ADMIN PANEL ─────────────────────────────────────────────────────────
  console.log('\n── 4. ADMIN PANEL ──')
  try {
    // Navighează la admin (dacă avem cookie de sesiune)
    if (SESSION_COOKIE || TEST_AUTH) {
      // Verifică rutele admin direct
      const adminRute = [
        '/api/admin/demos', '/api/admin/leads', '/api/admin/audit',
        '/api/admin/erori', '/api/admin/finance', '/api/admin/models',
        '/api/admin/keys', '/api/admin/money-circuit',
      ]
      let okCount = 0
      let failCount = 0
      for (const ruta of adminRute) {
        const r = await page.evaluate(async ({ url, token }) => {
          try {
            const resp = await fetch(url, { headers: token ? { 'x-test-auth': token } : {} })
            return { ok: resp.ok, status: resp.status }
          } catch (e) {
            return { ok: false, status: 0 }
          }
        }, { url: ruta, token: TEST_AUTH })
        if (r.ok) okCount++; else failCount++
      }
      log(okCount === adminRute.length, `Admin rute (${adminRute.length})`, `${okCount}/${adminRute.length} OK, ${failCount} picate`)
    } else {
      log(false, 'Admin panel', 'fără cookie de sesiune — sărit')
    }

    // Verifică tab-uri în AdminPanel — apăsăm butonul „Admin" ca să-l deschidem
    const adminBtn = page.locator('button:has-text("Admin"), button:has-text("🔒 Admin")')
    if (await adminBtn.count() > 0) {
      await adminBtn.first().click()
      await page.waitForTimeout(2000) // așteaptă randarea panoului
      const taburi = await page.locator('[data-tab], .admin-tab, button[role="tab"], .tab-button').count()
      log(taburi > 0, 'Tab-uri admin (după click)', `${taburi} tab-uri găsite`)
    } else {
      log(false, 'Tab-uri admin', 'butonul „Admin" nu a fost găsit')
    }

    // Verifică că „Vizitatori" NU mai e în UI
    const vizitatoriText = await page.locator('text=Vizitatori').count()
    log(vizitatoriText === 0, 'Tab „Vizitatori" șters', vizitatoriText === 0 ? 'confirmat — 0 apariții' : `${vizitatoriText} apariții`)

    // Verifică că „Free-trial" NU mai e în UI
    const freeTrialText = await page.locator('text=Free-trial').count()
    log(freeTrialText === 0, '„Free-trial" șters', freeTrialText === 0 ? 'confirmat — 0 apariții' : `${freeTrialText} apariții`)
  } catch (e) {
    log(false, 'Admin panel', String(e.message).slice(0, 150))
  }

  // ── 5. Erori de consolă ───────────────────────────────────────────────────
  console.log('\n── 5. Erori consolă browser ──')
  const eroriUnice = [...new Set(eroriConsola)].slice(0, 10)
  log(eroriUnice.length === 0, 'Erori consolă', eroriUnice.length === 0 ? '0 erori' : `${eroriUnice.length} erori unice:\n    ${eroriUnice.join('\n    ')}`)

  // ── 6. Latență primă încărcare ─────────────────────────────────────────────
  console.log('\n── 6. Latență ──')
  try {
    const timing = await page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0]
      return {
        domContentLoaded: Math.round(nav?.domContentLoadedEventEnd || 0),
        loadComplete: Math.round(nav?.loadEventEnd || 0),
        transferSize: Math.round(nav?.transferSize || 0),
      }
    })
    log(timing.domContentLoaded < 3000, 'DOM content loaded', `${timing.domContentLoaded}ms (țintă < 3000ms)`)
    log(timing.transferSize < 2_000_000, 'Transfer size', `${(timing.transferSize / 1024).toFixed(0)}KB (țintă < 2MB)`)
  } catch (e) {
    log(false, 'Latență', String(e.message).slice(0, 100))
  }

  // ── RAPORT FINAL ──────────────────────────────────────────────────────────
  console.log('\n=== RAPORT AUTOVEDERE ===')
  const ok = rezultate.filter(r => r.ok).length
  const fail = rezultate.filter(r => !r.ok).length
  console.log(`${ok} OK, ${fail} PICATE din ${rezultate.length} verificări`)
  if (fail > 0) {
    console.log('\nPICATE:')
    rezultate.filter(r => !r.ok).forEach(r => console.log(`  ❌ ${r.test}: ${r.detalii}`))
  }

  await browser.close()
  process.exit(fail > 0 ? 1 : 0)
}

main().catch(e => {
  console.error('FATAL:', e)
  process.exit(1)
})
