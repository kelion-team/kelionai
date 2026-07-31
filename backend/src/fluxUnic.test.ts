import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { filtruRepetitie, PRAG_REPETITIE } from './services/fluxUnic.js'

// ── „SCRIE ACEEAȘI FRAZĂ NONSTOP" ───────────────────────────────────────────
//
// Adrian, 31 iul: „în chat se balează răspunsul lui scris de mai multe ori, e
// greșit, el nu mă aude din prima?" → „scrie aceeași frază nonstop".
//
// NU era că nu aude. orchestrator.ts rulează până la 8 runde, iar chat.ts
// trimitea la client textul FIECĂREI runde, fără să compare cu ce ajunsese
// deja. Model împotmolit = aceeași frază, o dată pe rundă. De opt ori.
//
// Funcția e pură, deci testul e REAL: îi dăm bucăți exact cum vin din stream
// și verificăm ce iese. Nu citim sursa sperând că face ce scrie în ea.

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
    // Contează: ținta e primul cuvânt sub o secundă. Dacă filtrul ar reține
    // bucăți „ca să se lămurească", ar strica exact ce s-a lucrat luni de zile.
    const f = filtruRepetitie()
    expect(f.bucata('Salut')).toBe('Salut')
  })

  it('BUG-UL LUI ADRIAN: a doua rundă repetă fraza → nu mai iese nimic', () => {
    const f = filtruRepetitie()
    for (const b of FRAZA.match(/.{1,12}/g)!) f.bucata(b)
    f.inchideRunda()
    const dupaRunda1 = f.emis()

    // Runda 2: modelul spune exact același lucru.
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
    // Verificarea care contează cu adevărat: fraza apare o dată, nu de opt ori.
    expect(f.emis().split('Verific acum').length - 1).toBe(1)
  })
})

describe('repetarea APROAPE identică — cazul care încă se vedea pe ecran', () => {
  // Adrian, 31 iul, DUPĂ ce prima reparație era live: „revin cu întrebarea, de
  // ce baleiezi permanent în chat răspunsul?"
  //
  // Fiindcă prima variantă compara EXACT. Un model nu repetă identic — schimbă
  // o virgulă, o majusculă, un spațiu — și atunci filtrul îl lăsa să treacă
  // întreg. Adică prindea exact cazul care nu se întâmplă.
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

  // Granița care lipsea la prima încercare de normalizare: filtrul a tăiat
  // „Al" din „Altceva", fiindcă pe forma normalizată un început scurt se
  // potrivește aproape mereu undeva în istoric. Un răspuns ciuntit e mai rău
  // decât unul repetat — de asta se taie doar o FRAZĂ, nu o silabă.
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

  // Fără pragul ăsta, reparația ar deveni un bug mai rău decât cel reparat: un
  // răspuns final scurt („Da.") e mereu substring a ce s-a spus înainte și ar
  // dispărea complet de pe ecran.
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

  // Filtrul face ca repetarea să nu se VADĂ. Dacă ne-am opri acolo, tot am
  // plăti opt runde ca să aruncăm șapte — iar pe modelele gratuite opt apeluri
  // în rafală lovesc plafonul pe minut, deci următoarea întrebare a lui Adrian
  // primește 429, adică „problemă tehnică". Astea două sunt aceeași reparație.
  it('nimic nou + aceleași unelte ca runda trecută → ieșire din buclă', () => {
    expect(orch).toMatch(/rundaGoala && semnatura && semnatura === semnaturaTrecuta/)
    expect(orch).toMatch(/opresc bucla/)
  })

  it('textul trece prin filtru pe AMBELE căi — cu streaming și fără', () => {
    // Agenții din fundal nu streamează; dacă filtrul ar fi doar pe calea de
    // streaming, aceeași repetare ar intra netăiată în istoric și în voce.
    expect(orch).toContain('onTextFiltrat')
    expect(orch).toMatch(/if \(!onTextFiltrat && res\.text\) flux\.bucata\(res\.text\)/)
  })
})
