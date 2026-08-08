import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// ── NICIUN BUTON MONITORIZAT NU POATE FI MORT PE HÂRTIE ─────────────────────
//
// Adrian, Aug 1: „Kelion must monitor all the buttons — resolve their tasks,
// remove the ones no longer needed". The health probe in services/health.ts
// pings every Admin button's endpoint. This test guarantees the probe list
// itself never lies: every path in it MUST exist as a real registered route
// in the backend source. If someone renames a route and forgets the probe
// (or the button), it fails here — not in the admin's face.
const health = readFileSync(fileURLToPath(new URL('./services/health.ts', import.meta.url)), 'utf8')
const rute = [
  './routes/admin.ts',
  './routes/voiceprint.ts',
  './routes/constructor.ts',
].map((p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8')).join('\n')

const probe = [...health.matchAll(/\['([^']+)', '(\/api\/[^']+)'\]/g)].map((m) => ({
  nume: m[1],
  path: m[2],
}))

describe('monitorizarea butoanelor din Admin', () => {
  it('sonda există și acoperă cel puțin 15 butoane', () => {
    expect(health).toContain('buton_mort')
    expect(probe.length).toBeGreaterThanOrEqual(15)
  })

  it.each(probe.map((p) => [p.nume, p.path] as [string, string]))(
    'butonul „%s" are rută reală în backend (%s)',
    (_nume, path) => {
      expect(rute).toContain(`'${path}'`)
    },
  )
})
