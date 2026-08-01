import crypto from 'node:crypto'
import { recurringClientErrors, createBuildJob, loadKv, saveKv, requeueMoneyFailedBuildJobs } from '../db.js'
import { isOpsPaused } from './runbooks.js'
import { getOpenRouterBalance } from './openrouter.js'

// ── KELION'S SELF-HEALING (Adrian, 27 Jul: "Kelion must be able to gather
// errors appearing under each user automatically and remedy them, delivering
// the fixed version to all users afterwards") ──────────────────────────────
// The proactive loop, without being asked: at an interval, it takes the
// RECURRENT client errors (many occurrences, several users), and for each NEW
// signature it places an order in the constructor's queue. The constructor
// finds the cause in the source, fixes it, runs build+tests and opens a PR;
// on merge, auto-publishing brings the fixed version to ALL users. The merge
// stays with Adrian (the human gate) — that is why we file a PR, not push
// directly into master.
//
// Guards: (1) only real recurrent errors (the thresholds in
// recurringClientErrors); (2) dedup by signature in kv (`selfheal:<hash>`,
// 7 days) — we don't file the same error twice; (3) respects the autonomy
// pause; (4) max 3 orders per run, so a wave of errors doesn't flood the
// queue.

function signature(message: string): string {
  // A stable signature from the message, without variable numbers/addresses
  // — so the same error (with another line:col or another id) is recognized
  // as the same.
  const norm = message
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[0-9a-f]{8,}/g, '')
    .replace(/\d+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return crypto.createHash('sha1').update(norm).digest('hex').slice(0, 16)
}

export async function runSelfHeal(): Promise<{ filed: number }> {
  if (await isOpsPaused()) return { filed: 0 }

  // HEALING THE ORDERS THAT FELL ON MONEY (Adrian, 27 Jul: "why doesn't the
  // healing system see, repair? — automatically?"): if the brain's pouch is
  // positive again, the constructor orders failed on 402/credit are put BACK
  // in the queue BY THEMSELVES (only once per order — a mark in the log).
  try {
    const bal = await getOpenRouterBalance()
    if (bal.ok && bal.balance > 0) {
      const requeued = await requeueMoneyFailedBuildJobs()
      if (requeued) console.log(`[self-heal] ${requeued} ordin(e) eșuat(e) pe lipsă de credit, repus(e) în coadă — punga e iar plină`)
    }
  } catch {
    /* pouch unavailable — we try again on the next run */
  }

  const errors = await recurringClientErrors(24, 5, 2)
  if (!errors.length) return { filed: 0 }

  let filed = 0
  for (const e of errors) {
    if (filed >= 3) break
    const sig = signature(e.message)
    const key = `selfheal:${sig}`
    if (await loadKv(key)) continue // already filed — we don't duplicate

    const order =
      `AUTO-VINDECARE: repară o eroare de client RECURENTĂ (apărută de ${e.count} ori, ` +
      `la ${e.users} utilizatori distincți în ultimele 24h). Găsește CAUZA REALĂ în sursă ` +
      `(caută mesajul/stack-ul cu search_source/read_source) și rescrie curat modulul ` +
      `responsabil — fără petice. NU schimba nimic în afara cauzei acestei erori.\n\n` +
      `Mesaj: ${e.message}\n` +
      `URL unde apare: ${e.sampleUrl}\n` +
      `Stack (exemplu):\n${(e.sampleStack ?? '(fără stack)').slice(0, 2000)}\n\n` +
      `Verifică: npm --prefix backend run build (+ test dacă atingi backend), ` +
      `npm --prefix frontend run build dacă atingi frontend.`

    const id = await createBuildJob('kelion-autovindecare', order)
    if (id) {
      await saveKv(key, JSON.stringify({ at: Date.now(), job: id, count: e.count }))
      filed += 1
    }
  }
  if (filed) console.log(`[self-heal] ${filed} eroare(i) recurentă(e) trimisă(e) constructorului spre reparare`)
  return { filed }
}
