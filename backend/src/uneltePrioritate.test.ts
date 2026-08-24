import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const chat = readFileSync(fileURLToPath(new URL('./routes/chat.ts', import.meta.url)), 'utf8')
const listaAdmin = /const rawTools:[\s\S]*?\n {6}: \[/.exec(chat)?.[0] ?? chat
const poz = (simbol: string): number => listaAdmin.indexOf(simbol)

describe('inventarul admin păstrează uneltele reale înaintea cozii tăiabile', () => {
  const esentiale = [
    'NOTE_TOOLS',
    'BROWSER_TOOLS',
    'BUILD_SOFTWARE_TOOL',
    'SYSTEM_HEALTH_TOOL',
    'READ_INBOX_TOOL',
  ]
  const coada = ['SET_ROLE_TOOL', 'PROMO_TOOL', 'CERINTA_NOUA_TOOL']

  for (const esentiala of esentiale) {
    for (const optionala of coada) {
      it(`${esentiala} precedă ${optionala}`, () => {
        expect(poz(esentiala)).toBeGreaterThanOrEqual(0)
        expect(poz(optionala)).toBeGreaterThan(poz(esentiala))
      })
    }
  }

  it('nu reintroduce executori repository, SQL, shell sau secrete în procesul web', () => {
    for (const retras of ['REPO_WRITE_TOOL', 'DB_QUERY_TOOL', 'SECRET_PUNE_TOOL', 'SERVER_OPS_TOOL']) {
      expect(listaAdmin).not.toContain(retras)
    }
  })

  it('coada și uneltele eliminate la plafon rămân diagnosticabile', () => {
    expect(chat).toMatch(/COAD[ĂA]: se taie prima la plafon/)
    expect(chat).toMatch(/t[ăa]iate din coad[ăa]: \$\{taiate\}/)
  })
})
