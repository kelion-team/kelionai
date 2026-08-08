import { describe, it, expect, vi } from 'vitest'

// We mock the real functions — we test the DISPATCH + argument extraction, not them.
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
// POARTA DE MĂSURARE (8 aug): `repo_open_pr`/`repo_merge_pr` nu mai pornesc fără
// o rulare completă și recentă de porți. Implicit o punem pe „există dovadă", ca
// testul de rutare să măsoare ce măsura și înainte; refuzul are testul lui, mai jos.
const dovadaPortilor = vi.hoisted(() => vi.fn(async () => ({ poateImplementa: true, motiv: 'porți TRECE, măsurate acum 1 min' })))

vi.mock('./services/sourceCode.js', () => ({ listSource, readSource, searchSource }))
vi.mock('./db.js', async (importOriginal) => ({ ...(await importOriginal<typeof import('./db.js')>()), dbTablesOverview, dbQuery }))
vi.mock('./services/health.js', async (importOriginal) => ({ ...(await importOriginal<typeof import('./services/health.js')>()), systemHealth }))
vi.mock('./services/github.js', async (importOriginal) => ({ ...(await importOriginal<typeof import('./services/github.js')>()), repoWrite, repoOpenPR, repoMergePR }))
vi.mock('./services/masurare.js', async (importOriginal) => ({ ...(await importOriginal<typeof import('./services/masurare.js')>()), dovadaPortilor }))
vi.mock('./services/runbooks.js', async (importOriginal) => ({ ...(await importOriginal<typeof import('./services/runbooks.js')>()), runRunbook, runbookStatus, runbookLog, requestRepair }))

import { execSharedAdminTool, SHARED_ADMIN_TOOLS } from './services/adminTools.js'

describe('execSharedAdminTool — dispatch unic al uneltelor admin partajate (risc #4)', () => {
  // Adrian, 8 aug: „va trebui să folosească OBLIGATORIU toate testele și să
  // măsoare orice răspuns". Poarta e în COD, nu în prompt — deci se probează.
  it('FĂRĂ măsurătoare, uneltele care schimbă softul REFUZĂ și nu apelează nimic', async () => {
    dovadaPortilor.mockResolvedValueOnce({ poateImplementa: false, motiv: 'nu ai rulat NICIODATĂ porțile' })
    const r1 = await execSharedAdminTool('repo_open_pr', { branch: 'b', title: 't', body: 'y' })
    expect(String(r1)).toContain('REFUZAT')
    expect(String(r1)).toContain('ruleaza_portile')
    expect(repoOpenPR).not.toHaveBeenCalled()

    dovadaPortilor.mockResolvedValueOnce({ poateImplementa: false, motiv: 'porțile PICĂ' })
    const r2 = await execSharedAdminTool('repo_merge_pr', { pr: 7 })
    expect(String(r2)).toContain('REFUZAT')
    expect(repoMergePR).not.toHaveBeenCalled()
  })

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

  it('SHARED_ADMIN_TOOLS conține exact cele 34 unelte partajate', () => {
    // 3 aug: +3 (jules_repos/jules_task/jules_status — agentul asincron oficial
    // Google, pe cheia JULES_API_KEY pusă de owner).
    // 8 aug: +2 (ruleaza_portile/jurnal_masuratori — sistemul de măsurare cerut
    // de owner: „să știe să-și ruleze testele cum îmi dai tu mie să-ți rulez").
    expect(SHARED_ADMIN_TOOLS.size).toBe(34)
    for (const n of [
      'list_source', 'db_query', 'repo_merge_pr', 'run_runbook', 'request_repair',
      // Jul 30: he does his OWN settings — the same three in writing and in voice.
      'secret_pune', 'secret_lista', 'secret_publica',
      // Jul 30: the owner's requirements are caught from the conversation, no longer lost.
      'cerinta_noua', 'cerinte_lista', 'cerinta_prioritate',
      // Jul 31: the card at providers — the gate is the voice window, in the executor.
      'card_stare', 'card_completeaza', 'card_gata',
      // Jul 31, the third request: sees EVERYTHING the admin contains and can change it.
      'admin_vezi', 'admin_schimba',
      // Aug 2, LISTA LUI, aprobată de Adrian: memoria de proiect + starea măsurată.
      'memorie_pune', 'memorie_ia', 'memorie_lista', 'stare_masurata',
    ])
      expect(SHARED_ADMIN_TOOLS.has(n)).toBe(true)
    expect(SHARED_ADMIN_TOOLS.has('build_software')).toBe(false)
  })
})
