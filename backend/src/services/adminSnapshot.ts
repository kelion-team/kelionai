// PANOU ADMIN — STARE LIVE PENTRU CREIER (Adrian, 14 iul: „Kelion trebuie să vadă
// permanent tot ce e în fiecare buton admin"). Adună un REZUMAT COMPACT al fiecărui
// tab din panoul de admin (contoare + titlurile a câtorva rânduri), ca Kelion să fie
// mereu CONȘTIENT de ce e în fiecare buton — fără să-i turnăm datele întregi în prompt.
//
// DISCIPLINĂ DE LATENȚĂ (regula #1 a lui Adrian: primul cuvânt sub 1s): totul e
//   1. DOAR pentru admin (se cheamă doar pe tura lui);
//   2. interogări IEFTINE, în PARALEL (un singur drum spre bază);
//   3. CACHE 30s — turele admin dese nu re-lovesc baza.
// Rezumatul e scurt (câteva sute de token-uri), nu datele complete — pentru detalii
// Kelion cere tab-ul anume sau se uită în memoria comună / jurnal (deja în context).

import {
  listWorkOrders,
  getCapabilityGaps,
  listStagedReleases,
  listVoiceprints,
  listUsers,
  listVisitorConvos,
  listInboundEmails,
  listLeads,
} from '../db.js'

// Stadiile TERMINALE ale unui job (oglinda lui JOB_DONE din AdminPanel): ies din
// lista „în lucru" și intră în arhivă.
const JOB_DONE = new Set(['certified', 'finalized', 'published', 'failed', 'dismissed'])

let cache: { text: string; at: number } | null = null
const TTL_MS = 30_000

function trunc(s: string, n = 90): string {
  const t = (s || '').replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n)}…` : t
}

// Construiește (sau întoarce din cache) rezumatul panoului. Nu aruncă niciodată —
// orice sursă căzută devine o linie goală, nu o eroare care rupe chatul.
export async function buildAdminSnapshot(): Promise<string> {
  const now = Date.now()
  if (cache && now - cache.at < TTL_MS) return cache.text

  const [orders, gaps, releases, voices, users, visitors, emails, leads] = await Promise.all([
    listWorkOrders(50).catch(() => []),
    getCapabilityGaps(false, 200).catch(() => []),
    listStagedReleases(50).catch(() => []),
    listVoiceprints(200).catch(() => []),
    listUsers().catch(() => []),
    listVisitorConvos().catch(() => []),
    listInboundEmails(50).catch(() => []),
    listLeads().catch(() => []),
  ])

  const lines: string[] = []

  // JOBURI / ORDINE — ce se lucrează acum + câte sunt în arhivă.
  const jobsLive = orders.filter((o) => !JOB_DONE.has(o.status))
  const jobsDone = orders.length - jobsLive.length
  lines.push(`- Joburi/Ordine: ${jobsLive.length} în lucru, ${jobsDone} în arhivă.`)
  for (const o of jobsLive.slice(0, 5)) lines.push(`    • [${o.status}] ${trunc(o.text)}`)

  // CERERI NEACOPERITE — funcții/comportamente cerute și nerezolvate încă.
  const gapsOpen = gaps.filter((g) => !g.resolved)
  lines.push(`- Cereri neacoperite: ${gapsOpen.length} deschise.`)
  for (const g of gapsOpen.slice(0, 5)) lines.push(`    • (${g.hits}×) ${trunc(g.request)}`)

  // RELEASE-URI — schimbări gata, în așteptarea aprobării tale pentru publicare.
  const relPending = releases.filter((r) => r.status !== 'approved' && r.status !== 'failed')
  lines.push(`- Release-uri: ${relPending.length} în așteptarea aprobării (din ${releases.length} recente).`)
  for (const r of relPending.slice(0, 4)) lines.push(`    • ${trunc(r.title)}`)

  // AMPRENTE VOCALE — câte voci sunt înrolate.
  const admins = voices.filter((v) => v.isAdmin).length
  lines.push(`- Amprente vocale: ${voices.length} (admin: ${admins}, useri: ${voices.length - admins}).`)

  // UTILIZATORI / VIZITATORI / INBOX / LEADS — contoare simple.
  lines.push(`- Utilizatori (conturi cu istoric): ${users.length}.`)
  lines.push(`- Vizitatori (conversații demo): ${visitors.length}.`)
  lines.push(`- Inbox (emailuri primite): ${emails.length}.`)
  lines.push(`- Leads (contacte lăsate): ${leads.length}.`)

  const text =
    'PANOU ADMIN — STARE LIVE (ce e acum în fiecare buton al panoului tău; o vezi permanent, ' +
    'discret, nu o recita dacă nu ți se cere):\n' +
    lines.join('\n')

  cache = { text, at: now }
  return text
}

// Invalidare manuală (ex. după o acțiune care schimbă starea) — opțional.
export function invalidateAdminSnapshot(): void {
  cache = null
}
