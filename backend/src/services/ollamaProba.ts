// ── PROBA OLLAMA — creierul LOCAL al constructorului, verificat pe VPS (owner,
// 16 aug: „aider pe un model LOCAL pe VPS (Ollama)… verifică dacă nu e deja pus
// pe serverul linux"). Nu ghicim dacă Ollama e pe server — rulăm CHIAR
// `ollama list` pe gazdă și raportăm ce e instalat (modelele) sau eroarea reală
// (binar absent / serviciu oprit). Așa Kelion verifică singur serverul și-i
// spune ownerului în panou, măsurat — nu „cred că e/ nu e". Cache 10 min, ca la
// proba browserului/Aider. Ollama e creierul independent (fără cheie, fără cotă,
// fără bani): dacă e VIU cu un model de cod, Aider construiește pe el.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const PROBA_MS = 10 * 60_000
let cache: { la: number; ok: boolean; modele: string[]; motiv: string } | null = null

export async function probaOllama(): Promise<{ ok: boolean; modele: string[]; motiv: string }> {
  if (cache && Date.now() - cache.la < PROBA_MS) return cache
  try {
    // `ollama list` iese 0 și listează modelele instalate dacă serviciul rulează.
    const r = await exec('ollama', ['list'], { timeout: 15_000 })
    const linii = String(r.stdout || '').trim().split('\n').slice(1) // prima linie = antet
    const modele = linii.map((l) => l.trim().split(/\s+/)[0]).filter((m) => m && m !== 'NAME')
    cache = { la: Date.now(), ok: true, modele, motiv: '' }
  } catch (e) {
    cache = { la: Date.now(), ok: false, modele: [], motiv: String((e as Error)?.message ?? e).slice(0, 200) }
  }
  return cache
}

/** Testele nu moștenesc cache-ul unui alt test (proba are memorie 10 min). */
export function _resetProbaOllama(): void {
  cache = null
}
