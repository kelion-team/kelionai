import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { needsToolForAnswer, autoPreviewFrame } from './services/monitorAutoPreview.js'
import { eCadruDeSuprafata } from './services/chatFrames.js'

// ── TOTUL PE MONITOR (Adrian, Aug 2, 10:13 — "TOT pe monitor") ──────────────
//
// His complaint at 10:04: "Câte grade sunt afară?" → the Stage showed ONLY
// the avatar. No weather card, no visual, nothing. The monitor is Kelion's
// PRIMARY display surface.
//
// The break, proven by code reading: the LIGHT-TURN RACE in routes/chat.ts
// answered any non-heavy, image-less turn with THREE parallel models offered
// ZERO tools (`runOrchestrator(id, orMsgs, [], execTool, …)`). A weather
// question is "light" by the difficulty classifier, so get_weather was never
// callable → no screen_url → no {monitor} frame → dark monitor. The race's
// answer also came from stale model memory instead of live data.
//
// The fix, both ends:
//  1. questions that obviously need live data SKIP the tool-less race;
//  2. an end-of-turn auto-preview puts ONE visual on the monitor when the
//     answer carries an obvious payload the brain didn't show.
const sursa = (cale: string): string =>
  readFileSync(fileURLToPath(new URL(cale, import.meta.url)), 'utf8')

const chat = sursa('./routes/chat.ts')
const chatPanel = sursa('../../frontend/src/components/ChatPanel.tsx')
const workspace = sursa('../../frontend/src/lib/workspace.ts')
const orch = sursa('./services/orchestrator.ts')

