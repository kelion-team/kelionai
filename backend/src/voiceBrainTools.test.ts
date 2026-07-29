import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock-uim DOAR runGoogleTool (păstrăm googleTools reale) ca să testăm dispecerul
// executorului fără să lovim API-urile Google.
const runGoogleTool = vi.hoisted(() => vi.fn(async () => '{"ok":true}'))
vi.mock('./services/google.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./services/google.js')>()
  return { ...actual, runGoogleTool }
})

import { googleBrainTools, makeGoogleExecTool } from './services/voiceBrainTools.js'

describe('voiceBrainTools — uneltele + executorul decuplat al vocii (§6 pas 2)', () => {
  beforeEach(() => runGoogleTool.mockClear())

  it('expune definițiile reale ale skill-urilor Google', () => {
    const names = googleBrainTools().map((t) => t.name)
    expect(names).toContain('web_search')
    expect(names).toContain('read_email') // adăugate în CREIER UNIC
    expect(names).toContain('delete_calendar_event')
    expect(names.length).toBeGreaterThanOrEqual(22)
  })

  it('executorul parsează argumentele și cheamă runGoogleTool cu tokenul', async () => {
    const exec = makeGoogleExecTool('TOK')
    const out = await exec('web_search', '{"query":"kelion"}')
    expect(out).toBe('{"ok":true}')
    expect(runGoogleTool).toHaveBeenCalledWith('web_search', { query: 'kelion' }, 'TOK')
  })

  it('argumente ne-JSON → obiect gol (nu aruncă)', async () => {
    const exec = makeGoogleExecTool('TOK')
    await exec('get_time', 'nu-i json')
    expect(runGoogleTool).toHaveBeenCalledWith('get_time', {}, 'TOK')
  })

  it('unealtă necunoscută (non-Google) → eroare clară, fără să cheme runGoogleTool', async () => {
    const exec = makeGoogleExecTool('TOK')
    const out = await exec('repo_merge_pr', '{}')
    expect(JSON.parse(out)).toEqual({ error: 'unknown_tool', name: 'repo_merge_pr' })
    expect(runGoogleTool).not.toHaveBeenCalled()
  })
})
