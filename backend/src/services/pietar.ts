import { config } from '../config.js'
import { addMemory, memorieIa } from '../db.js'
import { dateSimbol, rezumatPentruAgent } from './piete.js'
import { geminiDirectChat } from './geminiDirect.js'
import { autonomActiv } from './autonomActiv.js'
import type { OrMessage } from './brainContract.js'

// ── PIETARUL: PATRULA PIEȚELOR 24/24 (Adrian, 4 aug: „el învață din realitate
// 24 din 24, din datele agenților bursieri... agenți pe toate piețele") ───────
//
// Ca iscoadele, dar pentru piețe: la fiecare PIETE_MIN minute (implicit 60,
// minim 15 — apelurile la creier costă bani reali), pentru fiecare simbol din
// lista de veghe (cheia 'piete-simboluri' din memorie_proiect, altfel lista
// casei: crypto + acțiuni + indici + valute + aur) ia datele REALE (piete.ts)
// și pune creierul să scrie O observație scurtă de trader (regim, nivel-cheie,
// schimbare notabilă) — salvată în memoria lui Kelion (agent 'tranzactii'),
// cu prețul și ora ei. AȘA învață din realitate non-stop: analizele de pe
// panou îi dau memoria asta înapoi și el își judecă apelurile pe fapte.
//
// Onest: patrula OBSERVĂ și ÎNVAȚĂ — nu tranzacționează (niciun broker legat).

const VEGHE_IMPLICITA = ['BTCUSDT', 'ETHUSDT', 'AAPL.US', 'NVDA.US', '^SPX', '^DAX', 'EURUSD', 'GC.F']

/** Lista de veghe: a ownerului (memorie_proiect 'piete-simboluri') sau a casei. */
export async function simboluriVeghe(): Promise<string[]> {
  const din = await memorieIa('piete-simboluri')
  const continut = din.startsWith('[') ? din.replace(/^\[[^\]]*\]\s*/, '') : ''
  const alese = continut
    .split(',')
    .map((t) => t.trim().toUpperCase())
    .filter(Boolean)
  return alese.length > 0 ? alese.slice(0, 12) : VEGHE_IMPLICITA
}

/** Un ocol de piață: citește fiecare simbol, scrie observația în memorie. */
export async function unOcolPietar(): Promise<{ simboluri: number; observatii: number }> {
  if (!config.geminiKey) return { simboluri: 0, observatii: 0 }
  const simboluri = await simboluriVeghe()
  let observatii = 0
  for (const s of simboluri) {
    const d = await dateSimbol(s, '1h')
    if ('error' in d) continue // piață necitibilă acum — ocolul merge mai departe
    const mesaje: OrMessage[] = [
      {
        role: 'system',
        content:
          'Ești ochiul de piață al lui Kelion. Primești date reale și scrii O SINGURĂ observație de trader, ' +
          '2-3 propoziții: regimul (trend/range), nivelul-cheie de acum și ce s-a schimbat notabil. ' +
          'Doar din cifre, fără preziceri sigure. Dacă nimic notabil, răspunde exact: NIMIC.',
      },
      { role: 'user', content: rezumatPentruAgent(d) },
    ]
    let text = ''
    try {
      const r = await geminiDirectChat(config.geminiModel, mesaje, [], { maxTokens: 384, temperature: 0.3, reasoning: 'low' })
      text = r.text.trim()
    } catch {
      continue
    }
    if (!text || /^NIMIC\b/i.test(text)) continue
    const zi = new Date().toISOString().slice(0, 16).replace('T', ' ')
    await addMemory(config.adminEmail, `[tranzactii ${zi}] ${d.simbol} [pret ${d.pret}, veghe]: ${text}`.slice(0, 1200), 'tranzactii')
    observatii += 1
  }
  return { simboluri: simboluri.length, observatii }
}

let pornit = false

/** Pornește pietarul (o dată per proces): primul ocol la 10 minute după boot,
 *  apoi la fiecare PIETE_MIN minute (minim 15). */
export function pornestePietarul(): void {
  if (pornit) return
  pornit = true
  const minute = Math.max(15, Number(process.env.PIETE_MIN) || 60)
  // OFF BY DEFAULT (9 aug): fără comutatorul autonom pornit, ocolul nu cheltuie
  // niciun token — doar o citire KV. Timerul bate, dar tura e no-op până când
  // ownerul pornește autonomia „când trebuie".
  const ocol = async (): Promise<void> => {
    if (!(await autonomActiv())) return
    await unOcolPietar().catch(() => {})
  }
  setTimeout(() => {
    void ocol()
    setInterval(() => {
      void ocol()
    }, minute * 60_000)
  }, 10 * 60_000)
}
