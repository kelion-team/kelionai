// ── VERIFICAREA ÎNTREGII APLICAȚII PRIN CHAT, CU COMENZI MĂSURABILE ───────────
//
// Adrian, 12 aug: „nu doresc să exersez chatul live, doresc să verifici TOATĂ
// aplicația prin comenzi măsurabile PRIN chatul live" · „din 10 cereri câte
// ajung la constructor? câte vor fi pass? câte sunt analizate?".
//
// Chatul e CANALUL, nu subiectul. Aici trimit COMENZI reale prin exact creierul
// + uneltele pe care le folosește chatul (brainCompleteWithTools + dispecerul
// `uneltele`, ca admin) și MĂSOR, comandă cu comandă: ce unealtă a chemat și
// dacă a întors rezultat. Iese un raport „X din N pass" — numărul cerut, nu o
// vorbă. Fiecare comandă picată → simptom la care self-heal ajunge.
//
// SIGURANȚĂ: verificarea primește DOAR unelte de CITIRE (nu poate scrie cod, nu
// poate pune secrete, nu poate atinge browserul) — măsoară, nu modifică.

import { brainCompleteWithTools } from './brain.js'
import { uneltele, UNELTELE_MAINILOR, plafonConstructor } from './autonomie.js'
import { recordSimptomLive, saveKv } from '../db.js'
import { autonomActiv } from './autonomActiv.js'
import { isOpsPaused } from './runbooks.js'
import type { AnthropicTool } from './brainContract.js'

// Uneltele pe care verificarea are voie să le cheme — TOATE de citire pură.
// db_query e scos dinadins (SQL construit de creier ar putea, teoretic, muta).
const NUME_CITIRE = new Set<string>([
  'system_health', 'read_source', 'search_source', 'list_source',
  'list_memories', 'server_logs', 'runbook_log',
  'db_tables', 'get_real_cost', 'list_updates',
])

// Definițiile de unealtă filtrate la subsetul de citire (name e la nivel de sus).
const UNELTE_CITIRE = (UNELTELE_MAINILOR as unknown as Array<{ name?: string }>).filter(
  (t) => NUME_CITIRE.has(String(t.name ?? '')),
) as unknown as AnthropicTool[]

interface Comanda {
  nume: string
  comanda: string
  /** Trece dacă a chemat ORICARE dintre uneltele astea și a întors rezultat. */
  asteapta: string[]
}

// Bateria — fiecare comandă e cum ar scrie omul în chat, cu un rezultat MĂSURABIL
// (o anume capabilitate a aplicației, exersată cap-coadă prin creier).
const BATERIE: Comanda[] = [
  { nume: 'sănătate', comanda: 'Verifică-ți starea sistemului (system_health) și spune pe scurt ce ai găsit.', asteapta: ['system_health'] },
  { nume: 'cod-sursă', comanda: 'Caută în propriul cod sursă unde e definită funcția recordSimptomLive și citește câteva rânduri.', asteapta: ['search_source', 'read_source', 'list_source'] },
  { nume: 'memorie', comanda: 'Listează ce ai în memorie despre owner (list_memories).', asteapta: ['list_memories'] },
  { nume: 'loguri', comanda: 'Citește ultimele erori din logurile serverului (server_logs).', asteapta: ['server_logs', 'runbook_log'] },
  { nume: 'schema-bd', comanda: 'Listează tabelele bazei de date (db_tables) și spune câte sunt.', asteapta: ['db_tables'] },
  { nume: 'cost', comanda: 'Care e costul real de azi? Folosește get_real_cost.', asteapta: ['get_real_cost'] },
  { nume: 'noutăți', comanda: 'Ce actualizări/noutăți ai de raportat? Folosește list_updates.', asteapta: ['list_updates'] },
]

export interface RaportVerificare {
  la: string
  total: number
  pass: number
  detalii: Array<{ nume: string; pass: boolean; motiv: string }>
}

/** O trecere a verificării integrale. Întoarce raportul măsurat (sau null dacă
 *  e sărită — autonomie oprită / plafon atins). */
export async function verificareIntegrala(): Promise<RaportVerificare | null> {
  const la = new Date().toISOString()
  if (!(await autonomActiv().catch(() => false)) || (await isOpsPaused().catch(() => false))) return null
  const pl = await plafonConstructor().catch(() => ({ activ: false, plafon: 0, cheltuit: 0 }))
  if (pl.activ && pl.cheltuit >= pl.plafon) return null

  const detalii: RaportVerificare['detalii'] = []
  for (const c of BATERIE) {
    const chemate: Array<{ name: string; ok: boolean }> = []
    // Dispecer înfășurat: MĂSOARĂ fiecare chemare și BLOCHEAZĂ orice nu e citire.
    const exec = async (name: string, args: Record<string, unknown>): Promise<string> => {
      if (!NUME_CITIRE.has(name)) return JSON.stringify({ error: 'unealtă blocată în verificare (doar citire)' })
      const out = await uneltele(name, args).catch((e: Error) => JSON.stringify({ error: e.message }))
      chemate.push({ name, ok: !/error|eroare|"error"/i.test(out.slice(0, 200)) })
      return out
    }
    const text = await brainCompleteWithTools(c.comanda, UNELTE_CITIRE, exec, { maxRounds: 3, maxTokens: 800 }).catch(() => '')

    const potrivit = chemate.find((x) => c.asteapta.includes(x.name))
    const pass = !!potrivit && potrivit.ok
    const motiv = pass
      ? `${potrivit!.name} a răspuns ok`
      : potrivit
        ? `${potrivit.name} a întors eroare`
        : chemate.length
          ? `a chemat ${chemate.map((x) => x.name).join(', ')} în loc de ${c.asteapta.join('/')}`
          : text
            ? 'n-a chemat nicio unealtă (doar text)'
            : 'chatul n-a răspuns deloc'
    detalii.push({ nume: c.nume, pass, motiv })
    if (!pass) {
      await recordSimptomLive('verificare-picata', `verificare integrală „${c.nume}": ${motiv} — comanda: ${c.comanda.slice(0, 90)}`).catch(() => {})
    }
  }

  const pass = detalii.filter((d) => d.pass).length
  const raport: RaportVerificare = { la, total: BATERIE.length, pass, detalii }
  await saveKv('verificare:integrala', JSON.stringify(raport)).catch(() => {})
  return raport
}
