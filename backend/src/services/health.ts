import fs from 'node:fs/promises'
import { getPool, dbEnabled, listBuildJobs, loadKv } from '../db.js'
import { resurseGazda, descrieResurse, PRAG_MEMORIE_PCT, PRAG_INCARCARE_PCT } from './resurse.js'
import { getOpenRouterBalance } from './openrouter.js'
import { stareDispecer, poateFolosiRezerva, REZERVA_CAP_ZILNIC_DEFAULT_USD } from './dispecer.js'
import { stareUrechiChirp } from './urechiChirp.js'
import { utcDay } from './timeContext.js'

// ── KELION'S EYES ON HIS OWN HEALTH (Adrian, 27 Jul: "Kelion must see this
// and be able to tell the admin through chat that he has problems x,y,z and
// ask whether to repair them") ─────────────────────────────────────────────
// DETERMINISTIC aggregation of all the health signals we already have:
// publishing sync (live vs master), recent red runs, failed build orders,
// the client-error wave, the disk, the DB, the brain's pouch. Kelion calls
// it through the system_health tool and RELAYS the list to the admin + ASKS
// whether to repair — he repairs nothing on his own initiative.

interface Problem {
  id: string
  grav: 'critic' | 'mediu' | 'minor'
  desc: string
  reparabil: string
}

const GH = 'https://api.github.com/repos/kelion-team/kelionai'
function ghHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${(process.env.GITHUB_TOKEN ?? '').trim()}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
}

