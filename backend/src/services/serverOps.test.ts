import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mocks
const mockQuery = vi.fn().mockResolvedValue({ rows: [] });
vi.mock('../db.js', () => ({
  getPool: () => ({
    query: mockQuery,
  }),
}));

let mockExecFileImpl: any = null;
vi.mock('child_process', () => ({
  execFile: (file: string, args: string[], options: any, callback: any) => {
    if (mockExecFileImpl) {
      return mockExecFileImpl(file, args, options, callback);
    }
    // Default success
    callback(null, 'mock stdout', '');
  },
}));

import { serverOps } from './serverOps.js';
import { SHARED_ADMIN_TOOLS, execSharedAdminTool } from './adminTools.js';
import { CAPABILITIES } from './brainCapabilities.js';
import { SERVER_OPS_TOOL, TOATE_UNELTELE_ADMIN } from './brainToolDefs.js';

describe('server_ops requirement #127', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecFileImpl = null;
  });

  describe('Registry & Integrations', () => {
    it('is registered in brainToolDefs as SERVER_OPS_TOOL and in TOATE_UNELTELE_ADMIN array', () => {
      expect(SERVER_OPS_TOOL).toBeDefined();
      expect(SERVER_OPS_TOOL.name).toBe('server_ops');
      expect(SERVER_OPS_TOOL.description).toContain('VPS');
      expect(TOATE_UNELTELE_ADMIN).toContainEqual(SERVER_OPS_TOOL);
    });

    it('is registered in SHARED_ADMIN_TOOLS and execSharedAdminTool', async () => {
      expect(SHARED_ADMIN_TOOLS.has('server_ops')).toBe(true);
      const res = await execSharedAdminTool('server_ops', { cmd: 'uptime' });
      expect(res).toBe('mock stdout');
    });

    it('is present in CAPABILITIES registry as an admin capability', () => {
      const cap = CAPABILITIES.find(c => c.name === 'server_ops');
      expect(cap).toBeDefined();
      expect(cap?.admin).toBe(true);
      expect(cap?.category).toBe('cod');
    });
  });

  describe('Command Validation & Security', () => {
    it('rejects unlisted commands and logs audit failure to DB', async () => {
      await expect(serverOps('rm -rf /')).rejects.toThrow(/Comandă nepermisă/);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO server_ops_audit'),
        ['rm -rf /', expect.stringContaining('Comandă nepermisă'), false]
      );
    });

    it('rejects empty or malicious command strings', async () => {
      await expect(serverOps('')).rejects.toThrow(/Comandă nepermisă/);
      await expect(serverOps('cat /etc/passwd')).rejects.toThrow(/Comandă nepermisă/);
      await expect(serverOps('uptime; whoami')).rejects.toThrow(/Comandă nepermisă/);
    });
  });

  describe('Execution & Output Limiting', () => {
    it('executes allowed command "uptime" with 20s timeout and logs audit to DB', async () => {
      mockExecFileImpl = (file: string, args: string[], options: any, cb: any) => {
        expect(file).toBe('uptime');
        expect(args).toEqual([]);
        expect(options).toEqual({ timeout: 20000 });
        cb(null, ' 14:00:00 up 10 days,  2 users,  load average: 0.05, 0.03, 0.00\n', '');
      };

      const result = await serverOps('uptime');
      expect(result).toContain('load average');

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO server_ops_audit'),
        ['uptime', expect.stringContaining('load average'), true]
      );
    });

    it('executes allowed command "df" with -h argument', async () => {
      mockExecFileImpl = (file: string, args: string[], options: any, cb: any) => {
        expect(file).toBe('df');
        expect(args).toEqual(['-h']);
        expect(options.timeout).toBe(20000);
        cb(null, 'Filesystem Size Used Avail Use% Mounted on\n/dev/sda1 50G 10G 40G 20% /', '');
      };

      const result = await serverOps('df');
      expect(result).toContain('Filesystem');
    });

    it('executes allowed command "free" with -m argument', async () => {
      mockExecFileImpl = (file: string, args: string[], options: any, cb: any) => {
        expect(file).toBe('free');
        expect(args).toEqual(['-m']);
        expect(options.timeout).toBe(20000);
        cb(null, 'total used free\nMem: 8000 2000 6000', '');
      };

      const result = await serverOps('free');
      expect(result).toContain('Mem:');
    });

    it('executes allowed command "docker_ps" with docker ps', async () => {
      mockExecFileImpl = (file: string, args: string[], options: any, cb: any) => {
        expect(file).toBe('docker');
        expect(args).toEqual(['ps']);
        expect(options.timeout).toBe(20000);
        cb(null, 'CONTAINER ID IMAGE COMMAND CREATED STATUS PORTS NAMES', '');
      };

      const result = await serverOps('docker_ps');
      expect(result).toContain('CONTAINER ID');
    });

    it('executes host log commands log_constructor and log_publicare', async () => {
      mockExecFileImpl = (file: string, args: string[], options: any, cb: any) => {
        expect(file).toBe('tail');
        expect(args[0]).toBe('-n');
        expect(args[1]).toBe('200');
        cb(null, '[LOG] sample host log output', '');
      };

      const resConst = await serverOps('log_constructor');
      expect(resConst).toContain('sample host log output');

      const resPub = await serverOps('log_publicare');
      expect(resPub).toContain('sample host log output');
    });

    it('truncates output exceeding 8KB (8192 chars)', async () => {
      const hugeOutput = 'A'.repeat(10000);
      mockExecFileImpl = (file: string, args: string[], options: any, cb: any) => {
        cb(null, hugeOutput, '');
      };

      const result = await serverOps('uptime');
      expect(result.length).toBeLessThan(10000);
      expect(result).toContain('[TRUNCATED - Output exceeded 8KB limit]');
      expect(result.startsWith('A'.repeat(8192))).toBe(true);

      // Audit preview also truncated to max 2000 chars
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO server_ops_audit'),
        ['uptime', 'A'.repeat(2000), true]
      );
    });

    it('handles command timeout error properly', async () => {
      mockExecFileImpl = (file: string, args: string[], options: any, cb: any) => {
        const timeoutErr = new Error('Command timed out') as any;
        timeoutErr.killed = true;
        cb(timeoutErr, 'partial output', '');
      };

      const result = await serverOps('uptime');
      expect(result).toContain('Command timed out after 20s');
      expect(result).toContain('partial output');

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO server_ops_audit'),
        ['uptime', 'partial output', false]
      );
    });

    it('handles non-zero exit code error properly', async () => {
      mockExecFileImpl = (file: string, args: string[], options: any, cb: any) => {
        const failErr = new Error('Process exited with 1') as any;
        failErr.code = 1;
        cb(failErr, '', 'failed to execute');
      };

      const result = await serverOps('uptime');
      expect(result).toContain('Command failed with code 1');
      expect(result).toContain('failed to execute');

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO server_ops_audit'),
        ['uptime', 'failed to execute', false]
      );
    });
  });
});
