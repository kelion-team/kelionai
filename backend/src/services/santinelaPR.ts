// ── SANTINELA PR — Kelion, admin 2 la coada de îmbinare (owner, 14 aug) ──────
//
// Ordinul, verbatim: „cind sunt pr finalizate, kelion trebuie sa stie si el sa
// ma anunte cind sunt logat sa dau merged, daca nu sunt logat el are rol de
// admin 2 sub mine, sa verifice el, sa le traga de pe master si sa dea merged".
//
// Ce face, la fiecare ciclu (pornit din index.ts, la 5 min):
//   1. Citește PR-urile DESCHISE și, pentru fiecare, starea REALĂ a porților pe
//      sha-ul curent (checkul `porti-vps` scris de poarta de pe VPS) + starea de
//      îmbinare (mergeable_state). Nimic declarat — totul măsurat de la GitHub.
//   2. PR verde și îmbinabil:
//        • ownerul e ONLINE (prezența WS, apel.ts) → îl ANUNȚĂ (panoul de
//          notificări), o singură dată per PR+sha — decizia de merge e a lui.
//        • ownerul NU e online → Kelion e admin 2: îmbină EL, prin repoMergePR
//          (care își face singur checkpoint de recuperare și respectă pauza de
//          operațiuni). Cel mult UN merge per ciclu — master-ul se mișcă serial,
//          nu în rafală (regula „producția = master, 100% sincron").
//   3. PR verde dar RĂMAS ÎN URMĂ față de master („behind") → „îl trage de pe
//      master": update-branch; porțile se re-rulează pe sha-ul nou și decizia
//      se ia la un ciclu viitor, pe măsurătoarea NOUĂ — niciodată pe cea veche.
//
// GARDURILE (banii și producția ownerului):
//   • Kelion îmbină singur DOAR ramurile propriei automatizări (kelion/,
//     panou/, claude/) — un PR de om străin doar se anunță, nu se îmbină orb.
//   • Verde = checkul porti-vps SUCCES pe sha-ul CURENT + mergeable. Fără
//     check încă = „nu pot verifica" → nu se atinge (regula #1).
//   • Fiecare anunț/tragere e deduplicat pe PR+sha în kv — fără spam, fără
//     bucle.

import { gh, ghToken } from './githubApi.js'
import { repoMergePR } from './github.js'
import { esteOnline } from './apel.js'
import { notifyAdmin } from './adminNotification.js'
import { config } from '../config.js'
import { loadKv, saveKv } from '../db.js'

/** Ramurile pe care Kelion are voie să le îmbine SINGUR (automatizarea proprie). */
const PREFIXE_PROPRII = ['kelion/', 'panou/', 'claude/']

interface PrScurt {
  number: number
  title: string
  head: { ref: string; sha: string }
  draft?: boolean
}

export interface RaportSantinela {
  ok: boolean
  motiv?: string
  verificate: number
  anuntate: number[]
  imbinate: number[]
  trase: number[]
}

/** Starea checkului porti-vps pe un sha: 'success' | 'failure' | 'pending' | 'lipsa'. */
async function starePorti(sha: string): Promise<string> {
  const r = await gh(`/commits/${sha}/status`)
  if (!r.ok) return 'lipsa'
  const j = (await r.json()) as { statuses?: { context?: string; state?: string }[] }
  const p = (j.statuses ?? []).find((s) => s.context === 'porti-vps')
  return p?.state ?? 'lipsa'
}

