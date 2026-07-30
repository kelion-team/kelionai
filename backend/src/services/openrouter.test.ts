import { describe, it, expect } from 'vitest'
import { toModel, resolveModel, resolveModelChecked, toolsToOpenAI, hasActionIntent, groupCatalog } from './openrouter.js'
import { runOrchestrator } from './orchestrator.js'

describe('openrouter catalog', () => {
  it('acceptă doar modele GPT/Gemini/Claude cu tools', () => {
    expect(
      toModel({ id: 'openai/gpt-4.1-mini', supported_parameters: ['tools'] }),
    )?.toMatchObject({ provider: 'openai' })
    expect(
      toModel({ id: 'anthropic/claude-sonnet-5', supported_parameters: ['tools'], architecture: { input_modalities: ['text', 'image'] } }),
    )?.toMatchObject({ provider: 'anthropic', vision: true })
    // fără tools → respins
    expect(toModel({ id: 'openai/gpt-4o', supported_parameters: [] })).toBeNull()
    // provider necunoscut → respins
    expect(toModel({ id: 'mistral/large', supported_parameters: ['tools'] })).toBeNull()
    // variantă veche exclusă
    expect(toModel({ id: 'openai/gpt-3.5-turbo', supported_parameters: ['tools'] })).toBeNull()
  })

  it('în AMBELE liste apar DOAR modele care fac TOT (văd + știu unelte)', async () => {
    // Ordinul lui Adrian, 29 iul: „se afișează doar AI care respectă toate
    // funcționalitățile aplicației — văz, auz, voce live". Un model orb ajuns în
    // meniu e o promisiune ruptă: userul îl alege și pe urmă camera nu merge.
    // Uneltele sunt la fel de obligatorii — fără ele cad skill-urile Google,
    // memoria, comenzile și escaladarea vocii pe creier.
    const vede = { input_modalities: ['text', 'image'] }
    const brut = [
      { id: 'openai/gpt-5', supported_parameters: ['tools'], architecture: vede },
      { id: 'google/gemini-3-pro', supported_parameters: ['tools'], architecture: vede },
      { id: 'anthropic/claude-opus-5', supported_parameters: ['tools'], architecture: vede },
      // ORBUL: are unelte, dar NU vede → nu are ce căuta în nicio listă.
      { id: 'openai/gpt-5-text-only', supported_parameters: ['tools'] },
      // FĂRĂ UNELTE: vede, dar n-ar putea folosi nimic din aplicație.
      { id: 'google/gemini-3-vision-mut', supported_parameters: [], architecture: vede },
    ]
    const modele = brut.map(toModel).filter((m) => m != null)
    const cat = groupCatalog(modele)
    const toate = [...cat.chat, ...cat.work]
    expect(toate.length).toBeGreaterThan(0)
    for (const m of toate) expect(m.vision, `${m.id} nu vede, dar e oferit userului`).toBe(true)
    expect(toate.map((m) => m.id)).not.toContain('openai/gpt-5-text-only')
    expect(toate.map((m) => m.id)).not.toContain('google/gemini-3-vision-mut')
    // Și cele complete chiar ajung acolo unde trebuie (nu „liste goale = curat").
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
    // Fără cheie OpenRouter (mediul de test) catalogul e gol → orice cerere cade
    // pe implicitul tier-ului, niciodată pe un model neverificat.
    // Implicitul chat = un model REAL gratuit, testat live (tool-call curat +
    // vedere reală) — vezi config.ts pentru dovada testului.
    expect(await resolveModel('chat', 'ceva/inexistent')).toBe('google/gemma-4-26b-a4b-it:free')
    // CREIERUL FULL FREE (Adrian, 27 iul: „da" pe schema $0): work = nucleul
    // OMNI gratuit (vede+aude+tools), top = gândirea grea gratuită (550B, 1M
    // context, FĂRĂ vedere — de asta garda !needsVision din chat.ts).
    expect(await resolveModel('work', null)).toBe('nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free')
    expect(await resolveModel('top', null)).toBe('nvidia/nemotron-3-ultra-550b-a55b:free')
  })

  // ── ÎNLOCUIREA CREIERULUI NU MAI E TĂCUTĂ ───────────────────────────────────
  // Adrian, 30 iul: „Kelion nu execută cerințele". Una dintre căile prin care
  // ajungea acolo: își alesese un model din Admin→Modele, acela dispărea din
  // catalogul furnizorului, iar `resolveModel` întorcea în TĂCERE implicitul
  // `:free` — model slab, care narează în loc să cheme unealta. Nimic, nicăieri,
  // nu spunea că s-a schimbat creierul sub el.
  it('resolveModelChecked SPUNE când modelul cerut a fost respins', async () => {
    const cerut = await resolveModelChecked('work', 'furnizor/model-scos-de-pe-piata')
    expect(cerut.fellBack).toBe(true)
    expect(cerut.model).toBe('nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free')
  })

  it('fără nicio cerere, implicitul NU e o cădere (n-a fost respins nimic)', async () => {
    const implicit = await resolveModelChecked('work', null)
    expect(implicit.fellBack).toBe(false)
    expect(implicit.model).toBe('nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free')
  })

  it('resolveModel rămâne exact ce era (aceeași valoare ca varianta verificată)', async () => {
    // Paznic de compatibilitate: zeci de apeluri vechi trec prin `resolveModel`;
    // dacă cele două ar diverge, ar fi două adevăruri despre același lucru.
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
