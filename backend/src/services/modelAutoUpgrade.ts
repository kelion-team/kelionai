import { config, modelUnicCod, setModelUnicValidat, esteModelGeneralGreu } from '../config.js'
import { probeazaModelComplet, SARCINI } from './probaModel.js'
import { loadKv, saveKv } from '../db.js'

export { esteModelGeneralGreu } from '../config.js'

// ── AUTO-UPGRADE VALIDAT AL MODELULUI UNIC (Adrian, 6 aug, regula ultra-decisă:
// „mereu cel mai performant model complet; când apare ceva nou să fie preluat prin
// update automat, peste tot") ────────────────────────────────────────────────────
//
// DECIZIA PERMANENTĂ a ownerului: „mereu cel mai bun din familia slotului greu". Acest job o pune în
// practică — SINGURA cale prin care modelul unic se schimbă (env/UI/autonomia NU
// pot; vezi config.setModelUnicValidat + brainContract). Reguli de siguranță (ca
// să nu se mai rupă cum s-a rupt cu gemini-1.5 / hibridul):
//   1. DOAR familia slotului greu — flash, NICIODATĂ lite/experimental (poarta e în
//      config.setModelUnicValidat, nu aici).
//   2. DOAR mai nou — versiune STRICT mai mare decât cea activă (nu retrogradează).
//   3. DOAR VALIDAT — TOATE probele bateriei de admitere (services/probaModel.ts),
//      nu „majoritatea" și nu „a răspuns 200". Adrian, 7 aug: „dacă nu se respectă
//      tot să nu se facă upgrade; doar când apare modelul corespunzător să treacă
//      tot." Lecția care a impus-o, măsurată: gemini-3.6-flash e mai NOU ca
//      3.5-flash, răspunde frumos cu text (deci trecea proba veche), dar face
//      17/20 și pică lanțul de unelte — s-ar fi instalat singur și ar fi degradat
//      creierul TĂCUT. La orice eroare/necunoscut → rămâne pe cel curent.
//   4. CU DOVADĂ — scorul candidatului ȘI al modelului activ, probate în aceeași
//      trecere, se scriu în KV („model_upgrade_dovada"). Nu „a mers": cifra.

const KV_KEY = 'model_unic_activ'
const G_BASE = 'https://generativelanguage.googleapis.com/v1beta'
const VERIFICA_LA_MS = 24 * 60 * 60 * 1000 // zilnic
const PRIMA_LA_MS = 3 * 60 * 1000 // prima trecere la 3 min după pornire

/** Versiunea dintr-un id `gemini-X.Y-flash…` → [X, Y]; null dacă nu e din familia
 *  slotului greu sau dacă este un model specializat (eap, video, audio, lite etc.). */
export function versiune(cod: string): [number, number] | null {
  if (!esteModelGeneralGreu(cod)) return null
  const m = /^gemini-(\d+)(?:\.(\d+))?-flash/.exec(cod)
  if (!m) return null
  return [Number(m[1]), Number(m[2] ?? 0)]
}
export function maiNou(a: [number, number], b: [number, number]): boolean {
  return a[0] > b[0] || (a[0] === b[0] && a[1] > b[1])
}

/** Cheia sub care rămâne DOVADA ultimei verificări (scoruri + sarcini picate). */
const KV_DOVADA = 'model_upgrade_dovada'

/** Modelele din familia slotului GREU disponibile pe cheia ownerului (fără
 *  modele specializate: video, audio, live, image, eap, fără `-lite`). */
