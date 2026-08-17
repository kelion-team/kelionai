import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// ── CREIERUL LOCAL AL CONSTRUCTORULUI (owner, 16 aug: „Aider pe un model LOCAL pe
// VPS (Ollama)… sa instaleze el, pe linux, aider automat cu tot ce trebuie"). ───
// `creierLocalLipseste` e decizia PURĂ din spatele auto-instalării: din ieșirea
// lui `ollama list` + numele modelului cerut spune dacă modelul mai trebuie tras.
// Cu tag explicit (nume:tag) cere potrivire EXACTĂ; fără tag, acceptă orice tag pe
// aceeași bază (Ollama trage ':latest'). O greșeală aici = ori reinstalează la
// nesfârșit, ori crede că are creier când n-are — de-aia o probăm real.
//
// Ca la pasExplorare/potrivesteEdit: modulul VPS e ESM în afara rădăcinii backend,
// îl exersăm printr-un subproces node care-l importă nativ și răspunde JSON.

const MJS = fileURLToPath(new URL('../../deploy/constructor-agent.mjs', import.meta.url))

function lipseste(ollamaListOutput: string, modelCerut: string): boolean {
  const script = `
    const m = await import(${JSON.stringify('file:///' + MJS.replace(/\\/g, '/'))});
    console.log(JSON.stringify(m.creierLocalLipseste(${JSON.stringify(ollamaListOutput)}, ${JSON.stringify(modelCerut)})));
  `
  const stdout = execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 30000 })
  return JSON.parse(stdout.trim()) as boolean
}

const LISTA = 'NAME              ID   SIZE   MODIFIED\nqwen2.5-coder:7b  abc  4.7 GB 2 days ago\nllama3.2:latest   def  2.0 GB 1 week ago\n'

describe('creierLocalLipseste — decizia auto-instalării creierului local', () => {
  it('modelul cerut (cu tag) e prezent → NU lipsește', () => {
    expect(lipseste(LISTA, 'qwen2.5-coder:7b')).toBe(false)
    // prefixul LiteLLM (ollama_chat/) e ignorat — e același model
    expect(lipseste(LISTA, 'ollama_chat/qwen2.5-coder:7b')).toBe(false)
  })

  it('alt tag al aceluiași model → LIPSEȘTE (potrivire exactă pe tag explicit)', () => {
    expect(lipseste(LISTA, 'qwen2.5-coder:14b')).toBe(true)
  })

  it('model cerut FĂRĂ tag → acceptă orice tag pe aceeași bază', () => {
    expect(lipseste(LISTA, 'llama3.2')).toBe(false) // llama3.2:latest e prezent
    expect(lipseste(LISTA, 'ollama_chat/llama3.2')).toBe(false)
    expect(lipseste(LISTA, 'mistral')).toBe(true) // nicio bază mistral
  })

  it('lista goală / doar antet / gunoi → LIPSEȘTE (nu inventăm că e acolo)', () => {
    expect(lipseste('', 'qwen2.5-coder:7b')).toBe(true)
    expect(lipseste('NAME  ID  SIZE  MODIFIED\n', 'qwen2.5-coder:7b')).toBe(true)
  })

  it('model cerut gol → LIPSEȘTE (nu putem confirma nimic)', () => {
    expect(lipseste(LISTA, '')).toBe(true)
  })
})
