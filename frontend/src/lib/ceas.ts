// ── CINE BLOCHEAZĂ FIRUL PRINCIPAL (Adrian, 8 aug 2026) ─────────────────────
//
// Din consola lui, în timpul vocii:
//
//     29 × [Violation] 'setInterval' handler took <N>ms
//
// Browserul spune CĂ ceva blochează, dar nu spune CE: mesajul e anonim, iar în
// bundle-ul minificat nici stiva nu ajută. Aplicația are 26 de `setInterval`.
// Am fi putut ghici care — exact ce n-avem voie să facem.
//
// Aici fiecare bătaie de ceas își spune numele și cât a durat. Un cronometru pe
// o funcție e ieftin (`performance.now()` de două ori); scrie DOAR când a durat
// peste prag, deci pe drumul sănătos nu costă nimic și nu îneacă nimic —
// lecția din `[captare]`, care scria un rând pe secundă și acoperea tot.
//
// Nu repară încetineala. O face MĂSURABILĂ, ca reparația să nu fie pe ghicite.

/** Peste atâtea milisecunde, o bătaie a întârziat destul cât să se vadă (o
 *  redare la 60fps are 16,7 ms per cadru; 50 ms înseamnă trei cadre sărite). */
const PRAG_MS = 50

/** Cât de rar se repetă avertismentul pentru ACELAȘI ceas — un ceas lent la
 *  fiecare bătaie ar scrie de sute de ori și am fi înapoi la spam. */
const TACERE_MS = 10_000

const ultimulAvertisment = new Map<string, number>()

/** Cea mai lentă bătaie văzută pentru fiecare ceas, ca dovadă adunată. */
const varfuri = new Map<string, { maxMs: number; batai: number; lente: number }>()

function masoaraBataia(nume: string, fn: () => void): void {
  const t0 = performance.now()
  try {
    fn()
  } finally {
    const ms = performance.now() - t0
    const v = varfuri.get(nume) ?? { maxMs: 0, batai: 0, lente: 0 }
    v.batai++
    if (ms > v.maxMs) v.maxMs = ms
    if (ms > PRAG_MS) {
      v.lente++
      const acum = performance.now()
      if (acum - (ultimulAvertisment.get(nume) ?? -Infinity) > TACERE_MS) {
        ultimulAvertisment.set(nume, acum)
        console.warn(`[ceas lent] „${nume}" a ținut firul ${Math.round(ms)} ms (vârf ${Math.round(v.maxMs)} ms, ${v.lente} din ${v.batai} bătăi)`)
        // ALERTĂ LA CREIER (owner, 13 aug): ceasurile FOARTE lente (vârf >500ms)
        // ajung la server, ca simptomul să fie vizibil creierului, nu doar în F12.
        // Bucket pe 100ms → dedup (nu îneacă). Import lene ca să nu creăm ciclu.
        if (v.maxMs > 500)
          void import('./errorReport').then((m) =>
            m.raporteazaSimptom(`[PERF] ceas lent „${nume}" vârf ~${Math.round(v.maxMs / 100) * 100}ms`),
          )
      }
    }
    varfuri.set(nume, v)
  }
}

/**
 * `setInterval` cu nume. Întoarce exact ce întoarce `window.setInterval`, deci
 * se oprește la fel (`clearInterval`) — se poate înlocui apel cu apel, fără să
 * se schimbe nimic în jur.
 */
export function ceas(nume: string, fn: () => void, ms: number): number {
  return window.setInterval(() => masoaraBataia(nume, fn), ms)
}

// ── RAPORTUL, LA CERERE, DIN CONSOLĂ ────────────────────────────────────────
// Scris pe `window` intenționat: ownerul lucrează în F12, pe telefon și pe
// laptop, și trebuie să poată cere tabelul CÂND vede că merge greu — nu să
// aștepte ca un prag să se declanșeze singur. Se tastează:
//
//     kelionCeasuri()
//
// și iese un tabel cu fiecare ceas, vârful lui și câte bătăi au fost lente.
declare global {
  interface Window {
    kelionCeasuri?: () => void
  }
}

window.kelionCeasuri = (): void => {
  const randuri = [...varfuri.entries()]
    .map(([nume, v]) => ({ ceas: nume, 'vârf ms': Math.round(v.maxMs), bătăi: v.batai, lente: v.lente }))
    .sort((a, b) => b['vârf ms'] - a['vârf ms'])
  if (randuri.length === 0) {
    console.info('[ceasuri] niciun ceas n-a bătut încă în pagina asta — nu e „totul rapid", e „n-am ce măsura".')
    return
  }
  console.table(randuri)
}
