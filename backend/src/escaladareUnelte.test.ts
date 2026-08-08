import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { fazaTurei, UNELTE_VORBIRE } from './services/fazeChat.js'

// ESCALADAREA CERUTĂ DE OWNER (8 aug): „verifică de ce nu știe să escaladeze să
// ceară acces la unelte, când are nevoie, folosește și se eliberează după ce o
// folosește" + „dacă nu are acces la unealtă sau funcție intră în blocaj".
//
// Ce era înainte, măsurat în cod: `ask_brain` chema `brainComplete` — o
// completare de TEXT fără nicio unealtă („expert fără mâini"; cu modelul unic
// era chiar ACELAȘI model), iar pe turele vocale ușa lipsea complet
// (`heavyTurn ? [] : [ASK_BRAIN_TOOL]` — vocea e „heavy" ca model). Blocajul
// reclamat era construit din amândouă. Pinurile de aici țin reparația pe loc.

const chat = readFileSync(fileURLToPath(new URL('./routes/chat.ts', import.meta.url)), 'utf8')
const orchestrator = readFileSync(fileURLToPath(new URL('./services/orchestrator.ts', import.meta.url)), 'utf8')

describe('ușa de escaladare — există și pe voce, nu doar pe scris', () => {
  it('ask_brain se oferă după FAZĂ (vorbire), nu după treapta de model', () => {
    expect(chat).toContain("incarcatura.faza === 'vorbire' ? [ASK_BRAIN_TOOL] : []")
    expect(chat).not.toContain('heavyTurn ? [] : [ASK_BRAIN_TOOL]')
  })

  it('ușa e în lista fazei de vorbire (fără ea, faza ar fi o cușcă)', () => {
    expect(UNELTE_VORBIRE).toContain('ask_brain')
  })
})

describe('ușa CHIAR deschide inventarul — nu mai e un „expert fără mâini"', () => {
  it('executorul comută lista turei pe inventarul plin', () => {
    expect(chat).toContain('tools.push(...uneltePline)')
    expect(chat).toContain('[FAZĂ] ESCALADARE ask_brain')
  })

  it('vechea escaladare fără unelte (brainComplete pe text) a dispărut din chat', () => {
    expect(chat).not.toContain('CHAT ESCALATION: the fast chat model handed you')
    expect(chat).not.toContain("import { brainComplete }")
  })

  it('mecanismul pe care circulă comutarea: orchestratorul dă array-ul de unelte prin REFERINȚĂ la fiecare rundă', () => {
    // Dacă cineva clonează lista pe rundă ([...tools]), comutarea din executor
    // nu mai ajunge la runda următoare și blocajul se întoarce în tăcere.
    expect(orchestrator).toContain('geminiDirectChatStream(gModel, convo, tools,')
    expect(orchestrator).toContain('geminiDirectChat(gModel, convo, tools,')
  })
})

describe('eliberarea e automată — faza se decide de la zero la fiecare tură', () => {
  it('o tură nouă de conversație pleacă iar cu setul mic', () => {
    const t = fazaTurei({ text: 'salut, ce mai faci?', areAudio: false, areImagine: false, cereActiune: false })
    expect(t.faza).toBe('vorbire')
    expect(t.unelte).toEqual([...UNELTE_VORBIRE])
  })

  it('escaladarea numită duce la decizie cu tot inventarul', () => {
    const t = fazaTurei({ text: '', areAudio: true, areImagine: false, cereActiune: false, aEscaladat: true })
    expect(t.faza).toBe('decizie')
    expect(t.instructiuniDeLucru).toBe(true)
  })
})
