import { describe, it, expect } from 'vitest'
import { parseConstructorStrategy } from './services/constructorStrategist.js'

// ── LACĂT: strategul nu mai pică pe o cheie în plus de la Gemini ───────────────
// Auditul din 22 aug a raportat „proprietăți nepermise în hypotheses" → toată
// strategia era respinsă (additionalProperties:false) și autonomia se bloca.
// Fix: cheile străine se taie ÎNAINTE de validare (pruneToSchema). NU inventăm
// nimic care lipsește — un câmp cerut absent rămâne eroare cinstită.

function strategieValida(): Record<string, unknown> {
  return {
    protocol: 'kelion.strategy/v1',
    incidentId: 7,
    objective: 'Repară publicarea blocată pe rc=2.',
    acceptanceCriteria: ['docker build iese 0', '/api/version urcă la master'],
    facts: ['live e în urma lui master', 'docker build pică rc=2'],
    unknowns: ['ce etapă exactă pică'],
    hypotheses: [{
      statement: 'tsc-ul frontend pică pe o variabilă necitită',
      evidenceFor: ['TS6133 în log'],
      evidenceAgainst: [],
      confidence: 0.8,
    }],
    options: [
      { id: 'opt-a', action: 'Reconectează semnalul calm', successProbability: 0.9, cost: 'free', risk: 'low', requires: [] },
      { id: 'opt-b', action: 'Revert la commitul anterior', successProbability: 0.5, cost: 'low', risk: 'medium', requires: [] },
    ],
    missingCapability: null,
    decision: {
      optionId: 'opt-a',
      rationale: 'Repară cauza reală fără să piardă funcția.',
      phase: 'repair',
      executor: 'brain_tools',
      action: 'Reconectează isCalm și rulează build-ul frontend.',
      reformulatedOrder: null,
      expectedEvidence: ['build frontend verde'],
    },
    stopConditions: ['CI verde'],
    replanWhen: ['build pică din alt motiv'],
  }
}

describe('parseConstructorStrategy — robust la deviațiile creierului', () => {
  it('acceptă o strategie validă', () => {
    const r = parseConstructorStrategy(JSON.stringify(strategieValida()))
    expect(r.ok).toBe(true)
  })

  it('TAIE cheile străine (nu mai pică pe „proprietăți nepermise")', () => {
    const s = strategieValida() as any
    s.reasoning = 'chei în plus la nivel de top' // interzisă de additionalProperties:false
    s.hypotheses[0].note = 'cheie străină pe ipoteză'
    s.decision.debug = { x: 1 }
    const r = parseConstructorStrategy(JSON.stringify(s))
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect((r.strategy as any).reasoning).toBeUndefined()
      expect((r.strategy.hypotheses[0] as any).note).toBeUndefined()
      expect((r.strategy.decision as any).debug).toBeUndefined()
    }
  })

  it('NU inventează un câmp cerut absent — eroare cinstită dacă lipsește action', () => {
    const s = strategieValida() as any
    delete s.decision.action
    const r = parseConstructorStrategy(JSON.stringify(s))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('strategy_schema_invalid')
  })
})
