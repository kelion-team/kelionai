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
// The admin GATE is done by the CALLER beforehand (isAdmin in chat;
// adminUnlocked via voiceprint in voice) — this function does NOT gate, it
// only executes.

import { listSource, readSource, searchSource } from './sourceCode.js'
import { dbTablesOverview, dbQuery, memoriePune, memorieIa, memorieLista } from '../db.js'
import { systemHealth } from './health.js'
import { resurseGazda } from './resurse.js'
import { stareCitirePlati } from './openBanking.js'
import { stareAutonomie } from './autonomie.js'
import { repoWrite, repoOpenPR, repoMergePR } from './github.js'
import { runRunbook, runbookStatus, runbookLog, requestRepair } from './runbooks.js'
import { seteazaSecret, listeazaSecrete, publicaCheile } from './secrete.js'
import { adaugaCerinta, listeazaCerinte, actualizeazaCerinta } from '../db.js'
import { cardConfigurat, completeazaCard, terminaCard, stareFurnizori, type CampCard } from './cardFurnizor.js'
import { voceRecenta, minuteRamaseVoce, fataRecenta, minuteRamaseFata } from './adminLock.js'
import { adminVezi, adminSchimba } from './adminVedere.js'
import { julesSurse, julesSarcina, julesStare } from './jules.js'
import { notifyAdmin } from './adminNotification.js'

// The names of the shared admin tools (chat ∩ voice). The caller checks
// membership to know whether to delegate here or handle it itself
// (build_software, google, browser...).
export const SHARED_ADMIN_TOOLS: ReadonlySet<string> = new Set([
  'list_source', 'read_source', 'search_source',
  'db_tables', 'db_query', 'system_health',
  // MĂSURAREA (8 aug, ordinul ownerului): Kelion își rulează SINGUR porțile, cu
  // aceleași comenzi ca omul, și își poate citi jurnalul propriilor măsurători —
  // ca o afirmație despre starea softului să poată fi CONFRUNTATĂ cu ce a măsurat.
  'ruleaza_portile', 'jurnal_masuratori', 'vaneaza_buguri',
  'repo_write', 'repo_open_pr', 'repo_merge_pr',
  'run_runbook', 'runbook_status', 'runbook_log', 'request_repair',
  'secret_pune', 'secret_lista', 'secret_publica',
  'cerinta_noua', 'cerinte_lista', 'cerinta_prioritate',
  // The card: the gate is IN the executor (the voice window), not here.
  'card_stare', 'card_completeaza', 'card_gata',
  // The whole admin panel (Jul 31, the third request): he sees what the owner
  // sees on screen and can change what can be undone.
  'admin_vezi', 'admin_schimba',
  // HIS OWN WISHLIST, granted (Aug 2, „implementează-i ce cere"): persistent
  // project memory + full observability of his own state, as tools.
  'memorie_pune', 'memorie_ia', 'memorie_lista', 'stare_masurata',
  // JULES (3 aug) — agentul asincron oficial Google, pe cheia pusă de owner.
  'jules_repos', 'jules_task', 'jules_status',
])

