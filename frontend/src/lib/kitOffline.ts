// ── KITUL OFFLINE — „auto download invizibil cu toate" (owner, 22 aug) ───────
//
// UN singur orchestrator pentru TOATE componentele modului offline:
//   1. CREIERUL — gemma prin WebLLM (există; creierLocal.ts își face singur
//      descărcarea — kitul doar NU se bagă peste el);
//   2. GURA — vocea Piper „Mihai" (63 MB, OPFS) — guraOffline.ts;
//   3. URECHEA — Whisper large-v3-turbo (~564 MB, Cache API
//      'transformers-cache', protejat la update) — urecheaOffline.ts.
//
// Regula descărcării e ACEEAȘI ca la creier (ordinul verbatim din 21 aug:
// automat, pe orice net, invizibil — fără bare, fără butoane): rulează DOAR
// online, sub autoDescarcareaPermisa() (contorul de eșecuri + gardul WebGPU
// al creierului), pe rând (întâi gura — mică, apoi urechea — mare), și tace.
// Nicio cădere nu se re-încearcă agresiv: următoarea trecere online reia.
import { autoDescarcareaPermisa } from './creierLocal'
import { esteConectat } from './conexiune'
import { descarcaGuraOffline, guraOfflinePregatita } from './guraOffline'
import { pregatesteUrecheaOffline, urecheaOfflineGata } from './urecheaOffline'

let inMers = false

/** O trecere de sincronizare a kitului — chemată la montare și la revenirea
 *  online (ChatPanel). Invizibilă, best-effort, idempotentă. */
export async function sincronizeazaKitOffline(): Promise<void> {
  if (inMers) return
  if (!esteConectat()) return
  if (!autoDescarcareaPermisa()) return
  inMers = true
  try {
    // 1. GURA (mică — întâi ea, ca măcar vocea constantă să fie gata repede):
    //    vocea RO + rezerva EN, doar dacă lipsesc.
    if (!(await guraOfflinePregatita('ro'))) await descarcaGuraOffline('ro')
    if (!(await guraOfflinePregatita('en'))) await descarcaGuraOffline('en')
    // 2. URECHEA (mare): pregătirea descarcă modelul în cache-ul protejat;
    //    dacă pică (net căzut la mijloc, GPU ocupat), trecerea următoare reia.
    if (!urecheaOfflineGata()) await pregatesteUrecheaOffline()
  } finally {
    inMers = false
  }
}
