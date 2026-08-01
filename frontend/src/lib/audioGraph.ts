// ── OPENING THE MICROPHONE + THE AUDIO CONTEXT — one single source ────────
//
// WHY (Batch D of PROCEDURA-REFACERE-CLONE.md; Adrian: "0 clones, that's the
// target"): `audioIO.ts` (playback + capture for voice) and `micStream.ts`
// (dictation) both started the microphone EXACTLY the same way — the same
// echo/noise constraints, the same "permission refusal ≠ transient failure"
// distinction, the same
// creare de AudioContext cu prefixul webkit. Erau ~20 de linii copiate, iar
// the real risk wasn't aesthetic: if someone changed the constraints in a
// single place, dictation and voice would start hearing DIFFERENTLY, silently.
//
// Here it's once. The two modules keep what is specific to them (the nodes,
// resample-ul, VAD-ul); comun e DOAR deschiderea aparatului.
//
// THE HOUSE RULE (AI-HANDOFF, the Jul 25 lesson): anything touching the
// voice path is verified LIVE, with real voice — not just typecheck.

/** De ce n-a pornit microfonul. `not-allowed` = refuz de permisiune (NU se
 *  retries by itself); `failed` = transient failure (device busy, headset
 *  unplugged — worth retrying); `unsupported` = the browser lacks the API. */
export type MicError = 'not-allowed' | 'failed' | 'unsupported'

/** The microphone constraints — IDENTICAL for voice and dictation (if they
 *  change, they change for both, which is exactly the point). */
export const MIC_CONSTRAINTS: MediaStreamConstraints = {
  audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
}

/** Constructorul de AudioContext, cu prefixul vechi webkit (Safari). */
export function getAudioContextCtor(): typeof AudioContext | null {
  return (
    globalThis.AudioContext ??
    (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ??
    null
  )
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
      const name = (e as { name?: string })?.name
      onError(name === 'NotAllowedError' || name === 'SecurityError' ? 'not-allowed' : 'failed')
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
  return { stream, ctx: new AC() }
}
