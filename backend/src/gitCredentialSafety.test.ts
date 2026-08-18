import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(import.meta.dirname, '../..')
const files = [
  'backend/src/services/lucratori.ts',
  'deploy/constructor-agent.mjs',
  'deploy/deploy.sh',
  'deploy/porti-pr.sh',
  'deploy/veghe-publicare.sh',
]

describe('Git credential safety', () => {
  it.each(files)('%s uses askpass and never embeds credentials in a remote URL', (file) => {
    const source = fs.readFileSync(path.join(root, file), 'utf8')
    expect(source).toContain('GIT_ASKPASS')
    expect(source).not.toContain(['https://', 'x-access-token:'].join(''))
    expect(source).not.toContain(';;;;')
  })
})
