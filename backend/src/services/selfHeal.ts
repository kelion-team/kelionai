import crypto from 'node:crypto'
import { recurringClientErrors, createBuildJob, loadKv, saveKv, requeueMoneyFailedBuildJobs } from '../db.js'
import { isOpsPaused } from './runbooks.js'
import { getOpenRouterBalance } from './openrouter.js'

// ── AUTO-VINDECAREA LUI KELION (Adrian, 27 iul: „Kelion trebuie să poată culege
// err apărute sub fiecare user automat și să le remedieze, dând versiunea
// reparată pentru toți userii ulterior") ────────────────────────────────────
// Bucla proactivă, fără să i se ceară: la interval, ia erorile de client
// RECURENTE (multe apariții, mai mulți utilizatori), și pentru fiecare semnătură
// NOUĂ pune un ordin în coada constructorului. Constructorul găsește cauza în
// sursă, o repară, rulează build+teste și deschide un PR; la merge, auto-
// publicarea duce versiunea reparată la TOȚI userii. Merge-ul rămâne al lui
// Adrian (poarta umană) — de aceea depunem un PR, nu împingem direct în master.
//
// Gărzi: (1) doar erori recurente reale (pragurile din recurringClientErrors);
// (2) dedup pe semnătură în kv (`selfheal:<hash>`, 7 zile) — nu depunem de două
// ori aceeași eroare; (3) respectă „pauza-autonomie"; (4) max 3 ordine pe rulare,
// ca un val de erori să nu inunde coada.

function signature(message: string): string {
  // Semnătură stabilă din mesaj, fără numere/adrese variabile — ca aceeași
  // eroare (cu alt line:col sau alt id) să fie recunoscută ca aceeași.
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

  // VINDECAREA ORDINELOR CĂZUTE PE BANI (Adrian, 27 iul: „de ce nu vede
  // sistemul de vindecare, repară? — automat?"): dacă punga creierului e iar
  // pozitivă, ordinele constructorului eșuate pe 402/credit se repun SINGURE
  // în coadă (o singură dată per ordin — marcaj în log).
  try {
    const bal = await getOpenRouterBalance()
    if (bal.ok && bal.balance > 0) {
      const requeued = await requeueMoneyFailedBuildJobs()
      if (requeued) console.log(`[self-heal] ${requeued} ordin(e) eșuat(e) pe lipsă de credit, repus(e) în coadă — punga e iar plină`)
    }
  } catch {
    /* punga indisponibilă — încercăm la rularea următoare */
  }

  const errors = await recurringClientErrors(24, 5, 2)
  if (!errors.length) return { filed: 0 }

  let filed = 0
  for (const e of errors) {
    if (filed >= 3) break
    const sig = signature(e.message)
    const key = `selfheal:${sig}`
    if (await loadKv(key)) continue // deja depusă — nu dublăm

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