export async function systemHealth(): Promise<string> {
  const problems: Problem[] = []
  const info: Record<string, unknown> = {}

  // 1. Publishing: live == the tip of master? (the house's central truth)
  const liveSha = (process.env.GIT_COMMIT_SHA ?? '').slice(0, 7)
  info.live = liveSha || 'necunoscut'
  try {
    if ((process.env.GITHUB_TOKEN ?? '').trim()) {
      const r = await fetch(`${GH}/commits/master`, {
        headers: { ...ghHeaders(), Accept: 'application/vnd.github.sha' },
        signal: AbortSignal.timeout(10_000),
      })
      const master = (await r.text()).slice(0, 7)
      info.master = master
      if (/^[0-9a-f]{7}$/.test(master) && liveSha && master !== liveSha)
        problems.push({
          id: 'live_in_urma',
          grav: 'critic',
          desc: `Live rulează ${liveSha}, dar master e ${master} — publicarea e în urmă.`,
          reparabil: 'auto-publicarea o repară singură în ~3 min; dacă persistă, run_runbook publish-master',
        })
    }
  } catch {
    /* GitHub unreachable — we don't invent problems */
  }

  // 2. The CURRENT red runs (Adrian, 27 Jul: "why doesn't the healing
  // system see, repair?" — the audit was showing him HISTORIC reds: old
  // one-off runs, already superseded by green runs of the same workflow;
  // those don't get "repaired", they are history). A workflow is a PROBLEM
  // only if its LATEST completed run is red — i.e. it is broken NOW.
  try {
    if ((process.env.GITHUB_TOKEN ?? '').trim()) {
      const [rFail, rAll] = await Promise.all([
        fetch(`${GH}/actions/runs?status=failure&per_page=15`, { headers: ghHeaders(), signal: AbortSignal.timeout(10_000) }),
        fetch(`${GH}/actions/runs?per_page=40`, { headers: ghHeaders(), signal: AbortSignal.timeout(10_000) }),
      ])
      const fail = (await rFail.json()) as { workflow_runs?: { name?: string; run_number?: number; created_at?: string }[] }
      const all = (await rAll.json()) as { workflow_runs?: { name?: string; status?: string; conclusion?: string | null; created_at?: string }[] }
      // The LATEST COMPLETED run of each workflow (the list comes descending).
      const latest = new Map<string, string>()
      for (const w of all.workflow_runs ?? []) {
        if (w.status !== 'completed' || !w.name) continue
        if (!latest.has(w.name)) latest.set(w.name, w.conclusion ?? '')
      }
      const cutoff = Date.now() - 48 * 3600_000
      const red = (fail.workflow_runs ?? []).filter(
        (w) => Date.parse(w.created_at ?? '') > cutoff && latest.get(w.name ?? '') === 'failure',
      )
      const historic = (fail.workflow_runs ?? []).filter(
        (w) => Date.parse(w.created_at ?? '') > cutoff && latest.get(w.name ?? '') !== 'failure',
      ).length
      info.rosiiIstorice = historic // visible in the audit as history, not as problems
      if (red.length)
        problems.push({
          id: 'rulari_rosii',
          grav: 'mediu',
          desc: `${red.length} workflow-uri stricate ACUM (ultima rulare roșie): ${red.map((w) => `${w.name} #${w.run_number}`).join(', ')}`,
          reparabil: 'vindecătorul rerulează deploy-urile singur; pe celelalte investighează cu runbook_log/server_logs',
        })
    }
  } catch {
    /* same */
  }

  // 3. Failed build orders (the constructor).
  try {
    const jobs = await listBuildJobs(10)
    const failed = jobs.filter((j) => j.status === 'failed' && Date.parse(j.updatedAt) > Date.now() - 48 * 3600_000)
    if (failed.length)
      problems.push({
        id: 'constructor_esuat',
        grav: 'mediu',
        desc: `${failed.length} ordine de construcție eșuate: ${failed.map((j) => `#${j.id}`).join(', ')}`,
        reparabil: 'vezi constructor_status + jurnalul din Admin→Constructor; repune ordinul reformulat cu build_software',
      })
  } catch {
    /* dead DB — caught below */
  }

  // 4. The database + the client-error wave.
  try {
    if (dbEnabled()) {
      await getPool().query('SELECT 1')
      const r = await getPool().query<{ n: string }>(
        "SELECT count(*) AS n FROM client_errors WHERE created_at > now() - interval '1 hour'",
      )
      const n = Number(r.rows[0]?.n ?? 0)
      if (n > 20)
        problems.push({
          id: 'erori_client',
          grav: 'mediu',
          desc: `${n} erori de client în ultima oră — ceva e rupt în interfață pentru useri.`,
          reparabil: 'citește-le cu db_query pe client_errors, găsește cauza în sursă și repar-o (repo_write sau build_software)',
        })
    } else {
      problems.push({ id: 'db_neconfigurata', grav: 'critic', desc: 'Baza de date nu e configurată.', reparabil: 'verifică DATABASE_URL pe VPS' })
    }
  } catch {
    problems.push({ id: 'db_moarta', grav: 'critic', desc: 'Baza de date NU răspunde (SELECT 1 a eșuat).', reparabil: 'run_runbook diagnostic; serviciul postgres pe VPS' })
  }

  // 5. The disk.
  try {
    const s = await fs.statfs('/')
    const usedPct = 100 - Math.round((Number(s.bavail) / Number(s.blocks)) * 100)
    info.disc = `${usedPct}%`
    if (usedPct >= 90)
      problems.push({ id: 'disc_plin', grav: 'critic', desc: `Discul e ${usedPct}% plin.`, reparabil: 'run_runbook curata-zombi sau docker system prune (cere acordul ownerului)' })
  } catch {
    /* statfs unavailable */
  }

  // 5b. The host's memory and load — see services/resurse.ts for why they
  // didn't exist until today and why they matter more than the disk.
  const res = await resurseGazda()
  if (res) {
    info.resurse = descrieResurse(res)
    if (res.liberPct <= PRAG_MEMORIE_PCT)
      problems.push({
        id: 'memorie_putina',
        grav: 'critic',
        desc: `Memorie: ${res.liberGb.toFixed(1)} GB liberi din ${res.totalGb.toFixed(1)} (${res.liberPct}%). Sub pragul ăsta kernelul începe să omoare procese — aplicația e cea mai mare, deci prima victimă.`,
        reparabil: 'run_runbook curata-zombi; docker system prune; sau oprește de pe VPS serviciile care nu sunt necesare',
      })
    if (res.incarcarePct >= PRAG_INCARCARE_PCT)
      problems.push({
        id: 'incarcare_mare',
        grav: 'mediu',
        desc: `Încărcare ${res.incarcarePct}% din ${res.procesoare} procesoare, susținut pe 15 min. Nu moare nimic, dar tot ce face casa devine încet — inclusiv chatul, care are țintă sub o secundă.`,
        reparabil: 'vezi ce rulează (run_runbook diagnostic); oprește ce nu e necesar, sau mărește VPS-ul',
      })
  } else {
    info.resurse = 'nu se pot măsura de aici'
  }

  // 6. The brain's pouch (OpenRouter).
  try {
    const b = await getOpenRouterBalance()
    info.creier = b.ok ? `$${b.balance.toFixed(2)}` : 'necunoscut'
    if (b.ok && b.low)
      problems.push({
        id: 'creier_sarac',
        grav: 'critic',
        desc: `Soldul OpenRouter e $${b.balance.toFixed(2)} — sub prag; creierul se poate opri.`,
        reparabil: 'doar ownerul poate alimenta (openrouter.ai/credits)',
      })
  } catch {
    /* balance unavailable */
  }

  // 7. THE ADMIN'S BUTTONS, WATCHED (Adrian, Aug 1: „Kelion must monitor all
  // the buttons — resolve their tasks, remove the dead ones"). Every button in
  // the Admin panel calls a read endpoint; a DEAD button = its endpoint 404s,
  // 500s or hangs. Probed from inside, without a session: alive endpoints
  // answer 401 (no auth) — 404/500/timeout means the button lies to the admin.
  try {
    const port = Number(process.env.PORT ?? 3000)
    const BUTOANE: [string, string][] = [
      ['Finanțe', '/api/admin/finance'],
      ['Circuitul banilor', '/api/admin/money-circuit'],
      ['Dovezile autonomiei', '/api/admin/autonomie/dovezi'],
      ['Magazine', '/api/admin/stores'],
      ['Vizitatori', '/api/admin/demos'],
      ['Contacte', '/api/admin/leads'],
      ['Chaturi vizitatori', '/api/admin/visitor-chats'],
      ['Inbox secretar', '/api/admin/inbound'],
      ['Cutia reală', '/api/admin/mailbox-live'],
      ['Mesaje contact', '/api/admin/contact-messages'],
      ['Utilizatori', '/api/admin/activity'],
      ['Istoric', '/api/admin/users'],
      ['Chei server', '/api/admin/env-check'],
      ['Tokenuri live', '/api/admin/token-checks'],
      ['Constructor', '/api/admin/constructor'],
      ['Recuperare', '/api/admin/backups'],
      ['Lacăt admin', '/api/admin/unlock/status'],
      ['Amprente vocale', '/api/voiceprint/list'],
    ]
    const moarte: string[] = []
    await Promise.all(
      BUTOANE.map(async ([nume, path]) => {
        try {
          const r = await fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(8_000) })
          if (r.status === 404 || r.status >= 500) moarte.push(`${nume} (${r.status})`)
        } catch {
          moarte.push(`${nume} (nu răspunde)`)
        }
      }),
    )
    info.butoane = `${BUTOANE.length - moarte.length}/${BUTOANE.length} vii`
    if (moarte.length)
      problems.push({
        id: 'buton_mort',
        grav: 'mediu',
        desc: `${moarte.length} butoane din Admin au endpointul MORT: ${moarte.join(', ')}.`,
        reparabil: 'verifică ruta în backend (repo_read); repar-o sau șterge butonul din AdminPanel (cere acordul ownerului)',
      })
  } catch {
    /* the probe itself failed — we don't invent problems */
  }

  // 8. THE VOICEPRINTS SURVIVE EVERY UPGRADE (Adrian, Aug 1: "la fiecare
  // upgrade să țină minte timbrul și vocea, să nu se mai piardă"). The prints
  // live in Postgres, which no deploy touches — so a MISSING admin print here
  // means it was truly lost (deleted by hand or DB rebuilt), and the voice
  // will no longer recognise him until he re-enrols.
  try {
    if (dbEnabled()) {
      const r = await getPool().query<{ n: string; admin_n: string }>(
        `SELECT count(*) AS n,
                count(*) FILTER (WHERE is_admin) AS admin_n
         FROM voiceprints`,
      )
      const n = Number(r.rows[0]?.n ?? 0)
      const adminN = Number(r.rows[0]?.admin_n ?? 0)
      const g = await getPool().query<{ n: string }>('SELECT count(*) AS n FROM voice_guests WHERE approved').catch(() => null)
      info.amprente = `${n} amprente (${adminN} admin) + ${Number(g?.rows[0]?.n ?? 0)} oaspeți aprobați`
      if (adminN === 0)
        problems.push({
          id: 'amprenta_admin_lipsa',
          grav: 'mediu',
          desc: 'Amprenta vocală a adminului LIPSEȘTE din baza de date — vocea nu-l mai recunoaște și lacătul vocal nu se mai deschide.',
          reparabil: 'ownerul dă Ctrl+F5 (să ia ultimul bundle) și îi vorbește lui Kelion — amprenta se re-înrolează singură la prima frază',
        })
    }
  } catch {
    /* the prints table answered nothing — the DB check above already reports */
  }

  // 9. THE DISPATCHER + THE RESERVE PURSE (Adrian, Aug 1: one purse, many
  // users). Telemetry always visible; a PROBLEM only when the day's reserve
  // spend passed the owner's cap — the app keeps running on the free pool,
  // but the owner must know the safety net is closed until tomorrow.
  try {
    info.dispecer = stareDispecer()
    const zi = utcDay()
    const rawSpent = await loadKv(`rezerva:zi:${zi}`).catch(() => null)
    const rawCap = await loadKv('rezerva:cap_zilnic').catch(() => null)
    const spent = rawSpent ? Number(rawSpent) : 0
    const capN = rawCap ? Number(rawCap) : NaN
    const cap = Number.isFinite(capN) && capN > 0 ? capN : REZERVA_CAP_ZILNIC_DEFAULT_USD
    const spentAzi = Number.isFinite(spent) ? spent : 0
    // NU E SĂRĂCIE (Adrian, 3 aug: „nu vede că are bani"). cap=0 e starea ALEASĂ
    // dinadins (leak-stop): fallback-ul PLĂTIT pe OpenRouter e închis special ca
    // să nu pornească modele plătite din greșeală. Creierul de LUCRU e Gemini
    // Tier 2, plătit pe cheia ownerului și funcțional — deci „rezerva la 0" NU e
    // o problemă și NU înseamnă „doar pool gratuit". Raportăm rezerva_plina DOAR
    // când ownerul a DESCHIS explicit rezerva (cap>0) și s-a epuizat.
    if (cap <= 0) {
      info.rezerva = `oprită intenționat (cap $0, leak-stop) — creierul de lucru e Gemini Tier 2 (plătit, pe cheia ownerului); fallback-ul plătit OpenRouter e închis dinadins, nu din lipsă de bani`
    } else {
      info.rezerva = `$${spentAzi.toFixed(4)} cheltuiți azi din rezervă (cap $${cap})`
      if (!poateFolosiRezerva(spentAzi, cap))
        problems.push({
          id: 'rezerva_plina',
          grav: 'mediu',
          desc: `Rezerva de plată deschisă de owner a atins capul zilnic ($${Number(spent).toFixed(2)} ≥ $${cap}) — până mâine fallback-ul plătit OpenRouter stă (creierul de lucru Gemini Tier 2 merge normal).`,
          reparabil: 'dacă traficul o cere, ownerul ridică capul: saveKv rezerva:cap_zilnic (prin db_query) — e o decizie de bani, NU o lua singur',
        })
    }
  } catch {
    /* kv unreachable — the DB check above already reports */
  }

  // 10. THE CHIRP EARS, UNDER CONSTANT WATCH (Adrian, Aug 2, direct order:
  // „un sistem de monitorizare care ține sub control peste tot folosirea
  // Chirp 3 HD, și dacă pică dă mesaj adminului imediat"). The counters live
  // in services/urechiChirp.ts — fed by routes/asr-stream.ts on every stream,
  // error, transparent reconnect and paid-fallback. Telemetry always visible;
  // a PROBLEM only on a RECENT persistent drop (auth/config or an unhealable
  // transient storm) — the admin is also paged instantly at the moment it
  // happens, this point is the standing proof for system_health.
  try {
    const u = stareUrechiChirp()
    info.urechiChirp = u.sumar
    if (!u.sanatoase)
      problems.push({
        id: 'urechi_chirp_bolnave',
        grav: 'mediu',
        desc: `Urechile Chirp (Google STT streaming) au căzut: ${u.motiv}. Vocea merge pe urechile OpenAI (plătite) până la reparare.`,
        reparabil: 'citește ultima eroare din jurnal («asr-stream»); dacă e auth/config → verifică GOOGLE_SERVICE_ACCOUNT_JSON pe VPS și regiunea «eu»',
      })
  } catch {
    /* the pulse itself unreadable — we don't invent problems */
  }

  return JSON.stringify({
    ok: problems.length === 0,
    verificatLa: new Date().toISOString(),
    info,
    probleme: problems,
    instructiune:
      problems.length === 0
        ? 'Totul e sănătos — spune-i ownerului doar dacă a întrebat.'
        : 'Enumeră-i ownerului problemele PE SCURT (x, y, z) și ÎNTREABĂ-L dacă să le repari. NU repara nimic fără acordul lui explicit.',
  })
}
