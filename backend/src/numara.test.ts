import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('CLI script - numara.mjs', () => {
  it('should count and stop when "stop" is entered', () => {
    return new Promise<void>((resolve, reject) => {
      // Path to the script relative to this test file
      const scriptPath = path.resolve(__dirname, '../../scripts/numara.mjs');
      
      // Spawn the script
      const child = spawn('node', [scriptPath], {
        stdio: ['pipe', 'pipe', 'inherit']
      });

      let stdoutData = '';
      let timer: NodeJS.Timeout;

      // Set a safety timeout of 5 seconds
      timer = setTimeout(() => {
        child.kill();
        reject(new Error('Test timed out. Output so far: ' + stdoutData));
      }, 5000);

      child.stdout.on('data', (data) => {
        const text = data.toString();
        stdoutData += text;

        // Once we see the first number or the start message, send 'stop'
        if (stdoutData.includes('1') && !stdoutData.includes('Numărătoarea a fost oprită')) {
          child.stdin.write('stop\n');
        }
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        try {
          expect(code).toBe(0);
          expect(stdoutData).toContain('Sistemul de numărare a pornit');
          expect(stdoutData).toContain('1');
          expect(stdoutData).toContain('Numărătoarea a fost oprită');
          resolve();
        } catch (err) {
          reject(err);
        }
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  });
});
