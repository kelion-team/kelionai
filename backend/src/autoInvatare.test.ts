import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { agregaTimpi, lectiiDin } from './services/autoInvatare.js'
import type { TimingRow } from './db.js'

const row = (kind: string, ms: number, ok = true): TimingRow => ({
  kind,
  model: 'x',
  ms,
  ok,
  rounds: null,
  created_at: '',
})

describe('auto-învățare — agregarea timpilor (pură, măsurabilă)', () => {
  it('agregă pe tip: n, medie, rată de eșec; cel mai lent tip primul', () => {
    const rows = [
      row('chat', 1000),
      row('chat', 3000),
      row('chat', 2000),
      row('autonom', 10000),
      row('autonom', 20000, false),
    ]
    const s = agregaTimpi(rows)
    expect(s[0].kind).toBe('autonom') // cel mai lent primul (acolo e câștigul)
    const chat = s.find((x) => x.kind === 'chat')!
    expect(chat.n).toBe(3)
    expect(chat.avgMs).toBe(2000)
    expect(chat.failRate).toBe(0)
    const autonom = s.find((x) => x.kind === 'autonom')!
    expect(autonom.failN).toBe(1)
    expect(autonom.failRate).toBe(0.5)
  })
})

describe('auto-învățare — lecțiile ies din tipare (nu repetă greșeli)', () => {
  it('sub 5 măsurători nu tragem concluzii', () => {
    expect(lectiiDin(agregaTimpi([row('chat', 20000, false)]))).toEqual([])
  })
  it('5 ture lente pe un tip → lecție de lentoare', () => {
    const l = lectiiDin(agregaTimpi(Array.from({ length: 5 }, () => row('greu', 12000))))
    expect(l.some((x) => x.includes('greu') && x.includes('lent'))).toBe(true)
  })
  it('rată mare de eșec pe un tip → lecție „nu relua orbește"', () => {
    // 3 eșecuri din 5 = 60% ≥ 20%
    const rows = Array.from({ length: 5 }, (_v, i) => row('flaky', 1000, i >= 3))
    const l = lectiiDin(agregaTimpi(rows))
    expect(l.some((x) => x.includes('flaky') && x.includes('eșec'))).toBe(true)
  })
})

const sursa = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

describe('auto-învățare — cablarea (măsoară + învață în spate, invizibil)', () => {
  it('tura de chat înregistrează timpul REAL — și reușită, și eșec', () => {
    const chat = sursa('./routes/chat.ts')
    expect(/recordTiming\(\{[^}]*kind: 'chat'[^}]*ok: true/.test(chat)).toBe(true)
    expect(/recordTiming\(\{[^}]*ok: false/.test(chat)).toBe(true)
  })
  it('registrul există în schemă, iar bucla din spate pornește la boot', () => {
    expect(sursa('./db.ts').includes('CREATE TABLE IF NOT EXISTS task_timings')).toBe(true)
    expect(sursa('./index.ts').includes('startAutoInvatare()')).toBe(true)
  })
  it('bucla scrie în spate (kv_state + memoria creierului), nu pe interfață', () => {
    const inv = sursa('./services/autoInvatare.ts')
    expect(inv.includes("saveKv('invatare:performanta'")).toBe(true)
    expect(inv.includes("memoriePune('invatare:timpi'")).toBe(true)
  })
})
