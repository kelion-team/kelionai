import { config } from '../config.js'
import { addMemory } from '../db.js'
import { webSearch } from './google.js'
import { geminiDirectChat } from './geminiDirect.js'
import type { OrMessage } from './brainContract.js'

// ── ISCOADELE LUI KELION (Adrian, 4 aug: „boti care bat netul 24 din 24 si
// aduc informati lui kelion") ────────────────────────────────────────────────
//
// O patrulă care nu doarme: la fiecare ISCOADA_MIN minute (implicit 360 = 6h;
// „24 din 24" înseamnă mereu pe drum, nu mereu în alergare — cota Serper și
// creditul Gemini sunt bani reali, iar un ocol prea des i-ar arde degeaba),
// pentru fiecare temă din ISCOADA_TEME (env, listă prin virgulă; implicit
// temele casei de mai jos) face o căutare Serper reală, pune creierul să
// aleagă DOAR ce e nou și important (altfel „NIMIC" — nu umplem memoria cu
// zgomot) și salvează concluzia în memoria lui Kelion (addMemory, agent
// 'iscoada'), cu data și linkurile. Kelion o găsește la următoarea conversație
// prin căutarea lui obișnuită în memorie.
//
// Contract de eșec, onest: fără chei (Serper/Gemini) patrula stă acasă; o
// căutare picată sare tema (search_unavailable), nu inventează; orice eroare
// e prinsă — patrula nu poate dărâma serverul.

const TEME_IMPLICITE = [
  'noutati Gemini API si Gemini Enterprise',
  'noutati agenti AI si protocolul A2A',
  'stiri importante tehnologie azi',
]

/** Un singur ocol: caută temele, cerne noutățile, le pune în memorie.
 *  Exportat pentru teste și pentru o chemare manuală la nevoie. */
export async function unOcolIscoada(): Promise<{ teme: number; salvate: number }> {
  if (!config.serperKey || !config.geminiKey) return { teme: 0, salvate: 0 }
  const dinEnv = (process.env.ISCOADA_TEME ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
  const teme = dinEnv.length > 0 ? dinEnv : TEME_IMPLICITE
  let salvate = 0
  for (const tema of teme) {
    const brut = await webSearch(tema, 5)
    if (brut.includes('search_unavailable') || brut.includes('empty_query')) continue
    const mesaje: OrMessage[] = [
      {
        role: 'system',
        content:
          'Ești iscoada lui Kelion. Primești rezultate de căutare (fapte cu linkuri). ' +
          'Scrie 1-3 propoziții scurte DOAR cu ce e nou și important, cu linkul sursei. ' +
          'Dacă nu e nimic nou sau important, răspunde exact: NIMIC.',
      },
      { role: 'user', content: `Tema: ${tema}\nRezultate:\n${brut.slice(0, 6000)}` },
    ]
    let text = ''
    try {
      const r = await geminiDirectChat(config.geminiModel, mesaje, [], { maxTokens: 512, temperature: 0.2, reasoning: 'low' })
      text = r.text.trim()
    } catch {
      continue // creierul n-a răspuns la tema asta — ocolul merge mai departe
    }
    if (!text || /^NIMIC\b/i.test(text)) continue
    const zi = new Date().toISOString().slice(0, 10)
    await addMemory(config.adminEmail, `[iscoada ${zi}] ${tema}: ${text}`.slice(0, 2000), 'iscoada')
    salvate += 1
  }
  return { teme: teme.length, salvate }
}

let pornit = false

/** Pornește patrula (o singură dată per proces): primul ocol la 5 minute după
 *  boot (serverul respiră întâi), apoi la fiecare ISCOADA_MIN minute (min 60). */
export function pornesteIscoadele(): void {
  if (pornit) return
  pornit = true
  const minute = Math.max(60, Number(process.env.ISCOADA_MIN) || 360)
  setTimeout(() => {
    void unOcolIscoada().catch(() => {})
    setInterval(() => {
      void unOcolIscoada().catch(() => {})
    }, minute * 60_000)
  }, 5 * 60_000)
}
