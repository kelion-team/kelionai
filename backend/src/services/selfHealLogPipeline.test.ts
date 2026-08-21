import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  ServerLogAdapter,
  ConstructorLogAdapter,
  groupLogsByFingerprint,
  SelfHealDecisionEngine,
  runLogSelfHealPipeline,
  eEroareDeInfrastructura,
  type RawLogItem,
} from './selfHealLogPipeline.js'

const jobs: { scope: string; order: string }[] = []
const kv = new Map<string, string>()

vi.mock('../db.js', () => ({
  createBuildJob: async (scope: string, order: string) => {
    jobs.push({ scope, order })
    return jobs.length
  },
  loadKv: async (k: string) => kv.get(k) ?? null,
  saveKv: async (k: string, v: string) => {
    kv.set(k, v)
  },
}))

vi.mock('./selfHeal.js', () => ({
  sursaOcupata: async (scope: string) => jobs.filter((j) => j.scope === scope).length > 0,
  signature: (msg: string) => `sig-${msg.slice(0, 30).replace(/[^a-z0-9]/gi, '_')}`,
}))

let mockRecentLogs: { level: number; t: string; msg: string }[] = []
vi.mock('./logbuffer.js', () => ({
  recentLogs: (_minLevel: number, _limit: number) => mockRecentLogs,
}))

let mockGazdaFiles: Record<string, { ok: boolean; text: string }> = {}
vi.mock('./logGazda.js', () => ({
  FISIERE_GAZDA: ['constructor.log', 'auto-publicare.log'] as const,
  coadaLogGazda: async (file: string) => mockGazdaFiles[file] ?? { ok: false, text: '' },
  semnaturiEroare: (text: string) =>
    text
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.includes('Error') || l.includes('FATAL') || l.includes('panic')),
}))

