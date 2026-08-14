import { execFile } from 'child_process';
import { getPool } from '../db.js';

const ALLOWED_COMMANDS: Record<string, { file: string; args: string[] }> = {
  uptime: { file: 'uptime', args: [] },
  df: { file: 'df', args: ['-h'] },
  free: { file: 'free', args: ['-m'] },
  docker_ps: { file: 'docker', args: ['ps'] },
  // ── LOGURILE GAZDEI (14 aug): montate read-only la /host/kelion (deploy.sh).
  // Owner: „Kelion trebuie să vadă logurile" — astea-s comenzile FIXE prin care
  // le vede la cerere (self-heal le scanează separat, prin logGazda.ts).
  log_constructor: { file: 'tail', args: ['-n', '200', '/host/kelion/constructor.log'] },
  log_publicare: { file: 'tail', args: ['-n', '200', '/host/kelion/auto-publicare.log'] },
};

export async function serverOps(cmd: string): Promise<string> {
  const allowed = ALLOWED_COMMANDS[cmd];
  if (!allowed) {
    const errText = `Comandă nepermisă: ${cmd}. Comenzile permise sunt: ${Object.keys(ALLOWED_COMMANDS).join(', ')}`;
    await logAudit(cmd || 'invalid', errText, false);
    throw new Error(errText);
  }

  return new Promise<string>((resolve) => {
    const child = execFile(allowed.file, allowed.args, { timeout: 20000 }, async (err, stdout, stderr) => {
      let output = stdout + stderr;
      const success = !err;

      // Limit output to 8KB (8192 chars)
      if (output.length > 8192) {
        output = output.substring(0, 8192) + '\n\n[TRUNCATED - Output exceeded 8KB limit]';
      }

      await logAudit(cmd, output, success);

      if (err) {
        if ((err as any).killed) {
          resolve(`Command timed out after 20s.\nOutput collected so far:\n${output}`);
        } else {
          resolve(`Command failed with code ${(err as any).code || 'unknown'}.\nOutput:\n${output}`);
        }
      } else {
        resolve(output);
      }
    });
  });
}

async function logAudit(cmd: string, output: string, success: boolean) {
  try {
    const pool = getPool();
    await pool.query(`
      CREATE TABLE IF NOT EXISTS server_ops_audit (
        id SERIAL PRIMARY KEY,
        timestamp TIMESTAMPTZ DEFAULT NOW(),
        command TEXT NOT NULL,
        output_preview TEXT,
        success BOOLEAN
      )
    `);

    await pool.query(
      `INSERT INTO server_ops_audit (command, output_preview, success) VALUES ($1, $2, $3)`,
      [cmd, output.substring(0, 2000), success]
    );
  } catch (e) {
    console.error('Failed to write server_ops audit log:', e);
  }
}
