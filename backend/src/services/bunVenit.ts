// ── GUSTAREA GRATIS — creditul de bun-venit (owner, 14 aug: „ideea e să nu
// consume și să nu plătească și plătesc eu… e o afacere până la urmă") ────────
//
// MĂSURAT înainte de a construi: zidul de plată există și e strâns (chat +
// voce + plafon de ture paralele) — nimeni nu consumă pe banii ownerului fără
// credit. DAR un om NOU era blocat la PRIMUL mesaj: zero gratis, prima
// reîncărcare min £20. Momeala lipsea cu totul — iar o afacere fără gustare
// nu vinde. De-acum: la prima venire, contul primește O SINGURĂ dată un credit
// mic de bun-venit (implicit 3 credite ≈ £0,30), apoi zidul cinstit.
//
// GĂRZILE (banii ownerului, nu robinet):
//   • O dată per email, pe veci — semn în kv (`bunvenit:<email>`), scris DOAR
//     după ce creditul chiar s-a acordat.
//   • Mărimea vine din env (CREDITE_BUN_VENIT); 0 = OPRIT complet. Un
//     rău-voitor cu conturi Google în serie fură cel mult gustarea — de-aia e
//     mică și reglabilă, nu generoasă.
//   • Ownerul nu primește (e scutit de plată oricum).
//   • Cadoul intră prin grantCredit → ambele registre contabile îl văd
//     (billing_events 'grant' + transactions) — nimic pe ascuns.

import { config } from '../config.js'
import { loadKv, saveKv, grantCreditMinor } from '../db.js'

/** Câte credite de bun-venit dă casa (0 = oprit). Reglabil fără deploy. */
export function crediteBunVenit(): number {
  const n = Number(process.env.CREDITE_BUN_VENIT ?? '3')
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

/** Acordă gustarea gratis O SINGURĂ dată. Întoarce true doar când chiar a
 *  acordat-o acum (pentru jurnal); false = deja primită / oprită / owner. */
export async function acordaBunVenit(email: string): Promise<boolean> {
  const e = (email ?? '').trim().toLowerCase()
  if (!e || e === config.adminEmail.toLowerCase()) return false
  const credite = crediteBunVenit()
  if (credite <= 0) return false
  const cheie = `bunvenit:${e}`
  if (await loadKv(cheie)) return false // gustarea se dă o dată, pe veci
  const sumaMinor = credite * config.billing.creditMinor
  if (!await grantCreditMinor(e, sumaMinor, `welcome:${e}`)) return false
  await saveKv(cheie, JSON.stringify({ la: new Date().toISOString(), credite }))
  console.log(`[bun-venit] credit acordat: ${credite}`)
  return true
}
