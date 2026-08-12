// ── VERIFICAREA ÎNTREGII APLICAȚII PRIN CHAT — TABELUL CU TOATE SKILL-URILE ───
//
// Adrian, 12 aug: „dacă voiai, concepeai o listă la toate funcționalitățile,
// skill-urile, într-un tabel și te apucai să le rulezi în chatul live și vedeai
// ce merge și ce nu merge… asta ar pune în evidență tot, și exact asta nu vrei
// să se vadă."
//
// Se vede tot. Aici e tabelul peste REGISTRUL REAL de skill-uri (uneltele pe
// care le are chatul: SHARED_ADMIN_TOOLS ∪ USER_SCOPED_TOOLS ∪ browser). Pentru
// FIECARE:
//   • skill de CITIRE (fără efect) → îl RULEZ live prin dispecerul chatului și
//     scriu „merge / nu merge", cu motivul măsurat;
//   • skill cu EFECT REAL (scrie cod, pune secret, taxează card, trimite email,
//     generează) → apare în tabel marcat „efect real — neexecutat pe prod": la
//     VEDERE, dar nu-l declanșez ca test (efectul ar fi real). NIMIC ascuns.
// În plus, o baterie reprezentativă trece PRIN CREIER (nu doar dispecer), ca să
// măsor și că routing-ul chatului ajunge la unealtă. Ce pică → simptom → self-heal.

import { brainCompleteWithTools } from './brain.js'
import { uneltele, UNELTELE_MAINILOR, plafonConstructor } from './autonomie.js'
import { recordSimptomLive, saveKv } from '../db.js'
import { autonomActiv } from './autonomActiv.js'
import { isOpsPaused } from './runbooks.js'
import { SHARED_ADMIN_TOOLS, USER_SCOPED_TOOLS } from './adminTools.js'
import type { AnthropicTool } from './brainContract.js'

// Skill-uri de CITIRE PURĂ, cu argumente benigne — le pot rula live fără efect.
// (Orice atinge extern / costă / modifică e scos dinadins și tratat ca efect real.)
const ARG_IMPLICIT: Record<string, Record<string, unknown>> = {
  system_health: {},
  db_tables: {},
  stare_masurata: {},
  jurnal_masuratori: { cate: 20 },
  secret_lista: {},
  cerinte_lista: {},
  memorie_lista: { prefix: '' },
  read_source: { path: 'backend/src/index.ts', from_line: 1 },
  search_source: { query: 'recordSimptomLive' },
  list_source: { dir: 'backend/src/services' },
  server_logs: { errorsOnly: false },
  get_real_cost: {},
  list_updates: {},
}
const SAFE_INVOKE = new Set(Object.keys(ARG_IMPLICIT))

// Uneltele browserului — au efect (navighează), deci în tabel apar ca efect real.
const BROWSER_NUME = [
  'browser_open', 'browser_click', 'browser_type', 'browser_read', 'browser_back',
  'browser_scroll', 'browser_key', 'browser_click_at', 'browser_close',
]

// Bateria reprezentativă care trece PRIN CREIER (routing-ul chatului).
interface Comanda { nume: string; comanda: string; asteapta: string[] }
const BATERIE: Comanda[] = [
  { nume: 'sănătate', comanda: 'Verifică-ți starea sistemului (system_health) și spune pe scurt.', asteapta: ['system_health'] },
  { nume: 'cod-sursă', comanda: 'Caută în codul tău sursă unde e definită recordSimptomLive și citește câteva rânduri.', asteapta: ['search_source', 'read_source', 'list_source'] },
  { nume: 'memorie', comanda: 'Listează ce ai în memorie (memorie_lista).', asteapta: ['memorie_lista', 'list_memories'] },
  { nume: 'loguri', comanda: 'Citește ultimele erori din logurile serverului (server_logs).', asteapta: ['server_logs', 'runbook_log'] },
]
const UNELTE_CITIRE = (UNELTELE_MAINILOR as unknown as Array<{ name?: string }>).filter(
  (t) => SAFE_INVOKE.has(String(t.name ?? '')),
) as unknown as AnthropicTool[]

interface RandTabel {
  skill: string
  tip: 'citire' | 'efect-real'
  status: 'merge' | 'nu merge' | 'cablat'
  motiv: string
}

export interface RaportVerificare {
  la: string
  tabel: RandTabel[]
  rezumat: { totalSkill: number; merg: number; nuMerg: number; efectReal: number }
  prinChat: { pass: number; total: number }
}

