import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock-uim runGoogleTool (păstrăm googleTools reale) + funcțiile de acces la cod,
// ca să testăm dispecerul decuplat fără să lovim API-uri reale sau discul.
const runGoogleTool = vi.hoisted(() => vi.fn(async () => '{"ok":true}'))
const listSource = vi.hoisted(() => vi.fn(async () => 'ARBORE'))
const readSource = vi.hoisted(() => vi.fn(async () => 'FIȘIER'))
const searchSource = vi.hoisted(() => vi.fn(async () => 'POTRIVIRE'))
const dbTablesOverview = vi.hoisted(() => vi.fn(async () => 'TABELE'))
const dbQuery = vi.hoisted(() => vi.fn(async () => 'REZULTAT'))
const systemHealth = vi.hoisted(() => vi.fn(async () => 'SANATATE'))
vi.mock('./services/google.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./services/google.js')>()
  return { ...actual, runGoogleTool }
})
vi.mock('./services/sourceCode.js', () => ({ listSource, readSource, searchSource }))
vi.mock('./db.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./db.js')>()
  return { ...actual, dbTablesOverview, dbQuery }
})
vi.mock('./services/health.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./services/health.js')>()
  return { ...actual, systemHealth }
})

import { voiceBrainTools, makeVoiceExecTool } from './services/voiceBrainTools.js'

describe('voiceBrainTools — uneltele + executorul decuplat al vocii (§6 pas 2-3)', () => {
  beforeEach(() => {
    runGoogleTool.mockClear()
    listSource.mockClear()
    readSource.mockClear()
    searchSource.mockClear()
  })

  it('non-admin: doar Google (fără uneltele de cod)', () => {
    const names = voiceBrainTools(false).map((t) => t.name)
    expect(names).toContain('web_search')
    expect(names).toContain('read_email')
    expect(names).not.toContain('read_source')
  })

  it('admin: Google + acces la cod + vede-și starea (DB, sănătate)', () => {
    const names = voiceBrainTools(true).map((t) => t.name)
    expect(names).toContain('web_search')
    expect(names).toContain('list_source')
    expect(names).toContain('read_source')
    expect(names).toContain('search_source')
    expect(names).toContain('db_tables')
    expect(names).toContain('db_query')
    expect(names).toContain('system_health')
  })

  it('admin: DB + sănătatea merg la executorii decupla ți', async () => {
    const exec = makeVoiceExecTool('TOK', true)
    expect(await exec('db_tables', '{}')).toBe('TABELE')
    expect(dbTablesOverview).toHaveBeenCalled()
    expect(await exec('db_query', '{"sql":"select 1"}')).toBe('REZULTAT')
    expect(dbQuery).toHaveBeenCalledWith('select 1')
    expect(await exec('system_health', '{}')).toBe('SANATATE')
    expect(systemHealth).toHaveBeenCalled()
  })

  it('executorul cheamă runGoogleTool pentru skill-uri Google, cu tokenul', async () => {
    const exec = makeVoiceExecTool('TOK', true)
    expect(await exec('web_search', '{"query":"x"}')).toBe('{"ok":true}')
    expect(runGoogleTool).toHaveBeenCalledWith('web_search', { query: 'x' }, 'TOK')
  })

  it('admin: uneltele de cod merg la sourceCode (decuplat), cu argumentele corecte', async () => {
    const exec = makeVoiceExecTool('TOK', true)
    expect(await exec('list_source', '{"dir":"backend/src"}')).toBe('ARBORE')
    expect(listSource).toHaveBeenCalledWith('backend/src')
    await exec('read_source', '{"path":"a.ts","from_line":10}')
    expect(readSource).toHaveBeenCalledWith('a.ts', 10)
    await exec('search_source', '{"query":"foo"}')
    expect(searchSource).toHaveBeenCalledWith('foo')
  })

  it('non-admin NU poate atinge uneltele de cod (gate de securitate)', async () => {
    const exec = makeVoiceExecTool('TOK', false)
    const out = await exec('read_source', '{"path":"secret.ts"}')
    expect(JSON.parse(out)).toEqual({ error: 'admin_only', name: 'read_source' })
    expect(readSource).not.toHaveBeenCalled()
  })

  it('input ne-JSON → obiect gol; unealtă necunoscută → eroare', async () => {
    const exec = makeVoiceExecTool('TOK', true)
    await exec('get_time', 'stricat')
    expect(runGoogleTool).toHaveBeenCalledWith('get_time', {}, 'TOK')
    expect(JSON.parse(await exec('repo_merge_pr', '{}'))).toEqual({ error: 'unknown_tool', name: 'repo_merge_pr' })
  })
})
