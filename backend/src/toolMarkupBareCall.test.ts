import { describe, it, expect } from 'vitest'
import { stripToolMarkup, makeToolMarkupStripper } from './services/toolMarkup.js'

// ── BARE TYPED CALLS NEVER REACH THE USER (Adrian, Aug 2 — live screenshot) ─
// The user asked "Câte grade sunt afară?" and the bubble showed a bare line
// `get_weather` above the real answer. The fake-call interpreter EXECUTES the
// typed call; the display stripper must hide the line itself — stream, final
// text and voice. The name set ALWAYS comes from the tools the turn offered
// (here a stand-in set), never hardcoded in the stripper.
const TOOLS = new Set(['get_weather', 'system_health', 'maps_search'])

describe('stripToolMarkup cu numele uneltelor turei (one-shot)', () => {
  it('linia goală `get_weather` de deasupra răspunsului dispare (screenshot-ul live)', () => {
    expect(stripToolMarkup('get_weather\nAfară sunt 22 de grade.', undefined, TOOLS)).toBe(
      'Afară sunt 22 de grade.',
    )
  })

  it('variantele call-shaped pe o linie singură dispar toate', () => {
    expect(stripToolMarkup('get_weather()\nSigur!', undefined, TOOLS)).toBe('Sigur!')
    expect(stripToolMarkup('call:get_weather{"city":"Oxford"}\nSigur!', undefined, TOOLS)).toBe('Sigur!')
    expect(stripToolMarkup('system_health()\nTotul merge bine.', undefined, TOOLS)).toBe(
      'Totul merge bine.',
    )
    // și la FINAL de text, fără newline
    expect(stripToolMarkup('Răspunsul:\nget_weather', undefined, TOOLS)).toBe('Răspunsul:')
  })

  it('bula care e ÎN TOTALITATE un apel gol tastat devine goală (pierde cursa)', () => {
    expect(stripToolMarkup('get_weather', undefined, TOOLS).trim()).toBe('')
    expect(stripToolMarkup('system_health()', undefined, TOOLS).trim()).toBe('')
  })

  it('numele ÎN INTERIORUL unei fraze rămâne vizibil — doar liniile standalone pleacă', () => {
    const t = 'Folosesc get_weather pentru prognoză, îți spun imediat.'
    expect(stripToolMarkup(t, undefined, TOOLS)).toBe(t)
    const t2 = 'get_weather e unealta potrivită aici'
    expect(stripToolMarkup(t2, undefined, TOOLS)).toBe(t2)
  })

  it('un nume NECUNOSCUT pe linie singură NU e mâncat (nu inventăm unelte)', () => {
    const t = 'hack_everything\nText real.'
    expect(stripToolMarkup(t, undefined, TOOLS)).toBe(t)
  })

  it('fără setul de nume (apel vechi) comportamentul e NESCHIMBAT', () => {
    const t = 'get_weather\nAfară sunt 22 de grade.'
    expect(stripToolMarkup(t)).toBe(t)
    expect(stripToolMarkup(t, (m) => void m)).toBe(t)
  })

  it('liniile înghițite ajung la log, ca secțiunile marcate', () => {
    const logged: string[] = []
    stripToolMarkup('get_weather\nRăspuns.', (m) => logged.push(m), TOOLS)
    expect(logged.join('')).toContain('get_weather')
  })
})

