// ── SANTINELA PUBLICĂRII (ordinul ownerului, 15 aug: „acest lucru trebuie să
// fie monitorizat de Kelion") ─────────────────────────────────────────────────
//
// Gaura dovedită AZI, pe viu: publicarea a STAT peste 2 ore (live pe f3440b9
// de la 05:45, master avansat de 2 ori), iar Kelion n-a văzut NIMIC — senzorii
// lui caută ERORI în loguri, dar stagnarea nu scrie nicio eroare: e tăcere.
// Ownerul a aflat uitându-se la footer. Exact anti-tiparul regulii #1: o stare
// nemăsurată tratată ca „merge".
//
// CE MĂSOARĂ (la fiecare ciclu, ~5 min, pornit din index.ts):
//   • sha-ul PROPRIU al containerului (GIT_COMMIT_SHA) = ce rulează LIVE;
//   • vârful master de la GitHub (prin githubApi, ca santinelaPR);
//   • de CÂND ține discrepanța (kv 'santinela:publicare' — prima observare).
// Peste prag (SANTINELA_PUBLICARE_PRAG_MIN, implicit 20 min): alarmă O DATĂ
// per sha-de-master-neajuns — notifyAdmin('publicare_blocata') care, prin
// legătura din 15 aug, sună și TELEFONUL — cu faptele măsurate și coada
// logului de publicare de pe gazdă (coadaLogGazda), ca omul să vadă CAUZA,
// nu doar simptomul. Când publicarea își revine (procesul NOU pornește pe
// sha-ul așteptat), anunță o dată „și-a revenit" și curăță starea.
//
// (Brațul 2 — auto-remedierea prin runbook la alarmă — e pinuit în
// RAMAS-DE-FACUT; senzorul ăsta e ochiul, cerut azi verbatim.)
import { gh } from './githubApi.js'
import { saveKv, loadKv, deleteKv } from '../db.js'
import { notifyAdmin } from './adminNotification.js'
import { coadaLogGazda, semnaturiEroare } from './logGazda.js'

const CHEIE_KV = 'santinela:publicare'
const PRAG_MIN = Math.max(5, Number(process.env.SANTINELA_PUBLICARE_PRAG_MIN ?? 20))

interface StareStagnare {
  masterSha: string
  vazutLa: string
  anuntat?: boolean
}

/** Sha-ul pe care RULEAZĂ procesul ăsta — adevărul despre „live". */
const shaPropriu = (): string => (process.env.GIT_COMMIT_SHA ?? '').slice(0, 7)

export interface RaportPublicare {
  live: string
  master: string | null
  stagnareMin: number | null
  alarma: boolean
}

export async function ruleazaSantinelaPublicarii(): Promise<RaportPublicare> {
  const live = shaPropriu()
  const raport: RaportPublicare = { live, master: null, stagnareMin: null, alarma: false }
  if (!live) return raport // mediu fără sha injectat (dev/probe) — nu inventăm

  const r = await gh('/commits/master').catch(() => null)
  if (!r?.ok) return raport // GitHub necitibil acum — nu declarăm nimic pe o citire picată
  const j = (await r.json().catch(() => null)) as { sha?: string } | null
  const master = (j?.sha ?? '').slice(0, 7)
  if (!master) return raport
  raport.master = master

  // Live = master → totul curge. Dacă tocmai ne-am trezit DUPĂ o stagnare
  // anunțată (procesul nou pornește pe sha-ul așteptat), spune-o o dată.
  if (master === live) {
    const brut = await loadKv(CHEIE_KV).catch(() => null)
    if (brut) {
      const st = JSON.parse(brut) as StareStagnare
      if (st.anuntat)
        await notifyAdmin(
          'publicare_ok',
          'Publicarea și-a revenit',
          `Live rulează acum chiar vârful master (${live}). Stagnarea anunțată (de la ${st.vazutLa.slice(11, 16)}) s-a încheiat.`,
        ).catch(() => 0)
      await deleteKv(CHEIE_KV).catch(() => undefined)
    }
    return raport
  }

  // Master ≠ live: pornim/continuăm ceasul PE ACEST vârf de master. Un vârf
  // NOU de master repornește ceasul (avansul e normal câteva minute).
  const acum = new Date()
  let st: StareStagnare | null = null
  try {
    const brut = await loadKv(CHEIE_KV)
    if (brut) st = JSON.parse(brut) as StareStagnare
  } catch {
    st = null
  }
  if (!st || st.masterSha !== master) {
    st = { masterSha: master, vazutLa: acum.toISOString() }
    await saveKv(CHEIE_KV, JSON.stringify(st)).catch(() => undefined)
    return raport
  }

  const varsteMin = Math.floor((acum.getTime() - new Date(st.vazutLa).getTime()) / 60_000)
  raport.stagnareMin = varsteMin
  if (varsteMin < PRAG_MIN || st.anuntat) return raport

  // ALARMA — o singură dată per vârf-neajuns, cu CAUZA lângă simptom:
  // coada logului de publicare, prin ochiul deja construit pe gazdă.
  const log = await coadaLogGazda('auto-publicare.log', 16 * 1024).catch(
    () => ({ ok: false as const, motiv: 'citirea logului a picat' }),
  )
  const semne = log.ok ? semnaturiEroare(log.text, 4) : []
  const cauza = log.ok
    ? semne.length
      ? `Semnele din auto-publicare.log:\n${semne.join('\n')}`
      : 'auto-publicare.log nu are erori în coadă — posibil cronul mort sau un deploy atârnat (ultimele linii nu arată activitate nouă).'
    : `Logul publicării nu se poate citi de aici: ${log.motiv}`
  await notifyAdmin(
    'publicare_blocata',
    `Publicarea STĂ de ${varsteMin} min`,
    `Live rulează ${live}, dar master e la ${master} de ${varsteMin} minute (prag: ${PRAG_MIN}). ${cauza}`,
    { live, master, minute: varsteMin },
  ).catch(() => 0)
  st.anuntat = true
  await saveKv(CHEIE_KV, JSON.stringify(st)).catch(() => undefined)
  raport.alarma = true
  return raport
}
