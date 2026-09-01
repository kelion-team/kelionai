// ── N val 2d: MEMORIA DE TRADING SE REAMINTEȘTE ÎN CONVERSAȚIE ───────────────
//
// Ownerul: în conversație normală memoria de tranzacții NU era reamintită — doar
// butonul Analiză o citea. Cauza: schimburile trecute se scriu într-un namespace
// SEPARAT ('tranzactii'), iar recall-ul general citește doar 'kelion', deci nu le
// vedea niciodată. `recallMemoriiTranzactii` aduce exact namespace-ul ăla, cu
// framing de trading, și DOAR când tabul e ancorat (gardul e în chat.ts).
//
// Ce păzește testul (real, cu db mockat — nu contract pe șiruri):
//   1. Citește namespace-ul 'tranzactii', NU 'kelion' (altfel bug-ul rămâne).
//   2. Fără nimic măsurat → șir GOL (nu inventează un istoric — regula #1).
//   3. Cu schimburi → framing de trading + toate rândurile, deduplicate.
import { describe, it, expect, vi, beforeEach } from 'vitest'

interface MemFalsa {
  content: string
}
// Memoriile pe namespace: testul umple 'tranzactii' și 'kelion' separat, ca să
// dovedim că funcția citește DOAR trading-ul.
const memPeAgent: Record<string, MemFalsa[]> = { tranzactii: [], kelion: [] }
// Ce agent i s-a cerut lui getMemories — dovada că nu citește 'kelion' din greșeală.
let agentiCeruti: string[] = []

vi.mock('../config.js', () => ({
  config: { openai: { key: '', luna: 'model-memorie' } },
}))
vi.mock('./brain.js', () => ({
  brain: { messages: { create: async () => ({ content: [] }) } },
}))
vi.mock('../db.js', () => ({
  getMemories: async (_email: string, _n: number, agent = 'kelion') => {
    agentiCeruti.push(agent)
    return memPeAgent[agent] ?? []
  },
  searchMemories: async (_email: string, agent: string) => memPeAgent[agent] ?? [],
  semanticMemories: async (_email: string, agent: string) => memPeAgent[agent] ?? [],
  addMemory: async () => {},
  recordCost: async () => {},
}))

import { recallMemoriiTranzactii } from './agents.js'

beforeEach(() => {
  memPeAgent.tranzactii = []
  memPeAgent.kelion = [{ content: 'faptul general care NU trebuie să apară aici' }]
  agentiCeruti = []
})

describe('N val 2d — reamintirea memoriei de trading', () => {
  it('citește namespace-ul „tranzactii", NU „kelion"', async () => {
    memPeAgent.tranzactii = [{ content: '[tranzactii-chat 2026-08-12 10:00] BTCUSD Î: unde e stopul? | R: sub 60000' }]
    await recallMemoriiTranzactii('adrianenc11@gmail.com', 'stop')
    expect(agentiCeruti).toContain('tranzactii')
    expect(agentiCeruti).not.toContain('kelion')
  })

  it('fără schimburi măsurate → șir GOL (nu inventează un istoric)', async () => {
    memPeAgent.tranzactii = []
    const out = await recallMemoriiTranzactii('adrianenc11@gmail.com', 'orice')
    expect(out).toBe('')
  })

  it('cu schimburi → framing de trading + rândul real, iar faptul general NU se scurge', async () => {
    memPeAgent.tranzactii = [{ content: '[tranzactii-chat 2026-08-12 10:00] BTCUSD Î: unde e rezistența? | R: 65000' }]
    const out = await recallMemoriiTranzactii('adrianenc11@gmail.com', 'rezistenta')
    expect(out).toContain('DISCUȚIILE VOASTRE ANTERIOARE DE TRADING')
    expect(out).toContain('BTCUSD')
    expect(out).toContain('65000')
    // Memoria generală ('kelion') n-are ce căuta în reamintirea de trading.
    expect(out).not.toContain('faptul general care NU trebuie să apară aici')
  })

  it('deduplică: același schimb din recent + căutare apare O DATĂ', async () => {
    const acelasi = { content: '[tranzactii-chat 2026-08-12 09:00] ETHUSD Î: intrare? | R: 2500' }
    memPeAgent.tranzactii = [acelasi] // recent ȘI căutarea/semantica întorc același obiect
    const out = await recallMemoriiTranzactii('adrianenc11@gmail.com', 'intrare')
    const aparitii = out.split('ETHUSD').length - 1
    expect(aparitii).toBe(1)
  })
})
