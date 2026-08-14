import { describe, it, expect, beforeEach } from 'vitest';
import Fastify from 'fastify';
import deployRoutes, { getDeployState, setDeployState } from './deploy';

describe('Deploy Routes & Progress State', () => {
  beforeEach(() => {
    setDeployState({
      status: 'idle',
      step: '',
      stepIndex: 0,
      totalSteps: 0,
      percent: 0,
      message: 'Niciun deploy în curs',
      startedAt: null,
      error: null,
    });
  });

  it('returns idle status initially', async () => {
    const app = Fastify();
    await app.register(deployRoutes, { prefix: '/deploy' });

    const res = await app.inject({
      method: 'GET',
      url: '/deploy/progress',
    });

    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.ok).toBe(true);
    expect(json.state.status).toBe('idle');
    expect(json.state.percent).toBe(0);

    await app.close();
  });

  it('updates progress accurately via POST /deploy/progress', async () => {
    const app = Fastify();
    await app.register(deployRoutes, { prefix: '/deploy' });

    const updateRes = await app.inject({
      method: 'POST',
      url: '/deploy/progress',
      payload: {
        status: 'running',
        step: 'Building backend & frontend',
        stepIndex: 3,
        totalSteps: 6,
        message: 'Compilare în desfășurare...',
      },
    });

    expect(updateRes.statusCode).toBe(200);
    const updateJson = updateRes.json();
    expect(updateJson.ok).toBe(true);
    expect(updateJson.state.status).toBe('running');
    expect(updateJson.state.percent).toBe(50);
    expect(updateJson.state.step).toBe('Building backend & frontend');

    const getRes = await app.inject({
      method: 'GET',
      url: '/deploy/progress',
    });
    expect(getRes.json().state.percent).toBe(50);

    await app.close();
  });

  it('handles completion and error statuses', async () => {
    setDeployState({
      status: 'success',
      step: 'Finalizat',
      percent: 100,
      message: 'Deploy realizat cu succes!',
    });

    const state = getDeployState();
    expect(state.status).toBe('success');
    expect(state.percent).toBe(100);

    setDeployState({
      status: 'failed',
      step: 'Test suite failed',
      error: 'Vitest tests exited with code 1',
    });

    const failedState = getDeployState();
    expect(failedState.status).toBe('failed');
    expect(failedState.error).toContain('Vitest');
  });
});
