import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { filtruRepetitie, PRAG_REPETITIE } from './services/fluxUnic.js'

// ── "IT WRITES THE SAME SENTENCE NONSTOP" ──────────────────────────────────
//
// Adrian, Jul 31: "in the chat its written answer drools several times, it's
// wrong, doesn't it hear me the first time?" → "it writes the same sentence
// nonstop".
//
// It was NOT that it doesn't hear. orchestrator.ts runs up to 8 rounds, and
// chat.ts sent EACH round's text to the client, without comparing it to what
// had already arrived. A stuck model = the same sentence, once per round.
// Eight times.
//
// The function is pure, so the test is REAL: we give it chunks exactly as they
// come from the stream and check what comes out. We don't read the source
// hoping it does what it says.

const FRAZA = 'Verific acum calendarul tău și îți spun imediat ce ai programat mâine dimineață.'

describe('ce s-a scris o dată nu se mai scrie', () => {
  it('prima rundă curge întreagă, bucată cu bucată', () => {
    const f = filtruRepetitie()
    let iesit = ''
    for (const b of ['Verific ', 'acum ', 'calendarul.']) iesit += f.bucata(b)
    iesit += f.inchideRunda()
    expect(iesit).toBe('Verific acum calendarul.')
    expect(f.emis()).toBe('Verific acum calendarul.')
  })

  it('primul cuvânt nu e întârziat — latența nu are de suferit', () => {
    // It matters: the target is the first word under one second. If the
    // filter held back chunks "to figure things out", it would break exactly
    // what took months of work.
    const f = filtruRepetitie()
    expect(f.bucata('Salut')).toBe('Salut')
  })

  it('BUG-UL LUI ADRIAN: a doua rundă repetă fraza → nu mai iese nimic', () => {
    const f = filtruRepetitie()
    for (const b of FRAZA.match(/.{1,12}/g)!) f.bucata(b)
    f.inchideRunda()
    const dupaRunda1 = f.emis()

    // Round 2: the model says exactly the same thing.
    let iesitRunda2 = ''
    for (const b of FRAZA.match(/.{1,12}/g)!) iesitRunda2 += f.bucata(b)
    iesitRunda2 += f.inchideRunda()

    expect(iesitRunda2).toBe('')
    expect(f.emis()).toBe(dupaRunda1)
    expect(f.rundaAFostGoala()).toBe(true)
  })

  it('opt runde identice — omul vede fraza O SINGURĂ dată, nu de opt ori', () => {
    const f = filtruRepetitie()
    for (let runda = 0; runda < 8; runda++) {
      for (const b of FRAZA.match(/.{1,12}/g)!) f.bucata(b)
      f.inchideRunda()
    }
    expect(f.emis()).toBe(FRAZA)
    // The check that really matters: the sentence appears once, not eight times.
    expect(f.emis().split('Verific acum').length - 1).toBe(1)
  })
})

describe('repetarea APROAPE identică — cazul care încă se vedea pe ecran', () => {
  // Adrian, Jul 31, AFTER the first fix was live: "coming back with the
  // question, why do you permanently drool the answer in the chat?"
  //
  // Because the first variant compared EXACTLY. A model doesn't repeat
  // identically — it changes a comma, a capital, a space — and then the
  // filter let it through whole. Meaning it caught exactly the case that
  // never happens.
  const variante = [
    ['virgulă în plus', FRAZA.replace('acum calendarul', 'acum, calendarul')],
    ['majuscule schimbate', FRAZA.toUpperCase()],
    ['spații duble', FRAZA.replace(/ /g, '  ')],
    ['punct la final în loc de nimic', `${FRAZA.slice(0, -1)}!`],
  ] as const

  for (const [cum, varianta] of variante) {
    it(`prinde repetarea cu ${cum}`, () => {
      const f = filtruRepetitie()
      f.bucata(FRAZA)
      f.inchideRunda()
      let iesit = ''
      iesit += f.bucata(varianta)
      iesit += f.inchideRunda()
      expect(iesit).toBe('')
      expect(f.rundaAFostGoala()).toBe(true)
    })
  }

  // The boundary missing from the first normalization attempt: the filter
  // cut "Al" from "Altceva" ("Something"), because in normalized form a short
  // beginning almost always matches somewhere in the history. A maimed answer
  // is worse than a repeated one — that's why only a SENTENCE is cut, not a
  // syllable.
  it('nu ciuntește începutul unui text nou care seamănă la primele litere', () => {
    const f = filtruRepetitie()
    f.bucata('Am verificat calendarul și nu am găsit nimic programat mâine.')
    f.inchideRunda()
    let iesit = ''
    iesit += f.bucata('Amănuntul care lipsea e că ședința e poimâine, nu mâine.')
    iesit += f.inchideRunda()
    expect(iesit).toBe('Amănuntul care lipsea e că ședința e poimâine, nu mâine.')
  })
})

