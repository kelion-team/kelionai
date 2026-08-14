// ── OCHII PE LOGURILE GAZDEI (owner, 14 aug: „cine monitorizează toate
// logurile? … nimeni — și asta trebuie aflat/rezolvat, tot, urgent, complet") ──
//
// Până azi, `constructor.log` și `auto-publicare.log` de pe VPS nu le citea
// NIMENI automat: blocajul constructorului l-a văzut ownerul cu ochii lui, nu
// sistemul. Containerul nu vedea fișierele (nu erau montate). De azi:
// deploy.sh + vps-set-env montează `/root/kelion` read-only la `/host/kelion`,
// iar modulul ăsta citește COADA fișierelor și scoate semnăturile de eroare —
// pentru self-heal (care deschide ordine pe recurență) și pentru server_ops
// (ca Kelion să le arate la cerere).
//
// REGULA #1 e respectată prin construcție: fișier absent (montarea încă nu a
// ajuns live / alt mediu) → `{ ok: false, motiv }`, NICIODATĂ text inventat.

import { open, stat } from 'node:fs/promises'

/** Directorul gazdei montat în container. Funcție (nu constantă) ca testele să
 *  poată arăta spre un director temporar prin env, fără importuri re-jucate. */
const radacina = (): string => process.env.HOST_KELION_DIR ?? '/host/kelion'

export const FISIERE_GAZDA = ['constructor.log', 'auto-publicare.log'] as const
export type FisierGazda = (typeof FISIERE_GAZDA)[number]

/** Coada (ultimii `maxBytes`) unui log de pe gazdă — sau motivul cinstit. */
export async function coadaLogGazda(
  fisier: FisierGazda,
  maxBytes = 64 * 1024,
): Promise<{ ok: true; text: string } | { ok: false; motiv: string }> {
  const cale = `${radacina()}/${fisier}`
  try {
    const s = await stat(cale)
    const fh = await open(cale, 'r')
    try {
      const lungime = Math.min(maxBytes, s.size)
      const start = Math.max(0, s.size - lungime)
      const buf = Buffer.alloc(lungime)
      await fh.read(buf, 0, lungime, start)
      return { ok: true, text: buf.toString('utf8') }
    } finally {
      await fh.close()
    }
  } catch (e) {
    return {
      ok: false,
      motiv: `nu pot citi ${cale}: ${String((e as Error)?.message ?? e).slice(0, 120)} (montarea /host/kelion vine cu deploy-ul; până atunci nu inventăm)`,
    }
  }
}

/** Liniile care put a eroare din textul unui log, normalizate și deduplicate.
 *  Întoarce LINIA ORIGINALĂ (pentru ordinul de reparație), nu forma normalizată
 *  — omul și constructorul au nevoie de context real, nu de amprentă.
 *
 *  Pentru loguri secvențiale de execuție (cum e auto-publicare.log):
 *  Dacă logul conține mai multe rulări, ne uităm doar la ULTIMA rulare.
 *  Dacă ultima rulare s-a terminat cu succes (anti-fantomă TRECE / Deploy finalizat),
 *  erorile din rulările vechi sunt istorice (deja rezolvate de noul deploy) și nu
 *  trebuie să mai nască alarme sau auto-vindecări fantomă. */
export function semnaturiEroare(text: string, maxim = 8): string[] {
  // Dacă textul provine dintr-un log de deploy/auto-publicare cu mai multe rulări,
  // izolăm ultima rulare ca să nu re-raportăm erori din rulări vechi deja reparate.
  const parti = text.split(/(?=(?:^|\n)(?:\[auto-publicare\]|== [01]\. Actualizez|== 0\. Blochez))/i)
  const textDeVerificat = parti[parti.length - 1] ?? text

  // Dacă ultima rulare s-a încheiat cu succes, nu există nicio eroare activă.
  if (/anti-fantom[ăa]\s+TRECE|Deploy finalizat cu succes/i.test(textDeVerificat)) {
    return []
  }

  const tipar =
    /\b(error|errors|eroare|erori|fatal|fail(ed|ure)?|pic[ăa]t?\b|refuz(at)?|denied|exception|traceback|unhandled|ECONN|ETIMEDOUT|EACCES|ENOSPC|creier_esec|\b5\d\d\b)/i
  // Linii care CONȚIN cuvinte de eroare dar sunt de fapt verdicte bune/contoare
  // pe zero — fără ele, „0 failed" ar fi născut ordine de reparație degeaba.
  // Tot zgomot sunt și erorile din subsisteme/furnizori DECOMISIONAȚI
  // (ex. RunPod/DeepInfra/OpenRouter — scoși din constructor, dar rămași în
  // coada logurilor istorice ale gazdei); liniile de log care doar citează/anunță
  // un ordin anterior sau o auto-vindecare (ex. „ordin #235...", „AUTO-VINDECARE",
  // „[CHAT-IN]", etc.), altfel titlul ordinului de auto-vindecare care conține
  // cuvântul „eroare" e re-detectat ca eroare nouă într-o buclă infinită; și
  // pașii normali de lucru ai constructorului (ex. `pas 18/120: grep ...`) care
  // conțin în argumente numele funcțiilor/fișierelor căutate.
  // (Regex unit din DOUĂ PR-uri paralele ale constructorului — job-254 și
  // job-256 au declarat fiecare `zgomot` din aceeași bază, iar merge-ul textual
  // le stivuise pe amândouă: master nu mai compila. Nicio alternativă pierdută.)
  const zgomot =
    /(\b0 (failed|errors?)\b|TRECE|passed|✅|verde|RunPod|DeepInfra|OpenRouter|AUTO-VINDECARE|ordin #\d+|\[CHAT-IN\]|\[BRAIN\]|^\s*\[?\d{1,2}:\d{2}:\d{2}\]?\s*pas\s+\d+\/\d+:\s*(grep|read|edit|write|ls|run|run_runbook|cauta|search))/i
  const vazute = new Set<string>()
  const out: string[] = []
  for (const linie of textDeVerificat.split('\n')) {
    if (!tipar.test(linie) || zgomot.test(linie)) continue
    const norm = linie
      .toLowerCase()
      .replace(/\d{4}-\d{2}-\d{2}[t ][\d:.,+z-]*/gi, '') // timpul nu schimbă eroarea
      .replace(/[0-9a-f]{8,}/gi, '') // sha-uri/id-uri
      .replace(/\d+/g, '#')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 160)
    if (!norm || vazute.has(norm)) continue
    vazute.add(norm)
    out.push(linie.trim().slice(0, 300))
    if (out.length >= maxim) break
  }
  return out
}
