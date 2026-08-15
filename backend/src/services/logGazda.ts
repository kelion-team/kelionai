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
  // Dacă textul provine dintr-un log secvențial (auto-publicare.log sau constructor.log)
  // cu mai multe rulări/joburi, izolăm ULTIMA rulare ca să nu re-raportăm erori vechi
  // deja rezolvate/istorice sau texte din prompturile ordinelor anterioare.
  // Permitem opțional timestamp la începutul liniei (ex. `[13:30:00] ordin #270`).
  const parti = text.split(
    /(?=(?:^|\n)(?:\[?\d{1,2}:\d{2}:\d{2}\]?\s*)?(?:\[auto-publicare\]|== [01]\. Actualizez|== 0\. Blochez|\[constructor\]|\[constructor-agent\]|=== (?:Job|ORDIN|Ordin)|🚀\s*\[?constructor\]?|Job #\d+|ordin #\d+|ORDINUL DE CONSTRUC[ȚT]IE))/i,
  )
  let textDeVerificat = (parti[parti.length - 1] ?? text).trim()

  // Dacă ultima rulare s-a încheiat cu succes (sau nu are erori active),
  // erorile din rulările vechi sunt istorice și nu trebuie să nască alarme.
  if (
    /anti-fantom[ăa]\s+TRECE|Deploy finalizat cu succes|✅\s*PR deschis|PR deschis(?::|\b)|✅\s*GATA|✅\s*PR #\d+|PR #\d+ deschis|finalizat cu succes|Nimic de f[ăa]cut/i.test(
      textDeVerificat,
    )
  ) {
    return []
  }

  // Eliminăm blocurile de prompt/instrucțiuni din corpul ordinului (de la antetul ordinului
  // până la începerea efectivă a pașilor de execuție / logurilor de lucru), altfel erorile
  // citate în descrierea sarcinii (ex. auto-vindecare) sunt confundate cu erori de rulare.
  textDeVerificat = textDeVerificat.replace(
    /(?:ORDINUL DE CONSTRUC[ȚT]IE|AUTO-VINDECARE\s*\([^)]*\):)[\s\S]*?(?=(?:^|\n)\s*(?:\[?\d{1,2}:\d{2}:\d{2}\]?\s*)?(?:pas\s+\d+|==|🚀|llm\s+|PR deschis|✅|\[constructor\]\s+pas|$))/i,
    '',
  )

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
  const zgomot =
    /(\b0 (failed|errors?)\b|TRECE|passed|✅|verde|RunPod|DeepInfra|OpenRouter|AUTO-VINDECARE|ordin #\d+|\[CHAT-IN\]|\[BRAIN\]|apare RECURENT eroarea|count=\d+,\s*prag=\d+|^\s*Step\s+\d+\/\d+\s*:|^\s*\[?\d{1,2}:\d{2}:\d{2}\]?\s*(?:pas\s+\d+\/\d+:\s*(?:grep|read|edit|write|ls|run|run_runbook|cauta|search)|llm\s+(?:încercarea|reîncercare)\s+\d+\/\d+)|\bit\(|\bexpect\(|\bdescribe\()/i
  const vazute = new Set<string>()
  const out: string[] = []
  let inPromptBloc = false
  for (const linie of textDeVerificat.split('\n')) {
    // Ignorăm blocurile de prompt citate în loguri (ex. ORDINUL DE CONSTRUCȚIE ... până la primul pas de execuție)
    if (/ORDINUL DE CONSTRUC[ȚT]IE|AUTO-VINDECARE \(constructor logs\)/i.test(linie)) {
      inPromptBloc = true
      continue
    }
    if (inPromptBloc) {
      if (/^\s*\[?\d{1,2}:\d{2}:\d{2}\]?\s*(?:pas\s+\d+\/\d+|==|🚀|PR deschis|Deploy finalizat)/i.test(linie)) {
        inPromptBloc = false
      } else {
        continue
      }
    }
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
