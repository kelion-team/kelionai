import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { OrChatResult, OrToolCall } from './openrouter.js'

// ── POARTA FAPTEI, PROBA DE REGRESIE (Adrian, 27 iul: „autonomia lui nu e
// reală") ────────────────────────────────────────────────────────────────────
// Bugul reparat: forțarea ținea o singură rundă, iar modelul o satisfăcea cu o
// unealtă de CITIT (system_health, read_source) după care revenea la 'auto' și
// NARA restul; în plus poarta faptei se dezarma singură la prima unealtă, deci
// nu mai putea prinde „am reparat" niciodată pe turele de acțiune.
// Testele astea îngheață comportamentul corect: forțarea ține până la o faptă
// REALĂ, iar poarta rămâne armată cât timp nu s-a făcut nimic.

const seen: { toolChoice?: string }[] = []
let queue: { text: string; toolCalls: OrToolCall[] }[] = []

const call = (name: string): OrToolCall => ({
  id: `c_${name}`,
  type: 'function',
  function: { name, arguments: '{}' },
})

vi.mock('./openrouter.js', () => ({
  openrouterChat: async (
    _model: string,
    _messages: unknown,
    _tools: unknown,
    opts: { toolChoice?: string } = {},
  ): Promise<OrChatResult> => {
    seen.push({ toolChoice: opts.toolChoice })
    const next = queue.shift() ?? { text: '', toolCalls: [] }
    return { text: next.text, toolCalls: next.toolCalls, costUsd: 0, model: 'test', stop: 'stop' }
  },
  openrouterChatStream: async (): Promise<OrChatResult> => ({
    text: '',
    toolCalls: [],
    costUsd: 0,
    model: 'test',
    stop: 'stop',
  }),
}))

const { runOrchestrator } = await import('./orchestrator.js')

const TOOLS = [
  { name: 'system_health', description: 'stare', input_schema: { type: 'object', properties: {} } },
  { name: 'repo_write', description: 'scrie cod', input_schema: { type: 'object', properties: {} } },
]
const PASSIVE = new Set(['system_health', 'read_source', 'db_query', 'ask_brain'])

beforeEach(() => {
  seen.length = 0
  queue = []
})

describe('orchestrator — forțarea până la faptă', () => {
  it('o unealtă PASIVĂ nu oprește forțarea; una de ACȚIUNE o oprește', async () => {
    queue = [
      { text: '', toolCalls: [call('system_health')] }, // doar citește → nu e faptă
      { text: '', toolCalls: [call('repo_write')] }, // asta e fapta
      { text: 'gata, am scris fixul', toolCalls: [] },
    ]
    await runOrchestrator('openai/test', [{ role: 'user', content: 'repară X' }], TOOLS, async () => 'ok', {
      forceToolsUntilAction: true,
      passiveTools: PASSIVE,
    })
    expect(seen.map((s) => s.toolChoice)).toEqual(['required', 'required', undefined])
  })

  it('fără forțare cerută, nu forțează nimic (conversația obișnuită e neatinsă)', async () => {
    queue = [{ text: 'salut', toolCalls: [] }]
    await runOrchestrator('openai/test', [{ role: 'user', content: 'salut' }], TOOLS, async () => 'ok', {
      passiveTools: PASSIVE,
    })
    expect(seen.map((s) => s.toolChoice)).toEqual([undefined])
  })

  it('forțarea se plafonează (nu ține la infinit dacă modelul doar citește)', async () => {
    queue = Array.from({ length: 6 }, () => ({ text: '', toolCalls: [call('system_health')] }))
    await runOrchestrator('openai/test', [{ role: 'user', content: 'repară X' }], TOOLS, async () => 'ok', {
      forceToolsUntilAction: true,
      passiveTools: PASSIVE,
    })
    // primele 3 runde forțate, restul libere — altfel ar chema unelte la infinit
    expect(seen.slice(0, 3).every((s) => s.toolChoice === 'required')).toBe(true)
    expect(seen.slice(3).every((s) => s.toolChoice === undefined)).toBe(true)
  })
})

describe('orchestrator — poarta faptei', () => {
  it('prinde „am reparat" chiar dacă modelul a chemat o unealtă de CITIT', async () => {
    queue = [
      { text: '', toolCalls: [call('system_health')] }, // bifează o unealtă pasivă
      { text: 'am reparat animația gurii', toolCalls: [] }, // ...și minte
      { text: 'nu pot: nu am unealta potrivită', toolCalls: [] }, // retractare onestă
    ]
    await runOrchestrator('openai/test', [{ role: 'user', content: 'repară X' }], TOOLS, async () => 'ok', {
      deedGate: true,
      passiveTools: PASSIVE,
    })
    // poarta a cerut o rundă în plus, iar aia rulează FORȚAT (nu pe 'auto',
    // altfel modelul repeta minciuna cu alte cuvinte)
    expect(seen).toHaveLength(3)
    expect(seen[2].toolChoice).toBe('required')
  })

  it('nu intervine când fapta a fost chiar făcută', async () => {
    queue = [
      { text: '', toolCalls: [call('repo_write')] },
      { text: 'am reparat animația gurii', toolCalls: [] },
    ]
    await runOrchestrator('openai/test', [{ role: 'user', content: 'repară X' }], TOOLS, async () => 'ok', {
      deedGate: true,
      passiveTools: PASSIVE,
    })
    expect(seen).toHaveLength(2)
  })
})
