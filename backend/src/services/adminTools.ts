// ── SINGLE SOURCE of the EXECUTION of the SHARED admin tools (audit Jul 29,
// risk #4) ───────────────────────────────────────────────────────────────────
// These tools' dispatch was copied identically in chat.ts (runTool) and in
// realtime.ts (execIntrospection) → the two could silently diverge. Here is a
// SINGLE implementation, called by both routes.
//
// Only tools with IDENTICAL behavior on both paths. Those with route-specific
// effects stay in their route: build_software (chat opens the control panel on
// the monitor; voice answers with speak_rule), constructor_status (different
// formatting), server_logs / read_inbox / list_updates (chat only).
//
// The admin gate is the verified Google session carried by the caller. Voice
// and face signals are never authorization factors.

import { memoriePune, memorieIa, memorieLista } from '../db.js'
import { systemHealth } from './health.js'
import { resurseGazda } from './resurse.js'
import { adaugaCerinta, listeazaCerinte, actualizeazaCerinta } from '../db.js'
import { notifyAdmin } from './adminNotification.js'
import { readConstructorMonitor } from './constructorMonitor.js'
import { esteAdminKelion } from './adminIdentity.js'

// The names of the shared admin tools (chat ∩ voice). The caller checks
// membership to know whether to delegate here or handle it itself
// (build_software, google, browser...).
export const SHARED_ADMIN_TOOLS: ReadonlySet<string> = new Set([
  'system_health',
  'cerinta_noua', 'cerinte_lista', 'cerinta_prioritate',
  // HIS OWN WISHLIST, granted (Aug 2, „implementează-i ce cere"): persistent
  // project memory + full observability of his own state, as tools.
  'memorie_pune', 'memorie_ia', 'memorie_lista', 'stare_masurata',
])

// Executes a SHARED admin tool. Returns the result (string) or `null` if the
// name is NOT a shared tool — then the caller handles it itself. The argument
// extraction is IDENTICAL to the one that lived duplicated in the two routes.
export async function execSharedAdminTool(
  name: string,
  args: Record<string, unknown>,
  // The actual authenticated session remains the only authority.
  ctx: { email?: string; baseUrl?: string; cookie?: string } = {},
): Promise<string | null> {
  if (!SHARED_ADMIN_TOOLS.has(name)) return null
  if (!ctx.email || !esteAdminKelion(ctx.email)) {
    return JSON.stringify({ error: 'admin_only' })
  }
  switch (name) {
    case 'system_health': return systemHealth()
    // KELION'S PROJECT MEMORY (his own request, Aug 2): keyed, persistent,
    // queryable — survives every deploy, unlike the conversation window.
    case 'memorie_pune': return memoriePune(String(args.cheie ?? ''), String(args.continut ?? ''))
    case 'memorie_ia': return memorieIa(String(args.cheie ?? ''))
    case 'memorie_lista': return memorieLista(String(args.prefix ?? ''))
    // FULL OBSERVABILITY in one call (his request #3): every figure below is a
    // MEASUREMENT — a failed read arrives as null and is said, never a zero.
    case 'stare_masurata': {
      const [sanatate, resurse, cost, constructorMonitor] = await Promise.all([
        systemHealth().catch(() => 'nu pot citi sănătatea'),
        resurseGazda().catch(() => null),
        citesteRezumatCost().catch(() => null),
        readConstructorMonitor().catch(() => ({ state:'unknown',error:'constructor_monitor_unavailable',activeExecution:false })),
      ])
      return JSON.stringify(
        {
          sanatate,
          constructorMonitor,
          resurse: resurse ?? 'nu pot citi /proc (memorie/încărcare)',
          costAzi: cost?.citit ? cost.valoare : `nu pot citi jurnalul de cost${cost && !cost.citit ? `: ${cost.motiv}` : ''}`,
          paymentCollection: {
            status: 'setup_required',
            automaticCredit: false,
          },
        },
        null,
        1,
      )
    }
    // THE OWNER'S REQUIREMENTS, caught from the conversation. Without these,
    // the `cerinte` table stayed empty and the whole management system was
    // decoration.
    case 'cerinta_noua': {
      const id = await adaugaCerinta(
        String(args.text ?? ''),
        'owner',
        args.criteriu ? String(args.criteriu) : undefined,
        Number(args.prioritate ?? 5),
      )
      return JSON.stringify(id ? { notat: true, id } : { error: 'cerinta_goala_sau_baza_indisponibila' })
    }
    case 'cerinte_lista': {
      const c = await listeazaCerinte(args.stare ? String(args.stare) : undefined, 60)
      return JSON.stringify({
        total: c.length,
        cerinte: c.map((x) => ({
          id: x.id, text: x.text.slice(0, 200), stare: x.stare, prioritate: x.prioritate,
          criteriu: x.criteriu?.slice(0, 200) ?? null, aleasa: x.aleasa?.slice(0, 200) ?? null,
          dovada: x.dovada?.slice(0, 200) ?? null,
        })),
      })
    }
    case 'cerinta_prioritate': {
      const id = Number(args.id ?? 0)
      const p = Math.max(1, Math.min(9, Math.round(Number(args.prioritate ?? 5)) || 5))
      if (!id) return JSON.stringify({ error: 'fara_id' })
      await actualizeazaCerinta(id, { prioritate: p })
      return JSON.stringify({ ok: true, id, prioritate: p })
    }
    default: return null
  }
}

