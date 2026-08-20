// ── ÎNVĂȚAREA CONSTRUCTORULUI (owner, 19 aug: „kelion invata cum si cine, ce a
// aplicat ca sa rezolve") ──────────────────────────────────────────────────────
// Când constructorul termină un ordin, proveniența rezolvării — CINE (creierul),
// CE constructor (motorul), CUM (sursa free/plătit) și CE a aplicat (fișierele) —
// devine o MEMORIE pe care Kelion o reține și o recall-uiește (getMemories →
// /api/constructor/context). Nucleul e PUR + testat: din proveniența MĂSURATĂ
// (nimic inventat, regula #1) formează o singură linie de memorie, clară.

export interface ProvenientaRezolvare {
  id: number
  motor?: string | null // 'aider' (motorul)
  creier?: string | null // modelul care a rezolvat (ex. qwen2.5-coder:32b / qwen3.5:397b)
  sursa?: string | null // 'free' (constructor free-local unic — paidul a fost scos)
  fisiere?: unknown // string[] — ce a aplicat
  ordin?: string | null // fapta ordinului (prima linie)
  prUrl?: string | null
}

/** O singură linie de memorie, clară, pentru ce a învățat Kelion din rezolvare.
 *  Întoarce '' dacă nu există proveniență minimă (fără id) — nu inventează. */
export function memorieRezolvareConstructor(p: ProvenientaRezolvare): string {
  const id = Number(p?.id)
  if (!Number.isInteger(id) || id <= 0) return ''
  const motor = String(p.motor || 'Aider').trim() || 'Aider'
  const creier = String(p.creier || '').trim()
  const sursa = p.sursa === 'free' ? 'free (local pe VPS)' : ''
  const fisiere = Array.isArray(p.fisiere) ? p.fisiere.map((f) => String(f).trim()).filter(Boolean) : []
  const ordin = String(p.ordin || '').replace(/\s+/g, ' ').trim().slice(0, 160)

  const parti = [`[constructor] Ordinul #${id}${ordin ? ` „${ordin}"` : ''} REZOLVAT`]
  parti.push(`prin ${motor}${creier ? ` pe creierul ${creier}` : ''}${sursa ? ` (${sursa})` : ''}`)
  if (fisiere.length) parti.push(`— a aplicat pe: ${fisiere.slice(0, 12).join(', ')}${fisiere.length > 12 ? ` (+${fisiere.length - 12})` : ''}`)
  return parti.join(' ')
}
