import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// owner, 19 aug: „in raportul pr, trebuie sa apara clar ce creier si ce constructor
// a rezolvat". `raportCreierConstructor` e PUR — îl exersăm real prin subproces node
// care importă modulul VPS (ESM, în afara rădăcinii backend), ca celelalte teste.
const MJS = fileURLToPath(new URL('../../deploy/constructor-agent.mjs', import.meta.url))

function raport(info: Record<string, unknown>): string {
  const script = `
    const m = await import(${JSON.stringify('file:///' + MJS.replace(/\\/g, '/'))});
    console.log(JSON.stringify(m.raportCreierConstructor(${JSON.stringify(info)})));
  `
  const stdout = execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 30000 })
  return JSON.parse(stdout.trim())
}

describe('raportCreierConstructor — cine + ce constructor a rezolvat (PR clar)', () => {
  it('free local: motor Aider + creier free + fișierele aplicate', () => {
    const r = raport({ sursaFinal: 'free', creierModel: 'qwen2.5-coder:32b', modelFree: 'qwen2.5-coder:32b', fisiere: ['backend/src/db.ts'] })
    expect(r).toContain('Constructor (motor): Aider')
    expect(r).toContain('qwen2.5-coder:32b')
    expect(r).toContain('FREE (local pe VPS')
    expect(r).toContain('Ce a aplicat (1 fișiere): backend/src/db.ts')
    expect(r).not.toContain('escaladat') // n-a escaladat
  })

  // (Cazul „plătit după escaladare" a fost SCOS — Ollama Cloud a ieșit, owner 20
  // aug: „rămân doar cu Linux și Gemini Live". Constructorul rulează DOAR free local.)

  it('fără fișiere → fără linia „ce a aplicat"; creier necunoscut e onest', () => {
    const r = raport({ sursaFinal: 'free', creierModel: '', fisiere: [] })
    expect(r).toContain('(necunoscut)')
    expect(r).not.toContain('Ce a aplicat')
  })
})
