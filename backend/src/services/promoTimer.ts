// ── P22: TIMERUL DE PROMOVARE (owner, 15 aug: „cu functie timer de promovare
// eventual la ore prestabilite") ─────────────────────────────────────────────
// Rulează DOAR sub cheile ownerului, toate la vedere: butonul lui (kv, implicit
// OPRIT), orele lui, plafonul lui zilnic, ideea lui — și comutatorul 🎬 din P29
// (generarea costă bani la Google). Orice refuz e PE NUME în jurnal; succesul
// se anunță în panou cu linkul clipului. Independent de „autonomie" (e ordinul
// LUI programat, ca publicarea — nu inițiativa lui Kelion).
import { loadKv, saveKv, recordCost, costAziPe } from '../db.js'
import { config } from '../config.js'
import { genereazaVideo, videoPlatitPornit, costVideoUsd } from './video.js'
import {
  KV_STUDIO_PROMO, setariPromoDinKv, motivRefuzPromo, promptVideoDinIdee, numeClip,
} from './studioClipuri.js'

const KV_ULTIMA = 'studio_promo_ultima'
export const FEL_COST_PROMO = 'video-promo'

/** O trecere a timerului (chemată din bucla de 5 min a serverului). Întoarce
 *  ce s-a întâmplat — pentru jurnal și pentru teste. */
export async function promoTick(acum = new Date()): Promise<{ rulat: boolean; motiv?: string; id?: string }> {
  const setari = setariPromoDinKv(await loadKv(KV_STUDIO_PROMO).catch(() => null))
  // Ieftin la ieșire: oprit = nicio altă citire (drumul comun, la 5 minute).
  if (!setari.pornit) return { rulat: false, motiv: 'promo_oprit (butonul ownerului)' }

  const p = (n: number): string => String(n).padStart(2, '0')
  const stampilaOra = `${acum.getFullYear()}-${p(acum.getMonth() + 1)}-${p(acum.getDate())} ${p(acum.getHours())}`
  const ultima = await loadKv(KV_ULTIMA).catch(() => null)
  const comutator = await videoPlatitPornit()
  const cheltuitAzi = await costAziPe(FEL_COST_PROMO)
  if (cheltuitAzi === null)
    return { rulat: false, motiv: 'cost_azi_necitibil — pe necitit nu se cheltuie (regula #1)' }

  const motiv = motivRefuzPromo({
    setari,
    oraAcum: acum.getHours(),
    dejaRulatOraAsta: ultima === stampilaOra,
    videoPornit: comutator.pornit,
    cheltuitAziUsd: cheltuitAzi,
    costClipUsd: costVideoUsd(config.videoModel, 8),
  })
  if (motiv) return { rulat: false, motiv }

  // Stampila se scrie ÎNAINTE de generare: dacă generarea durează/pică, ora
  // asta tot nu se mai încearcă a doua oară (un clip pe oră programată, LEGE).
  await saveKv(KV_ULTIMA, stampilaOra)
  const rezultat = await genereazaVideo(promptVideoDinIdee(setari.idee, 'Spot publicitar'), 8, false)
  if ('error' in rezultat) {
    console.error(`[promo] generarea programată a picat: ${rezultat.error.slice(0, 200)}`)
    return { rulat: false, motiv: `generare_picata: ${rezultat.error.slice(0, 160)}` }
  }
  void recordCost('kelion-promo', FEL_COST_PROMO, rezultat.costUsd)
  const nume = numeClip('Spot', setari.idee, acum)
  try {
    const { notifyAdmin } = await import('./adminNotification.js')
    await notifyAdmin(
      'scris',
      `🎬 Clipul de promovare al orei ${p(acum.getHours())}:00 e gata`,
      `„${setari.idee.slice(0, 120)}" → /api/video/${rezultat.id} (${rezultat.secunde}s, $${rezultat.costUsd.toFixed(2)}; azi: $${(cheltuitAzi + rezultat.costUsd).toFixed(2)} din plafonul $${setari.plafonUsdZi.toFixed(2)}). Nume sugerat: ${nume}.mp4`,
      { videoId: rezultat.id },
    )
  } catch {
    /* anunțul picat nu anulează clipul făcut */
  }
  return { rulat: true, id: rezultat.id }
}
