import { describe, it, expect, vi } from 'vitest'

// Mock-uim funcțiile reale — testăm DISPATCH-ul + extragerea argumentelor, nu ele.
const listSource = vi.hoisted(() => vi.fn(async () => 'ARBORE'))
const readSource = vi.hoisted(() => vi.fn(async () => 'FISIER'))
const searchSource = vi.hoisted(() => vi.fn(async () => 'POTRIVIRE'))
const dbTablesOverview = vi.hoisted(() => vi.fn(async () => 'TABELE'))
const dbQuery = vi.hoisted(() => vi.fn(async () => 'REZULTAT'))
const systemHealth = vi.hoisted(() => vi.fn(async () => 'SANATATE'))
const repoWrite = vi.hoisted(() => vi.fn(async () => 'SCRIS'))
const repoOpenPR = vi.hoisted(() => vi.fn(async () => 'PR'))
const repoMergePR = vi.hoisted(() => vi.fn(async () => 'MERGE'))
const runRunbook = vi.hoisted(() => vi.fn(async () => 'RUNBOOK'))
const runbookStatus = vi.hoisted(() => vi.fn(async () => 'STARE'))
const runbookLog = vi.hoisted(() => vi.fn(async () => 'JURNAL'))
const requestRepair = vi.hoisted(() => vi.fn(async () => 'ORDIN'))

vi.mock('./services/sourceCode.js', () => ({ listSource, readSource, searchSource }))
vi.mock('./db.js', async (importOriginal) => ({ ...(await importOriginal<typeof import('./db.js')>()), dbTablesOverview, dbQuery }))
vi.mock('./services/health.js', async (importOriginal) => ({ ...(await importOriginal<typeof import('./services/health.js')>()), systemHealth }))
vi.mock('./services/github.js', async (importOriginal) => ({ ...(await importOriginal<typeof import('./services/github.js')>()), repoWrite, repoOpenPR, repoMergePR }))
vi.mock('./services/runbooks.js', async (importOriginal) => ({ ...(await importOriginal<typeof import('./services/runbooks.js')>()), runRunbook, runbookStatus, runbookLog, requestRepair }))

import { execSharedAdminTool, SHARED_ADMIN_TOOLS } from './services/adminTools.js'

describe('execSharedAdminTool — dispatch unic al uneltelor admin partajate (risc #4)', () => {
  it('rutează fiecare unealtă partajată la funcția reală, cu argumentele corecte', async () => {
    expect(await execSharedAdminTool('list_source', { dir: 'backend/src' })).toBe('ARBORE')
    expect(listSource).toHaveBeenCalledWith('backend/src')
    await execSharedAdminTool('read_source', { path: 'a.ts', from_line: 10 })
    expect(readSource).toHaveBeenCalledWith('a.ts', 10)
    await execSharedAdminTool('search_source', { query: 'foo' })
    expect(searchSource).toHaveBeenCalledWith('foo')
    expect(await execSharedAdminTool('db_tables', {})).toBe('TABELE')
    await execSharedAdminTool('db_query', { sql: 'select 1' })
    expect(dbQuery).toHaveBeenCalledWith('select 1')
    expect(await execSharedAdminTool('system_health', {})).toBe('SANATATE')
    await execSharedAdminTool('repo_write', { branch: 'b', path: 'p', content: 'c', message: 'm' })
    expect(repoWrite).toHaveBeenCalledWith('b', 'p', 'c', 'm')
    await execSharedAdminTool('repo_open_pr', { branch: 'b', title: 't', body: 'y' })
    expect(repoOpenPR).toHaveBeenCalledWith('b', 't', 'y')
    await execSharedAdminTool('repo_merge_pr', { pr: 7 })
    expect(repoMergePR).toHaveBeenCalledWith(7)
    await execSharedAdminTool('run_runbook', { name: 'diagnostic' })
    expect(runRunbook).toHaveBeenCalledWith('diagnostic')
    await execSharedAdminTool('runbook_log', { run_id: 42 })
    expect(runbookLog).toHaveBeenCalledWith(42)
    await execSharedAdminTool('request_repair', { title: 't', details: 'd' })
    expect(requestRepair).toHaveBeenCalledWith('t', 'd')
  })

  it('runbook_status: nume dat → filtrat; fără nume → undefined', async () => {
    await execSharedAdminTool('runbook_status', { name: 'deploy.yml' })
    expect(runbookStatus).toHaveBeenCalledWith('deploy.yml')
    await execSharedAdminTool('runbook_status', {})
    expect(runbookStatus).toHaveBeenLastCalledWith(undefined)
  })

  it('unealtă NEpartajată → null (apelantul o tratează el)', async () => {
    expect(await execSharedAdminTool('build_software', { order: 'x' })).toBeNull()
    expect(await execSharedAdminTool('web_search', { query: 'x' })).toBeNull()
    expect(await execSharedAdminTool('constructor_status', {})).toBeNull()
  })

  it('SHARED_ADMIN_TOOLS conține exact cele 13 unelte partajate', () => {
    expect(SHARED_ADMIN_TOOLS.size).toBe(13)
    for (const n of ['list_source', 'db_query', 'repo_merge_pr', 'run_runbook', 'request_repair'])
      expect(SHARED_ADMIN_TOOLS.has(n)).toBe(true)
    expect(SHARED_ADMIN_TOOLS.has('build_software')).toBe(false)
  })
})