function pare_eroare(out: string): boolean {
  return /"error"|\beroare\b|\berror\b|not found|nesuportat|necunoscut/i.test(out.slice(0, 240))
}

/** O trecere: tabelul complet peste registru + bateria prin creier. */
export async function verificareIntegrala(): Promise<RaportVerificare | null> {
  const la = new Date().toISOString()
  if (!(await autonomActiv().catch(() => false)) || (await isOpsPaused().catch(() => false))) return null
  const pl = await plafonConstructor().catch(() => ({ activ: false, plafon: 0, cheltuit: 0 }))
  if (pl.activ && pl.cheltuit >= pl.plafon) return null

  // ── 1. TABELUL COMPLET peste TOT registrul de skill-uri ────────────────────
  const toate = [...new Set([...SHARED_ADMIN_TOOLS, ...USER_SCOPED_TOOLS, ...BROWSER_NUME])].sort()
  const tabel: RandTabel[] = []
  for (const skill of toate) {
    if (SAFE_INVOKE.has(skill)) {
      const out = await uneltele(skill, ARG_IMPLICIT[skill]).catch((e: Error) => JSON.stringify({ error: e.message }))
      const ok = !pare_eroare(out)
      tabel.push({ skill, tip: 'citire', status: ok ? 'merge' : 'nu merge', motiv: ok ? 'răspuns ok' : out.slice(0, 120) })
      if (!ok) await recordSimptomLive('verificare-picata', `skill „${skill}" nu merge: ${out.slice(0, 120)}`).catch(() => {})
    } else {
      tabel.push({ skill, tip: 'efect-real', status: 'cablat', motiv: 'efect real — la vedere, neexecutat pe prod' })
    }
  }

  // ── 2. BATERIA PRIN CREIER (routing-ul chatului ajunge la unealtă?) ────────
  let pass = 0
  for (const c of BATERIE) {
    const chemate: Array<{ name: string; ok: boolean }> = []
    const exec = async (name: string, args: Record<string, unknown>): Promise<string> => {
      if (!SAFE_INVOKE.has(name)) return JSON.stringify({ error: 'unealtă blocată în verificare (doar citire)' })
      const out = await uneltele(name, args).catch((e: Error) => JSON.stringify({ error: e.message }))
      chemate.push({ name, ok: !pare_eroare(out) })
      return out
    }
    const text = await brainCompleteWithTools(c.comanda, UNELTE_CITIRE, exec, { maxRounds: 3, maxTokens: 800 }).catch(() => '')
    const potrivit = chemate.find((x) => c.asteapta.includes(x.name))
    const okChat = !!potrivit && potrivit.ok
    if (okChat) pass += 1
    else {
      const motiv = potrivit ? `${potrivit.name} a întors eroare` : chemate.length ? `a chemat ${chemate.map((x) => x.name).join(', ')}` : text ? 'doar text, nicio unealtă' : 'chatul n-a răspuns'
      await recordSimptomLive('verificare-picata', `prin chat „${c.nume}": ${motiv} — comanda: ${c.comanda.slice(0, 80)}`).catch(() => {})
    }
  }

  const rezumat = {
    totalSkill: tabel.length,
    merg: tabel.filter((r) => r.status === 'merge').length,
    nuMerg: tabel.filter((r) => r.status === 'nu merge').length,
    efectReal: tabel.filter((r) => r.status === 'cablat').length,
  }
  const raport: RaportVerificare = { la, tabel, rezumat, prinChat: { pass, total: BATERIE.length } }
  await saveKv('verificare:integrala', JSON.stringify(raport)).catch(() => {})
  return raport
}

/** Tabelul măsurat, gata de citit în chat. ✅ merge · ❌ nu merge · • efect-real. */
export function formateazaRaport(r: RaportVerificare): string {
  const simbol = (s: RandTabel['status']): string => (s === 'merge' ? '✅' : s === 'nu merge' ? '❌' : '•')
  const linii = r.tabel.map((x) => `${simbol(x.status)} ${x.skill} [${x.tip}] — ${x.motiv}`)
  return (
    `VERIFICARE INTEGRALĂ — ${r.la}\n` +
    `Rezumat: ${r.rezumat.merg} MERG / ${r.rezumat.nuMerg} NU MERG / ${r.rezumat.efectReal} efect-real (neexecutate), ` +
    `din ${r.rezumat.totalSkill} skill-uri. Prin creier (routing): ${r.prinChat.pass}/${r.prinChat.total}.\n\n` +
    linii.join('\n')
  )
}
