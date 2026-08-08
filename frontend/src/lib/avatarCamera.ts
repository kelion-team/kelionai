// ── THE CAMERA LIMITS AROUND THE AVATAR — once only ───────────────────────
//
// WHY (Batch E of PROCEDURA-REFACERE-CLONE.md): `Landing.tsx` (the visitor)
// and `Stage.tsx` (the app) had EXACTLY the same orbit limits, copied. If the
// framing was tuned in one, Kelion looked different on the two screens — the
// kind of divergence you don't see until it jumps out at you in a screenshot.
//
// The framing rule (unchanged, only moved): no lateral panning, no zoom,
// nearly horizontal gaze, and rotation of at most ±3° around the axis —
// Kelion looks at the person, it doesn't spin like an object.
export const AVATAR_ORBIT = {
  enablePan: false,
  enableZoom: false,
  minPolarAngle: Math.PI / 2.3,
  maxPolarAngle: Math.PI / 1.95,
  /** ±3° left/right — that's all, so the gaze stays toward the user. */
  minAzimuthAngle: -Math.PI / 60,
  maxAzimuthAngle: Math.PI / 60,
  /** The point looked at: at chest/face height, not at the feet. */
  target: [0, 0.7, 0] as [number, number, number],
} as const
