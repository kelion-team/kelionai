// ── DESCHIDEREA MICROFONULUI + CONTEXTUL AUDIO — o singură sursă ─────────────
//
// DE CE (Lotul D din PROCEDURA-REFACERE-CLONE.md; Adrian: „0 clone, ăsta e
// targetul"): `audioIO.ts` (redarea + captura pentru voce) și `micStream.ts`
// (dictarea) porneau amândouă microfonul EXACT la fel — aceleași constrângeri de
// eco/zgomot, aceeași distincție „refuz de permisiune ≠ eșec trecător", aceeași
// creare de AudioContext cu prefixul webkit. Erau ~20 de linii copiate, iar
// riscul real nu era estetic: dacă cineva schimba constrângerile într-un singur
// loc, dictarea și vocea începeau să audă DIFERIT, tăcut.
//
// Aici e o singură dată. Cele două module păstrează ce au ele specific (nodurile,
// resample-ul, VAD-ul); comun e DOAR deschiderea aparatului.
//
// REGULA CASEI (AI-HANDOFF, lecția din 25 iul): orice atinge calea vocii se
// verifică LIVE, cu voce reală — nu doar cu typecheck.

/** De ce n-a pornit microfonul. `not-allowed` = refuz de permisiune (NU se
 *  reîncearcă singur); `failed` = eșec trecător (dispozitiv ocupat, căști scoase
 *  — se poate reîncerca); `unsupported` = browserul n-are API-ul. */
export type MicError = 'not-allowed' | 'failed' | 'unsupported'

/** Constrângerile microfonului — IDENTICE pentru voce și dictare (dacă se
 *  schimbă, se schimbă pentru amândouă, ceea ce e chiar scopul). */
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
 * Deschide microfonul și pregătește contextul audio.
 *
 * `preWarmed` = un flux deja obținut (îl refolosim, ca să nu cerem permisiunea
 * de două ori). La orice eșec cheamă `onError` cu motivul exact și întoarce
 * `null` — apelantul nu mai trebuie să deosebească singur cazurile.
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
      // Refuz de permisiune ≠ eșec trecător: refuzul nu se reîncearcă singur,
      // eșecul trecător (dispozitiv ocupat, căști scoase) da.
      const name = (e as { name?: string })?.name
      onError(name === 'NotAllowedError' || name === 'SecurityError' ? 'not-allowed' : 'failed')
      return null
    }
  }

  const AC = getAudioContextCtor()
  if (!AC) {
    // Fără AudioContext nu putem procesa nimic — eliberăm aparatul, altfel rămâne
    // becul microfonului aprins degeaba.
    stream.getTracks().forEach((t) => t.stop())
    onError('unsupported')
    return null
  }
  return { stream, ctx: new AC() }
}
