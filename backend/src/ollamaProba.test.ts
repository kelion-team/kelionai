// ── PROBA OLLAMA — dovada vie a creierului LOCAL al constructorului (owner, 16
// aug: „aider pe un model LOCAL pe VPS (Ollama)… verifică dacă nu e deja pus pe
// serverul linux"). Nu ghicim dacă Ollama e pe server — îl întrebăm pe HOST prin
// HTTP (`/api/tags`), NU rulând CLI-ul în container (bugul „spawn ollama ENOENT"
// care striga fals „LIPSĂ pe VPS"). + LEGĂTURA: proba e în health, în panoul
// constructor, iar agentul chiar instalează/rulează pe creierul local.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

function sursa(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

describe('probaOllama — întreabă HOST-ul prin HTTP (/api/tags), cu cache', () => {
  beforeEach(async () => {
    const { _resetProbaOllama } = await import('./services/ollamaProba.js')
    _resetProbaOllama()
    vi.restoreAllMocks()
  })

  it('Ollama nu răspunde pe host → ok:false cu motiv real (nu „e ok" fabricat)', async () => {
    // Serviciul căzut / neatins = eroare de rețea, NU „spawn ollama ENOENT" din
    // container (bugul reparat: nu mai rulăm binarul local, întrebăm host-ul).
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('fetch failed ECONNREFUSED') }))
    const { probaOllama, _resetProbaOllama } = await import('./services/ollamaProba.js')
    _resetProbaOllama()
    const r = await probaOllama()
    expect(r.ok).toBe(false)
    expect(r.modele).toEqual([])
    expect(r.motiv).toContain('nu răspunde pe host')
    vi.unstubAllGlobals()
  })

  it('Ollama pe host răspunde (200 + /api/tags) → ok:true cu modelele REALE (dovada)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ models: [{ name: 'qwen2.5-coder:7b' }, { name: 'llama3.2:latest' }] }),
    })))
    const { probaOllama, _resetProbaOllama } = await import('./services/ollamaProba.js')
    _resetProbaOllama()
    const r = await probaOllama()
    expect(r.ok).toBe(true)
    expect(r.modele).toContain('qwen2.5-coder:7b')
    expect(r.modele).toContain('llama3.2:latest')
    vi.unstubAllGlobals()
  })
})

describe('proba Ollama e LEGATĂ (health + panoul constructor + auto-instalarea agentului)', () => {
  it('systemHealth probează creierul LOCAL Ollama (VIU/LIPSĂ măsurat)', () => {
    const h = sursa('./services/health.ts')
    expect(h).toContain('probaOllama()')
    expect(h).toContain('ollama-local-lipsa')
  })
  it('GET /api/admin/constructor trimite starea probată a creierului local', () => {
    const c = sursa('./routes/constructor.ts')
    expect(c).toMatch(/probaOllama\(\)/)
    expect(c).toContain('ollama, // { ok, modele, motiv }')
  })
  it('agentul își pune SINGUR creierul local pe VPS (owner: „sa instaleze el")', () => {
    const a = sursa('../../deploy/constructor-agent.mjs')
    expect(a).toContain('function asiguraCreierulLocal')
    expect(a).toContain('setup-ollama.sh')
    expect(a).toContain('OLLAMA_API_BASE')
    expect(a).toContain('ollama_chat/')
  })
})

