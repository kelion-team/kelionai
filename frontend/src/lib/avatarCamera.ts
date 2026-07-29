// ── LIMITELE CAMEREI DIN JURUL AVATARULUI — o singură dată ───────────────────
//
// DE CE (Lotul E din PROCEDURA-REFACERE-CLONE.md): `Landing.tsx` (vizitatorul) și
// `Stage.tsx` (aplicația) aveau EXACT aceleași limite de orbitare, copiate. Dacă
// se regla încadrarea într-una, Kelion arăta diferit în cele două ecrane — genul
// de divergență pe care n-o vezi până nu-ți sare în ochi într-o captură.
//
// Regula de încadrare (neschimbată, doar mutată): fără deplasare laterală, fără
// zoom, privire aproape orizontală, și rotire de cel mult ±3° în jurul axei —
// Kelion se uită la om, nu se învârte ca un obiect.
export const AVATAR_ORBIT = {
  enablePan: false,
  enableZoom: false,
  minPolarAngle: Math.PI / 2.3,
  maxPolarAngle: Math.PI / 1.95,
  /** ±3° stânga/dreapta — atât, ca privirea să rămână spre utilizator. */
  minAzimuthAngle: -Math.PI / 60,
  maxAzimuthAngle: Math.PI / 60,
  /** Punctul privit: la înălțimea pieptului/feței, nu la picioare. */
  target: [0, 0.7, 0] as [number, number, number],
} as const
