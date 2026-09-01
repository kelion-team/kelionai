import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CAPABILITIES } from './services/brainCapabilities.js'

describe('canalul de administrare nu oferă shell arbitrar modelului', () => {
  const chat = readFileSync(fileURLToPath(new URL('./routes/chat.ts', import.meta.url)), 'utf8')
  const defs = readFileSync(fileURLToPath(new URL('./services/brainToolDefs.ts', import.meta.url)), 'utf8')

  it('constructor_command nu mai există în suprafața de unelte sau în executor', () => {
    expect(CAPABILITIES.some((c) => c.name === 'constructor_command')).toBe(false)
    expect(chat).not.toContain("name: 'constructor_command'")
    expect(chat).not.toContain("case 'constructor_command':")
    expect(defs).not.toContain("name: 'constructor_command'")
  })

  it('chatul nu mai execută comenzi construite de model printr-un shell', () => {
    expect(chat).not.toMatch(/import\(['"](?:node:)?child_process['"]\)/)
    expect(chat).not.toMatch(/\bexec\(cmd\b/)
  })

  it('operațiile necesare rămân pe unelte deterministe', () => {
    expect(CAPABILITIES.some((c) => c.name === 'build_software')).toBe(true)
    expect(CAPABILITIES.some((c) => c.name === 'server_ops')).toBe(false)
    expect(CAPABILITIES.some((c) => c.name === 'run_runbook')).toBe(false)
    expect(CAPABILITIES.some((c) => c.name === 'ruleaza_portile')).toBe(false)
  })
})
