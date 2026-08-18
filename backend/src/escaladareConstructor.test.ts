// ORDINUL (owner, 16 aug): „constructor unic aider… scoti tot din constructor si
// instalezi doar aider… aider va avea absolut toate instrumentele necesare pentru
// a repara si construi, real". CORECȚIA (owner, 16 aug, mai târziu): „la constructor
// NU e gemeni idiotule… e doar aider si cu openhands ca si completare… Aider pe un
// model LOCAL pe VPS (Ollama)… pe serverul linux si de acolo sa lucreze aider" +
// „sa instaleze el, pe linux, aider automat cu tot ce trebuie".
//
// Contractele NOI, încuiate pe sursă (LATEST wins — Ollama, nu Gemini):
//  • Motorul constructorului e AIDER, UNIC — agentul îl rulează.
//  • Creierul lui Aider = MODEL LOCAL pe VPS (Ollama), NU app-ul, NU Gemini —
//    ruleazaAider trece `--model ollama_chat/…` + OLLAMA_API_BASE, fără chei.
//  • Constructorul își PUNE SINGUR creierul local pe VPS dacă lipsește
//    (asiguraCreierulLocal), fără SSH.
//  • Ruta veche de creier prin app (Gemini) a fost SCOASĂ din constructor.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ruta = readFileSync(fileURLToPath(new URL('./routes/constructor.ts', import.meta.url)), 'utf8')
const agent = readFileSync(fileURLToPath(new URL('../../deploy/constructor-agent.mjs', import.meta.url)), 'utf8')

describe('constructor = Aider (motor unic) pe creier LOCAL Ollama de pe VPS', () => {
  it('agentul rulează Aider ca motor unic, pe model LOCAL Ollama (fără chei)', () => {
    expect(agent).toContain('construiesteCuAider')
    expect(agent).toContain('function ruleazaAider')
    // Modelul lui Aider = un model Ollama local (prefix LiteLLM ollama_chat/).
    expect(agent).toContain("env.CONSTRUCTOR_AIDER_MODEL || 'ollama_chat/qwen2.5-coder:32b'")
    expect(agent).toContain('OLLAMA_API_BASE')
    // NU mai trece prin app-Gemini: fără --model openai/kelion-constructor, fără
    // OPENAI_API_KEY, fără ruta openai a app-ului.
    expect(agent).not.toContain("'--model', 'openai/kelion-constructor'")
    expect(agent).not.toContain('OPENAI_API_KEY: BRIDGE')
    expect(agent).not.toContain('/api/constructor/openai/v1')
  })

  it('verificaAtelierul vede modificările COMMITUITE de aider (--auto-commits), nu doar arborele', () => {
    // BUG 16 aug (reprodus): aider face `--auto-commits`, deci `git status
    // --porcelain` e GOL după el; verificarea veche credea fals „n-ai scris nimic"
    // și pica ORICE ordin „eșuat", identic pe free ȘI pe plătit. Fixul: se uită la
    // diff-ul față de baseSha (commituri), nu doar la arborele necomituit.
    expect(agent).toContain('function verificaAtelierul(baseSha)')
    expect(agent).toContain('git diff --name-only ${baseSha} HEAD')
    expect(agent).toContain('verificaAtelierul(baseSha)') // apelul pasează baseSha
  })

  it('constructorul își instalează SINGUR creierul local pe VPS (fără SSH)', () => {
    // Owner: „sa instaleze el, pe linux, aider automat cu tot ce trebuie".
    expect(agent).toContain('function asiguraCreierulLocal')
    expect(agent).toContain('setup-ollama.sh')
    // Se cheamă ÎNAINTE de a construi; dacă nu reușește, ordinul e AMÂNABIL.
    expect(agent).toContain('if (!platit && !asiguraCreierulLocal())')
    expect(agent).toContain('amanabil: true')
  })

  it('watchdogul nu omoară cold-startul free sau sumarizarea după commit', () => {
    const praguri = /CONSTRUCTOR_SILENCE_MS \|\| \(platit \? ([0-9_]+) : ([0-9_]+)\)/.exec(agent)
    expect(praguri).toBeTruthy()
    const paidMs = Number(praguri?.[1].replaceAll('_', ''))
    const freeMs = Number(praguri?.[2].replaceAll('_', ''))
    // Probe live: free load_duration=80_647ms; paid a fost ucis fals după 90s post-commit.
    expect(freeMs).toBeGreaterThan(80_647)
    expect(paidMs).toBeGreaterThan(90_000)
    expect(agent).toContain('CONSTRUCTOR_POST_COMMIT_SILENCE_MS || 300_000')
    expect(agent).toContain('const aComis =')
  })

  it('porți roșii după free comută următoarea reparație pe fallbackul paid', () => {
    expect(agent).toContain('motivFree: `calitate ${problema.slice(0, 300)}`')
    expect(agent).toContain('CLOUD rezervă după poarta de calitate')
    expect(agent).toContain("salveazaLectie({ sig: 'escaladare_paid', cauza: 'calitate'")
  })

  it('ruta veche de creier prin app (Gemini) a FOST SCOASĂ din constructor', () => {
    // Owner: „la constructor nu e gemeni". Nici handlerul, nici ușile lui.
    expect(ruta).not.toContain('const creierHandler')
    expect(ruta).not.toContain("app.post('/api/constructor/creier'")
    expect(ruta).not.toContain("app.post('/api/constructor/openai/v1/chat/completions'")
    // Puntea de formate (creier2Constructor) a fost ștearsă odată cu ruta.
    expect(ruta).not.toContain('creier2Constructor')
    expect(ruta).not.toContain('uneltePentruCreier2')
  })

  it('FABLE 5 a ieșit TOTAL din constructor (owner, 16 aug)', () => {
    // Cod: nicio funcție Fable, niciun apel direct Anthropic, niciun comutator.
    expect(/fable5Disponibil|fable5Chat|fable5Constructor|fable5Valida/.test(ruta)).toBe(false)
    expect(/claude-fable-5|api\.anthropic\.com/.test(ruta)).toBe(false)
    expect(/forta.?fable/i.test(ruta)).toBe(false)
    // Agentul: niciun identificator Fable în cod (motorul e Aider pe Ollama local).
    expect(/fable5|fable5Chat|claude-fable-5/i.test(agent)).toBe(false)
  })
})
