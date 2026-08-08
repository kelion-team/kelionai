// ── CONTORUL FRAZEI (Adrian, 8 aug 2026: „afișează contor de când am terminat
// eu fraza până ajunge la creier") ──────────────────────────────────────────
//
// Fiecare segment al drumului, cronometrat de la ACELAȘI zero: clipa în care
// VAD-ul a închis fraza (tu ai terminat de vorbit). Până acum, [TIMP] de pe
// server măsura DOAR creierul (1619 ms) — segmentele de dinainte și de după
// erau invizibile, deci nedovedibile. Contorul le face vizibile pe toate:
//
//     [CONTOR] frază → cerere trimisă: 18 ms         (împachetarea în browser)
//     [CONTOR] frază → server a răspuns: 310 ms      (rețea + poarta serverului)
//     [CONTOR] frază → primul semn în stream: 1480 ms (creierul a început)
//     [CONTOR] frază → primul sunet: 2100 ms          (gura a pornit)
//
// Se citește în F12 → Console. Diferența dintre două rânduri = costul REAL al
// segmentului dintre ele; vinovatul se vede, nu se ghicește.
//
// Pornește DOAR la frază vocală (zero zgomot pe turele scrise) și scrie fiecare
// moment O SINGURĂ dată pe frază — lecția [captare]: un diagnostic care se
// repetă îneacă exact linia care contează.

let t0 = 0
const scrise = new Set<string>()

/** Zero-ul cronometrului: fraza s-a închis, audio-ul e gata de drum. */
export function frazaInchisa(): void {
  t0 = performance.now()
  scrise.clear()
  console.info('[CONTOR] frază închisă — cronometrul pornit')
}

/** Un moment de pe drum. Scrie delta față de închiderea frazei, o dată. */
export function moment(nume: string): void {
  if (!t0 || scrise.has(nume)) return
  scrise.add(nume)
  console.info(`[CONTOR] frază → ${nume}: ${Math.round(performance.now() - t0)} ms`)
}

/** Sfârșitul drumului (primul sunet, sau tura stinsă). Oprește contorul. */
export function gata(nume: string): void {
  moment(nume)
  t0 = 0
}
