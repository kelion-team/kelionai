export const CALL_UTTERANCE_MAX_MS = 15_000

export type CallMediaType = 'vorbire' | 'comanda-apel'

export function callMediaEnvelope(
  type: CallMediaType,
  callId: string,
  audio: string,
  mime: string,
  createId: () => string = () => crypto.randomUUID(),
): { type: CallMediaType; callId: string; utteranceId: string; audio: string; mime: string } {
  return { type, callId, utteranceId: createId(), audio, mime }
}

export function shouldSplitCallUtterance(startedAt: number, now: number): boolean {
  return Number.isFinite(startedAt) && Number.isFinite(now) && now - startedAt >= CALL_UTTERANCE_MAX_MS
}