describe('S3 — serializarea și validarea argumentelor de unelte Ollama Cloud', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('normalizeazaSchema asigură JSON Schema valid pentru tool definitions', async () => {
    const { normalizeazaSchema } = await import('./services/ollamaCloud.js')
    
    // Schema fără type → adaugă 'object'
    expect(normalizeazaSchema({})).toEqual({ type: 'object', properties: {} })
    
    // Schema fără properties → adaugă properties gol
    expect(normalizeazaSchema({ type: 'object' })).toEqual({ type: 'object', properties: {} })
    
    // Schema cu properties invalid → curăță
    expect(normalizeazaSchema({ type: 'object', properties: 'invalid' })).toEqual({ type: 'object', properties: {} })
    
    // Schema cu properties array → curăță
    expect(normalizeazaSchema({ type: 'object', properties: [] })).toEqual({ type: 'object', properties: {} })
    
    // Schema cu proprietăți nepermise → curăță
    const schemaCuExtra = { type: 'object', properties: { name: { type: 'string' } }, extraProp: 'bad' }
    const result = normalizeazaSchema(schemaCuExtra)
    expect(result).not.toHaveProperty('extraProp')
    expect(result.type).toBe('object')
    expect(result.properties).toEqual({ name: { type: 'string' } })
    
    // Schema cu required invalid → curăță
    const schemaCuRequiredInvalid = { type: 'object', properties: {}, required: 'not-array' }
    const result2 = normalizeazaSchema(schemaCuRequiredInvalid)
    expect(result2).not.toHaveProperty('required')
    
    // Schema cu required array valid → păstrează
    const schemaCuRequiredValid = { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }
    const result3 = normalizeazaSchema(schemaCuRequiredValid)
    expect(result3.required).toEqual(['name'])
    
    // Schema cu required array parțial invalid → filtrează
    const schemaCuRequiredMixt = { type: 'object', properties: {}, required: ['name', 123, null] }
    const result4 = normalizeazaSchema(schemaCuRequiredMixt)
    expect(result4.required).toEqual(['name'])
    
    // Schema null/undefined → schema minimală
    expect(normalizeazaSchema(null)).toEqual({ type: 'object', properties: {} })
    expect(normalizeazaSchema(undefined)).toEqual({ type: 'object', properties: {} })
  })

  it('parseazaArgumenteTool gestionează argumente malformate cu fallback curat', async () => {
    const { parseazaArgumenteTool } = await import('./services/ollamaCloud.js')
    
    // String JSON valid → parsează
    expect(parseazaArgumenteTool('{"key": "value"}')).toEqual({ key: 'value' })
    
    // String gol → obiect gol
    expect(parseazaArgumenteTool('')).toEqual({})
    
    // String whitespace → obiect gol
    expect(parseazaArgumenteTool('   ')).toEqual({})
    
    // null/undefined → obiect gol
    expect(parseazaArgumenteTool(null as any)).toEqual({})
    expect(parseazaArgumenteTool(undefined as any)).toEqual({})
    
    // JSON invalid → obiect gol (nu aruncă)
    expect(parseazaArgumenteTool('{invalid json}')).toEqual({})
    expect(parseazaArgumenteTool('not json')).toEqual({})
    expect(parseazaArgumenteTool('{')).toEqual({})
    
    // Array în loc de object → obiect gol
    expect(parseazaArgumenteTool('[1, 2, 3]')).toEqual({})
    
    // Obiect deja → returnat direct
    expect(parseazaArgumenteTool({ key: 'value' })).toEqual({ key: 'value' })
    
    // Array ca obiect → obiect gol
    expect(parseazaArgumenteTool([1, 2, 3] as any)).toEqual({})
  })

  it('serializeazaArgumenteTool garantează JSON valid pentru Ollama Cloud', async () => {
    const { serializeazaArgumenteTool } = await import('./services/ollamaCloud.js')
    
    // Null/undefined → obiect gol serializat
    expect(serializeazaArgumenteTool(null)).toBe('{}')
    expect(serializeazaArgumenteTool(undefined)).toBe('{}')
    
    // String JSON valid → re-serializat
    expect(serializeazaArgumenteTool('{"key": "value"}')).toBe('{"key":"value"}')
    
    // String gol → obiect gol
    expect(serializeazaArgumenteTool('')).toBe('{}')
    
    // String whitespace → obiect gol
    expect(serializeazaArgumenteTool('   ')).toBe('{}')
    
    // String JSON invalid → obiect gol
    expect(serializeazaArgumenteTool('{invalid}')).toBe('{}')
    expect(serializeazaArgumenteTool('not json')).toBe('{}')
    
    // Obiect valid → serializat
    expect(serializeazaArgumenteTool({ key: 'value' })).toBe('{"key":"value"}')
    
    // Array → obiect gol
    expect(serializeazaArgumenteTool([1, 2, 3] as any)).toBe('{}')
    
    // String care e array JSON → obiect gol
    expect(serializeazaArgumenteTool('[1, 2, 3]')).toBe('{}')
    
    // Primitive → obiect gol
    expect(serializeazaArgumenteTool(123 as any)).toBe('{}')
    expect(serializeazaArgumenteTool(true as any)).toBe('{}')
  })

  it('unelteOpenAi produce payload compatibil Ollama Cloud', async () => {
    const { unelteOpenAi } = await import('./services/ollamaCloud.js')
    
    const tools = [
      {
        name: 'test_tool',
        description: 'Test tool description',
        input_schema: {
          type: 'object',
          properties: {
            param1: { type: 'string', description: 'First param' },
            param2: { type: 'number', description: 'Second param' },
          },
          required: ['param1'],
        },
      },
    ]
    
    const result = unelteOpenAi(tools)
    
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      type: 'function',
      function: {
        name: 'test_tool',
        description: 'Test tool description',
      },
    })
    expect((result[0] as any).function.parameters).toEqual({
      type: 'object',
      properties: {
        param1: { type: 'string', description: 'First param' },
        param2: { type: 'number', description: 'Second param' },
      },
      required: ['param1'],
    })
  })

  it('unelteOpenAi cu schema minimală produce parameters valid', async () => {
    const { unelteOpenAi, normalizeazaSchema } = await import('./services/ollamaCloud.js')
    
    // Schema minimală → parameters valid
    const minimalSchema = normalizeazaSchema({})
    expect(minimalSchema.type).toBe('object')
    expect(minimalSchema.properties).toEqual({})
    
    // Tool cu schema minimală → parameters corect
    const toolsMinimal = [{
      name: 'minimal_tool',
      description: 'Minimal',
      input_schema: {},
    }]
    const resultMinimal = unelteOpenAi(toolsMinimal as any)
    expect((resultMinimal[0] as any).function.parameters.type).toBe('object')
    expect((resultMinimal[0] as any).function.parameters.properties).toEqual({})
  })

  it('tool call arguments dublu serializate sunt gestionate corect', async () => {
    const { parseazaArgumenteTool } = await import('./services/ollamaCloud.js')
    
    // Argumente deja serializate ca string în interiorul JSON-ului
    const doubleSerialized = '{"query": "{\\"nested\\": \\"value\\"}"}'
    const result = parseazaArgumenteTool(doubleSerialized)
    
    // Ar trebui să parseze corect primul nivel
    expect(result).toHaveProperty('query')
    expect(typeof result.query).toBe('string')
  })

  it('ollama-cloud tool calls cu arguments goale sunt sanitizate', async () => {
    const { parseazaArgumenteTool } = await import('./services/ollamaCloud.js')
    const { serializeazaArgumenteTool } = await import('./services/ollamaCloud.js')
    
    // Argumente goale din tool call
    expect(parseazaArgumenteTool('')).toEqual({})
    expect(parseazaArgumenteTool(null as any)).toEqual({})
    expect(parseazaArgumenteTool(undefined as any)).toEqual({})
    
    // JSON invalid din tool call
    expect(parseazaArgumenteTool('not json')).toEqual({})
    expect(parseazaArgumenteTool('{')).toEqual({})
    
    // Serializare arguments goale
    expect(serializeazaArgumenteTool('')).toBe('{}')
    expect(serializeazaArgumenteTool(null)).toBe('{}')
    expect(serializeazaArgumenteTool(undefined)).toBe('{}')
  })

  it('mesajeOpenAi serializează corect tool calls cu arguments validate', async () => {
    const { serializeazaArgumenteTool, parseazaArgumenteTool } = await import('./services/ollamaCloud.js')
    
    // Simulează fluxul din mesajeOpenAi
    const argsStr = serializeazaArgumenteTool('{"param": "value"}')
    const argsObj = parseazaArgumenteTool(argsStr)
    
    expect(argsStr).toBe('{"param":"value"}')
    expect(argsObj).toEqual({ param: 'value' })
    
    // Arguments goale
    const argsStrGol = serializeazaArgumenteTool('')
    const argsObjGol = parseazaArgumenteTool(argsStrGol)
    
    expect(argsStrGol).toBe('{}')
    expect(argsObjGol).toEqual({})
  })

  it('dinRaspunsOpenAi parsează corect tool calls din răspuns', async () => {
    const { parseazaArgumenteTool } = await import('./services/ollamaCloud.js')
    
    // Simulează răspuns Ollama Cloud cu tool calls
    const mockResponse = {
      choices: [{
        message: {
          content: 'text',
          tool_calls: [
            { id: 'call_1', function: { name: 'test_tool', arguments: '{"key": "value"}' } },
            { id: 'call_2', function: { name: 'bad_tool', arguments: '{invalid}' } },
            { id: 'call_3', function: { name: 'empty_tool', arguments: '' } },
          ],
        },
        finish_reason: 'stop',
      }],
      usage: { prompt_tokens: 10, completion_tokens: 20 },
      model: 'qwen-test',
    }
    
    // Parsează arguments din fiecare tool call
    const toolCalls = mockResponse.choices[0].message.tool_calls.map((c, i) => {
      const argsObj = parseazaArgumenteTool(c.function.arguments)
      return {
        id: c.id,
        function: {
          name: c.function.name,
          arguments: JSON.stringify(argsObj),
        },
      }
    })
    
    expect(toolCalls[0].function.arguments).toBe('{"key":"value"}')
    expect(toolCalls[1].function.arguments).toBe('{}') // invalid JSON → gol
    expect(toolCalls[2].function.arguments).toBe('{}') // empty string → gol
  })
})
