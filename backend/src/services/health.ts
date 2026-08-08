import fs from 'node:fs/promises'
import { config } from '../config.js'
import { getPool, dbEnabled, listBuildJobs } from '../db.js'
import { getOpenRouterBalance } from './openrouter.js'

// ── OCHII LUI KELION PE PROPRIA SĂNĂTATE (Adrian, 27 iul: „Kelion trebuie să
// vadă asta și să poată comunica adminului prin chat că are problemele x,y,z
// și să întrebe dacă să le repare") ─────────────────────────────────────────
// Agregare DETERMINISTĂ a tuturor semnalelor de sănătate pe care le avem
// oricum: sincronizarea publicării (live vs master), rulările roșii recente,
// ordinele de construcție eșuate, valul de erori client, discul, DB-ul,
// punga creierului. Kelion o cheamă prin unealta system_health și REDĂ lista
// adminului + ÎNTREABĂ dacă să repare — nu repară nimic din proprie inițiativă.

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

  // 1. Publicarea: live == vârful lui master? (adevărul central al casei)
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
    /* GitHub inaccesibil — nu inventăm probleme */
  }

  // 2. Rulările roșii din ultimele 48h (deploy + restul workflow-urilor).
  try {
    if ((process.env.GITHUB_TOKEN ?? '').trim()) {
      const r = await fetch(`${GH}/actions/runs?status=failure&per_page=10`, {
        headers: ghHeaders(),
        signal: AbortSignal.timeout(10_000),
      })
      const data = (await r.json()) as { workflow_runs?: { name?: string; run_number?: number; created_at?: string; html_url?: string }[] }
      const cutoff = Date.now() - 48 * 3600_000
      const red = (data.workflow_runs ?? []).filter((w) => Date.parse(w.created_at ?? '') > cutoff)
      if (red.length)
        problems.push({
          id: 'rulari_rosii',
          grav: 'mediu',
          desc: `${red.length} rulări roșii în ultimele 48h: ${red.map((w) => `${w.name} #${w.run_number}`).join(', ')}`,
          reparabil: 'vindecătorul le rerulează singur când live==master; altfel investighează cu runbook_log',
        })
    }
  } catch {
    /* idem */
  }

  // 3. Ordine de construcție eșuate (constructorul).
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
    /* DB moartă — prinsă mai jos */
  }

  // 4. Baza de date + valul de erori client.
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

  // 5. Discul.
  try {
    const s = await fs.statfs('/')
    const usedPct = 100 - Math.round((Number(s.bavail) / Number(s.blocks)) * 100)
    info.disc = `${usedPct}%`
    if (usedPct >= 90)
      problems.push({ id: 'disc_plin', grav: 'critic', desc: `Discul e ${usedPct}% plin.`, reparabil: 'run_runbook curata-zombi sau docker system prune (cere acordul ownerului)' })
  } catch {
    /* statfs indisponibil */
  }

  // 6. Punga creierului (OpenRouter).
  try {
    const b = await getOpenRouterBalance()
    info.creier = b.ok ? `$${b.balance.toFixed(2)}` : 'necunoscut'
    if (b.ok && b.low)
      problems.push({
        id: 'creier_sarac',
        grav: 'critic',
        desc: `Soldul OpenRouter e $${b.balance.toFixed(2)} — sub prag; creierul se poate opri.`,
        reparabil: 'doar ownerul poate alimenta (openrouter.ai/credits) până pornește circuitul automat Stripe Issuing',
      })
  } catch {
    /* balanța indisponibilă */
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
