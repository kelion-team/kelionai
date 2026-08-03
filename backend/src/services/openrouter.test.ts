import { describe, it, expect } from 'vitest'
import { toModel, resolveModel, resolveModelChecked, toolsToOpenAI, hasActionIntent, groupCatalog, classifyCost, priceFromCatalog, faraAudioParts } from './openrouter.js'
import type { Catalog, CatalogModel } from './openrouter.js'
import { runOrchestrator } from './orchestrator.js'

describe('openrouter catalog', () => {
  it('acceptă orice provider cu tools; refuză doar lipsa uneltelor sau variantele moarte', () => {
    expect(
      toModel({ id: 'openai/gpt-4.1-mini', supported_parameters: ['tools'] }),
    )?.toMatchObject({ provider: 'openai' })
    expect(
      toModel({ id: 'anthropic/claude-sonnet-5', supported_parameters: ['tools'], architecture: { input_modalities: ['text', 'image'] } }),
    )?.toMatchObject({ provider: 'anthropic', vision: true })
    // no tools → rejected
    expect(toModel({ id: 'openai/gpt-4o', supported_parameters: [] })).toBeNull()
    // ANY provider with tools → accepted (Adrian, Jul 30: "I must be able to
    // decide any model from the list" — the 5-company filter was not his order).
    expect(toModel({ id: 'mistral/large', supported_parameters: ['tools'] }))
      ?.toMatchObject({ provider: 'mistral' })
    // old variant excluded
    expect(toModel({ id: 'openai/gpt-3.5-turbo', supported_parameters: ['tools'] })).toBeNull()
  })

  it('clasa de cost: verde free → galben ieftin → portocaliu → roșu, din prețuri reale', () => {
    // THE COLOR THE USER TRUSTS (Adrian, Aug 1). From real OpenRouter pricing
    // (USD/token strings → per-1M numbers), blended 3:1 input:output.
    // free: both prices 0 / missing (the :free variants)
    expect(toModel({ id: 'nvidia/nemotron-ultra:free', supported_parameters: ['tools'], pricing: { prompt: '0', completion: '0' } }))
      ?.toMatchObject({ costClass: 'free', promptPerM: 0, completionPerM: 0 })
    // cheap: blended under $0.5/1M (e.g. $0.10 in / $0.40 out)
    expect(toModel({ id: 'openai/mini', supported_parameters: ['tools'], pricing: { prompt: '0.0000001', completion: '0.0000004' } }))
      ?.toMatchObject({ costClass: 'cheap' })
    // mid: blended under $5/1M (e.g. $1 in / $4 out → 1.75 blended)
    expect(toModel({ id: 'google/mid', supported_parameters: ['tools'], pricing: { prompt: '0.000001', completion: '0.000004' } }))
      ?.toMatchObject({ costClass: 'mid' })
    // expensive: blended $5+/1M (e.g. $15 in / $75 out)
    expect(toModel({ id: 'anthropic/opus', supported_parameters: ['tools'], pricing: { prompt: '0.000015', completion: '0.000075' } }))
      ?.toMatchObject({ costClass: 'expensive' })
    // classifyCost edge cases, directly: 0 and garbage are free, boundaries fall down
    expect(classifyCost(0, 0)).toBe('free')
    expect(classifyCost(Number.NaN, Number.NaN)).toBe('free')
    expect(classifyCost(0.49, 0.49)).toBe('cheap')
    expect(classifyCost(0.5, 0.5)).toBe('mid')
    expect(classifyCost(4.99, 4.99)).toBe('mid')
    expect(classifyCost(5, 5)).toBe('expensive')
  })

  it('uneltele sunt obligatorii peste tot; vederea doar pe lista de chat', async () => {
    // Adrian's order, Jul 29: "only AI that respects all the app's features
    // is shown — sight, hearing, live voice". A blind model that reaches the
    // menu is a broken promise: the user picks it and then the camera doesn't
    // work. Tools are just as mandatory — without them the Google skills,
    // memory, commands and voice escalation onto the brain all fall.
    //
    // CHANGED AT HIS ORDER, Jul 31: "remove the vision filter".
    // The reason: Nemotron 3 Ultra 550B — the most capable free brain measured
    // (550B, 1M context, tools) — is BLIND, so the filter took it out of the
    // list and he could never choose it. The Jul 29 promise stays whole, but
    // at the level where it mattered: the feature belongs to the APP, not to
    // a single model. A turn with a picture is automatically served by a model
    // that sees (`bestVisionModel`, chat.ts) — see src/vedereaDelegata.test.ts.
    //
    // What did NOT change: tools stay mandatory everywhere (nothing works
    // without them, and they can't be delegated), and the CHAT list — the
    // public tier, where there is no escalation — still requires vision.
    const vede = { input_modalities: ['text', 'image'] }
    const brut = [
      { id: 'openai/gpt-5', supported_parameters: ['tools'], architecture: vede },
      { id: 'google/gemini-3-pro', supported_parameters: ['tools'], architecture: vede },
      { id: 'anthropic/claude-opus-5', supported_parameters: ['tools'], architecture: vede },
      // THE BLIND ONE: has tools, but does NOT see → has no business in any list.
      { id: 'openai/gpt-5-text-only', supported_parameters: ['tools'] },
      // WITHOUT TOOLS: it sees, but couldn't use anything in the app.
      { id: 'google/gemini-3-vision-mut', supported_parameters: [], architecture: vede },
    ]
    const modele = brut.map(toModel).filter((m) => m != null)
    const cat = groupCatalog(modele)
    const toate = [...cat.chat, ...cat.work]
    expect(toate.length).toBeGreaterThan(0)
    // TOOLS: mandatory everywhere, in both lists. They can't be delegated —
    // without them neither Google, nor memory, nor commands work.
    expect(toate.map((m) => m.id)).not.toContain('google/gemini-3-vision-mut')
    // VISION: mandatory on the CHAT list (the public tier, no escalation).
    for (const m of cat.chat) expect(m.vision, `${m.id} nu vede, dar e pe lista de chat`).toBe(true)
    expect(cat.chat.map((m) => m.id)).not.toContain('openai/gpt-5-text-only')
    // …but NOT on the work tier: there a blind brain is allowed, because the
    // turn with a picture is served by a model that sees. Without this,
    // Nemotron Ultra 550B could never be chosen — the most capable free brain,
    // invisible in its own app.
    expect(cat.work.map((m) => m.id)).toContain('openai/gpt-5-text-only')
    // And the complete ones really get where they should (not "empty lists = clean").
    expect(cat.chat.map((m) => m.id)).toContain('openai/gpt-5')
    expect(cat.chat.map((m) => m.id)).toContain('google/gemini-3-pro')
    expect(cat.work.map((m) => m.id)).toContain('anthropic/claude-opus-5')
  })

  it('convertește uneltele Anthropic → OpenAI (input_schema → parameters)', () => {
    const out = toolsToOpenAI([
      { name: 'get_x', description: 'ia x', input_schema: { type: 'object', properties: {} } },
    ]) as { type: string; function: { name: string; parameters: unknown } }[]
    expect(out[0].type).toBe('function')
    expect(out[0].function.name).toBe('get_x')
    expect(out[0].function.parameters).toEqual({ type: 'object', properties: {} })
  })

  it('orchestratorul se oprește curat fără cheie (nu blochează)', async () => {
    const r = await runOrchestrator('openai/gpt-4.1-mini', [{ role: 'user', content: 'salut' }], [], async () => '')
    expect(r.text).toBe('')
    expect(r.costUsd).toBe(0)
  })

  it('resolveModel cade pe implicit când modelul cerut nu e în tier', async () => {
    // Without an OpenRouter key (the test environment) the catalog is empty →
    // any request falls onto the tier's default, never onto an unverified model.
    // The chat default = a REAL free model, tested live (clean tool-call +
    // real vision) — see config.ts for the test's proof.
    expect(await resolveModel('chat', 'ceva/inexistent')).toBe('google/gemma-4-26b-a4b-it:free')
    // THE BRAIN, SET BY ADRIAN ON JUL 31: "make nemotron-3-ultra the brain".
    // It was `nano-omni-30b-a3b` — 30B total, 3B ACTIVE. His work went through
    // a third-tier model, while the most capable free brain in the world (550B,
    // 1M context) sat unused on the 'top' tier, reachable only through
    // escalation. Now it is on both.
    // It has no vision — no longer matters: vision gets DELEGATED (see
    // vedereaDelegata).
    // AUG 2, MEASURED: on the real payload gemma-4-26b took 22s+37s and called
    // no tool, while Ultra took 6s+3.2s with the correct tool call (the full
    // table is in config.ts). The work default is Ultra — the fastest free
    // model THAT THINKS, measured, not picked from a spec sheet.
    expect(await resolveModel('work', null)).toBe('nvidia/nemotron-3-ultra-550b-a55b:free')
    expect(await resolveModel('top', null)).toBe('nvidia/nemotron-3-ultra-550b-a55b:free')
  })

  // ── REPLACING THE BRAIN IS NO LONGER SILENT ─────────────────────────────
  // Adrian, Jul 30: "Kelion doesn't execute requests". One of the paths that
  // got there: he had chosen a model in Admin→Models, that one disappeared
  // from the provider's catalog, and `resolveModel` SILENTLY returned the
  // `:free` default — a weak model that narrates instead of calling the tool.
  // Nothing, anywhere, said the brain had been swapped under him.
  it('resolveModelChecked SPUNE când modelul cerut a fost respins', async () => {
    const cerut = await resolveModelChecked('work', 'furnizor/model-scos-de-pe-piata')
    expect(cerut.fellBack).toBe(true)
    expect(cerut.model).toBe('nvidia/nemotron-3-ultra-550b-a55b:free')
  })

  it('fără nicio cerere, implicitul NU e o cădere (n-a fost respins nimic)', async () => {
    const implicit = await resolveModelChecked('work', null)
    expect(implicit.fellBack).toBe(false)
    expect(implicit.model).toBe('nvidia/nemotron-3-ultra-550b-a55b:free')
  })

  it('resolveModel rămâne exact ce era (aceeași valoare ca varianta verificată)', async () => {
    // Compatibility guard: dozens of old calls go through `resolveModel`;
    // if the two diverged, there would be two truths about the same thing.
    for (const cerut of [null, 'ceva/inexistent']) {
      expect(await resolveModel('work', cerut)).toBe((await resolveModelChecked('work', cerut)).model)
    }
  })

  it('hasActionIntent (25 iul — escaladare economică: ieftin implicit, greu doar pe cereri de acțiune reală)', () => {
    expect(hasActionIntent('repară animația gurii')).toBe(true)
    expect(hasActionIntent('rulează diagnostic te rog')).toBe(true)
    expect(hasActionIntent('publică fixul în producție')).toBe(true)
    expect(hasActionIntent('bună, ce mai faci?')).toBe(false)
    expect(hasActionIntent('mulțumesc pentru ajutor')).toBe(false)
  })
})

