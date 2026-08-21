/**
 * Voice Heartbeat & AudioContext Auto-Resume
 *
 * Prevents live voice session freezing after multiple conversation turns:
 * 1. Keeps WebSocket alive via periodic ping frames (prevents reverse proxy / NAT idle timeout).
 * 2. Auto-resumes AudioContext if the browser suspends it between phrases/turns.
 */

export async function ensureAudioContextRunning(ctx: AudioContext | null | undefined): Promise<boolean> {
  if (!ctx) return false;
  try {
    if (ctx.state === 'suspended' || (ctx.state as string) === 'interrupted') {
      await ctx.resume();
    }
    return ctx.state === 'running';
  } catch {
    return false;
  }
}

export function setupAudioContextAutoResume(
  ctx: AudioContext,
  isActive: () => boolean = () => true
): () => void {
  const onStateChange = () => {
    if (ctx.state === 'suspended' && isActive()) {
      ctx.resume().catch(() => {});
    }
  };

  ctx.addEventListener('statechange', onStateChange);

  // Resume on user gestures if still suspended
  const events = ['pointerdown', 'touchstart', 'keydown'] as const;
  const onGesture = () => {
    if (isActive() && ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
  };

  for (const evt of events) {
    window.addEventListener(evt, onGesture, { passive: true, capture: true });
  }

  return () => {
    ctx.removeEventListener('statechange', onStateChange);
    for (const evt of events) {
      window.removeEventListener(evt, onGesture, { capture: true });
    }
  };
}

export function startVoiceHeartbeat(
  getWs: () => WebSocket | null | undefined,
  intervalMs = 10000
): () => void {
  let timer: any = null;

  const sendPing = () => {
    try {
      const ws = getWs();
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping', t: Date.now() }));
      }
    } catch {
      // Ignore transient send errors; connection handler will reconnect if dead
    }
  };

  timer = setInterval(sendPing, intervalMs);

  return () => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}
