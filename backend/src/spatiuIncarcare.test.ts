// ── P13: SPAȚIUL DE ÎNCĂRCARE ÎN CHAT, MĂRIT ȚINTIT ─────────────────────────
// (owner, 15 aug: „trebuie sa-i maresti spatiu de incarcare in chat")
//
// MĂSURAT: /api/ingest stătea pe bodyLimit-ul GLOBAL de 25MB — cu umflarea
// base64 (4/3), un fișier de ~18MB umplea țeava, iar frontend-ul (care
// oglindea cinstit limita serverului) îl refuza. Mărirea e ȚINTITĂ: doar
// ruta de ingest urcă la 100MB (ca /api/chat, sub capul real Cloudflare);
// globalul de 25MB rămâne pentru restul rutelor — nu lărgim toate ușile
// pentru că una era strâmtă.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const aici = dirname(fileURLToPath(import.meta.url))
const citeste = (cale: string): string => readFileSync(join(aici, cale), 'utf8')

describe('spațiul de încărcare: mărit unde trebuia, neschimbat unde nu', () => {
  it('/api/ingest are limita LUI de 100MB', () => {
    const ingest = citeste('routes/ingest.ts')
    expect(ingest).toMatch(/'\/api\/ingest', \{\s*\n\s*bodyLimit: 100_000_000,/)
  })

  it('globalul rămâne 25MB — restul rutelor nu se lărgesc pe furiș', () => {
    const index = citeste('index.ts')
    expect(index).toMatch(/bodyLimit: 25_000_000/)
  })

  it('oglinda din frontend urcă la fel (96MB base64 ≈ fișier ~72MB), cu refuzul cinstit păstrat', () => {
    const panou = citeste('../../frontend/src/components/ChatPanel.tsx')
    expect(panou).toMatch(/MAX_INGEST_B64 = 96_000_000/)
    expect(panou).toMatch(/docTooLarge/)
  })
})