describe('turele NU mai pot pierde uneltele (cursa fără unelte a fost extirpată)', () => {
  // (3 aug — extirparea OpenRouter a îngropat și cursa pe 3 modele fără
  // unelte: acum ORICE tură merge pe calea secvențială CU unelte, pe creierul
  // Gemini. Riscul „get_weather necallable → monitor întunecat" nu mai are
  // codul care îl producea.)
  it('nu mai există cursă fără unelte în chat.ts', () => {
    expect(chat).not.toMatch(/runOrchestrator\(id, orMsgs, \[\], execTool/)
  })
  it('calea unică a creierului oferă uneltele turei', () => {
    expect(chat).toMatch(/runOrchestrator\(\s*orchestratorModel,\s*orMsgs,\s*tools as unknown as AnthropicTool\[\]/)
  })
})

describe('needsToolForAnswer — detectorul determinist', () => {
  const trebuieUnealta = [
    'Câte grade sunt afară?',
    'Ce vreme e mâine la Cluj?',
    'Plouă azi?',
    'Pune un clip cu pisici.',
    'Dă-mi știrile de azi.',
    'Caută prețul la bitcoin.',
    'Cât e ceasul în Tokyo?',
    'Unde mă aflu?',
    'Uite ce am găsit: https://example.com/articol',
    'What is the weather in London?',
  ]
  for (const q of trebuieUnealta) {
    it(`ia drumul cu unelte: „${q}"`, () => expect(needsToolForAnswer(q)).toBe(true))
  }

  const ramaneCursa = [
    'Salut, ce faci?',
    'Spune-mi o glumă.',
    'Povestește-mi despre istoria Romei.',
    'Mulțumesc, perfect!',
    'Cine a fost Eminescu?',
    'Scrie-mi o poezie despre toamnă.',
  ]
  for (const q of ramaneCursa) {
    it(`rămâne în cursă (viteză): „${q}"`, () => expect(needsToolForAnswer(q)).toBe(false))
  }
})

describe('auto-preview-ul de sfârșit de tură — EXACT un vizual, sau nimic', () => {
  it('o imagine URL ajunge pe monitor ca imagine', () => {
    const f = autoPreviewFrame('Uite graficul: https://ex.com/chart.png — și explicația.')
    expect(f).toEqual({ monitor: { url: 'https://ex.com/chart.png', title: 'Image' } })
  })

  it('un link simplu ajunge pe monitor ca pagină (fără punctuația de final)', () => {
    const f = autoPreviewFrame('Am găsit pagina https://example.com/raport pentru tine.')
    expect(f).toEqual({ monitor: { url: 'https://example.com/raport', title: '' } })
  })

  it('o pagină Google care refuză iframe-ul NU devine cadru mort (rămâne document, nu iframe)', () => {
    const f = autoPreviewFrame('Iată: https://www.google.com/search?q=test — rezultatele.')
    // NU se deschide un iframe mort spre Google (X-Frame-Options) — dar răspunsul
    // tot ajunge pe monitor, ca DOCUMENT lizibil (regula „orice răspuns pe monitor").
    expect(f?.monitor).toBeUndefined()
    expect(f?.doc?.text).toContain('google.com/search')
  })

  it('coordonate din proză devin harta NOASTRĂ same-origin (nu un iframe străin)', () => {
    const f = autoPreviewFrame('Suntem chiar acum la 44.4268, 26.1025, lângă piață.')
    expect(f?.monitor?.url).toContain('/api/route?punct=44.4268,26.1025')
    expect(f?.monitor?.url).not.toContain('openstreetmap.org')
  })

  it('un tabel markdown devine card (un rând = un item)', () => {
    const f = autoPreviewFrame(
      'Iată comparația:\n| Oraș | Max | Min |\n| --- | --- | --- |\n| Cluj | 24 | 12 |\n| Oradea | 26 | 14 |\nSper să ajute.',
    )
    expect(f?.card?.type).toBe('table')
    expect(f?.card?.items).toHaveLength(2)
    expect(f?.card?.items[0]).toEqual({ primary: 'Cluj', secondary: '24', meta: '12' })
  })

  it('un bloc de cod devine document lizibil', () => {
    const f = autoPreviewFrame('Sigur:\n```ts\nconst x: number = 42\n```\nGata.')
    expect(f?.doc?.title).toBe('Code (ts)')
    expect(f?.doc?.text).toBe('const x: number = 42')
  })

  it('când există ȘI imagine ȘI tabel, iese EXACT un vizual (imaginea câștigă)', () => {
    const f = autoPreviewFrame(
      'Uite: https://ex.com/a.png\n| A | B |\n| --- | --- |\n| 1 | 2 |',
    )
    expect(f?.monitor?.url).toBe('https://ex.com/a.png')
    expect(f?.card).toBeUndefined()
  })

  // ORICE RĂSPUNS PE MONITOR (owner, 19 aug: „obligatoriu absolut orice mesaj se
  // pune pe monitor… Kelion nu înțelege că orice răspuns trebuie afișat pe
  // monitor"). Contractul s-a SCHIMBAT față de 2 aug: proza simplă NU mai lasă
  // monitorul gol — acum aprinde un document lizibil cu răspunsul, ca afișarea să
  // nu mai depindă de model să cheme show_document.
  it('proza simplă aprinde monitorul ca document (orice răspuns se vede)', () => {
    const proza = [
      'Afară sunt 24 de grade, cer senin. E o zi frumoasă.',
      'Încearcă din nou în câteva secunde.',
      'Am preluat cerința (ordin #12).',
      'Rezultatul e 804.',
    ]
    for (const p of proza) {
      const f = autoPreviewFrame(p)
      expect(f?.doc?.text).toBe(p)
      expect((f?.doc?.title ?? '').length).toBeGreaterThan(0)
    }
  })

  it('răspuns gol / doar spații → NU aprinde nimic (nu inventează un ecran)', () => {
    expect(autoPreviewFrame('')).toBeNull()
    expect(autoPreviewFrame('   \n  ')).toBeNull()
  })
})

describe('auto-preview-ul nu dublează NICIODATĂ ce uneltele au pus deja', () => {
  it('gardul din chat.ts verifică surfaceShown', () => {
    expect(chat).toMatch(/if \(!surfaceShown && assistantText\.trim\(\)\)/)
    expect(chat).toMatch(/surfaceShown = eCadruDeSuprafata\(chunk\)/)
    expect(chat).toMatch(/const preview = autoPreviewFrame\(assistantText\)/)
  })

  // Detectorul protocolului este testat direct, nu reconstruit fragil din sursă.
  const CTRL = String.fromCharCode(31)

  it('{monitor} cu url real = suprafață', () => {
    expect(eCadruDeSuprafata(`${CTRL}{"monitor":{"url":"https://x.y","title":""}}${CTRL}`)).toBe(true)
  })
  it('{doc} / {card} / {app} / {build} = suprafață', () => {
    expect(eCadruDeSuprafata(`${CTRL}{"doc":{"title":"t","text":"x"}}${CTRL}`)).toBe(true)
    expect(eCadruDeSuprafata(`${CTRL}{"card":{"type":"table","title":"t","items":[]}}${CTRL}`)).toBe(true)
    expect(eCadruDeSuprafata(`${CTRL}{"build":{"open":true}}${CTRL}`)).toBe(true)
  })
  it('{monitor} cu url GOL = curățarea ecranului, NU suprafață', () => {
    expect(eCadruDeSuprafata(`${CTRL}{"monitor":{"url":"","title":""}}${CTRL}`)).toBe(false)
  })
  it('cadrele de protocol NU sunt suprafețe', () => {
    expect(eCadruDeSuprafata(`${CTRL}{"heard":"salut"}${CTRL}`)).toBe(false)
    expect(eCadruDeSuprafata(`${CTRL}{"turn":"abc"}${CTRL}`)).toBe(false)
  })
})

describe('show_document ajunge la payload-ul de workspace cu forma corectă', () => {
  it('backendul scrie un cadru {doc:{title,text}} și răspunde shown:true', () => {
    const bloc = /case 'show_document': \{([\s\S]*?)\n    \}/.exec(chat)?.[1] ?? ''
    expect(bloc).toMatch(/reply\.raw\.write\(`\$\{CTRL\}\$\{JSON\.stringify\(\{ doc: \{ title, text \} \}\)\}\$\{CTRL\}`\)/)
    expect(bloc).toMatch(/return JSON\.stringify\(\{ shown: true \}\)/)
  })
  it('frontendul deschide cadrul {doc} ca document pe monitor', () => {
    expect(chatPanel).toMatch(/if \(c\.doc && c\.doc\.text\.trim\(\)\) \{\s*\n\s*openWorkspaceDoc\(/)
  })
  it('magazinul de workspace fixează suprafața doc ca vizibilă (status ok)', () => {
    expect(workspace).toMatch(/export function openWorkspaceDoc\(title: string, text: string\): void \{\s*\n\s*upsert\(\{ id: 'doc', kind: 'doc', title, url: '', card: null, text, status: 'ok' \}\)/)
  })
})

describe('poarta analizei rămâne neatinsă', () => {
  it('cele două porți (fapta + analiza) sunt încă active în orchestrator', () => {
    expect(orch).toMatch(/POARTA FAPTEI/)
    expect(orch).toMatch(/POARTA ANALIZEI/)
    expect(orch).toMatch(/ANALIZA_CLAIM_RE\.test/)
    expect(orch).toMatch(/PUNE PE MONITOR[\s\S]{0,60}show_document/)
  })
})