// ── §1 "WHAT TEXT CAN DO, VOICE CAN DO TOO" — tools bound to ONE USER ──────
// The gap measured on Jul 29: the registry had 66 capabilities in text and
// only 31 in voice. These 8 didn't depend on the monitor or the browser — only
// on who the user is — so they had no real reason to be missing when speaking.
// SINGLE source, called by chat.ts (runTool) AND realtime.ts (the escalated
// brain), so they don't diverge.
// The admin gate is done HERE TOO (it needs isAdmin), unlike
// execSharedAdminTool where the caller does it.
import { updatesList } from './updates.js'
import { fetchRecentInbox } from './mailbox.js'
import { recentLogs } from './logbuffer.js'
import { recentClientErrorRows } from '../db.js'
import { recentClientErrors } from '../routes/clientErrors.js'
import { getMemories, deleteMemory, cautaIstoric, logCapabilityGap, citesteRezumatCost, dovezileFaptelor } from '../db.js'

export const USER_SCOPED_TOOLS: ReadonlySet<string> = new Set([
  'list_updates', 'read_inbox', 'server_logs', 'client_errors', 'get_real_cost',
  'list_memories', 'cauta_istoric', 'dovada_faptelor', 'forget_memory', 'log_unsupported_request',
])

export async function execUserScopedTool(
  name: string,
  args: Record<string, unknown>,
  email: string,
  isAdmin: boolean,
): Promise<string | null> {
  const denied = JSON.stringify({ error: 'admin_only' })
  switch (name) {
    case 'list_updates': {
      if (!isAdmin) return denied
      const raw = await updatesList()
      return raw ? raw.slice(0, 20_000) : JSON.stringify({ updates: [] })
    }
    case 'read_inbox': {
      if (!isAdmin) return denied
      const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 40)
      // fetchRecentInbox spune acum și DE CE nu a citit (auditul admin, 3
      // aug): ok:false + motiv — unealta relatează eșecul, nu o cutie goală.
      const r = await fetchRecentInbox(limit)
      if (!r.ok) return JSON.stringify({ error: 'inbox_unreadable', motiv: r.motiv })
      return JSON.stringify({ count: r.emails.length, items: r.emails })
    }
    case 'server_logs': {
      if (!isAdmin) return denied
      // DEFAULT = TOATE (owner, 13 aug: „Kelion nu vede toate logurile"). Înainte
      // implicitul era 40 (doar warn+error), deci info-ul (inclusiv urmele [BRAIN])
      // rămânea ascuns. Acum implicit vede tot; `errorsOnly:true` filtrează la nevoie.
      const minLevel = args.errorsOnly === true ? 40 : 0
      const entries = recentLogs(minLevel, Math.min(Math.max(Number(args.limit) || 60, 1), 200))
      return JSON.stringify({ count: entries.length, entries })
    }
    case 'client_errors': {
      if (!isAdmin) return denied
      // Erorile F12 din browser, la CERERE (owner, 14 aug: „kelion să vadă F12").
      // DB-ul (durabil, toți userii) + inelul tău din memorie (cele mai proaspete
      // ale userului curent, poate încă nescrise în DB) — împreună, poza completă.
      const hours = Math.min(Math.max(Number(args.hours) || 24, 1), 720)
      const limit = Math.min(Math.max(Number(args.limit) || 40, 1), 100)
      const includePerf = args.includePerf === true
      const rows = await recentClientErrorRows(hours, limit, includePerf)
      const proaspete = recentClientErrors(email, hours * 3600_000)
      return JSON.stringify({
        count: rows.length,
        erori: rows,
        proaspete_utilizator_curent: proaspete,
        nota: rows.length === 0 && proaspete.length === 0
          ? 'Nicio eroare de browser în fereastra cerută — interfața nu a raportat erori (nu înseamnă că nu poți vedea, ci că nu sunt).'
          : undefined,
      })
    }
    case 'get_real_cost': {
      if (!isAdmin) return JSON.stringify({ error: 'unauthorized' })
      // M7b (8 aug): o citire picată se SPUNE, nu se maschează în zerouri.
      const c = await citesteRezumatCost()
      return JSON.stringify(c.citit ? c.valoare : { error: 'nu pot citi jurnalul de cost', motiv: c.motiv })
    }
    case 'list_memories': {
      const memories = await getMemories(email)
      return JSON.stringify({ memories: memories.map((m) => m.content) })
    }
    case 'cauta_istoric': {
      const query = String(args.query ?? '')
      if (!query.trim()) return JSON.stringify({ error: 'no_query' })
      const rows = await cautaIstoric(email, query)
      return JSON.stringify({
        gasite: rows.map((r) => ({
          cine: r.role === 'user' ? 'user' : 'Kelion',
          text: String(r.content).slice(0, 500),
          cand: r.created_at,
        })),
      })
    }
    case 'dovada_faptelor': {
      // JARVIS pasul 4 (§7): asul din mânecă — dovada salvată, per-utilizator.
      // O citire picată se SPUNE (Legea #1), nu se maschează în listă goală.
      const cate = Math.min(Math.max(Number(args.cate) || 10, 1), 30)
      const cauta = String(args.cauta ?? '').trim()
      const r = await dovezileFaptelor(email, cate, cauta || undefined)
      if (!r.citit) return JSON.stringify({ error: 'jurnal_operational_necitit', motiv: r.motiv })
      return JSON.stringify({
        count: r.sarcini.length,
        sarcini: r.sarcini,
        nota: r.sarcini.length === 0
          ? `Nicio faptă ÎNREGISTRATĂ${cauta ? ' pentru filtrul cerut' : ''} — jurnalul a răspuns, dar nu are rânduri. Nu înseamnă că nimic nu s-a întâmplat vreodată: faptele dinaintea jurnalului (18 aug 2026) nu au dovadă salvată.`
          : undefined,
      })
    }
    case 'forget_memory': {
      const fragment = String(args.fragment ?? '')
      if (!fragment) return JSON.stringify({ error: 'no_fragment' })
      const count = await deleteMemory(email, fragment, 'kelion')
      return JSON.stringify({ forgotten: count })
    }
    case 'log_unsupported_request': {
      const request = String(args.request ?? '')
      if (!request) return JSON.stringify({ error: 'no_request' })
      const nouGol = await logCapabilityGap(email, request, String(args.reason ?? ''))
      // ANUNȚ LA OWNER (K14), o singură dată, DOAR pe gol NOU: un user a cerut ceva
      // ce Kelion nu acoperă — ownerul e anunțat ca să decidă (nu la fiecare repetare).
      if (nouGol) {
        void notifyAdmin('scris', 'Cerere neacoperită', `${email}: „${request.slice(0, 160)}"`, {
          email,
          request: request.slice(0, 500),
        }).catch(() => 0)
      }
      return JSON.stringify({ logged: true })
    }
    default: return null
  }
}
