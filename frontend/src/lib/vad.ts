// ── POARTA DE VOCE (VAD local) ───────────────────────────────────────────────
// Owner, 20 aug: „nu se poate activa doar la voce? nu la zgomot?" + „fa profi de la
// inceput." Măsurat în cod: sesiunea Gemini Live trimite microfonul CONTINUU spre
// server (vocalLive.ts, `ws.send` pe fiecare cadru), inclusiv în TĂCERE → se
// facturează audio de intrare chiar dacă nimeni nu vorbește (~$27/11h, măsurat de
// `CALIBRARE_LIVE`). Aici e poarta care deschide țeava DOAR când chiar se vorbește,
// și o închide pe tăcere/zgomot de fond — hands-free, dar plătești doar vorba reală.
//
// FĂCUT PROFI, nu un simplu prag de volum:
//  • prag ADAPTIV la zgomotul din cameră (fondul se învață singur) → un ventilator/
//    trafic constant intră în fond și NU deschide poarta; o voce clar peste fond, da;
//  • respinge zgomotul de bandă largă (hiss) la DESCHIDERE prin rata de treceri prin
//    zero (ZCR): vocea vocalizată are ZCR mic, hiss-ul are ZCR mare;
//  • DEBOUNCE la onset (nu deschide pe pocnete scurte: ușă, click);
//  • HANGOVER generos după ultima vorbire → NU taie coada cuvintelor ȘI lasă tăcerea
//    de final ca serverul (Gemini) să-și detecteze sfârșitul de tură;
//  • warm-up scurt: la pornire doar calibrează fondul.
// Regula de aur: la nesiguranță, poarta stă DESCHISĂ — mai bine trimitem un pic de
// tăcere decât să înghițim vorba omului. Strat PUR, testabil, fără rețea.

export interface ParamVad {
  /** De câte ori peste fondul învățat trebuie să fie nivelul ca să fie „vorbire". */
  factorSnr: number
  /** Prag RMS absolut minim: sub el e tăcere sigură, oricât de liniștită e camera. */
  pragAbsolut: number
  /** ZCR peste care semnalul e mai degrabă zgomot/hiss → nu DESCHIDEM pe el. */
  zcrMaxDeschidere: number
  /** Cât trebuie susținută vorbirea (ms) ca să deschidem (respinge pocnete scurte). */
  onsetMs: number
  /** Cât ținem deschis (ms) după ultima vorbire (coada cuvintelor + tăcerea de tură). */
  hangoverMs: number
  /** Netezirea EMA a fondului de zgomot (mic = se adaptează lent, stabil). */
  alfaFond: number
  /** Warm-up (ms): la început doar calibrăm fondul, ținem închis. */
  incalzireMs: number
}

// Valori alese pentru voce la 16 kHz, cu prag de siguranță spre DESCHIS. Nu sunt
// cifre de bani/tarif/stare afișată → nu cad sub legea anti-hardcodare; sunt
// parametri de semnal, ajustabili într-un singur loc.
export const PARAM_VAD_IMPLICIT: ParamVad = {
  factorSnr: 2.6,
  pragAbsolut: 0.006,
  zcrMaxDeschidere: 0.36,
  onsetMs: 120,
  hangoverMs: 800,
  alfaFond: 0.05,
  incalzireMs: 400,
}

export interface StareVad {
  fond: number // nivelul de referință învățat al zgomotului de fond
  deschis: boolean // poarta e deschisă (trimitem la model)?
  hangoverPana: number // tMs până la care ținem deschis după ultima vorbire
  onsetDin: number | null // de când depășim pragul fără să fi deschis încă (debounce)
  pornitLa: number // tMs la pornire (pentru warm-up)
}

export function stareVadInitiala(tMs: number): StareVad {
  return { fond: 0, deschis: false, hangoverPana: 0, onsetDin: null, pornitLa: tMs }
}

export interface CadruVad {
  rms: number
  zcr: number
  tMs: number
}

/** Un pas al porții pe un cadru MĂSURAT (rms + zcr). PUR: nu mută starea primită,
 *  întoarce noua stare + dacă poarta e deschisă (trimitem cadrul la model). */
export function pasVad(st: StareVad, cadru: CadruVad, p: ParamVad): { deschis: boolean; st: StareVad } {
  const { rms, zcr, tMs } = cadru

  // Warm-up: doar calibrăm fondul, stăm închiși (nu trimitem zgomot de pornire).
  if (tMs - st.pornitLa < p.incalzireMs) {
    const fond = st.fond === 0 ? rms : p.alfaFond * rms + (1 - p.alfaFond) * st.fond
    return { deschis: false, st: { ...st, fond, deschis: false, onsetDin: null, hangoverPana: 0 } }
  }

  const pragFond = Math.max(p.pragAbsolut, st.fond * p.factorSnr)
  const tare = rms > pragFond
  const voceLaDeschidere = zcr <= p.zcrMaxDeschidere

  let deschis = st.deschis
  let onsetDin = st.onsetDin
  let hangoverPana = st.hangoverPana

  if (deschis) {
    // Rămâne deschis: orice cadru „tare" reîmprospătează hangover-ul; altfel se
    // închide când trece fereastra de hangover (coada cuvintelor + tăcerea de tură).
    if (tare) hangoverPana = tMs + p.hangoverMs
    deschis = tMs < hangoverPana
    onsetDin = null
  } else {
    // Închis: deschidem doar la vorbire SUSȚINUTĂ (debounce) și care nu e hiss (ZCR).
    if (tare && voceLaDeschidere) {
      onsetDin = onsetDin ?? tMs
      if (tMs - onsetDin >= p.onsetMs) {
        deschis = true
        hangoverPana = tMs + p.hangoverMs
        onsetDin = null
      }
    } else {
      onsetDin = null
    }
  }

  // Fondul se învață DOAR când e clar tăcere (nu deschis și nu tare) — ca vorbirea
  // să nu umfle referința și să-și taie singură poarta.
  let fond = st.fond
  if (!deschis && !tare) fond = p.alfaFond * rms + (1 - p.alfaFond) * st.fond

  return { deschis, st: { fond, deschis, onsetDin, hangoverPana, pornitLa: st.pornitLa } }
}

/** RMS al unui cadru (0..~1). PUR. */
export function rmsDin(buf: Float32Array | number[]): number {
  const n = buf.length
  if (!n) return 0
  let s = 0
  for (let i = 0; i < n; i++) s += buf[i] * buf[i]
  return Math.sqrt(s / n)
}

/** Rata de treceri prin zero (0..1). PUR. Mică pentru voce vocalizată, mare pentru
 *  hiss/zgomot de bandă largă — de-aia ajută la respins zgomotul la deschidere. */
export function zcrDin(buf: Float32Array | number[]): number {
  const n = buf.length
  if (n < 2) return 0
  let treceri = 0
  for (let i = 1; i < n; i++) {
    if ((buf[i] >= 0) !== (buf[i - 1] >= 0)) treceri++
  }
  return treceri / (n - 1)
}