describe('ce e NOU trece întotdeauna', () => {
  it('runda care repetă și apoi continuă — iese doar continuarea', () => {
    const f = filtruRepetitie()
    f.bucata(FRAZA)
    f.inchideRunda()

    let iesit = ''
    iesit += f.bucata(FRAZA)
    iesit += f.bucata(' Ai o ședință la 10.')
    iesit += f.inchideRunda()

    expect(iesit).toBe(' Ai o ședință la 10.')
    expect(f.emis()).toBe(`${FRAZA} Ai o ședință la 10.`)
    expect(f.rundaAFostGoala()).toBe(false)
  })

  it('text complet diferit trece nemodificat', () => {
    const f = filtruRepetitie()
    f.bucata(FRAZA)
    f.inchideRunda()
    const nou = 'Altceva, complet fără legătură cu ce am spus mai devreme.'
    let iesit = ''
    iesit += f.bucata(nou)
    iesit += f.inchideRunda()
    expect(iesit).toBe(nou)
  })

  // Without this threshold, the fix would become a worse bug than the one
  // fixed: a short final answer ("Yes.") is always a substring of what was
  // said before and would disappear completely from the screen.
  it('un răspuns SCURT nu se înghite niciodată, chiar dacă s-a mai spus', () => {
    const f = filtruRepetitie()
    f.bucata('Da, am verificat și am găsit ședința. Da.')
    f.inchideRunda()
    let iesit = ''
    iesit += f.bucata('Da.')
    iesit += f.inchideRunda()
    expect(iesit).toBe('Da.')
    expect('Da.'.length).toBeLessThan(PRAG_REPETITIE)
  })
})

describe('bucla se rupe când modelul se învârte în loc', () => {
  const orch = readFileSync(fileURLToPath(new URL('./services/orchestrator.ts', import.meta.url)), 'utf8')

  // The filter makes the repetition not be SEEN. If we stopped there, we'd
  // still pay eight rounds to throw away seven — and on the free models eight
  // calls in a burst hit the per-minute ceiling, so Adrian's next question
  // gets a 429, i.e. "technical problem". These two are the same fix.
  // Garda e acum PURĂ (`pasRepetitie`, testată pe comportament în
  // services/orchestrator.test.ts): aceleași apeluri + aceleași rezultate.
  it('aceleași apeluri cu aceleași rezultate → ieșire din buclă', () => {
    expect(orch).toMatch(/pasRepetitie\(/)
    expect(orch).toMatch(/opresc bucla/)
  })

  it('textul trece prin filtru pe AMBELE căi — cu streaming și fără', () => {
    // The background agents don't stream; if the filter were only on the
    // streaming path, the same repetition would enter the history and the
    // voice uncut.
    expect(orch).toContain('onTextFiltrat')
    expect(orch).toMatch(/if \(!onTextFiltrat && res\.text\) flux\.bucata\(res\.text\)/)
  })
})
