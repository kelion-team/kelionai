// ── BARGRAF DE INTRARE AL URECHII LIVE (owner, 16 aug 2026) ─────────────────
// (verbatim: „vreau sa vad un mic bargraf care arata nivelul de la intrarea
// urechi modelului live, trebuie indentificat daca nu se truncheaza nimic")
//
// Lacăt pe sursă: nivelul se MĂSOARĂ în lib/vocalLive.ts (RMS + vârf pe cadrul
// trimis modelului) și se dă UI-ului prin onNivelIntrare; ChatPanel îl leagă și
// randează bargraful cât ascultă. Dacă vreo verigă se rupe, ownerul rămâne fără
// dovada vizuală a truncherii — de-aia o ținem încuiată.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const aici = dirname(fileURLToPath(import.meta.url))
const clientVL = readFileSync(join(aici, '../../frontend/src/lib/vocalLive.ts'), 'utf8')
const panou = readFileSync(join(aici, '../../frontend/src/components/ChatPanel.tsx'), 'utf8')
const bargraf = readFileSync(join(aici, '../../frontend/src/components/MicBargraf.tsx'), 'utf8')

describe('bargraful urechii live — nivelul de intrare, măsurat, cu truncherea vizibilă', () => {
  it('lib/vocalLive MĂSOARĂ nivelul cadrului trimis (RMS + vârf) și-l emite prin onNivelIntrare', () => {
    // Măsurătoarea e făcută în laCadru, pe semnalul real, nu inventată.
    expect(clientVL).toContain('onNivelIntrare')
    expect(clientVL).toMatch(/Math\.sqrt\(sum \/ ds\.length\)/) // RMS pe cadru
    // Emite și starea porții half-duplex (poarta) + clip — ca truncherea să se vadă.
    expect(clientVL).toMatch(/onNivelIntrare\(\{ nivel: rms, pic, poarta, clip:/)
  })

  it('poarta half-duplex e raportată din aceeași decizie care taie trimiterea', () => {
    // `poarta` din raport = exact condiția care înlocuiește microfonul cu tăcere.
    expect(clientVL).toMatch(/const poarta = kelionAudibil\(\)/)
    expect(clientVL).toMatch(/const la16k = poarta \? new Float32Array\(ds\.length\) : ds/)
  })

  it('MicBargraf arată cele trei stări: nivel, poartă (mut) și clip', () => {
    expect(bargraf).toContain('export interface NivelIntrare')
    expect(bargraf).toMatch(/poarta/)
    expect(bargraf).toMatch(/clip/)
    // Citește prin requestAnimationFrame (nu re-randează tot chatul).
    expect(bargraf).toContain('requestAnimationFrame')
    // Doar stiluri inline — fără clasă CSS partajată (lecția coliziunii de clase).
    expect(bargraf).not.toMatch(/className=/)
  })

  it('ChatPanel leagă nivelul într-un ref și randează bargraful cât ascultă', () => {
    expect(panou).toContain("import MicBargraf, { type NivelIntrare } from './MicBargraf'")
    expect(panou).toMatch(/micNivelRef\.current = nv/) // handler-ul onNivelIntrare
    expect(panou).toMatch(/listening && <MicBargraf nivelRef=\{micNivelRef\} activ=\{listening\} \/>/)
  })
})
