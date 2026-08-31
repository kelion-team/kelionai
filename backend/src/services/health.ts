import fs from 'node:fs/promises'
import { getPool, dbEnabled, listBuildJobs, countClientErrorsLastHour } from '../db.js'
import { resurseGazda, descrieResurse, PRAG_MEMORIE_PCT, PRAG_INCARCARE_PCT } from './resurse.js'
import { openaiHealth } from './openaiResponses.js'
import { stareDispecer } from './dispecer.js'
import { probaBrowserulMainilor } from './browser.js'
import { getConstructorChainStatus } from './constructorChainStatus.js'
import { GITHUB_API, ghToken } from './githubApi.js'

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

function ghHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${ghToken()}`,
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
    if (ghToken()) {
      const r = await fetch(`${GITHUB_API}/commits/master`, {
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
          reparabil: 'publisherul separat trebuie să reconcilieze master cu versiunea live; verifică jobul de deploy din panoul Constructor',
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
        fetch(`${GITHUB_API}/actions/runs?status=failure&per_page=15`, { headers: ghHeaders(), signal: AbortSignal.timeout(10_000) }),
        fetch(`${GITHUB_API}/actions/runs?per_page=40`, { headers: ghHeaders(), signal: AbortSignal.timeout(10_000) }),
      ])
      const fail = (await rFail.json()) as { workflow_runs?: { name?: string; run_number?: number; created_at?: string; updated_at?: string }[] }
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
      if (red.length) {
        // CAUZA, MĂSURATĂ din durata rulărilor, nu ghicită (8 aug: deploy +
        // sentinel roșii din 6 aug; fiecare job murea în 1-3s, 0 ms facturate,
        // runner_id=0, fără nicio schimbare în workflows — blocaj de CONT
        // GitHub, nu de cod). Semnătura: un job care nici nu pornește se
        // „termină" în câteva secunde; unul real durează minute.
        const toateInstant = red.every((w) => {
          const t0 = Date.parse(w.created_at ?? '')
          const t1 = Date.parse(w.updated_at ?? '')
          return Number.isFinite(t0) && Number.isFinite(t1) && t1 - t0 <= 20_000
        })
        problems.push({
          id: 'rulari_rosii',
          grav: 'mediu',
          desc:
            `${red.length} workflow-uri stricate ACUM (ultima rulare roșie): ${red.map((w) => `${w.name} #${w.run_number}`).join(', ')}` +
            (toateInstant ? ' — TOATE mor în ≤20s fără să pornească pe vreun runner (măsurat din durata rulărilor): blocaj de cont GitHub (minute/facturare Actions), nu de cod' : ''),
          reparabil: toateInstant
            ? 'nu se repară din cod: ownerul → github.com/organizations/kelion-team/settings/billing (minute Actions / limită / plată); publicarea pe site NU depinde de Actions (veghea VPS publică singură)'
            : 'investighează jurnalul workerului/publisherului separat și server_logs; procesul web nu rerulează workflow-uri',
        })
      }
    }
  } catch {
    /* same */
  }

  // 3. Failed build orders (the constructor).
  try {
    // null = query-ul cozii/migrarea nu poate fi citită. SELECT 1 de mai jos
    // dovedește doar conectivitatea, deci nu are voie să transforme asta în
    // listă goală și într-un health fals-verde.
    // Fereastră SCURTĂ (Adrian, 4 aug: „ce pică și nu mai e de actualitate să
    // nu mai rămână"): doar eșecurile din ultimele 3h — cele vechi, deja
    // parcate de autonomie, se sting singure din audit, nu se adună toată
    // noaptea.
    const jobs = await listBuildJobs(10)
    if (jobs === null) {
      problems.push({
        id: 'constructor_queue_unreadable',
        grav: 'critic',
        desc: 'Coada durabilă Constructor nu poate fi citită, deși baza poate încă răspunde la SELECT 1.',
        reparabil: 'verifică migrarea build_jobs și query-ul listBuildJobs; nu declara lanțul sănătos până când coada este lizibilă',
      })
    } else {
      const failed = jobs.filter((j) => j.status === 'failed' && Date.parse(j.updatedAt) > Date.now() - 3 * 3600_000)
      if (failed.length)
        problems.push({
          id: 'constructor_esuat',
          grav: 'mediu',
          desc: `${failed.length} ordine de construcție eșuate: ${failed.map((j) => `#${j.id}`).join(', ')}`,
          reparabil: 'vezi constructor_status + jurnalul din Admin→Constructor; repune ordinul reformulat cu build_software',
        })
    }
  } catch {
    problems.push({
      id: 'constructor_queue_unreadable',
      grav: 'critic',
      desc: 'Citirea cozii durabile Constructor a eșuat.',
      reparabil: 'verifică migrarea build_jobs și query-ul listBuildJobs; nu declara lanțul sănătos până când coada este lizibilă',
    })
  }

  // 4. The database + the client-error wave.
  try {
    if (dbEnabled()) {
      await getPool().query('SELECT 1')
      // Simptomele [PERF] sunt EXCLUSE de helper (owner, 13 aug): nu sunt
      // interfață ruptă, ci un semnal separat pe care creierul îl vede oricum în
      // contextul chatului — aici numărăm doar erorile reale de UI.
      const n = await countClientErrorsLastHour()
      if (n > 20)
        problems.push({
          id: 'erori_client',
          grav: 'mediu',
          desc: `${n} erori de client în ultima oră — ceva e rupt în interfață pentru useri.`,
          reparabil: 'citește client_errors, identifică simptomul și trimite un ordin build_software workerului separat',
        })
    } else {
      problems.push({ id: 'db_neconfigurata', grav: 'critic', desc: 'Baza de date nu e configurată.', reparabil: 'verifică DATABASE_URL pe VPS' })
    }
  } catch {
    problems.push({ id: 'db_moarta', grav: 'critic', desc: 'Baza de date NU răspunde (SELECT 1 a eșuat).', reparabil: 'verifică readiness și jurnalul serviciului PostgreSQL din infrastructura separată' })
  }

  // 5. The disk.
  try {
    const s = await fs.statfs('/')
    const usedPct = 100 - Math.round((Number(s.bavail) / Number(s.blocks)) * 100)
    info.disc = `${usedPct}%`
    if (usedPct >= 90)
      problems.push({ id: 'disc_plin', grav: 'critic', desc: `Discul e ${usedPct}% plin.`, reparabil: 'operatorul infrastructurii trebuie să investigheze retenția și spațiul; procesul web nu execută operații pe gazdă' })
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
        reparabil: 'operatorul infrastructurii trebuie să investigheze memoria și serviciile; procesul web nu execută operații pe gazdă',
      })
    if (res.incarcarePct >= PRAG_INCARCARE_PCT)
      problems.push({
        id: 'incarcare_mare',
        grav: 'mediu',
        desc: `Încărcare ${res.incarcarePct}% din ${res.procesoare} procesoare, susținut pe 15 min. Nu moare nimic, dar tot ce face casa devine încet — inclusiv chatul, care are țintă sub o secundă.`,
        reparabil: 'operatorul infrastructurii trebuie să investigheze încărcarea și să ajusteze serviciile ori capacitatea',
      })
  } else {
    info.resurse = 'nu se pot măsura de aici'
  }

  // 6. Creierul OpenAI. Semnalul este un apel mic prin aceeași cale Responses
  // folosită de chat; nu pretindem un sold pe care furnizorul nu îl expune.
  try {
    const g = await openaiHealth()
    info.creier = g.serving ? 'OpenAI servește' : `OpenAI NU servește (${g.class})`
    if (!g.serving)
      problems.push({
        id: 'creier_sarac',
        grav: 'critic',
        desc: `OpenAI (creierul unic) nu servește: ${g.class} — chatul se poate opri.`,
        reparabil: 'ownerul verifică motivul acționabil din Admin → Credit AI și configurația serverului',
      })
  } catch {
    /* ping unavailable */
  }

  // 7. THE ADMIN'S BUTTONS, WATCHED (Adrian, Aug 1: „Kelion must monitor all
  // the buttons — resolve their tasks, remove the dead ones"). Every button in
  // the Admin panel calls a read endpoint; a DEAD button = its endpoint 404s,
  // 500s or hangs. Probed from inside, without a session: alive endpoints
  // answer 401 (no auth) — 404/500/timeout means the button lies to the admin.
  try {
    // FALLBACK ALINIAT LA SERVER (5 aug, auditul de onestitate): serverul
    // ascultă pe `PORT ?? 8080` (config.ts:57). Aici era `?? 3000` — dacă PORT
    // nu e setat, sonda lovea portul greșit și RAPORTA toate butoanele admin ca
    // „nu răspunde" (roșu FALS — o citire eșuată prezentată ca fapt, regula #1).
    const port = Number(process.env.PORT ?? 8080)
    const BUTOANE: [string, string][] = [
      ['Finanțe', '/api/admin/finance'],
      ['Circuitul banilor', '/api/admin/money-circuit'],
      ['Magazine', '/api/admin/stores'],
      ['Vizitatori', '/api/admin/demos'],
      ['Contacte', '/api/admin/leads'],
      ['Inbox secretar', '/api/admin/inbound'],
      ['Cutia reală', '/api/admin/mailbox-live'],
      ['Mesaje contact', '/api/admin/contact-messages'],
      ['Utilizatori', '/api/admin/activity'],
      ['Istoric', '/api/admin/users'],
      ['Chei server', '/api/admin/env-check'],
      ['Tokenuri live', '/api/admin/token-checks'],
      ['Constructor', '/api/admin/constructor'],
      ['Recuperare', '/api/admin/backups'],
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


  // 9. THE DISPATCHER (Adrian, Aug 1: one brain, many users). Telemetry always
  // visible. (Punga de rezervă pe modele plătite a fost EXTIRPATĂ odată cu
  // Providerul cloud este unic; starea modelelor este raportată de Responses.)
  try {
    info.dispecer = stareDispecer()
  } catch {
    /* telemetry unreadable — we don't invent problems */
  }

  // 11. BROWSERUL MÂINILOR — PROBAT CU LANSARE, NU DECLARAT (owner, 15 aug:
  // „browserul acesta nu funcționează" + „ce-ar fi să testezi tot ce faci și
  // lași funcțional"). Instalarea din deploy 4b putea „reuși" cu un browser
  // care NU pornește (biblioteci de sistem lipsă) — și nimeni nu-l proba până
  // la primul om care se lovea. Proba lansează Chromium real (cache 10 min,
  // ca health-ul să rămână ieftin); MORT → intră la probleme, cu eroarea lui.
  try {
    const b = await probaBrowserulMainilor()
    info.browserMaini = b.ok ? 'VIU (lansare probată)' : `MORT: ${b.motiv}`
    if (!b.ok) {
      problems.push({
        id: 'browser-maini-mort',
        grav: 'mediu',
        desc: `browserul mâinilor (Chromium) nu pornește: ${b.motiv} — browser_open și pașii pe mâini cu browser pică`,
        reparabil: 'pe gazdă: cauza în /root/kelion/browser-install.log; de regulă lipsesc bibliotecile de sistem → o re-publicare rulează 4b cu --with-deps',
      })
    }
  } catch {
    /* proba însăși a crăpat — nu inventăm nici viu, nici mort */
  }

  const constructor = await getConstructorChainStatus()
  const constructorReady = constructor.state === 'ready' || constructor.state === 'busy'
  info.constructorExecutor = constructorReady
    ? `Lanț Constructor ${constructor.state}: OpenCode + Qwen local (llama.cpp) + publisher + release; coadă build_jobs`
    : `Lanț Constructor ${constructor.state}: ${constructor.reason}`
  if (!constructorReady) {
    problems.push({
      id: 'constructor_chain_unavailable',
      grav: 'critic',
      desc: `Fluxul Constructor complet nu este disponibil: ${constructor.reason}. Un worker verde nu dovedește publicarea sau release-ul.`,
      reparabil: 'verifică separat heartbeatul și configurația workerului, publisherului și releaserului raportate de panoul Constructor',
    })
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
