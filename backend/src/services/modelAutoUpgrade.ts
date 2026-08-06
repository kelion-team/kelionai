import { config, modelUnicCod, setModelUnicValidat } from '../config.js'
import { geminiDirectChat } from './geminiDirect.js'
import { loadKv, saveKv } from '../db.js'

// ── AUTO-UPGRADE VALIDAT AL MODELULUI UNIC (Adrian, 6 aug, regula ultra-decisă:
// „mereu cel mai performant model complet; când apare ceva nou să fie preluat prin
// update automat, peste tot") ────────────────────────────────────────────────────
//
// DECIZIA PERMANENTĂ a ownerului: „mereu cel mai bun Pro". Acest job o pune în
// practică — SINGURA cale prin care modelul unic se schimbă (env/UI/autonomia NU
// pot; vezi config.setModelUnicValidat + brainContract). Reguli de siguranță (ca
// să nu se mai rupă cum s-a rupt cu gemini-1.5 / hibridul):
//   1. DOAR Pro — niciodată flash/lite/experimental (setModelUnicValidat refuză).
//   2. DOAR mai nou — versiune STRICT mai mare decât cea activă (nu retrogradează).
//   3. DOAR VALIDAT — o probă REALĂ (payload ca-n aplicație, cu gândire) trebuie să
//      răspundă 200 cu text; altfel rămâne pe cel curent (lecția 4 aug: un smoke gol
//      nu validează un model). La orice eroare/necunoscut → rămâne pe cel curent.

const KV_KEY = 'model_unic_activ'
const G_BASE = 'https://generativelanguage.googleapis.com/v1beta'
const VERIFICA_LA_MS = 24 * 60 * 60 * 1000 // zilnic
const PRIMA_LA_MS = 3 * 60 * 1000 // prima trecere la 3 min după pornire

/** Versiunea dintr-un id `gemini-X.Y-pro…` → [X, Y]; null dacă nu e Pro. */
function versiune(cod: string): [number, number] | null {
  const m = /^gemini-(\d+)(?:\.(\d+))?-pro/.exec(cod)
  if (!m) return null
  return [Number(m[1]), Number(m[2] ?? 0)]
}
function maiNou(a: [number, number], b: [number, number]): boolean {
  return a[0] > b[0] || (a[0] === b[0] && a[1] > b[1])
}

/** Proba REALĂ: payload ca-n aplicație (gândire pornită, plafon de output ridicat).
 *  Un model nou intră DOAR dacă răspunde 200 cu text — nu pe un smoke gol. */
async function probeazaModel(cod: string): Promise<boolean> {
  try {
    const r = await geminiDirectChat(
      `google-direct/${cod}`,
      [{ role: 'user', content: 'Răspunde cu un singur cuvânt: gata.' }],
      [],
      { maxTokens: 2000, reasoning: 'high' },
    )
    return Boolean(r.text && r.text.trim().length > 0 && r.stop !== 'no_key')
  } catch {
    return false
  }
}

/** Modelele Pro disponibile pe cheia ownerului (fără vision/experimental ciudat). */
async function listeazaModelePro(): Promise<string[]> {
  if (!config.geminiKey) return []
  try {
    const r = await fetch(`${G_BASE}/models?pageSize=200`, {
      headers: { 'x-goog-api-key': config.geminiKey },
    })
    if (!r.ok) return []
    const j = (await r.json()) as { models?: { name?: string; supportedGenerationMethods?: string[] }[] }
    return (j.models ?? [])
      .map((m) => (m.name ?? '').replace(/^models\//, ''))
      .filter((cod) => /^gemini-\d+(?:\.\d+)?-pro/.test(cod) && !/vision|thinking-exp|tuning/.test(cod))
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
  const candidati = await listeazaModelePro()
  let best: { cod: string; v: [number, number] } | null = null
  for (const cod of candidati) {
    const v = versiune(cod)
    if (v && maiNou(v, vActiv) && (!best || maiNou(v, best.v))) best = { cod, v }
  }
  if (!best) return // nimic mai nou — rămâne cel curent, tăcut
  console.log(`[MODEL-UPGRADE] candidat mai nou: ${best.cod} (activ: ${activ}) — probez cu payload real…`)
  if (!(await probeazaModel(best.cod))) {
    console.warn(`[MODEL-UPGRADE] ${best.cod} NU a trecut proba reală — RĂMÂN pe ${activ} (nu degradez pe un model nevalidat)`)
    return
  }
  if (setModelUnicValidat(best.cod)) {
    await saveKv(KV_KEY, best.cod).catch(() => {})
    console.log(`[MODEL-UPGRADE] ✅ trecut AUTOMAT pe modelul mai nou VALIDAT: ${best.cod} (peste tot). Anterior: ${activ}`)
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
