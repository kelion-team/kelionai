import { describe, it, expect } from 'vitest'
import { listSource, readSource, searchSource } from './services/sourceCode.js'

// These tests run on the repo's REAL TREE (the root detected by
// sourceCode.ts), so they prove full access to real code, not mocks.

describe('Acces complet la sursă — arbore', () => {
  it('vede fișiere ADÂNCI (peste 3 niveluri) — ex. backend/src/services/brain.ts', async () => {
    const tree = await listSource('.')
    expect(tree).toContain('backend/src/services/brain.ts')
  })
  it('vede DOT-directoarele cu cod real — .github/workflows (CI-ul)', async () => {
    const tree = await listSource('.')
    expect(tree).toMatch(/\.github\/workflows\//)
  })
})

describe('Acces complet la sursă — citire integrală prin paginare', () => {
  it('un fișier mare (chat.ts) se poate citi ÎN ÎNTREGIME prin from_line', async () => {
    const first = await readSource('backend/src/routes/chat.ts')
    expect(first).toMatch(/^1\t/) // starts at line 1, with numbers
    // Large file → the first page must announce the continuation.
    expect(first).toMatch(/continuă: read_source/i)
    // Extract the continuation line and read the next page.
    const m = first.match(/from_line=(\d+)/)
    expect(m).toBeTruthy()
    const next = Number(m![1])
    expect(next).toBeGreaterThan(1)
    const page2 = await readSource('backend/src/routes/chat.ts', next)
    expect(page2).toMatch(new RegExp(`^${next}\\t`)) // page 2 starts exactly at the requested line
  })
})

describe('Acces complet la sursă — secretele rămân blocate', () => {
  it('read_source pe un fișier de secrete e refuzat, chiar dacă listarea le arată', async () => {
    const out = await readSource('backend/.env')
    expect(out).toMatch(/fisier_secret|bad_path/)
  })
  it('nu se poate evada din rădăcină cu ../', async () => {
    const out = await readSource('../../../etc/passwd')
    expect(out).toContain('bad_path')
  })
})

describe('Acces complet la sursă — căutare', () => {
  it('search_source găsește un simbol real în cod', async () => {
    const hits = await searchSource('expertModelLadder')
    expect(hits).toMatch(/brain\.ts:\d+/)
  })
})
