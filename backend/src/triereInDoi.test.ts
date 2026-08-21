import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// ── TRIEREA ÎN DOI (JARVIS pasul 3 — PROIECT-CHAT-VOCE §4, „inima") ─────────
// Cât creierul greu macină, ce spune omul (ADRESAT) devine informație pentru
// gândirea în curs; la întoarcerea ușii, creierul greu primește runde de
// convergență cu ce s-a aflat. STOP: nimic nou = răspunsul e gata (nu un
// procent inventat). Lacătele pinuiează COD VIU (lecția anti-M6).

const ruta = readFileSync(fileURLToPath(new URL('./routes/vocalLive.ts', import.meta.url)), 'utf8')
const viu = ruta
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter((l) => !l.trimStart().startsWith('//'))
  .join('\n')

describe('trierea în doi pe calea vocală', () => {
  it('rostirea ADRESATĂ sosită cât ușa grea macină intră în convergență (aceeași gardă ca la comenzi)', () => {
    expect(viu).toMatch(/^\s*let injectiiUsa: string\[\] = \[\]/m)
    expect(viu).toMatch(/^\s*if \(usiGreleInZbor > 0 && rostireCurenta\.trim\(\)\) \{\s*\n\s*injectiiUsa\.push\(rostireCurenta\.trim\(\)\)/m)
  })
  it('ușa pornește curată și convergența rulează doar pe informație NOUĂ, cu plafon (nu e raliu)', () => {
    expect(viu).toMatch(/^\s*injectiiUsa\.length = 0/m)
    expect(viu).toMatch(/^\s*while \(r\.ok && injectiiUsa\.length > 0 && runde < RUNDE_TRIERE\) \{/m)
    expect(viu).toMatch(/\[TRIEREA ÎN DOI — ce a spus omul cât gândeai\]/)
  })
  it('protocolul e în fișa uneltei (declarat o dată la setup): întreabă întâi, completează, oprește-te la convergență, fără narațiune de proces', () => {
    expect(viu).toMatch(/TRIEREA ÎN DOI: dacă cererea e ambiguă/)
    expect(viu).toMatch(/nicio\s*'\s*\+\s*'întrebare rămasă nu mai mută răspunsul/)
  })
})
