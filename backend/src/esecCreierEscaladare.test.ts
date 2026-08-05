import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const sursaConstructorRoute = readFileSync(
  fileURLToPath(new URL('./routes/constructor.ts', import.meta.url)),
  'utf8',
)

const sursaAdminPanel = readFileSync(
  fileURLToPath(new URL('../../frontend/src/components/AdminPanel.tsx', import.meta.url)),
  'utf8',
)

const sursaDb = readFileSync(
  fileURLToPath(new URL('./db.ts', import.meta.url)),
  'utf8',
)

describe('Eșec creier («creierul nu poate») și buton de escaladare', () => {
  it('ruta constructor.ts oferă endpoint-uri pentru reluare cu creier superior și anunț email explicit', () => {
    expect(sursaConstructorRoute).toContain('/api/admin/constructor/:id/escaladeaza')
    expect(sursaConstructorRoute).toContain('BIFEAZĂ CREIER SUPERIOR')
    expect(sursaConstructorRoute).toContain('creierul nu poate')
  })

  it('AdminPanel.tsx afișează insigna/anunțul explicit și butonul de escaladare', () => {
    expect(sursaAdminPanel).toContain('Bifează creier superior')
    expect(sursaAdminPanel).toContain('retryBuildOrder(j.id, true)')
    expect(sursaAdminPanel).toContain('esecCreier')
  })

  it('db.ts include coloanele creier_superior și esec_creier plus detecția eșecului de creier', () => {
    expect(sursaDb).toContain('creier_superior')
    expect(sursaDb).toContain('esec_creier')
    expect(sursaDb).toMatch(/creier\|brain\|quota\|rate limit\|503\|429/i)
  })
})