// Executes a SHARED admin tool. Returns the result (string) or `null` if the
// name is NOT a shared tool — then the caller handles it itself. The argument
// extraction is IDENTICAL to the one that lived duplicated in the two routes.
export async function execSharedAdminTool(
  name: string,
  args: Record<string, unknown>,
  // Who asks and from where — needed ONLY by the card tools (the browser is
  // per user, and the gate is "I recognised your voice just now"). The rest
  // ignore them.
  ctx: { email?: string; baseUrl?: string; cookie?: string } = {},
): Promise<string | null> {
  switch (name) {
    case 'list_source': return listSource(String(args.dir ?? '.'))
    case 'read_source': return readSource(String(args.path ?? ''), Number(args.from_line ?? 1) || 1)
    case 'search_source': return searchSource(String(args.query ?? ''))
    case 'db_tables': return dbTablesOverview()
    case 'db_query': return dbQuery(String(args.sql ?? ''))
    case 'system_health': return systemHealth()
    // MĂSURAREA (8 aug) — Kelion își rulează singur porțile, exact cele pe care
    // le rulează omul, și primește înapoi un verdict cu TREI stări. Raportul e
    // formatat aici, nu de model: „NU POT VERIFICA" nu se poate rescrie în
    // „trece" pe drum.
    case 'ruleaza_portile': {
      const cerute = Array.isArray(args.porti) ? (args.porti as unknown[]).map(String) : undefined
      const rez = await ruleazaPortile(cerute)
      return raportPorti(rez)
    }
    case 'vaneaza_buguri': {
      const v = await vaneazaBuguri(Number(args.ore ?? 48) || 48)
      return raportVanatoare(v)
    }
    case 'jurnal_masuratori': {
      const randuri = await jurnalMasuratori(Number(args.cate ?? 30) || 30)
      if (!randuri.length) return 'Jurnalul e GOL — nu ai măsurat nimic încă. Asta NU înseamnă că totul e bine; înseamnă că nu știi.'
      return randuri
        .map((r) => `${r.la}  ${r.masurat ? 'MĂSURAT' : 'NU POT VERIFICA'}  ${r.cum} (${r.ms} ms) → ${r.rezumat}`)
        .join('\n')
    }
    // KELION'S PROJECT MEMORY (his own request, Aug 2): keyed, persistent,
    // queryable — survives every deploy, unlike the conversation window.
    case 'memorie_pune': return memoriePune(String(args.cheie ?? ''), String(args.continut ?? ''))
    case 'memorie_ia': return memorieIa(String(args.cheie ?? ''))
    case 'memorie_lista': return memorieLista(String(args.prefix ?? ''))
    // FULL OBSERVABILITY in one call (his request #3): every figure below is a
    // MEASUREMENT — a failed read arrives as null and is said, never a zero.
    case 'stare_masurata': {
      const [sanatate, resurse, cost] = await Promise.all([
        systemHealth().catch(() => 'nu pot citi sănătatea'),
        resurseGazda().catch(() => null),
        citesteRezumatCost().catch(() => null),
      ])
      return JSON.stringify(
        {
          sanatate,
          resurse: resurse ?? 'nu pot citi /proc (memorie/încărcare)',
          costAzi: cost?.citit ? cost.valoare : `nu pot citi jurnalul de cost${cost && !cost.citit ? `: ${cost.motiv}` : ''}`,
          citirePlati: stareCitirePlati() ?? 'cititorul de plăți n-a rulat încă în procesul ăsta',
          autonomie: stareAutonomie() ?? 'bucla n-a trecut încă în procesul ăsta',
        },
        null,
        1,
      )
    }
    // JULES — sarcini către agentul asincron oficial Google (PR-ul îl îmbină ownerul).
    case 'jules_repos': return julesSurse()
    case 'jules_task': return julesSarcina(String(args.prompt ?? ''), String(args.sursa ?? ''), args.ramura ? String(args.ramura) : 'master')
    case 'jules_status': return julesStare(String(args.sesiune ?? ''))
    // ── POARTA OBLIGATORIE (Adrian, 8 aug: „va trebui să folosească OBLIGATORIU
    // toate testele și să măsoare orice răspuns") ──────────────────────────────
    // Uneltele care SCHIMBĂ softul nu pornesc fără o rulare COMPLETĂ de porți,
    // recentă, cu verdict TRECE. Nu e o rugăminte în prompt — e o poartă în cod,
    // exact ca să nu se poată uita. „Am rulat testele" nu mai e o vorbă: se
    // citește din jurnalul măsurătorilor sau nu se întâmplă nimic.
    case 'repo_open_pr':
    case 'repo_merge_pr': {
      const d = await dovadaPortilor()
      if (!d.poateImplementa) {
        return `REFUZAT — nu implementez fără măsurătoare: ${d.motiv}\n\nProcedura: 1) ruleaza_portile  2) repari ce pică  3) abia apoi ${name}.`
      }
      return name === 'repo_open_pr'
        ? repoOpenPR(String(args.branch ?? ''), String(args.title ?? ''), String(args.body ?? ''))
        : repoMergePR(Number(args.pr ?? 0))
    }
    case 'repo_write': return repoWrite(String(args.branch ?? ''), String(args.path ?? ''), String(args.content ?? ''), String(args.message ?? ''))
    case 'run_runbook': {
      const inputs: Record<string, string> = {}
      if (args.pachet) inputs.pachet = String(args.pachet)
      if (args.pkg) inputs.pkg = String(args.pkg)
      if (args.inputs && typeof args.inputs === 'object') {
        Object.assign(inputs, args.inputs)
      }
      const name = String(args.name ?? '')
      return Object.keys(inputs).length > 0 ? runRunbook(name, inputs) : runRunbook(name)
    }
    case 'runbook_status': return runbookStatus(args.name ? String(args.name) : undefined)
    case 'runbook_log': return runbookLog(Number(args.run_id ?? 0))
    case 'request_repair': return requestRepair(String(args.title ?? ''), String(args.details ?? ''))
    // HIS SETTINGS. `valoare` never goes into any log from here — the
    // function in secrete.ts reports only the name and the length.
    case 'secret_pune': return seteazaSecret(String(args.nume ?? ''), String(args.valoare ?? ''))
    case 'secret_lista': return listeazaSecrete()
    case 'secret_publica': return publicaCheile()
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
    // ── THE CARD AT PROVIDERS ──────────────────────────────────────────────
    // The value NEVER passes through the model: it only says which field and
    // where.
    case 'card_stare': {
      const c = cardConfigurat()
      // The providers come from what was MEASURED on their pages at the
      // session's close, not from what someone said they did.
      const furnizori = await stareFurnizori()
      return JSON.stringify({
        configurat: c.gata,
        lipsesc: c.lipsesc,
        vocea_recunoscuta: voceRecenta(ctx.email ?? ''),
        minute_ramase_voce: minuteRamaseVoce(ctx.email ?? ''),
        fata_recunoscuta: fataRecenta(ctx.email ?? ''),
        minute_ramase_fata: minuteRamaseFata(ctx.email ?? ''),
        // Cardul cere TREI factori: admin logat + voce + față (toate ACUM).
        gata_de_card: voceRecenta(ctx.email ?? '') && fataRecenta(ctx.email ?? ''),
        furnizori,
        plati_automate: furnizori.some((f) => f.automat),
        nota: 'Valorile NU se pot citi de nicăieri, nici de mine — doar se scriu în pagină.',
      })
    }
    case 'card_completeaza': {
      const r = await completeazaCard(
        ctx.email ?? '',
        ctx.baseUrl ?? 'https://kelionai.app',
        String(args.camp ?? '') as CampCard,
        Number(args.index ?? -1),
      )
      // The page comes back already masked by the discreet module; we add nothing.
      return JSON.stringify({ ok: r.ok, camp: r.camp, detaliu: r.detaliu, pagina: r.pagina })
    }
    // ── EVERYTHING THE ADMIN CONTAINS ──────────────────────────────────────
    // The cookie belongs to the caller: the tool does NOT bypass the admin
    // gate, it uses it. Without an admin session, the route answers 403 and it
    // says so.
    case 'admin_vezi':
      return adminVezi(String(args.sectiune ?? ''), ctx.cookie ?? '')
    case 'admin_schimba':
      return adminSchimba(String(args.sectiune ?? ''), args.date ?? {}, ctx.cookie ?? '')
    case 'card_gata': {
      const r = await terminaCard(ctx.email ?? '', ctx.baseUrl ?? 'https://kelionai.app', String(args.furnizor ?? ''))
      return JSON.stringify({ ok: true, card_la_dosar: r.card, plata_automata: r.automat, detaliu: r.detaliu, pagina: r.pagina })
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
import { getMemories, deleteMemory, cautaIstoric, logCapabilityGap, citesteRezumatCost, proposeKelionTool } from '../db.js'
import { execGuestVoiceTool, GUEST_VOICE_TOOLS } from './guestVoices.js'
import { ruleazaPortile, raportPorti, jurnalMasuratori, dovadaPortilor, vaneazaBuguri, raportVanatoare } from './masurare.js'

export const USER_SCOPED_TOOLS: ReadonlySet<string> = new Set([
  'list_updates', 'read_inbox', 'server_logs', 'get_real_cost',
  'list_memories', 'cauta_istoric', 'forget_memory', 'log_unsupported_request', 'propose_tool',
  // GUEST VOICES (Adrian, Aug 1): holder-only by construction — they act on
  // the SESSION user's own account (every user is the holder of theirs).
  // The names come from the single source in guestVoices.ts.
  ...GUEST_VOICE_TOOLS,
])

export async function execUserScopedTool(
  name: string,
  args: Record<string, unknown>,
  email: string,
  isAdmin: boolean,
): Promise<string | null> {
  const denied = JSON.stringify({ error: 'admin_only' })
  // GUEST VOICES: not admin-gated — every holder manages the guests of their
  // OWN account.
  if (GUEST_VOICE_TOOLS.has(name))
    return execGuestVoiceTool(name, args, email)
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
    case 'propose_tool': {
      // AUTO-EXTINDERE: Kelion își cere singur o unealtă nouă (ownerul o aprobă
      // cu un click în Admin → Unelte Kelion). MUTAT AICI (5 aug): în registru e
      // `admin:false` și e în USER_SCOPED_TOOLS — dar executorul stătea în
      // execSharedAdminTool, gardat de SHARED_ADMIN_TOOLS care NU-l conține, deci
      // orice apel crăpa „unknown_tool". Acum e pe calea corectă. Identic în
      // text și în voce.
      const p = args as Record<string, unknown>
      const id = await proposeKelionTool({
        name: String(p.name ?? ''),
        description: String(p.description ?? ''),
        paramsJson: JSON.stringify(p.params_schema ?? { type: 'object', properties: {}, required: [] }),
        httpMethod: String(p.http_method ?? 'GET'),
        httpUrl: String(p.http_url ?? ''),
        httpHeaders: JSON.stringify(p.http_headers ?? {}),
        rationale: String(p.rationale ?? ''),
      })
      return JSON.stringify(id
        ? { proposed: true, id, note: 'Așteaptă aprobarea owner-ului în Admin → Unelte Kelion.' }
        : { error: 'invalid_proposal (doar HTTPS, nume valid)' })
    }
    default: return null
  }
}
