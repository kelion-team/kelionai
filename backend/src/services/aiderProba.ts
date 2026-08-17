// ── PROBA AIDER — DOVADA VIE că motorul constructorului există (owner, 16 aug:
// „doar denumit nu e suficient trebuie verificat real ca e aider… cu dovada").
// Nu e destul să scrie „Aider" în UI — panoul trebuie să arate starea MĂSURATĂ:
// rulăm CHIAR `aider --version` pe gazdă și raportăm versiunea reală (VIU) sau
// eroarea reală (LIPSĂ). Același tipar ca proba browserului: cache 10 minute
// (rularea costă ~1s), iar eșecul păstrează cauza reală (binar absent), nu un
// „nu merge" generic. Motorul e instalat în imagine (Dockerfile: pip install
// aider-chat); dacă lipsește, constructorul cade pe fallback și becul o spune.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const PROBA_MS = 10 * 60_000
let cache: { la: number; ok: boolean; versiune: string; motiv: string } | null = null

export async function probaAider(): Promise<{ ok: boolean; versiune: string; motiv: string }> {
  if (cache && Date.now() - cache.la < PROBA_MS) return cache
  try {
    const r = await exec('aider', ['--version'], { timeout: 20_000 })
    // aider scrie versiunea pe stdout („aider 0.x.y"); o luăm ca dovadă vie.
    const versiune = String(r.stdout || r.stderr || '').trim().split('\n')[0].slice(0, 80)
    cache = { la: Date.now(), ok: versiune.length > 0, versiune, motiv: '' }
  } catch (e) {
    cache = { la: Date.now(), ok: false, versiune: '', motiv: String((e as Error)?.message ?? e).slice(0, 200) }
  }
  return cache
}

/** Testele nu moștenesc cache-ul unui alt test (proba are memorie 10 min). */
export function _resetProbaAider(): void {
  cache = null
}
