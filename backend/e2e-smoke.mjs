// ── P19: SMOKE E2E CU BROWSER ADEVĂRAT — POARTA „SE DESCHIDE, NU DOAR PORNEȘTE"
// (owner, 15 aug: „nu te comporți ca un QA inginer soft, și nu livrezi
// aplicația reparată" + „ce-ar fi să testezi tot ce faci și lași funcțional")
//
// Până azi, porțile dovedeau că aplicația COMPILEAZĂ și PORNEȘTE — nimeni nu
// o DESCHIDEA într-un browser înainte de merge; primele ochi pe pagina reală
// erau ale ownerului. Scriptul ăsta rulează în poarta VPS (porti-pr.sh), pe
// instanța bootată la 18099, cu Chromium-ul Playwright:
//   • pagina principală răspunde 200 și randează (nu ecran alb);
//   • ZERO erori de pagină (pageerror) și zero erori de consolă la încărcare;
//   • manualul public se deschide.
// Fără DB și fără login (poarta n-are secrete) — deci adâncimea e pe
// suprafața publică; adâncimea pe Stage/meniu cere sesiune și vine separat
// (registrul P19b). Ieșire: cod 0 = TRECE; 1 = PICĂ, cu ce s-a văzut.
import { chromium } from 'playwright'

const BAZA = process.env.SMOKE_URL || 'http://127.0.0.1:18099'
const erori = []
let brauser = null
try {
  // E2E_CHROMIUM: calea unui executabil Chromium deja prezent (medii cu browser
  // preinstalat în alt loc decât cache-ul Playwright). Fără ea — rezolvarea
  // standard Playwright (cache-ul gazdei, umplut de poartă cu `install`).
  const executabil = (process.env.E2E_CHROMIUM ?? '').trim()
  brauser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
    ...(executabil ? { executablePath: executabil } : {}),
  })
} catch (e) {
  // Fără browser instalat pe mașina porții nu inventăm un verdict: spunem
  // limpede și ieșim cu cod DISTINCT (2), ca poarta să scrie „NEPROBAT", nu
  // „TRECE" și nici „PICĂ" pe o măsurătoare care nu a avut loc (regula #1).
  console.error(`E2E-NEPROBAT: Chromium nu pornește pe mașina porții: ${String(e).slice(0, 200)}`)
  process.exit(2)
}
const ctx = await brauser.newContext({ viewport: { width: 1440, height: 900 } })
const pg = await ctx.newPage()
pg.on('pageerror', (e) => erori.push(`pageerror: ${String(e).slice(0, 160)}`))
pg.on('console', (m) => {
  if (m.type() !== 'error') return
  const t = m.text()
  // 401 la sondele de sesiune e comportamentul NORMAL al unui vizitator
  // nelogat (aplicația întreabă „cine ești?", serverul răspunde „nimeni") —
  // nu e defect. 404/500/erori de script rămân defecte.
  if (/status of 401/.test(t)) return
  erori.push(`consolă: ${t.slice(0, 160)}`)
})

let iesire = 0
try {
  const r = await pg.goto(`${BAZA}/`, { waitUntil: 'load', timeout: 30000 })
  const status = r?.status() ?? 0
  if (status !== 200) {
    console.error(`E2E-PICĂ: pagina principală a răspuns HTTP ${status}`)
    iesire = 1
  }
  await pg.waitForTimeout(2500) // React apucă să monteze (sau să crape zgomotos)
  const text = await pg.evaluate(() => document.body.innerText.trim())
  if (!text) {
    console.error('E2E-PICĂ: pagina principală randează ECRAN GOL (body fără text)')
    iesire = 1
  }
  const rman = await pg.goto(`${BAZA}/manual`, { waitUntil: 'load', timeout: 20000 })
  if ((rman?.status() ?? 0) >= 500) {
    console.error(`E2E-PICĂ: /manual a răspuns HTTP ${rman?.status()}`)
    iesire = 1
  }
  if (erori.length) {
    console.error(`E2E-PICĂ: ${erori.length} erori de browser la încărcare:`)
    for (const e of erori.slice(0, 6)) console.error(`  ${e}`)
    iesire = 1
  }
  if (iesire === 0) console.log('E2E-TRECE: pagina se deschide, randează, fără erori de browser')
} catch (e) {
  console.error(`E2E-PICĂ: ${String(e).split('\n')[0].slice(0, 200)}`)
  iesire = 1
} finally {
  await brauser.close().catch(() => {})
}
process.exit(iesire)
