import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// ── DOVADA: FREE (și constructorul) CHIAR REPARĂ (owner, 19 aug: „obligatoriu tot
// ce e free si constructor trebuie sa repare… rezolva real cu dovezi ca free
// functioneaza") ─────────────────────────────────────────────────────────────
// CAUZA măsurată: poarta protocolului strict (commit 0efd377) arunca
// `amanabil: invalid_protocol` ÎNAINTE de despărțirea free/plătit, când creierul
// app nu putea întoarce un protocol JSON valid (răspuns 200 cu `protocol:null`,
// sau 422 „non-cod"). Deci Aider NU rula NICIODATĂ — IDENTIC pe free ȘI pe plătit
// („constructorul nu repara, nici ieftin nici platit"). FIX: `decideSursaPlanAider`
// întoarce, pe protocol lipsă, o SURSĂ LEGACY (ordinul brut → Aider) în loc să
// omoare ordinul. Porțile atelierului verifică oricum rezultatul.
//
// Ca și celelalte teste ale constructorului: modulul VPS e ESM în afara rădăcinii
// backend — îl exersăm REAL printr-un subproces node care-l importă nativ.

const MJS = fileURLToPath(new URL('../../deploy/constructor-agent.mjs', import.meta.url))
const AGENT_SRC = readFileSync(MJS, 'utf8')

function decide(h: unknown, orderText: string): {
  protocol: unknown
  legacy: boolean
  files: string[]
  ajutorFolosit: boolean
  fallbackDinProtocolInvalid: boolean
  errors: string[]
} {
  const script = `
    const m = await import(${JSON.stringify('file:///' + MJS.replace(/\\/g, '/'))});
    const r = m.decideSursaPlanAider(${JSON.stringify(h)}, ${JSON.stringify(orderText)});
    console.log(JSON.stringify(r));
  `
  const stdout = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
    timeout: 30000,
  })
  return JSON.parse(stdout.trim())
}

describe('decideSursaPlanAider — free/constructorul repară chiar când protocolul strict lipsește', () => {
  it('protocol app 200 cu `protocol:null` (LLM a ratat JSON-ul) → LEGACY, NU amânare', () => {
    const h = { protocol: null, plan: '', files: [], legacy: false, strictFailure: true, errors: ['invalid root shape'] }
    const r = decide(h, 'repară butonul de copy din backend/src/routes/admin.ts care nu funcționează')
    expect(r.fallbackDinProtocolInvalid).toBe(true)
    expect(r.legacy).toBe(true)
    // Aider primește fișierele extrase din ordin (drum legacy real, nu gol)
    expect(r.files).toContain('backend/src/routes/admin.ts')
  })

  it('422 „non-cod" (protocol:null cu schema) → tot LEGACY, ordinul nu moare', () => {
    const h = { protocol: null, plan: '', files: [], legacy: false, strictFailure: true, errors: ['invalid root shape'] }
    const r = decide(h, 'ceva ordin fără verb tehnic clar')
    expect(r.fallbackDinProtocolInvalid).toBe(true)
    expect(r.legacy).toBe(true)
  })

  it('protocol strict VALID → rămâne pe protocol (calea preferată, neatinsă)', () => {
    const protocol = {
      protocol: 'kelion.constructor/v1',
      naturalLanguage: {
        task: 'x'.repeat(10),
        rationale: 'r',
        instructions: [{ operationId: 'S1', text: 'do it' }],
      },
      technical: {
        files: [{ path: 'backend/src/index.ts', access: 'modify' }],
        operations: [{ id: 'S1', action: 'modify', file: 'backend/src/index.ts' }],
        checks: [{ type: 'command', command: 'npm --prefix backend run build' }],
      },
    }
    const h = { protocol, plan: 'FILES:\n- backend/src/index.ts', files: ['backend/src/index.ts'], legacy: false, strictFailure: false, errors: [] }
    const r = decide(h, 'modifică backend/src/index.ts')
    expect(r.fallbackDinProtocolInvalid).toBe(false)
    expect(r.legacy).toBe(false)
    expect(r.protocol).not.toBeNull()
    expect(r.ajutorFolosit).toBe(true)
  })

  it('plan legacy de la app (fără protocol) → sursă legacy cu fișierele lui', () => {
    const h = { protocol: null, plan: 'FILES:\n- backend/src/db.ts', files: ['backend/src/db.ts'], legacy: true, strictFailure: false, errors: [] }
    const r = decide(h, 'repară query-ul SQL')
    expect(r.fallbackDinProtocolInvalid).toBe(false)
    expect(r.legacy).toBe(true)
    expect(r.files).toContain('backend/src/db.ts')
    expect(r.ajutorFolosit).toBe(true)
  })
})

describe('constructor-agent.mjs — poarta protocolului NU mai omoară ordinul', () => {
  it('throw-ul `invalid_protocol` a fost SCOS (nu mai amână la protocol lipsă)', () => {
    expect(AGENT_SRC).not.toContain("freeIssue: 'invalid_protocol'")
  })

  it('drumul de fallback pe legacy există explicit în construiesteCuAider', () => {
    expect(AGENT_SRC).toContain('decideSursaPlanAider')
    expect(AGENT_SRC).toContain('fallbackDinProtocolInvalid')
    expect(AGENT_SRC).toMatch(/cad pe LEGACY/i)
  })
})
