import { useEffect, useState } from 'react';
import { apiFetch, consumeApiEventStream } from '../lib/transport';

export interface DeployState {
  status: 'idle' | 'running' | 'success' | 'failed';
  step: string;
  stepIndex: number;
  totalSteps: number;
  percent: number;
  message: string;
  startedAt: string | null;
  updatedAt: string;
  error?: string | null;
}

export function DeployProgressBar() {
  const [state, setState] = useState<DeployState>({
    status: 'idle',
    step: '',
    stepIndex: 0,
    totalSteps: 0,
    percent: 0,
    message: '',
    startedAt: null,
    updatedAt: new Date().toISOString(),
    error: null,
  });
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const streamController = new AbortController();
    let pollInterval: ReturnType<typeof setInterval> | null = null;

    const fetchProgress = async () => {
      try {
        const res = await apiFetch('/api/deploy/progress');
        if (res.ok) {
          const data = await res.json();
          if (data.ok && data.state) {
            setState(data.state);
            if (data.state.status === 'running') {
              setDismissed(false);
            }
          }
        }
      } catch {
        // Silently fail polling
      }
    };

    const startPolling = (): void => {
      if (!pollInterval) {
        void fetchProgress();
        pollInterval = setInterval(() => { void fetchProgress() }, 3000);
      }
    };

    void consumeApiEventStream('/api/deploy/status', (payload) => {
        try {
          const data = JSON.parse(payload) as DeployState;
          setState(data);
          if (data.status === 'running') {
            setDismissed(false);
          }
        } catch {
          // ignore parsing error
        }
      }, streamController.signal)
      .catch(() => { if (!streamController.signal.aborted) startPolling() });

    return () => {
      streamController.abort();
      if (pollInterval) {
        clearInterval(pollInterval);
      }
    };
  }, []);

  if (state.status === 'idle' || dismissed) {
    return null;
  }

  const isRunning = state.status === 'running';
  const isSuccess = state.status === 'success';
  const isFailed = state.status === 'failed';

  const statusColor = isRunning
    ? 'var(--accent, #3b82f6)'
    : isSuccess
    ? '#10b981'
    : '#ef4444';

  const statusTitle = isRunning
    ? '🚀 Deploy în desfășurare...'
    : isSuccess
    ? '✅ Deploy finalizat cu succes!'
    : '❌ Deploy eșuat';

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        maxWidth: 420,
        width: 'calc(100vw - 48px)',
        zIndex: 9999,
        background: 'rgba(23, 23, 23, 0.92)',
        backdropFilter: 'blur(12px)',
        border: `1px solid ${statusColor}`,
        borderRadius: 12,
        boxShadow: '0 10px 30px rgba(0, 0, 0, 0.5)',
        padding: '14px 16px',
        color: '#f3f4f6',
        fontFamily: 'inherit',
        fontSize: 13,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontWeight: 600, color: statusColor, display: 'flex', alignItems: 'center', gap: 6 }}>
          {statusTitle}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontWeight: 700, fontSize: 13 }}>{state.percent}%</span>
          {!isRunning && (
            <button
              onClick={() => setDismissed(true)}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#9ca3af',
                cursor: 'pointer',
                padding: '2px 4px',
                fontSize: 14,
                lineHeight: 1,
              }}
              title="Închide"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Progress Bar Track */}
      <div
        style={{
          width: '100%',
          height: 8,
          background: 'rgba(255, 255, 255, 0.1)',
          borderRadius: 4,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${Math.min(100, Math.max(0, state.percent))}%`,
            height: '100%',
            background: statusColor,
            borderRadius: 4,
            transition: 'width 0.4s ease-in-out',
          }}
        />
      </div>

      {/* Details & Step info */}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#9ca3af' }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '75%' }}>
          {state.step || state.message || 'Procesare...'}
        </span>
        {state.totalSteps > 0 && (
          <span>
            Pas {state.stepIndex}/{state.totalSteps}
          </span>
        )}
      </div>

      {isFailed && state.error && (
        <div
          style={{
            fontSize: 11,
            color: '#fca5a5',
            background: 'rgba(239, 68, 68, 0.1)',
            padding: '6px 8px',
            borderRadius: 6,
            marginTop: 4,
            wordBreak: 'break-word',
          }}
        >
          {state.error}
        </div>
      )}
    </div>
  );
}
export default DeployProgressBar;
