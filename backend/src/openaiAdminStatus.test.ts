import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const source = (path: string): string =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

function routeHandler(fullSource: string, method: string, path: string): string {
  const registration = new RegExp(`app\\.${method}\\s*(?:<[\\s\\S]{0,3000}?>)?\\s*\\(\\s*'${path}'`)
  const match = registration.exec(fullSource)
  expect(match, `missing route ${method.toUpperCase()} ${path}`).toBeTruthy()
  const rest = fullSource.slice((match as RegExpExecArray).index + (match as RegExpExecArray)[0].length)
  const next = rest.search(/\n {2}app\.(get|post|put|patch|delete)\b/)
  return next === -1 ? rest : rest.slice(0, next)
}

describe('Admin uses the measured safe OpenAI status consistently', () => {
  const route = routeHandler(source('./routes/admin.ts'), 'get', '/api/admin/brain-credit')
  const card = source('../../frontend/src/components/admin/shared.tsx')

  it('brain-credit reports the health probe instead of key presence', () => {
    expect(route).toContain('openaiHealth()')
    expect(route).toContain('serving: openai.serving')
    expect(route).toContain('status: openai.status')
    expect(route).toContain('class: openai.class')
    expect(route).toContain('action: openaiHealthAction(openai.class)')
    expect(route).not.toContain('serving: openaiAvailable()')
  })

  it('a non-serving provider never renders a success check and shows the safe class', () => {
    expect(card).toMatch(/!o\?\.serving \? `⚠ \$\{o\?\.class \?\? 'necunoscut'\}`/)
    expect(card).toContain("o?.class ?? 'stare necunoscută'")
    expect(card).toContain('o?.action')
    expect(card).not.toMatch(/o\?\.serving \? '✓'/)
  })
})
