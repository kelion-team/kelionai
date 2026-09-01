import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  curataTextJurnal,
  metadateJurnalSigure,
  rezumaStareFinalaSarcinaOperationala,
  tranzitieOperationalaPermisa,
} from './jurnalOperational.js'
import { clasificaRezultatUnealta } from './poartaFaptelor.js'

describe('jurnal operațional — mașina de stări', () => {
  it('permite lanțul observare → interpretare → plan → execuție → verificare', () => {
    expect(tranzitieOperationalaPermisa('observing', 'interpreting')).toBe(true)
    expect(tranzitieOperationalaPermisa('interpreting', 'planning')).toBe(true)
    expect(tranzitieOperationalaPermisa('planning', 'executing')).toBe(true)
    expect(tranzitieOperationalaPermisa('executing', 'verifying')).toBe(true)
    expect(tranzitieOperationalaPermisa('verifying', 'completed')).toBe(true)
  })

  it('refuză închiderea directă a unei observații ca efect finalizat', () => {
    expect(tranzitieOperationalaPermisa('observing', 'completed')).toBe(false)
    expect(tranzitieOperationalaPermisa('completed', 'executing')).toBe(false)
  })

  it('nu confundă succesul tehnic cu efectul verificat', () => {
    const succes = clasificaRezultatUnealta('send_email', JSON.stringify({ success: true }))
    expect(rezumaStareFinalaSarcinaOperationala({
      cereActiune: true,
      dovezi: [succes],
      planFaraExecutie: false,
    })).toEqual({ stare: 'unverified', cod: 'independent_verification_missing' })
  })

  it('păstrează blocajele, eșecurile și confirmările ca stări distincte', () => {
    const blocat = clasificaRezultatUnealta('send_email', JSON.stringify({ denied: true, reason: 'permission missing' }))
    const confirmare = clasificaRezultatUnealta('send_email', JSON.stringify({ awaiting_confirmation: true }))
    const esuat = clasificaRezultatUnealta('send_email', JSON.stringify({ error: 'provider unavailable' }))
    expect(rezumaStareFinalaSarcinaOperationala({ cereActiune: true, dovezi: [blocat], planFaraExecutie: false }).stare).toBe('blocked')
    expect(rezumaStareFinalaSarcinaOperationala({ cereActiune: true, dovezi: [confirmare], planFaraExecutie: false }).stare).toBe('awaiting_confirmation')
    expect(rezumaStareFinalaSarcinaOperationala({ cereActiune: true, dovezi: [esuat], planFaraExecutie: false }).stare).toBe('failed')
  })
})

describe('jurnal operațional — legat în ciclul chatului', () => {
  const chat = readFileSync(fileURLToPath(new URL('../routes/chat.ts', import.meta.url)), 'utf8')

  it('leagă turnul, tentativa, rezultatul și starea derivată în aceeași sarcină', () => {
    expect(chat).toMatch(/const sarcinaOperationalaId = randomUUID\(\)/)
    expect(chat).toMatch(/inregistreazaSarcinaOperationala\(\{/)
    expect(chat).toMatch(/kind: 'tool_attempted'/)
    expect(chat).toMatch(/kind: 'tool_result'/)
    expect(chat).toMatch(/rezumaStareFinalaSarcinaOperationala\(\{/)
    expect(chat).toMatch(/stare: finalOperational\.stare/)
  })

  it('nu lasă ramurile rapide în afara jurnalului', () => {
    expect(chat).toMatch(/const commandTaskId = randomUUID\(\)/)
    expect(chat).toMatch(/code: 'client_ack_missing'/)
    expect(chat).toMatch(/completeChatTurn\(\{[\s\S]*?code: `instant_\$\{frameKey\}`/)
    expect(chat).toMatch(/code: 'chat_processing_failed'/)
  })
})

describe('jurnal operațional — date sigure', () => {
  it('maschează secretele și nu primește output-uri brute în metadate', () => {
    expect(curataTextJurnal('Authorization: Bearer secret-value-which-is-long-enough-to-be-redacted')).not.toContain('secret-value')
    expect(metadateJurnalSigure({
      source: 'chat',
      output: '{"private":"tool output"}',
      token: 'not-for-the-journal',
      rounds: 2,
    })).toEqual({ source: 'chat', rounds: 2 })
  })
})