describe('priceFromCatalog — prețul unui model, DOAR din catalogul live', () => {
  const m = (id: string, promptPerM: number, completionPerM: number): CatalogModel => ({
    id, name: id, provider: id.split('/')[0], vision: true, contextLength: 1000,
    costClass: 'cheap', promptPerM, completionPerM,
  })
  const cat: Catalog = {
    chat: [m('google/gemini-2.5-flash', 0.3, 2.5), m('nvidia/nemotron-ultra:free', 0, 0)],
    work: [m('anthropic/claude-sonnet-5', 3, 15)],
    fetchedAt: 0,
  }

  it('potrivește id-ul exact, id-ul fără :free și numele gol (după slash)', () => {
    expect(priceFromCatalog(cat, 'google/gemini-2.5-flash')).toEqual({ promptPerM: 0.3, completionPerM: 2.5 })
    expect(priceFromCatalog(cat, 'gemini-2.5-flash')).toEqual({ promptPerM: 0.3, completionPerM: 2.5 })
    expect(priceFromCatalog(cat, 'nvidia/nemotron-ultra')).toEqual({ promptPerM: 0, completionPerM: 0 })
    expect(priceFromCatalog(cat, 'anthropic/claude-sonnet-5')).toEqual({ promptPerM: 3, completionPerM: 15 })
  })

  it('model lipsă din catalog → null (NICIODATĂ 0 tăcut, care ar arăta a „gratis")', () => {
    expect(priceFromCatalog(cat, 'openai/model-inexistent')).toBeNull()
    expect(priceFromCatalog(cat, '')).toBeNull()
  })
})