describe('Pipeline de auto-vindecare pentru loguri de server și constructor', () => {
  beforeEach(() => {
    jobs.length = 0
    kv.clear()
    mockRecentLogs = []
    mockGazdaFiles = {}
  })

  describe('Adaptoare de scanare loguri', () => {
    it('ServerLogAdapter extrage mesajele din inelul de loguri de server', async () => {
      mockRecentLogs = [
        { level: 50, t: new Date(1700000000000).toISOString(), msg: 'Unhandled rejection in /api/chat: Database timeout' },
        { level: 40, t: new Date(1700000001000).toISOString(), msg: 'Fastify error 500 on GET /api/status' },
      ]
      const adapter = new ServerLogAdapter()
      const results = await adapter.scan()

      expect(results).toHaveLength(2)
      expect(results[0].source).toBe('server')
      expect(results[0].message).toContain('Database timeout')
      expect(results[1].source).toBe('server')
      expect(results[1].message).toContain('Fastify error 500')
    })

    it('ConstructorLogAdapter scanează fișierele gazdei și extrage erorile', async () => {
      mockGazdaFiles['constructor.log'] = {
        ok: true,
        text: 'info: starting\nError: build worker exited with code 1\nFATAL: out of memory during tsc',
      }
      mockGazdaFiles['auto-publicare.log'] = {
        ok: true,
        text: 'ok: sync complete\nError: docker compose restart failed',
      }

      const adapter = new ConstructorLogAdapter(['constructor.log', 'auto-publicare.log'])
      const results = await adapter.scan()

      expect(results).toHaveLength(3)
      expect(results[0].source).toBe('constructor')
      expect(results[0].message).toBe('Error: build worker exited with code 1')
      expect(results[1].source).toBe('constructor')
      expect(results[1].message).toBe('FATAL: out of memory during tsc')
      expect(results[2].source).toBe('gazda')
      expect(results[2].message).toBe('Error: docker compose restart failed')
    })
  })

  describe('Grupare pe amprente', () => {
    it('normalizează mesajele și agregă aparițiile similare', () => {
      const items: RawLogItem[] = [
        { source: 'server', fileOrContext: 'server.logbuffer', message: '2026-08-14 12:00:00 Error: connection reset at id 1234' },
        { source: 'server', fileOrContext: 'server.logbuffer', message: '2026-08-14 12:00:05 Error: connection reset at id 5678' },
        { source: 'server', fileOrContext: 'server.logbuffer', message: 'TypeError: undefined variable in helper' },
      ]

      const grouped = groupLogsByFingerprint(items)
      expect(grouped).toHaveLength(2)

      const connGroup = grouped.find((g) => g.sampleMessage.includes('connection reset'))
      expect(connGroup).toBeDefined()
      expect(connGroup?.count).toBe(2)

      const typeErrGroup = grouped.find((g) => g.sampleMessage.includes('TypeError'))
      expect(typeErrGroup).toBeDefined()
      expect(typeErrGroup?.count).toBe(1)
    })
  })

  describe('SelfHealDecisionEngine & Verificare praguri de declanșare build_software', () => {
    it('SUB prag → salvează contorul în KV dar NU deschide ordin de build', async () => {
      const engine = new SelfHealDecisionEngine({ thresholds: { server: 3 } })
      const groups = [
        {
          fingerprint: 'fp-server-err-1',
          sampleMessage: 'Error in DB connection',
          source: 'server' as const,
          fileOrContext: 'server.logbuffer',
          count: 2, // 2 < 3 (sub prag)
        },
      ]

      const res = await engine.processAggregatedGroups(groups)
      expect(res.filed).toBe(0)
      expect(jobs).toHaveLength(0)
      expect(kv.get('selfheal-log-n:server:fp-server-err-1')).toBe('2')
    })

    it('LA / PESTE prag → deschide ordin de build_software și marchează cheia filed', async () => {
      const engine = new SelfHealDecisionEngine({ thresholds: { server: 3 } })
      const groups = [
        {
          fingerprint: 'fp-server-err-1',
          sampleMessage: 'Error in DB connection',
          source: 'server' as const,
          fileOrContext: 'server.logbuffer',
          count: 3, // 3 >= 3 (atinge pragul)
        },
      ]

      const res = await engine.processAggregatedGroups(groups)
      expect(res.filed).toBe(1)
      expect(jobs).toHaveLength(1)
      expect(jobs[0].scope).toBe('kelion-autovindecare-server')
      expect(jobs[0].order).toContain('Error in DB connection')
      expect(jobs[0].order).toContain('count=3, prag=3')
      expect(kv.has('selfheal-log-filed:server:fp-server-err-1')).toBe(true)
    })

    it('trimite erorile constructorului strategului fără ordin recursiv, după atingerea pragului', async () => {
      const engine = new SelfHealDecisionEngine({ thresholds: { constructor: 2 } })
      const groupRun1 = [
        {
          fingerprint: 'fp-constructor-err-99',
          sampleMessage: 'Error: worker crashed on build step',
          source: 'constructor' as const,
          fileOrContext: 'constructor.log',
          count: 1, // 1 < 2
        },
      ]

      const res1 = await engine.processAggregatedGroups(groupRun1)
      expect(res1.filed).toBe(0)
      expect(jobs).toHaveLength(0)

      const groupRun2 = [
        {
          fingerprint: 'fp-constructor-err-99',
          sampleMessage: 'Error: worker crashed on build step',
          source: 'constructor' as const,
          fileOrContext: 'constructor.log',
          count: 1, // 1 + 1 = 2 >= 2 (prag atins)
        },
      ]

      const res2 = await engine.processAggregatedGroups(groupRun2)
      expect(res2.filed).toBe(0)
      expect(jobs).toHaveLength(0)
      expect(JSON.parse(kv.get('selfheal-log-filed:constructor:fp-constructor-err-99') ?? '{}')).toMatchObject({
        count: 2,
        handedTo: 'constructor_incident_strategist',
        evidence: 'Error: worker crashed on build step',
      })
    })

    it('Dedup: o amprentă deja trimisă nu mai generează alt ordin', async () => {
      const engine = new SelfHealDecisionEngine({ thresholds: { server: 2 } })
      const groups = [
        {
          fingerprint: 'fp-dup',
          sampleMessage: 'Error: recurring issue',
          source: 'server' as const,
          fileOrContext: 'server.logbuffer',
          count: 2,
        },
      ]

      await engine.processAggregatedGroups(groups)
      expect(jobs).toHaveLength(1)

      // Rulare repetată
      const resSecond = await engine.processAggregatedGroups(groups)
      expect(resSecond.filed).toBe(0)
      expect(jobs).toHaveLength(1)
    })
  })

  describe('runLogSelfHealPipeline end-to-end', () => {
    it('scanează adaptoarele, grupează logurile și emite ordin la depășirea pragului', async () => {
      mockRecentLogs = [
        { level: 50, t: new Date(100).toISOString(), msg: 'Error: fatal pool connection failed' },
        { level: 50, t: new Date(200).toISOString(), msg: 'Error: fatal pool connection failed' },
      ]
      mockGazdaFiles['constructor.log'] = {
        ok: true,
        text: 'Error: build failed\nError: build failed',
      }

      const res = await runLogSelfHealPipeline()
      expect(res.filed).toBeGreaterThanOrEqual(1)
      expect(jobs.length).toBeGreaterThanOrEqual(1)
    })
  })

  // ── INFRASTRUCTURA NU NAȘTE ORDINE DE COD (regula §16, extinsă — lot B) ──
  // Clasa exactă: [ASR CHIRP CĂZUT] HTTP 403 (rol IAM pierdut) se repetă la
  // fiecare tură vocală → prag 2 atins imediat → ordin FALS de reparat cod
  // pentru o problemă de permisiuni. Ca la Postgres (§16, Devin): evidență, nu ordin.
  describe('infrastructura căzută = evidență, nu build_software', () => {
    it('clasificatorul pur recunoaște clasele de infrastructură', () => {
      expect(eEroareDeInfrastructura('[ASR CHIRP CĂZUT] HTTP 403 de la Speech v2 (PERMISSION_DENIED) — trec pe urechea Gemini')).toBe(true)
      expect(eEroareDeInfrastructura('route error err: connect ECONNREFUSED 127.0.0.1:5432')).toBe(true)
      expect(eEroareDeInfrastructura('gemini 429 RESOURCE_EXHAUSTED: quota exceeded')).toBe(true)
      expect(eEroareDeInfrastructura('[PROFUNDUL EPUIZAT] google-direct/gemini a picat → cad pe fața rapidă')).toBe(true)
      expect(eEroareDeInfrastructura('gemini 404 NOT_FOUND: model retired')).toBe(true)
      expect(eEroareDeInfrastructura('getaddrinfo ENOTFOUND api.example.com')).toBe(true)
    })
    it('…și NU stinge defectele reale de cod', () => {
      expect(eEroareDeInfrastructura("TypeError: Cannot read properties of undefined (reading 'map')")).toBe(false)
      expect(eEroareDeInfrastructura('ReferenceError: sarcina is not defined')).toBe(false)
      expect(eEroareDeInfrastructura('Error: fatal pool connection failed')).toBe(false)
      expect(eEroareDeInfrastructura('Unhandled rejection in /api/chat: Database timeout')).toBe(false)
    })
    it('un log de server de infrastructură la prag NU deschide ordin — se reține ca evidență', async () => {
      const engine = new SelfHealDecisionEngine()
      const groups = groupLogsByFingerprint([
        { source: 'server', fileOrContext: 'server.logbuffer', message: '[ASR CHIRP CĂZUT] HTTP 403 de la Speech v2 (PERMISSION_DENIED) — trec pe urechea Gemini', timestamp: 1 },
        { source: 'server', fileOrContext: 'server.logbuffer', message: '[ASR CHIRP CĂZUT] HTTP 403 de la Speech v2 (PERMISSION_DENIED) — trec pe urechea Gemini', timestamp: 2 },
      ] satisfies RawLogItem[])
      const res = await engine.processAggregatedGroups(groups)
      expect(res.filed).toBe(0)
      expect(jobs).toHaveLength(0)
      const filedKeys = Array.from(kv.keys()).filter((k) => k.startsWith('selfheal-log-filed:'))
      expect(filedKeys).toHaveLength(1)
      expect(JSON.parse(kv.get(filedKeys[0]) ?? '{}').handedTo).toBe('infrastructura_nu_cod')
    })
    it('un defect REAL de cod la prag deschide ordin exact ca înainte (filtrul nu orbește vindecarea)', async () => {
      const engine = new SelfHealDecisionEngine()
      const groups = groupLogsByFingerprint([
        { source: 'server', fileOrContext: 'server.logbuffer', message: "TypeError: Cannot read properties of undefined (reading 'map')", timestamp: 1 },
        { source: 'server', fileOrContext: 'server.logbuffer', message: "TypeError: Cannot read properties of undefined (reading 'map')", timestamp: 2 },
      ] satisfies RawLogItem[])
      const res = await engine.processAggregatedGroups(groups)
      expect(res.filed).toBe(1)
      expect(jobs).toHaveLength(1)
    })
  })
})
