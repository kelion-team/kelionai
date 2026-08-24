import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sourceRoot = resolve(process.cwd(), 'src')

function productionSources(dir = sourceRoot): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return productionSources(path)
    if (!path.endsWith('.ts') || path.endsWith('.test.ts')) return []
    return [path]
  })
}

function callersOf(symbol: string): string[] {
  return productionSources()
    .filter((path) => {
      const source = readFileSync(path, 'utf8')
      const calls = source.match(new RegExp(`\\b${symbol}\\s*\\(`, 'g'))?.length ?? 0
      const declarations = source.match(new RegExp(`(?:function|const)\\s+${symbol}\\b`, 'g'))?.length ?? 0
      return calls > declarations
    })
    .map((path) => relative(sourceRoot, path).replaceAll('\\', '/'))
    .sort()
}

describe('single product-debit boundary', () => {
  it('routes every paid capability through the central identity-aware debit', () => {
    expect(callersOf('debitWalletMinorAtomar')).toEqual([
      'routes/a2a.ts',
      'routes/chat.ts',
      'routes/vocalLive.ts',
      'services/apelTraducere.ts',
      'services/tarife.ts',
    ])
    expect(callersOf('taxeazaServiciu')).toEqual([
      'routes/chat.ts',
      'routes/jobs.ts',
    ])
  })

  it('has exactly one SQL path that decreases an available wallet', () => {
    const writers = productionSources()
      .filter((path) => /balance_minor\s*=\s*balance_minor\s*-/.test(readFileSync(path, 'utf8')))
      .map((path) => relative(sourceRoot, path).replaceAll('\\', '/'))
    expect(writers).toEqual(['db.ts'])

    const db = readFileSync(join(sourceRoot, 'db.ts'), 'utf8')
    expect(db).toMatch(/function debitWalletMinorAtomar[\s\S]*?if \(esteAdminKelion\(email\)\) return \{ ok: true, debitedMinor: 0/)
  })

  it('does not attach a second wallet debit to included capabilities', () => {
    for (const path of [
      'routes/auz.ts',
      'routes/offline.ts',
      'routes/constructor.ts',
      'routes/deploy.ts',
    ]) {
      const source = readFileSync(join(sourceRoot, path), 'utf8')
      expect(source).not.toMatch(/debitWalletMinorAtomar|taxeazaServiciu|balance_minor\s*=/)
    }
  })
})
