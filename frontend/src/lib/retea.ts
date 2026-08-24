// ── DETECȚIA ȚEVII + CALITATE ADAPTIVĂ (owner, 12 aug: „test care vede ce țeavă
//    se folosește și comută calitatea dinamic?") ──────────────────────────────
//
// CE E REAL (și de-aia e aici):
//  - Pe Chromium (telefonul owner-ului / APK) există Network Information API:
//    `navigator.connection` dă `effectiveType` (slow-2g/2g/3g/4g), `downlink`
//    (Mbit/s ESTIMAT de browser), `rtt` (ms) și `saveData` (omul a cerut
//    economie). Se reîmprospătează singur și trage un event `change` — deci
//    putem comuta DINAMIC, nu o dată la pornire.
//  - Pe Safari/iOS/Firefox API-ul LIPSEȘTE → întoarcem `necunoscut`, iar
//    `necunoscut` păstrează EXACT calitatea de azi (fără regresie nicăieri).
//
// CE NU E aici (ca să nu mint): banda VOCII live e PCM brut, fixă, cerută de
// OpenAI Realtime (16 kHz sus / 24 kHz jos în protocolul Kelion) — nu se poate micșora dinamic fără să
// comprimăm cu Opus (schimbare mai mare, separată). Levierul real și sigur de
// aici e VEDEREA (camera): dimensiune + calitate JPEG + număr de cadre.

export type Teava = 'slab' | 'mediu' | 'bun' | 'necunoscut'

export interface InfoRetea {
  effectiveType?: string // 'slow-2g' | '2g' | '3g' | '4g'
  downlink?: number // Mbit/s (estimare browser)
  rtt?: number // ms
  saveData?: boolean
}

/** Din semnalele browserului → o treaptă. PURĂ, ca s-o putem proba fără rețea.
 *  `saveData` bate tot (omul a cerut explicit economie). `4g` cu debit mic sau
 *  RTT mare NU e „bun": eticheta browserului spune „rapid", dar cifrele
 *  MĂSURATE spun adevărul. Fără niciun semnal → `necunoscut` (= calitatea de azi). */
export function clasificaTeava(info: InfoRetea): Teava {
  if (info.saveData) return 'slab'
  const et = info.effectiveType
  if (et === 'slow-2g' || et === '2g') return 'slab'
  if (et === '3g') return 'mediu'
  if (et === '4g') {
    if ((info.downlink !== undefined && info.downlink < 1) || (info.rtt !== undefined && info.rtt > 500)) return 'mediu'
    return 'bun'
  }
  // Fără effectiveType, dar cu downlink/rtt măsurate.
  if (info.downlink !== undefined || info.rtt !== undefined) {
    const dl = info.downlink ?? 10
    const rtt = info.rtt ?? 50
    if (dl < 0.5 || rtt > 800) return 'slab'
    if (dl < 2 || rtt > 400) return 'mediu'
    return 'bun'
  }
  return 'necunoscut'
}

interface ConnLike extends InfoRetea {
  addEventListener?: (tip: string, cb: () => void) => void
  removeEventListener?: (tip: string, cb: () => void) => void
}

function conn(): ConnLike | null {
  if (typeof navigator === 'undefined') return null
  const n = navigator as unknown as {
    connection?: ConnLike
    mozConnection?: ConnLike
    webkitConnection?: ConnLike
  }
  return n.connection ?? n.mozConnection ?? n.webkitConnection ?? null
}

function citeste(): InfoRetea {
  const c = conn()
  if (!c) return {}
  return { effectiveType: c.effectiveType, downlink: c.downlink, rtt: c.rtt, saveData: c.saveData }
}

/** Treapta de ACUM — citită live (property reads sincrone, ieftine), deci mereu
 *  proaspătă fără să depindă de vreo pornire. */
export function getTeava(): Teava {
  return clasificaTeava(citeste())
}

/** CONEXIUNE LENTĂ (owner, 11 aug: „aplicația trebuie să meargă și pe 3G date").
 *  Pe 3G/2G/economie NU mai descărcăm avatarul 3D (~1 MB three.js) — fură banda
 *  de care au nevoie chatul și vocea (Stage.tsx o folosește exact pentru asta).
 *  PĂSTRAT identic cu prima variantă: 4G rămâne mereu „rapid", API absent → NU
 *  penalizăm (fals). E, ca înțeles, „țeava e slabă sau medie". */
export function reteaLenta(): boolean {
  const c = conn()
  if (!c) return false
  if (c.saveData) return true
  const t = String(c.effectiveType ?? '')
  return t === 'slow-2g' || t === '2g' || t === '3g'
}

// NB: comutarea calității e DINAMICĂ fără vreun watcher — `getTeava()` citește
// live semnalele browserului la fiecare cadru (property reads sincrone). Un
// watcher pe `connection.change` (subscribeTeava/pornesteRetea) exista aici, dar
// n-avea niciun abonat — surplus mort, scos ca să nu rămână cod nelegat.

// ── CALITATEA CAMEREI PE TREAPTĂ ────────────────────────────────────────────
export interface CalitateCamera {
  maxDim: number // latura maximă a cadrului (px)
  jpeg: number // calitate JPEG 0–1
  cadre: number // câte cadre trimitem la o cerere de vedere
}

/** Profilul de vedere pe treaptă. `bun`/`necunoscut` = EXACT ce e azi (512 /
 *  0.6 / 4) — nicio regresie. `slab`/`mediu` scad pixelii, calitatea și numărul
 *  de cadre, ca vederea să treacă și pe 2G/3G fără să sufoce vocea. */
export function calitateCamera(t: Teava): CalitateCamera {
  switch (t) {
    case 'slab':
      return { maxDim: 320, jpeg: 0.4, cadre: 1 }
    case 'mediu':
      return { maxDim: 448, jpeg: 0.5, cadre: 2 }
    default:
      return { maxDim: 512, jpeg: 0.6, cadre: 4 }
  }
}
