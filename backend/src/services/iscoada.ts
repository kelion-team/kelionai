import { config } from '../config.js'
import { addMemory, memorieIa } from '../db.js'
import { webSearch } from './google.js'
import { rationeazaMesajeSigur } from './creierRationament.js'
import { autonomActiv } from './autonomActiv.js'
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

/** Temele patrulei, în ordinea de încredere: (1) ce a scris OWNERUL în admin
 *  (memorie_proiect, cheia 'iscoada-teme' — formular pe pagina agenților,
 *  4 aug: „iscoadele pe temele tale"), (2) env ISCOADA_TEME, (3) temele casei. */
export async function temeIscoada(): Promise<string[]> {
  const dinAdmin = await memorieIa('iscoada-teme')
  const continut = dinAdmin.startsWith('[') ? dinAdmin.replace(/^\[[^\]]*\]\s*/, '') : ''
  const alese = (continut || process.env.ISCOADA_TEME || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
  return alese.length > 0 ? alese.slice(0, 10) : TEME_IMPLICITE
}

/** Un singur ocol: caută temele, cerne noutățile, le pune în memorie.
 *  Exportat pentru teste și pentru o chemare manuală la nevoie. */
export async function unOcolIscoada(): Promise<{ teme: number; salvate: number }> {
  if (!config.serperKey || !config.geminiKey) return { teme: 0, salvate: 0 }
  const teme = await temeIscoada()
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
    const text = await rationeazaMesajeSigur(mesaje, {
      ruta: 'service.iscoada',
      maxTokens: 512,
      temperature: 0.2,
      reasoning: 'low',
      treapta: 'rapid',
      tools: [],
    })
    if (!text || /^NIMIC\b/i.test(text)) continue
    const zi = new Date().toISOString().slice(0, 10)
    // Namespace 'kelion' (10 aug): recallMemories citește DOAR agent='kelion'
    // (chat.ts). Scris pe 'iscoada', ce aduna patrula cadea intr-un sertar pe
    // care creierul nu-l deschidea niciodata — scriere-oarba. Acum ajunge in
    // aceeasi memorie pe care Kelion o cauta la fiecare conversatie.
    await addMemory(config.adminEmail, `[iscoada ${zi}] ${tema}: ${text}`.slice(0, 2000), 'kelion')
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
  // OFF BY DEFAULT (9 aug): fără comutatorul autonom pornit, patrula nu cheltuie
  // niciun token (nici Serper, nici Gemini) — timerul bate, tura e no-op.
  const ocol = async (): Promise<void> => {
    if (!(await autonomActiv())) return
    await unOcolIscoada().catch(() => {})
  }
  setTimeout(() => {
    void ocol()
    setInterval(() => {
      void ocol()
    }, minute * 60_000)
  }, 5 * 60_000)
}