async function listeazaModeleGrele(): Promise<string[]> {
  if (!config.geminiKey) return []
  try {
    const r = await fetch(`${G_BASE}/models?pageSize=200`, {
      headers: { 'x-goog-api-key': config.geminiKey },
    })
    if (!r.ok) return []
    const j = (await r.json()) as { models?: { name?: string; supportedGenerationMethods?: string[] }[] }
    return (j.models ?? [])
      .map((m) => (m.name ?? '').replace(/^models\//, ''))
      .filter((cod) => esteModelGeneralGreu(cod))
      .filter((cod) => {
        const meths = (j.models ?? []).find((m) => (m.name ?? '').endsWith(cod))?.supportedGenerationMethods ?? []
        return meths.length === 0 || meths.includes('generateContent')
      })
  } catch {
    return []
  }
}

/** O trecere: dacă există un Pro STRICT mai nou ȘI trece proba reală → comută. */
export async function ruleazaAutoUpgradeModel(): Promise<void> {
  const activ = modelUnicCod()
  const vActiv = versiune(activ)
  if (!vActiv) return
  const candidati = await listeazaModeleGrele()
  let best: { cod: string; v: [number, number] } | null = null
  for (const cod of candidati) {
    const v = versiune(cod)
    if (v && maiNou(v, vActiv) && (!best || maiNou(v, best.v))) best = { cod, v }
  }
  if (!best) return // nimic mai nou — rămâne cel curent, tăcut

  // ── POARTA (Adrian, 7 aug): „dacă nu se respectă TOT, să nu se facă upgrade;
  // doar când apare modelul corespunzător, să treacă tot." ────────────────────
  // Deci NU „majoritatea", NU „mai bun decât cel curent", NU „a răspuns 200":
  // TOATE cele 10 sarcini, fiecare cu verificare automată și exactă. Un singur
  // punct pierdut = rămâne modelul actual, oricât de nou e numărul candidatului.
  console.log(`[MODEL-UPGRADE] candidat mai nou: ${best.cod} (activ: ${activ}) — rulez bateria completă (${SARCINI.length} probe)…`)
  const p = await probeazaModelComplet(best.cod)
  // Modelul ACTIV e probat în ACEEAȘI trecere, ca dovada să fie o comparație pe
  // aceleași condiții și în aceeași zi — nu o cifră veche din altă rulare.
  const pActiv = await probeazaModelComplet(activ)
  const dovada = {
    la: new Date().toISOString(),
    candidat: { model: p.model, scor: p.scor, total: p.total, picate: p.picate, detaliu: p.detaliu },
    activ: { model: pActiv.model, scor: pActiv.scor, total: pActiv.total, picate: pActiv.picate },
    decizie: p.scor === p.total ? 'trecut' : 'refuzat',
  }
  await saveKv(KV_DOVADA, JSON.stringify(dovada)).catch(() => {})

  if (p.scor !== p.total) {
    console.warn(
      `[MODEL-UPGRADE] ❌ ${best.cod} a picat bateria: ${p.scor}/${p.total} ` +
        `(picate: ${p.picate.join(', ')}). RĂMÂN pe ${activ} (${pActiv.scor}/${pActiv.total}). ` +
        `Dovada e în KV „${KV_DOVADA}".`,
    )
    return
  }
  if (setModelUnicValidat(best.cod)) {
    await saveKv(KV_KEY, best.cod).catch(() => {})
    console.log(
      `[MODEL-UPGRADE] ✅ ${best.cod} a trecut TOATE cele ${p.total} probe — comut de pe ${activ} ` +
        `(${pActiv.scor}/${pActiv.total}). Dovada e în KV „${KV_DOVADA}".`,
    )
  } else {
    console.warn(`[MODEL-UPGRADE] ${best.cod} a trecut probele dar poarta de familie l-a refuzat — rămân pe ${activ}`)
  }
}

/** Dovada ultimei verificări de upgrade (pentru panou/raport). null dacă n-a rulat
 *  niciodată — „nu pot verifica", nu o cifră inventată. */
export async function dovadaUltimuluiUpgrade(): Promise<unknown | null> {
  try {
    const s = await loadKv(KV_DOVADA)
    return s ? (JSON.parse(s) as unknown) : null
  } catch {
    return null
  }
}

/** La pornire: reia modelul unic salvat (un upgrade validat de dinainte). */
export async function incarcaModelUnic(): Promise<void> {
  try {
    const stocat = await loadKv(KV_KEY)
    if (stocat && setModelUnicValidat(stocat)) {
      console.log(`[MODEL-UPGRADE] model unic reluat din KV: ${stocat}`)
    }
  } catch {
    /* rămâne pe defaultul sigilat din cod */
  }
}

let timer: ReturnType<typeof setInterval> | null = null
/** Pornește veghea de auto-upgrade (prima la 3 min, apoi zilnic). */
export function startAutoUpgradeModel(): void {
  if (timer) return
  setTimeout(() => void ruleazaAutoUpgradeModel().catch(() => {}), PRIMA_LA_MS)
  timer = setInterval(() => void ruleazaAutoUpgradeModel().catch(() => {}), VERIFICA_LA_MS)
}
