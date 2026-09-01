import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const sursaChat = readFileSync(fileURLToPath(new URL('./routes/chat.ts', import.meta.url)), 'utf8')
const sursaI18n = readFileSync(fileURLToPath(new URL('../../frontend/src/lib/i18n.ts', import.meta.url)), 'utf8')

describe('salut la pornire cu imagine (regula K6)', () => {
  it('SYSTEM_PROMPT din chat.ts interzice expres Văd/Observ la primirea unei imagini', () => {
    expect(sursaChat).toMatch(/NEVER say "Văd că ați trimis o imagine"|NEVER use forbidden words like "Văd" or "Observ"/)
  })

  it('SYSTEM_PROMPT impune salvat tăcut și salut ancorat pe oră', () => {
    expect(sursaChat).toMatch(/Save and process received images silently/)
    expect(sursaChat).toMatch(/brief hour-anchored greeting/)
  })

  it('i18n.ts din frontend interzice menționarea imaginii și "Văd / Observ" la salut', () => {
    expect(sursaI18n).toMatch(/interzis "Văd" \/ "Observ"/)
  })
})
