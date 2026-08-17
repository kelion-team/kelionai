import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// ── ×-ul DE PE PAGINA DESCHISĂ PE ECRAN CHIAR ÎNCHIDE (owner, 13 aug: „nicăieri
// în aplicație când Kelion deschide pe ecran o pagină, X nu merge"; „am cerut de
// 3 milioane de ori: oriunde e un X de închidere, să fie funcțional") ──────────
//
// Cauza REALĂ, măsurată în cod (nu presupusă): avatarul (`.stage-canvas.pip`) e
// `pointer-events:none`, DAR `pointer-events` NU se moștenește — canvasul three.js
// din el e implicit `auto`, deci rămânea ȚINTĂ de click și înghițea ×-ul de sub el
// (mai ales când avatarul e mare/centrat, pe un tab „doc"). Reparațiile din 8/10
// aug puseseră `none` doar pe CONTAINER, nu pe CANVAS — de-aia „nu merge" a
// supraviețuit de 3 ori. Frontend-ul n-are runner; îl citim de aici, ca poartaNumelui.
const sursa = (cale: string): string =>
  readFileSync(fileURLToPath(new URL(cale, import.meta.url)), 'utf8')

const css = sursa('../../frontend/src/index.css')
const stage = sursa('../../frontend/src/pages/Stage.tsx')

describe('×-ul de pe pagina din monitor chiar închide (nu mai moare pe canvas)', () => {
  it('canvasul avatarului e pointer-events:none în modul monitor, nu doar containerul', () => {
    // Fără regula pe CANVAS, clicul pe × cădea pe dreptunghiul three.js de deasupra.
    expect(css).toMatch(/\.stage-canvas\.pip > canvas[\s\S]{0,80}pointer-events:\s*none/)
  })

  it('bara de taburi stă DEASUPRA avatarului (z-index peste stratul lui)', () => {
    // Avatarul e z-index:1; fără să ridicăm bara, canvasul lui o acoperea.
    expect(css).toMatch(/\.workspace-head\s*\{[\s\S]*?z-index:\s*[2-9]/)
  })

  it('×-ul tabului chiar cheamă închiderea (handlerul e cablat)', () => {
    // Clicul pe × oprește propagarea (ca să nu comute tabul) și închide task-ul.
    expect(stage).toMatch(/ws-tab-x[\s\S]{0,200}closeTask\(task\.id\)/)
    expect(stage).toMatch(/e\.stopPropagation\(\)[\s\S]{0,60}closeTask\(task\.id\)/)
  })
})
