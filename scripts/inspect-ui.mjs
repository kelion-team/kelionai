import { chromium } from '../backend/node_modules/playwright/index.mjs'
import { readFileSync } from 'node:fs'

const product = JSON.parse(readFileSync(new URL('../config/product.json', import.meta.url), 'utf8'))
const targetOrigin = process.env.KELION_URL || product.publicAppOrigin

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } })
const page = await ctx.newPage()
await page.setExtraHTTPHeaders({ 'x-test-auth': process.env.TEST_AUTH_TOKEN })
await page.goto(targetOrigin, { waitUntil: 'networkidle', timeout: 30000 })
await page.waitForTimeout(3000)
// Apasă „Refuz" pe poarta de consimțământ
const refuzBtn = page.locator('button:has-text("Refuz")')
if (await refuzBtn.count() > 0) {
  await refuzBtn.first().click()
  console.log('(poarta: Refuz apăsat)')
  await page.waitForTimeout(5000)
}

const visible = await page.evaluate(() => {
  const els = document.querySelectorAll('*')
  const out = []
  for (const el of els) {
    const rect = el.getBoundingClientRect()
    if (rect.width > 50 && rect.height > 50 && rect.top < 720 && rect.left < 1280) {
      const tag = el.tagName.toLowerCase()
      const cls = (typeof el.className === 'string' ? el.className : '').slice(0, 60)
      const id = el.id ? '#' + el.id : ''
      if (!['html','body','script','style','link','meta'].includes(tag)) {
        out.push(`${tag}${id}.${cls} (${Math.round(rect.width)}x${Math.round(rect.height)} @${Math.round(rect.left)},${Math.round(rect.top)})`)
      }
    }
  }
  return out.slice(0, 40)
})
console.log('ELEMENTE VIZIBILE:')
visible.forEach(v => console.log(' ', v))

// Verifică text vizibil
const text = await page.evaluate(() => {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  const texts = []
  let node
  while (node = walker.nextNode()) {
    const t = node.textContent.trim()
    if (t.length > 3) {
      const rect = node.parentElement.getBoundingClientRect()
      if (rect.top < 720 && rect.left < 1280) texts.push(t.slice(0, 80))
    }
  }
  return texts.slice(0, 20)
})
console.log('\nTEXT VIZIBIL:')
text.forEach(t => console.log(' ', t))

await browser.close()
