import fs from 'node:fs/promises'
import { getPool, dbEnabled, listBuildJobs } from '../db.js'
import { resurseGazda, descrieResurse, PRAG_MEMORIE_PCT, PRAG_INCARCARE_PCT } from './resurse.js'
import { getOpenRouterBalance } from './openrouter.js'

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
