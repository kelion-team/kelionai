import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

describe('Deploy Progress Monitor & State', () => {
  it('DeployProgressBar exists and exports component', () => {
    const componentPath = resolve(__dirname, '../../frontend/src/components/DeployProgressBar.tsx');
    expect(existsSync(componentPath)).toBe(true);
    const content = readFileSync(componentPath, 'utf8');
    expect(content).toContain('export function DeployProgressBar');
    expect(content).toContain('/api/deploy/status');
    expect(content).toContain('/api/deploy/progress');
  });

  it('Stage page renders DeployProgressBar on monitor', () => {
    const stagePath = resolve(__dirname, '../../frontend/src/pages/Stage.tsx');
    expect(existsSync(stagePath)).toBe(true);
    const content = readFileSync(stagePath, 'utf8');
    expect(content).toContain('<DeployProgressBar');
  });

  it('Python CLI monitor script exists and is structured properly', () => {
    const scriptPath = resolve(__dirname, '../../scripts/deploy_monitor.py');
    expect(existsSync(scriptPath)).toBe(true);
    const content = readFileSync(scriptPath, 'utf8');
    expect(content).toContain('/api/deploy/progress');
    expect(content).toContain('render_simple_bar');
  });
});