describe('audio nativ: OpenRouter NU primește blocul audio (doar Gemini îl aude)', () => {
  it('scoate audio_url, păstrează textul (transcriptul rămâne rezervă)', () => {
    const out = faraAudioParts([
      { role: 'user', content: [
        { type: 'audio_url', audio_url: { url: 'data:audio/wav;base64,AAA' } },
        { type: 'text', text: 'salut' },
      ] },
    ] as unknown as Parameters<typeof faraAudioParts>[0])
    const c = out[0].content as { type: string }[]
    expect(c.some((b) => b.type === 'audio_url')).toBe(false)
    expect(c.some((b) => b.type === 'text')).toBe(true)
  })
  it('păstrează imaginile (image_url) — doar audio se scoate', () => {
    const out = faraAudioParts([
      { role: 'user', content: [
        { type: 'audio_url', audio_url: { url: 'data:audio/wav;base64,AAA' } },
        { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,BBB' } },
      ] },
    ] as unknown as Parameters<typeof faraAudioParts>[0])
    const c = out[0].content as { type: string }[]
    expect(c.some((b) => b.type === 'image_url')).toBe(true)
    expect(c.some((b) => b.type === 'audio_url')).toBe(false)
  })
  it('tură DOAR audio → marcaj „(voce)", nu conținut gol', () => {
    const out = faraAudioParts([
      { role: 'user', content: [ { type: 'audio_url', audio_url: { url: 'data:audio/wav;base64,AAA' } } ] },
    ] as unknown as Parameters<typeof faraAudioParts>[0])
    expect(out[0].content).toBe('(voce)')
  })
  it('mesaje fără audio rămân neatinse (aceeași referință)', () => {
    const inp = [{ role: 'user', content: 'text simplu' }] as unknown as Parameters<typeof faraAudioParts>[0]
    expect(faraAudioParts(inp)).toBe(inp)
  })
})