describe('makeToolMarkupStripper cu numele uneltelor turei (streaming)', () => {
  it('apelul rupt pe bucăți nu scapă nicio literă în bula de chat', () => {
    const s = makeToolMarkupStripper(() => {}, TOOLS)
    const parts = ['Sigur!\nget_', 'weather\nAfară sunt ', '22 de grade.']
    let visible = ''
    for (const p of parts) visible += s.push(p)
    visible += s.flush()
    expect(visible).toBe('Sigur!\nAfară sunt 22 de grade.')
  })

  it('apelul cu argumente, rupt în mijlocul parantezelor, dispare', () => {
    const s = makeToolMarkupStripper(() => {}, TOOLS)
    let visible = s.push('call:get_weather{"ci')
    visible += s.push('ty":"Oxford"}\nIată prognoza.')
    visible += s.flush()
    expect(visible).toBe('Iată prognoza.')
  })

  it('textul normal NU așteaptă: o linie care nu poate deveni apel curge imediat', () => {
    const s = makeToolMarkupStripper(() => {}, TOOLS)
    expect(s.push('Folosesc get_')).toBe('Folosesc get_')
    let visible = s.push('weather pentru tine.')
    visible += s.flush()
    expect(visible).toBe('weather pentru tine.')
  })

  it('flush eliberează o linie parțială care NU a devenit apel (nimic nu se pierde)', () => {
    const s = makeToolMarkupStripper(() => {}, TOOLS)
    let visible = s.push('get_wea')
    expect(visible).toBe('') // ținută — putea deveni get_weather
    visible += s.flush()
    expect(visible).toBe('get_wea') // nu e apel complet → text real, ajunge la om
  })

  it('flush înghite un apel complet rămas fără newline (și îl loghează)', () => {
    const logged: string[] = []
    const s = makeToolMarkupStripper((m) => logged.push(m), TOOLS)
    let visible = s.push('Răspunsul vine.\nget_weather')
    visible += s.flush()
    expect(visible).toBe('Răspunsul vine.\n')
    expect(logged.join('')).toContain('get_weather')
  })

  it('fragmentele de marker rămân ascunse la flush și cu setul de nume activ', () => {
    const s = makeToolMarkupStripper(() => {}, TOOLS)
    let visible = s.push('text real<|tool')
    visible += s.flush()
    expect(visible).toBe('text real')
  })

  it('fără setul de nume, streamingul e NESCHIMBAT (compatibilitate)', () => {
    const s = makeToolMarkupStripper(() => {})
    let visible = s.push('get_')
    visible += s.push('weather\nText.')
    visible += s.flush()
    expect(visible).toBe('get_weather\nText.')
  })
})

// ── ECOUL DE REZULTAT `response:NAME{...}` NU AJUNGE LA OM (Adrian, 13 aug —
// screenshot live: bula arăta RAW `response:secret_publica{result:{rezultat:{…}}}`)
// Un model slab a TASTAT wrapperul de rezultat al unei unelte ca text. E markup,
// nu răspuns — și, spre deosebire de un apel, doar se ASCUNDE, nu se execută.
const ADMIN_TOOLS = new Set(['secret_publica', 'db_query', 'system_health'])

describe('ecoul `response:NAME{...}` (rezultat de unealtă tastat) e ascuns', () => {
  it('linia `response:secret_publica{...}` de deasupra răspunsului dispare', () => {
    expect(
      stripToolMarkup(
        'response:secret_publica{result:{rezultat:{}}}\nGata, am publicat.',
        undefined,
        ADMIN_TOOLS,
      ),
    ).toBe('Gata, am publicat.')
  })

  it('variantele wrapper (result:/output:/observation:, cu spațiu) dispar toate', () => {
    expect(stripToolMarkup('result: db_query{"q":"x"}\nGata.', undefined, ADMIN_TOOLS)).toBe('Gata.')
    expect(stripToolMarkup('output:system_health()\nTotul merge.', undefined, ADMIN_TOOLS)).toBe(
      'Totul merge.',
    )
    expect(stripToolMarkup('tool_response:secret_publica{}\nOK.', undefined, ADMIN_TOOLS)).toBe('OK.')
  })

  it('bula care e ÎN TOTALITATE ecoul de rezultat devine goală', () => {
    expect(stripToolMarkup('response:secret_publica{result:{}}', undefined, ADMIN_TOOLS).trim()).toBe('')
  })

  it('o FRAZĂ care conține „response:" + numele uneltei rămâne vizibilă', () => {
    const t = 'response: secret_publica e unealta prin care public un secret.'
    expect(stripToolMarkup(t, undefined, ADMIN_TOOLS)).toBe(t)
  })

  it('un nume NECUNOSCUT după wrapper NU e mâncat (nu inventăm unelte)', () => {
    const t = 'response:hack_everything{}\nText real.'
    expect(stripToolMarkup(t, undefined, ADMIN_TOOLS)).toBe(t)
  })

  it('streaming: ecoul rupt pe bucăți nu scapă nicio literă în bulă', () => {
    const s = makeToolMarkupStripper(() => {}, ADMIN_TOOLS)
    let visible = s.push('response:secret_pub')
    visible += s.push('lica{result:{}}\nAm publicat.')
    visible += s.flush()
    expect(visible).toBe('Am publicat.')
  })
})
