import { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from 'fastify';

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

let currentDeployState: DeployState = {
  status: 'idle',
  step: '',
  stepIndex: 0,
  totalSteps: 0,
  percent: 0,
  message: 'Niciun deploy în curs',
  startedAt: null,
  updatedAt: new Date().toISOString(),
  error: null,
};

// Maximum running time before considering deploy timed out / stale (e.g. 15 minutes)
const DEPLOY_TIMEOUT_MS = 15 * 60 * 1000;

export function getDeployState(): DeployState {
  if (currentDeployState.status === 'running') {
    const elapsed = Date.now() - new Date(currentDeployState.updatedAt).getTime();
    if (elapsed > DEPLOY_TIMEOUT_MS) {
      currentDeployState = {
        ...currentDeployState,
        status: 'failed',
        error: 'Deploy-ul a depășit timpul limită (timeout / deconectare)',
        message: 'Procesul de deploy a expirat sau a fost întrerupt.',
        updatedAt: new Date().toISOString(),
      };
    }
  }
  return currentDeployState;
}

export function setDeployState(newState: Partial<DeployState>): DeployState {
  const now = new Date().toISOString();
  const base = getDeployState();
  const calculatedPercent =
    typeof newState.percent === 'number'
      ? newState.percent
      : typeof newState.stepIndex === 'number' && typeof newState.totalSteps === 'number' && newState.totalSteps > 0
      ? Math.min(100, Math.round((newState.stepIndex / newState.totalSteps) * 100))
      : base.percent;

  currentDeployState = {
    ...base,
    ...newState,
    percent: calculatedPercent,
    updatedAt: now,
    startedAt: newState.status === 'running' && base.status !== 'running' ? now : (base.startedAt || now),
  };

  return currentDeployState;
}

export async function deployRoutes(
  fastify: FastifyInstance,
  _opts: FastifyPluginOptions
) {
  // Read current deploy progress (JSON)
  fastify.get('/progress', async (_req: FastifyRequest, reply: FastifyReply) => {
    return reply.send({
      ok: true,
      state: getDeployState(),
    });
  });

  // Real-time SSE stream for deploy status & progress
  fastify.get('/status', async (req: FastifyRequest, reply: FastifyReply) => {
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache, no-transform');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.flushHeaders?.();

    const sendState = () => {
      const state = getDeployState();
      try {
        reply.raw.write(`data: ${JSON.stringify(state)}\n\n`);
      } catch {
        // stream closed
      }
    };

    sendState();
    const interval = setInterval(sendState, 2000);

    req.raw.on('close', () => {
      clearInterval(interval);
    });
  });

  // Update deploy progress from CI / deploy scripts / runbook
  fastify.post('/progress', async (
    req: FastifyRequest<{
      Body: {
        status?: 'idle' | 'running' | 'success' | 'failed';
        step?: string;
        stepIndex?: number;
        totalSteps?: number;
        percent?: number;
        message?: string;
        error?: string;
      };
    }>,
    reply: FastifyReply
  ) => {
    const body = req.body || {};
    const updated = setDeployState({
      status: body.status,
      step: body.step,
      stepIndex: body.stepIndex,
      totalSteps: body.totalSteps,
      percent: body.percent,
      message: body.message,
      error: body.error,
    });

    return reply.send({
      ok: true,
      state: updated,
    });
  });
}

export default deployRoutes;
