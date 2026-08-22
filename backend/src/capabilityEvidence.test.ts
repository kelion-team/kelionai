import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

interface EvidenceReport {
  summary: {
    capabilities: number
    capabilitiesStaticPass: number
    uiApplications: number
    uiApplicationsMapped: number
    manualSections: number
    gaps: Record<string, string[]>
  }
  capabilities: { implementationRefs: unknown[]; staticVerdict: string }[]
}

describe('matricea capabilităților promise', () => {
  it('fiecare capabilitate, aplicație UI și secțiune de manual are dovadă statică', () => {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
    const script = join(root, 'scripts/genereaza-dovezi-capabilitati.mjs')
    const temp = mkdtempSync(join(tmpdir(), 'kelion-capability-evidence-'))
    const output = join(temp, 'evidence.json')
    try {
      execFileSync(process.execPath, [script, output], { cwd: root, stdio: 'pipe' })
      const report = JSON.parse(readFileSync(output, 'utf8')) as EvidenceReport
      expect(report.summary.capabilities).toBe(130) // 22 aug (2): +5 unelte oferite dar neînregistrate (C4 — apeleaza_user, guest voices ×3, media_control). // 22 aug: +dovada_faptelor (JARVIS pasul 4 — cititorul jurnalului operațional). // 20 aug: −comuta_sursa (comutatorul free/plătit scos odată cu Ollama Cloud). // 19 aug: +autoverificare (self-check LIVE real din chat)
      expect(report.summary.capabilitiesStaticPass).toBe(report.summary.capabilities)
      expect(report.summary.uiApplicationsMapped).toBe(report.summary.uiApplications)
      expect(report.summary.manualSections).toBe(12) // 20 aug: +„When you lose signal — the companion mode" (offline faza 1-4)
      expect(Object.values(report.summary.gaps).flat()).toEqual([])
      expect(report.capabilities.every((row) => row.staticVerdict === 'pass' && row.implementationRefs.length > 0)).toBe(true)
    } finally {
      rmSync(temp, { recursive: true, force: true })
    }
  })
})
