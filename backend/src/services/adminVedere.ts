// ── KELION SEES EVERYTHING THE ADMIN PANEL SEES ─────────────────────────────
//
// Adrian, 31 Jul, for the third time: "Kelion must be able to see everything
// the admin contains, and to modify it, to have full access to the source
// code. I won't ask you a third time, I'll just curse you."
//
// He is right that he asked three times. He had `read_source` (the code),
// `db_query` (raw data) and `repo_write` (writing) — but NOT what he sees on
// screen: the aggregated figures, the verdicts, the lists computed by the
// admin routes. When he told him "look in the Money tab", Kelion had to
// rebuild from SQL what the panel already had computed — and often came out
// with something else.
//
// Here is the missing link: the very same routes the panel calls, called by
// him. Not a copy of the logic (it would diverge within a week) — the actual
// routes.
//
// DESIGN, and why:
//   • ONE SINGLE read tool for all ~30 tabs. Not thirty tools that would fill
//     the context window and go stale with every new route.
//   • Route names are NOT hand-written here: they are requested from the app,
//     so a new route shows up in his list on its own.
//   • Reading is free; WRITING goes through an explicit allowlist, because
//     among the admin routes are also the ones that move money (`user` with
//     action credit, `brain-credit`) or destroy what cannot be brought back
//     (`user` with action delete, `backups/restore`). Those stay with the
//     owner — not because I don't trust him, but because a mistake there
//     cannot be undone.

/** The admin routes he may NOT call on his own, with the reason written down.
 *  The rule: if the mistake cannot be undone, you press it yourself.
 *
 *  KEEP THIS LIST TRUE: the Stripe-era entries (deposit / payout /
 *  sell-credits / money-circuit/card-key) were removed together with their
 *  routes (31 Jul) — guarding a route that no longer exists while the REAL
 *  money route (`/api/admin/user`: credit = money moved, delete = data gone
 *  forever) stayed open would have been a hole, not a guard. */
const DOAR_OWNERUL = new Map<string, string>([
  ['user', 'creditează cu bani reali sau șterge definitiv un user'],
  ['brain-credit', 'mișcă bani reali'],
  ['backups/restore', 'suprascrie baza de date întreagă'],
  ['reset-counters', 'șterge contoare, nu se poate desface'],
  ['unlock/secret', 'poarta ta de admin — nu se atinge singur'],
])

/** We truncate what is too long so it doesn't eat the brain's context window. */
const MAX = 20_000

// ALIASURI DE SECȚIUNE (owner, 13 aug: „alertele îi dau lui Kelion 404"). Datele
// de alerte pentru owner stau la /api/admin/notificari (cererile lui) și
// /api/admin/erori (erorile recente), dar creierul cerea firesc „alerte"/„alerts"
// → ruta nu există → 404. Mapăm numele firești pe rutele REALE, ca „arată-mi
// alertele" să meargă, în loc să ghicească o secțiune inexistentă.
const ALIAS_SECTIUNE: Record<string, string> = {
  alerte: 'notificari',
  alerts: 'notificari',
  notifications: 'notificari',
  notificari: 'notificari',
  erori: 'erori',
  errors: 'erori',
  greseli: 'erori',
}

/** Routes are called on LIVE, not localhost: what he sees must be exactly
 *  what you see in the panel, from the same application. */
function url(cale: string): string {
  const c = cale.replace(/^\/+/, '').replace(/^api\/admin\//, '')
  const mapat = ALIAS_SECTIUNE[c.toLowerCase()] ?? c
  return `https://kelionai.app/api/admin/${mapat}`
}

/**
 * Reads a section of the admin panel — exactly the data he sees.
 *
 * `cookie` is the admin session of the requester: without it the route answers
 * 403, and that is good — the tool does not bypass the admin gate, it uses it.
 */
export async function adminVezi(cale: string, cookie: string): Promise<string> {
  if (!cale.trim()) return JSON.stringify({ error: 'spune ce secțiune vrei, ex. „finance" sau „users"' })
  try {
    const r = await fetch(url(cale), { headers: cookie ? { cookie } : {} })
    const text = (await r.text()).slice(0, MAX)
    if (!r.ok) {
      return JSON.stringify({
        error: `panoul a răspuns ${r.status}`,
        detaliu: r.status === 403 ? 'sesiunea nu e de admin — cere-i ownerului să fie logat' : text.slice(0, 500),
      })
    }
    return text
  } catch (e) {
    return JSON.stringify({ error: `n-am putut citi „${cale}": ${(e as Error).message}` })
  }
}

/**
 * Changes something in the panel (POST), on the routes that can be undone.
 *
 * What moves money or restores the database stays with the owner — the reply
 * states clearly WHICH route it is and WHY, so it doesn't look like an
 * arbitrary refusal.
 */
export async function adminSchimba(cale: string, corp: unknown, cookie: string): Promise<string> {
  const c = cale.replace(/^\/+/, '').replace(/^api\/admin\//, '')
  const motiv = DOAR_OWNERUL.get(c)
  if (motiv) {
    return JSON.stringify({
      error: 'oprit_intentionat',
      ruta: c,
      de_ce: `${motiv} — o greșeală aici nu se poate desface, deci o apeși tu`,
      ce_pot_face: 'îți pregătesc exact ce ai de apăsat și-ți spun ce se va întâmpla',
    })
  }
  try {
    const r = await fetch(url(c), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(corp ?? {}),
    })
    const text = (await r.text()).slice(0, MAX)
    return JSON.stringify({ ok: r.ok, status: r.status, raspuns: text.slice(0, 4000) })
  } catch (e) {
    return JSON.stringify({ error: `n-am putut schimba „${c}": ${(e as Error).message}` })
  }
}