export async function ruleazaSantinelaPR(): Promise<RaportSantinela> {
  const gol: RaportSantinela = { ok: false, verificate: 0, anuntate: [], imbinate: [], trase: [] }
  if (!ghToken()) return { ...gol, motiv: 'fara_token' }

  const lista = await gh('/pulls?state=open&per_page=30').catch(() => null)
  if (!lista || !lista.ok) return { ...gol, motiv: `citire_pr_esuata_${lista?.status ?? 'retea'}` }
  const prs = ((await lista.json()) as PrScurt[]).filter((p) => !p.draft)

  const raport: RaportSantinela = { ok: true, verificate: prs.length, anuntate: [], imbinate: [], trase: [] }
  const ownerOnline = esteOnline(config.adminEmail)
  let aImbinatUnul = false

  for (const pr of prs) {
    const sha = pr.head?.sha ?? ''
    if (!sha) continue
    const porti = await starePorti(sha)
    if (porti !== 'success') continue // roșu, pe drum sau „nu pot verifica" → nu se atinge

    // Starea de îmbinare vine doar din detaliul PR-ului (lista n-o are).
    const det = await gh(`/pulls/${pr.number}`).catch(() => null)
    if (!det || !det.ok) continue
    const dj = (await det.json()) as { mergeable?: boolean | null; mergeable_state?: string }
    const stare = String(dj.mergeable_state ?? 'unknown')

    // Rămas în urmă față de master → „îl trage de pe master" (o dată per sha);
    // porțile se re-rulează pe sha-ul nou, decizia vine la ciclul următor.
    // NU ne bazăm doar pe mergeable_state==='behind' (GitHub îl raportează
    // sigur doar sub protecție strictă de branch — altfel un PR în urmă poate
    // apărea „clean"): măsurăm DIRECT cu compare. Lecția din 14 aug: job-254
    // și job-256, verzi FIECARE pe sha-ul lui, au stivuit două declarații
    // `const zgomot` la îmbinarea textuală și master a rămas necompilabil —
    // porțile trebuie să ruleze chiar pe rezultatul îmbinării, adică pe sha-ul
    // de DUPĂ update-branch.
    let inUrma = stare === 'behind'
    if (!inUrma) {
      const cmp = await gh(`/compare/master...${sha}`).catch(() => null)
      const cj = cmp?.ok ? ((await cmp.json()) as { behind_by?: number }) : null
      inUrma = (cj?.behind_by ?? 0) > 0
    }
    if (inUrma) {
      const cheie = `santinela:tras:${pr.number}:${sha}`
      if (await loadKv(cheie)) continue
      const u = await gh(`/pulls/${pr.number}/update-branch`, { method: 'PUT' }).catch(() => null)
      await saveKv(cheie, JSON.stringify({ la: new Date().toISOString(), ok: !!u?.ok }))
      if (u?.ok) raport.trase.push(pr.number)
      continue
    }
    if (dj.mergeable !== true) continue

    if (ownerOnline) {
      // Ownerul e aici → a lui e decizia; Kelion doar anunță, o dată per PR+sha.
      const cheie = `santinela:anunt:${pr.number}:${sha}`
      if (await loadKv(cheie)) continue
      await notifyAdmin(
        'pr_gata',
        `PR #${pr.number} e verde — gata de merge`,
        `„${pr.title}" (${pr.head.ref}) a trecut porțile pe VPS și e îmbinabil. Îl îmbini tu, sau îl las santinelei când ieși?`,
        { pr: pr.number, sha, url: `https://github.com/kelion-team/kelionai/pull/${pr.number}` },
      ).catch(() => 0)
      await saveKv(cheie, JSON.stringify({ la: new Date().toISOString() }))
      raport.anuntate.push(pr.number)
      continue
    }

    // Ownerul NU e online → admin 2. Doar ramurile propriei automatizări și
    // cel mult un merge per ciclu (master serial, nu rafală).
    if (aImbinatUnul) continue
    if (!PREFIXE_PROPRII.some((p) => pr.head.ref.startsWith(p))) continue
    const rezultat = await repoMergePR(pr.number).catch(() => '')
    let ok = false
    try { ok = JSON.parse(rezultat)?.ok === true } catch { /* răspuns ne-JSON = eșec */ }
    if (ok) {
      aImbinatUnul = true
      raport.imbinate.push(pr.number)
      // Jurnalul faptei rămâne în panou — ownerul vede la întoarcere CE s-a
      // îmbinat în lipsa lui, cu linkul, nu o istorie mută.
      await notifyAdmin(
        'pr_gata',
        `Am îmbinat PR #${pr.number} (erai plecat)`,
        `„${pr.title}" (${pr.head.ref}): porți verzi pe VPS, îmbinabil, checkpoint de recuperare făcut înainte. Link: https://github.com/kelion-team/kelionai/pull/${pr.number}`,
        { pr: pr.number, sha },
      ).catch(() => 0)
    }
  }
  return raport
}
