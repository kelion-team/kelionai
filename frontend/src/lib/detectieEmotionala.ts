// ── DETECȚIA EMOȚIONALĂ (owner, 22 aug 2026: „simte") ───────────────────────
//
// Detectează emoția din expresia facială folosind landmark-urile face-api.js
// (deja încărcate pentru faceprint). Analiza e GEOMETRICĂ — nu necesită un
// model ML suplimentar, doar măsoară distanțe între puncte faciale:
//   - Zâmbet: colțurile gurii sus vs baza nasului
//   - Sprâncene încruntate: distanța între sprâncene mică + înălțime
//   - Surprindere: gura deschisă (distanța buzelor mare)
//   - Tristețe: colțurile gurii jos vs baza nasului
//   - Calm: toate distanțele în interval neutru
//
// Trimite emoția detectată la /api/emotie pentru ca backend-ul să o salveze
// ca memorie emoțională și să o injecteze în contextul creierului.

export type Emotie = 'vesel' | 'suparat' | 'surprins' | 'trist' | 'calm' | 'stresat' | 'neutru'

export interface StareEmotionala {
  emotie: Emotie
  intensitate: number // 0-100
  ts: number
}

const INTERVAL_DETECTIE_MS = 3000 // la 3 secunde — nu stresăm CPU
let inMers = false
let timer: ReturnType<typeof setInterval> | null = null
let ultimaEmotie: StareEmotionala = { emotie: 'neutru', intensitate: 0, ts: 0 }

/** Detectează emoția din landmark-urile faciale. Geometrie pură. */
export function detecteazaEmotieDinLandmark(
  landmark: { positions: Array<{ x: number; y: number }> } | { x: number; y: number }[] | null,
): StareEmotionala {
  if (!landmark) return { emotie: 'neutru', intensitate: 0, ts: Date.now() }
  // face-api.js returnează un obiect cu .positions (array de 68 puncte)
  const pts = Array.isArray(landmark)
    ? landmark
    : (landmark as { positions: Array<{ x: number; y: number }> }).positions
  if (!pts || pts.length < 68) return { emotie: 'neutru', intensitate: 0, ts: Date.now() }
  const ts = Date.now()
  // Puncte cheie (face-api.js 68-point model):
  // 0-16: contur față, 17-21: sprânceană dreapta, 22-26: sprânceană stânga
  // 27-30: nas, 31-35: nări, 48-67: gură
  const coltGuraStang = pts[48]
  const coltGuraDrept = pts[54]
  const centruGuraSus = pts[51]
  const centruGuraJos = pts[57]
  const varfNas = pts[33]
  const spranceanaStangIntern = pts[21]
  const spranceanaDreptIntern = pts[22]
  // Distanțe normalizate la lățimea feței (pt robustețe la distanță)
  const latimeFata = Math.abs(pts[16].x - pts[0].x)
  if (latimeFata < 1) return { emotie: 'neutru', intensitate: 0, ts }
  // 1. Zâmbet: colțurile gurii sunt DEASUPRA bazei nasului (relativ)
  const ridicareColtStang = (varfNas.y - coltGuraStang.y) / latimeFata
  const ridicareColtDrept = (varfNas.y - coltGuraDrept.y) / latimeFata
  const ridicareMedie = (ridicareColtStang + ridicareColtDrept) / 2
  // 2. Încruntare: sprâncenele sunt apropiate + jos
  const distantaSprancene = Math.abs(spranceanaDreptIntern.x - spranceanaStangIntern.x) / latimeFata
  const coborareSprancene = (varfNas.y - spranceanaStangIntern.y) / latimeFata
  // 3. Gura deschisă (surprindere)
  const guraDeschisa = Math.abs(centruGuraJos.y - centruGuraSus.y) / latimeFata
  // Clasificare
  if (guraDeschisa > 0.08) {
    return { emotie: 'surprins', intensitate: Math.min(100, Math.round(guraDeschisa * 800)), ts }
  }
  if (ridicareMedie > 0.02) {
    return { emotie: 'vesel', intensitate: Math.min(100, Math.round(ridicareMedie * 1500)), ts }
  }
  if (ridicareMedie < -0.02) {
    return { emotie: 'trist', intensitate: Math.min(100, Math.round(-ridicareMedie * 1500)), ts }
  }
  if (distantaSprancene < 0.08 && coborareSprancene < 0.05) {
    return { emotie: 'suparat', intensitate: Math.min(100, Math.round((0.08 - distantaSprancene) * 1000)), ts }
  }
  if (coborareSprancene < 0.03) {
    return { emotie: 'stresat', intensitate: Math.min(100, Math.round((0.03 - coborareSprancene) * 1500)), ts }
  }
  return { emotie: 'calm', intensitate: 50, ts }
}

async function trimiteEmotie(stare: StareEmotionala): Promise<void> {
  try {
    await fetch('/api/emotie', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(stare),
    })
  } catch { /* offline — tăcut */ }
}

/** Pornește detecția emoțională periodică. Primește o funcție care întoarce
 *  landmark-ul curent (de la faceprint care rulează deja). */
export function pornesteDetectiaEmotionala(
  obtineLandmark: () => Promise<{ positions: Array<{ x: number; y: number }> } | null>,
): void {
  if (inMers) return
  inMers = true
  timer = setInterval(async () => {
    if (document.hidden) return
    try {
      const lm = await obtineLandmark()
      const stare = detecteazaEmotieDinLandmark(lm)
      if (stare.emotie !== 'neutru' && stare.emotie !== ultimaEmotie.emotie) {
        ultimaEmotie = stare
        void trimiteEmotie(stare)
      }
    } catch { /* tăcut */ }
  }, INTERVAL_DETECTIE_MS)
}

/** Oprește detecția emoțională. */
export function opresteDetectiaEmotionala(): void {
  inMers = false
  if (timer) { clearInterval(timer); timer = null }
}

/** Ultima emoție detectată. */
export function emotieCurenta(): StareEmotionala {
  return ultimaEmotie
}
