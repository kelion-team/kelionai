// ── MODEL SELECTION AND ESCALATION TESTS (the brain) ────────────────────────
//
// This is where it is decided HOW smart Kelion replies and WHEN it climbs to
// the heavy model — exactly where the "the paid brain is as dumb as the free
// one" bug hid (the owner route fell onto `:free` models). Zero tests until now.
import { describe, it, expect, vi } from 'vitest'

vi.mock('./config.js', () => ({
  config: {
    openrouter: {
      key: '', // NOT CONFIGURED: no network request
      chatDefault: 'model/chat:free',
      workDefault: 'model/work:free',
      topDefault: 'model/top:free',
    },
  },
}))

const {
  taskDifficulty,
  hasActionIntent,
  ESCALATE_AT,
  ESCALATE_TOP_AT,
  toModel,
  toolsToOpenAI,
  resolveModel,
  bestPaidWorkModel,
} = await import('./services/openrouter.js')

describe('creier — cât de grea e cererea (decide escaladarea)', () => {
  it('vorba simplă rămâne JOS (nu arde bani pe „salut")', () => {
    expect(taskDifficulty('salut')).toBeLessThan(ESCALATE_AT)
    expect(taskDifficulty('mulțumesc')).toBeLessThan(ESCALATE_AT)
  })
  it('cererea de raționament URCĂ peste pragul de escaladare', () => {
    expect(taskDifficulty('analizează în detaliu de ce pică plata și explică pas cu pas')).toBeGreaterThanOrEqual(ESCALATE_AT)
  })
  it('cererea de cod urcă (cel mai exigent)', () => {
    expect(taskDifficulty('găsește bug-ul din funcția asta și refactorează codul')).toBeGreaterThanOrEqual(ESCALATE_AT)
  })
  it('scorul rămâne în 0..100, orice i-ai da', () => {
    for (const t of ['', 'a', 'analiză cod debug '.repeat(200)]) {
      const d = taskDifficulty(t)
      expect(d).toBeGreaterThanOrEqual(0)
      expect(d).toBeLessThanOrEqual(100)
    }
    expect(ESCALATE_TOP_AT).toBeGreaterThan(ESCALATE_AT)
  })
})

describe('creier — intenția de ACȚIUNE (ordinele proprietarului)', () => {
  it('prinde ordinele reale, nu doar cuvinte savante', () => {
    for (const t of ['repară chatul', 'publică pe master', 'deschide youtube', 'pune o melodie', 'caută prețul', 'fă un audit', 'arată-mi fișierul']) {
      expect(hasActionIntent(t), t).toBe(true)
    }
  })
  it('nu confundă conversația obișnuită cu un ordin', () => {
    for (const t of ['ce mai faci?', 'mersi frumos', 'e frumos afară']) {
      expect(hasActionIntent(t), t).toBe(false)
    }
  })
})

describe('creier — catalogul de modele (filtrul de compatibilitate)', () => {
  it('acceptă doar modele cu tool-use — restul n-ar putea chema unelte', () => {
    expect(toModel({ id: 'openai/gpt-x', supported_parameters: ['tools'] })).not.toBeNull()
    expect(toModel({ id: 'openai/gpt-x', supported_parameters: [] })).toBeNull()
  })
  it('marchează corect VEDEREA (o poză trimisă unui model orb s-ar pierde)', () => {
    const cuVedere = toModel({ id: 'openai/x', supported_parameters: ['tools'], architecture: { input_modalities: ['text', 'image'] } })
    expect(cuVedere?.vision).toBe(true)
    expect(toModel({ id: 'openai/x', supported_parameters: ['tools'] })?.vision).toBe(false)
  })
  it('acceptă ORICE provider cu tools; respinge doar variantele moarte', () => {
    // Adrian, Jul 30: "I must be able to decide any model from the list" —
    // a fixed 5-company filter was never his order. The provider is taken
    // from the id's first segment, whatever it is.
    expect(toModel({ id: 'necunoscut/model', supported_parameters: ['tools'] }))
      ?.toMatchObject({ provider: 'necunoscut' })
    // Dead variants stay out: they exist in the OpenRouter list but are retired.
    expect(toModel({ id: 'openai/gpt-3.5-turbo', supported_parameters: ['tools'] })).toBeNull()
  })
})

describe('creier — conversia uneltelor pentru furnizor', () => {
  it('păstrează numele, descrierea și schema', () => {
    const out = toolsToOpenAI([{ name: 'get_weather', description: 'vremea', input_schema: { type: 'object' } }]) as {
      type: string
      function: { name: string; description: string; parameters: unknown }
    }[]
    expect(out[0].type).toBe('function')
    expect(out[0].function.name).toBe('get_weather')
    expect(out[0].function.description).toBe('vremea')
    expect(out[0].function.parameters).toEqual({ type: 'object' })
  })
  it('listă goală → listă goală (nu null, nu excepție)', () => {
    expect(toolsToOpenAI([])).toEqual([])
  })
})

describe('creier — fără cheie NU se cheamă rețeaua', () => {
  it('resolveModel cade pe implicit, fără catalog', async () => {
    expect(await resolveModel('chat')).toBe('model/chat:free')
    expect(await resolveModel('work')).toBe('model/work:free')
    expect(await resolveModel('top')).toBe('model/top:free')
  })
  it('bestPaidWorkModel întoarce null (nu rutează pe plătit fără bani)', async () => {
    // Anti-breakage GUARD: without key/balance, the owner stays on FUNCTIONAL
    // free, instead of hitting 402 on every turn.
    expect(await bestPaidWorkModel()).toBeNull()
  })
})
