import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const source = fs.readFileSync(path.resolve(import.meta.dirname, '../../deploy/sentinela-locala.sh'), 'utf8')

describe('sentinela locală', () => {
  it('restarts only after three consecutive misses, which span at least six minutes', () => {
    expect(source).toContain('[ "$fails" -lt 3 ]')
    expect(source).not.toContain('[ "$fails" -lt 2 ]')
    expect(source).toContain('mort de 3 ori LA RÂND (≥6 min')
  })
})
