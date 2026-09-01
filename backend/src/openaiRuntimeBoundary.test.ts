import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function runtimeSources(directory: URL): string[] {
  const root = fileURLToPath(directory)
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name)
    if (entry.isDirectory()) return runtimeSources(new URL(`${entry.name}/`, directory))
    return entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')
      ? [path]
      : []
  })
}

describe('frontiera dintre aplicație și autentificarea personală Codex', () => {
  it('nu citește tokenul personal și nu apelează endpointuri ChatGPT private', () => {
    const files = [
      fileURLToPath(new URL('./index.ts', import.meta.url)),
      ...runtimeSources(new URL('./routes/', import.meta.url)),
      ...runtimeSources(new URL('./services/', import.meta.url)),
    ]
    const forbidden = [
      ['.codex', 'auth.json'].join('/'),
      ['chatgpt.com', 'backend-api'].join('/'),
      ['ChatGPT', 'Account-ID'].join('-'),
    ]

    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      for (const needle of forbidden) expect(source, `${file} conține ${needle}`).not.toContain(needle)
    }
  })
})
