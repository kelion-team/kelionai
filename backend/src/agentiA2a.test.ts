import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ROSTER, gasesteAgent, carteAgent } from './services/agentiKelion.js'
import { extrageText } from './routes/a2a.js'
import { CHEAMA_AGENT_TOOL } from './services/brainToolDefs.js'

// ── AGENȚII A2A (4 aug 2026) ────────────────────────────────────────────────
// Cei 33 de agenți trebuie să fie sursă unică (agentiKelion.ts) și să fie
// accesibili viu la /api/a2a/<id>. Testele țin invariantele: id-uri unice,
// cartea arată exact spre endpointul agentului, iar extractorul de text
// înțelege și forma A2A JSON-RPC, și forma simplă { text }.

describe('rosterul agenților — sursă unică, curat', () => {
  it('are agenți și toți au id, nume, rol ne-goale', () => {
    expect(ROSTER.length).toBeGreaterThanOrEqual(30)
    for (const a of ROSTER) {
      expect(a.id.trim()).not.toBe('')
      expect(a.nume.trim()).not.toBe('')
      expect(a.rol.trim()).not.toBe('')
    }
  })

  it('id-urile sunt unice (nicio dublură)', () => {
    const ids = ROSTER.map((a) => a.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('numele sunt unice (Enterprise deduplică pe displayName)', () => {
    const nume = ROSTER.map((a) => a.nume)
    expect(new Set(nume).size).toBe(nume.length)
  })

  it('agenții ceruți explicit de owner există', () => {
    for (const id of ['debug', 'senzorial', 'adevar', 'cautator', 'solutii', 'electronist', 'designer', 'scenograf', 'textier', 'regizor']) {
      expect(gasesteAgent(id), id).toBeTruthy()
    }
  })
})

describe('cartea A2A arată spre agentul viu', () => {
  it('url-ul cărții e chiar endpointul /api/a2a/<id>', () => {
    for (const a of ROSTER) {
      const card = carteAgent(a) as { url: string; name: string; skills: { id: string }[] }
      expect(card.url).toBe(`https://kelionai.app/api/a2a/${a.id}`)
      expect(card.name).toBe(a.nume)
      expect(card.skills[0].id).toBe(a.id)
    }
  })
})

describe('unealta de delegare a creierului (cheama_agent)', () => {
  it('e bine formată și NU are enum static pe agent (rosterul e viu — 4 aug)', () => {
    expect(CHEAMA_AGENT_TOOL.name).toBe('cheama_agent')
    const props = CHEAMA_AGENT_TOOL.input_schema.properties as {
      agent: { enum?: string[] }
      sarcina: unknown
    }
    // FĂRĂ enum: schema statică bloca agenții adăugați de owner din admin
    // (agenti_custom); validarea o face executorul, cu gasesteAgentViu.
    expect(props.agent.enum).toBeUndefined()
    expect(CHEAMA_AGENT_TOOL.input_schema.required).toEqual(['agent', 'sarcina'])
  })
  it('descrierea listează fiecare agent (id — specialitate)', () => {
    for (const a of ROSTER) expect(CHEAMA_AGENT_TOOL.description).toContain(a.id)
  })
  it('descrierea îl învață pe creier să citească jurnalul dovezii (16 aug)', () => {
    expect(CHEAMA_AGENT_TOOL.description).toContain('unelte_executate')
    expect(CHEAMA_AGENT_TOOL.description).toContain('Listă GOALĂ')
  })
})

// ── LEGEA UNELTEI PE JOB (owner, 16 aug, verbatim: „Orice agent din cei 91,
// trebuie cind face verificari trebuie sa foloseasca unealta necesara jobului
// alocat... asta faci acum aduci dovezi ca ai facut" + „nu te misti pina
// fiecare agent primeste uneltele real, nu doar text"). Lacătele citesc CHIAR
// sursa executorului — o regresie care scoate uneltele sau jurnalul pică aici.
describe('LEGEA UNELTEI PE JOB — agenții au unelte REALE + jurnalul dovezii', () => {
  const sursa = readFileSync(fileURLToPath(new URL('./services/agentiKelion.ts', import.meta.url)), 'utf8')

  it('agenții pe căile admin primesc numai măsurători fără execuție de cod sau shell', () => {
    for (const unealta of ['stare_masurata', 'server_logs', 'client_errors']) {
      expect(sursa, unealta).toContain(`'${unealta}'`)
    }
    expect(sursa).not.toContain("name: 'ruleaza_portile'")
    expect(sursa).toMatch(/\.\.\.UNELTE_MASURARE\]/)
    // executorii sunt AI CASEI (sursă unică adminTools), nu copii locale
    expect(sursa).toMatch(/execSharedAdminTool\(/)
    expect(sursa).toMatch(/execUserScopedTool\(/)
  })

  it('fiecare unealtă executată intră în JURNALUL dovezii; refuzul/necunoscuta NU', () => {
    // Refactorat: jurnalul e acum `doveziUnelte` (DovadaUnealta[]), fiecare execuție
    // clasificată (faptă reală vs refuz/necunoscută) prin clasificaRezultatUnealta;
    // spre creier pleacă DOAR uneltele cu succes (unelteCuSucces) — refuzul/necunoscuta NU.
    expect(sursa).toMatch(/const doveziUnelte: DovadaUnealta\[\] = \[\]/)
    expect(sursa).toMatch(/doveziUnelte\.push\(clasificaRezultatUnealta\(tc\.function\.name/)
    expect(sursa).toMatch(/unelteCuSucces\(doveziUnelte\)/)
  })

  it('jurnalul pleacă la creierul mare în JSON (unelte_executate) și în RaspunsAgent', () => {
    expect(sursa).toMatch(/unelte_executate: r\.unelteExecutate/)
    expect(sursa).toMatch(/unelteExecutate: string\[\]/)
  })

  it('poarta faptelor judecă și răspunsul agentului, pe jurnalul LUI', () => {
    // Refactorat: poarta faptelor judecă răspunsul pe jurnalul de DOVEZI al agentului.
    expect(sursa).toMatch(/pretentiiFaraFapta\(r\.text, doveziUnelte\)/)
    expect(sursa).toMatch(/textulDemascarii\(nedovedite\)/)
  })

  it('instrucțiunea fiecărui agent poartă LEGEA UNELTEI PE JOB', () => {
    expect(sursa).toContain('LEGEA UNELTEI PE JOB')
    expect(sursa).toContain('o pretenție fără dovadă este marcată ca neverificată')
  })
})

describe('extrageText înțelege ambele forme', () => {
  it('forma simplă { text }', () => {
    expect(extrageText({ text: 'salut' })).toBe('salut')
    expect(extrageText({ sarcina: 'fa ceva' })).toBe('fa ceva')
    expect(extrageText({ prompt: 'x' })).toBe('x')
  })

  it('forma A2A JSON-RPC message/send', () => {
    const body = {
      jsonrpc: '2.0',
      id: 1,
      method: 'message/send',
      params: { message: { role: 'user', parts: [{ kind: 'text', text: 'buna' }, { kind: 'text', text: 'ziua' }] } },
    }
    expect(extrageText(body)).toBe('buna ziua')
  })

  it('gol când nu e text nicăieri', () => {
    expect(extrageText({})).toBe('')
    expect(extrageText({ params: { message: { parts: [{ kind: 'file' }] } } })).toBe('')
  })
})
