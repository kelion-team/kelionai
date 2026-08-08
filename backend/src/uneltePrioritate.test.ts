import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// ── UNELTELE DE AUR STAU ÎN PRIMELE 64, OCAZIONALELE LA COADĂ (Adrian, 3 aug) ──
//
// Plafonul furnizorului e 64 de unelte/tură; adminul are ~80, deci 16 se taie
// din COADĂ. Înainte, `NOTE_TOOLS`+`BROWSER_TOOLS` la mijloc împingeau uneltele
// de aur (repo/build/db/health) peste 64 → Kelion zicea „nu pot" pentru ele, deși
// promptul i le jura. Acum ordinea garantează că uneltele de aur + memoria +
// mâinile sunt înaintea cozii ocazionale (rol/cost/promo/secrete/cerințe/card/
// invitați). Testul păzește ordinea în sursă (arata unde e granița).
const chat = readFileSync(fileURLToPath(new URL('./routes/chat.ts', import.meta.url)), 'utf8')

// Poziția primei apariții a unui simbol în lista adminului (după „isAdmin ? [").
const listaAdmin = /isAdmin\s*\r?\n?\s*\?[\s\S]*?\n {6}: \[/.exec(chat)?.[0] ?? chat
const poz = (s: string): number => listaAdmin.indexOf(s)

describe('uneltele de aur sunt înaintea cozii ocazionale (plafon 64)', () => {
  const aur = ['NOTE_TOOLS', 'BROWSER_TOOLS', 'REPO_WRITE_TOOL', 'BUILD_SOFTWARE_TOOL', 'DB_QUERY_TOOL', 'SYSTEM_HEALTH_TOOL', 'READ_INBOX_TOOL']
  const coada = ['SET_ROLE_TOOL', 'PROMO_TOOL', 'SECRET_PUNE_TOOL', 'CERINTA_NOUA_TOOL', 'CARD_STARE_TOOL', 'ALLOW_GUEST_VOICE_TOOL']
  for (const a of aur) {
    for (const c of coada) {
      it(`${a} vine înaintea lui ${c}`, () => {
        const pa = poz(a)
        const pc = poz(c)
        expect(pa).toBeGreaterThanOrEqual(0)
        expect(pc).toBeGreaterThan(pa)
      })
    }
  }
  it('coada e marcată explicit ca tăiabilă la plafon', () => {
    expect(chat).toMatch(/COAD[ĂA]: se taie prima la plafon/)
  })
  it('avertismentul numește exact uneltele tăiate (diagnosticabil)', () => {
    expect(chat).toMatch(/t[ăa]iate din coad[ăa]: \$\{taiate\}/)
  })
})
