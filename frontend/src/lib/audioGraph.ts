// ── OPENING THE MICROPHONE + THE AUDIO CONTEXT — one single source ────────
//
// WHY (Batch D of PROCEDURA-REFACERE-CLONE.md; Adrian: "0 clones, that's the
// target"): `audioIO.ts` (playback + capture for voice) and `micStream.ts`
// (dictation) both started the microphone EXACTLY the same way — the same
// echo/noise constraints, the same "permission refusal ≠ transient failure"
// distinction, the same
// webkit-prefixed AudioContext creation. They were ~20 copied lines, and
// the real risk wasn't aesthetic: if someone changed the constraints in a
// single place, dictation and voice would start hearing DIFFERENTLY, silently.
//
// Here it's once. The two modules keep what is specific to them (the nodes,
// resample-ul, VAD-ul); comun e DOAR deschiderea aparatului.
//
// THE HOUSE RULE (AI-HANDOFF, the Jul 25 lesson): anything touching the
// voice path is verified LIVE, with real voice — not just typecheck.

/** Why the microphone didn't start. `not-allowed` = permission refusal (does NOT
 *  retry by itself); `no-device` = no microphone exists on the machine (audit
 *  Aug 2 — a different truth than a failure); `failed` = transient failure
 *  (device busy, headset unplugged — worth retrying); `unsupported` = the
 *  browser lacks the API. */
export type MicError = 'not-allowed' | 'no-device' | 'failed' | 'unsupported'

/** The microphone constraints — IDENTICAL for voice and dictation (if they
 *  change, they change for both, which is exactly the point). */
const MIC_CONSTRAINTS: MediaStreamConstraints = {
  audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
}

/** Constructorul de AudioContext, cu prefixul vechi webkit (Safari). */
function getAudioContextCtor(): typeof AudioContext | null {
  return (
    globalThis.AudioContext ??
    (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ??
    null
  )
}

/** DEBLOCAJ PE GEST (5 aug, „kelion nu aude" pe telefon) — cauza rădăcină:
 *  pe iOS/Android `AudioContext` pornește în starea 'suspended' și NU se
 *  activează fără un GEST de utilizator. Cât rămâne suspendat, `onaudioprocess`
 *  nu rulează NICIODATĂ → microfonul e SURD deși becul de „ascult" e aprins.
 *  `resume()` fără gest (fire-and-forget) nu ajută. Aici: încercăm resume ACUM
 *  și, dacă nu prinde, îl reluăm la PRIMUL gest (tap/touch/tastă) — apoi ne
 *  retragem singuri. Un singur tap al ownerului deblochează urechea. */
export function deblocheazaAudioLaGest(ctx: AudioContext): void {
  const evenimente = ['pointerdown', 'touchstart', 'touchend', 'click', 'keydown']
  let retras = false
  const retrage = (): void => {
    if (retras) return
    retras = true
    for (const ev of evenimente) window.removeEventListener(ev, reia, true)
    try {
      ctx.removeEventListener('statechange', laSchimbareStare)
    } catch {
      /* fără EventTarget */
    }
  }
  // Ascultătoarele se scot și când contextul e ÎNCHIS (nu doar când ajunge
  // 'running'): înainte, un context închis între timp le lăsa pe `window` pe
  // veci — cinci ascultătoare scurse la fiecare sesiune eșuată, care mai
  // și chemau `resume()` pe un cadavru la fiecare tap.
  const laSchimbareStare = (): void => {
    if (ctx.state === 'running' || ctx.state === 'closed') retrage()
  }
  const reia = (): void => {
    if (ctx.state === 'closed') {
      retrage()
      return
    }
    void ctx.resume().catch(() => {})
    if (ctx.state === 'running') retrage()
  }
  if (ctx.state === 'closed') return
  void ctx.resume().catch(() => {})
  if (ctx.state === 'running') return
  for (const ev of evenimente) window.addEventListener(ev, reia, { capture: true, passive: true })
  try {
    ctx.addEventListener('statechange', laSchimbareStare)
  } catch {
    /* fără EventTarget — rămâne retragerea la gest */
  }
}

/**
 * Opens the microphone and prepares the audio context.
 *
 * `preWarmed` = an already-obtained stream (we reuse it, so we don't ask for
 * permission twice). On any failure it calls `onError` with the exact reason
 * and returns `null` — the caller no longer has to distinguish the cases itself.
 */
export async function openMicGraph(
  onError: (e: MicError) => void,
  preWarmed?: MediaStream | null,
): Promise<{ stream: MediaStream; ctx: AudioContext } | null> {
  let stream: MediaStream
  if (preWarmed && preWarmed.getAudioTracks().length > 0) {
    stream = preWarmed
  } else {
    try {
      stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS)
    } catch (e) {
      // Permission refusal ≠ transient failure: a refusal doesn't retry by
      // itself, a transient failure (device busy, headset unplugged) does.
      // NO MICROPHONE AT ALL is a third truth (audit Aug 2): the panel can
      // now say "no microphone found" instead of a generic failure.
      const name = (e as { name?: string })?.name
      onError(
        name === 'NotAllowedError' || name === 'SecurityError'
          ? 'not-allowed'
          : name === 'NotFoundError' || name === 'DevicesNotFoundError'
            ? 'no-device'
            : 'failed',
      )
      return null
    }
  }

  const AC = getAudioContextCtor()
  if (!AC) {
    // Without AudioContext we can't process anything — we release the device, otherwise it stays
    // becul microfonului aprins degeaba.
    stream.getTracks().forEach((t) => t.stop())
    onError('unsupported')
    return null
  }
  const ctx = new AC()
  // Pe mobil contextul e 'suspended' până la un gest — fără deblocaj, urechea e
  // surdă (vezi deblocheazaAudioLaGest). Îl armăm ca să prindă primul tap.
  if (ctx.state !== 'running') deblocheazaAudioLaGest(ctx)
  return { stream, ctx }
}
