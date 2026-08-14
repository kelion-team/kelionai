import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
vi.mock('../db.js', () => ({
  getPool: () => ({
    query: mockQuery,
  }),
}));

const mockExecFile = vi.fn();
vi.mock('child_process', () => ({
  execFile: (file: string, args: string[], options: any, callback: any) => {
    mockExecFile(file, args, options, callback);
    return {} as any;
  },
}));

// Import after mocking
const { serverOps } = await import('./serverOps.js');

describe('serverOps', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('respinge comenzile nepermise', async () => {
    await expect(serverOps('ls')).rejects.toThrow('Comandă nepermisă');
    // Verify audit log was written for failure
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO server_ops_audit'),
      expect.arrayContaining(['ls', expect.stringContaining('Comandă nepermisă'), false])
    );
  });

  it('permite și rulează comenzi predefinite cu succes', async () => {
    mockExecFile.mockImplementation((file, args, options, callback) => {
      callback(null, 'uptime info 12:00', '');
    });

    const result = await serverOps('uptime');
    expect(result).toBe('uptime info 12:00');
    expect(mockExecFile).toHaveBeenCalledWith('uptime', [], { timeout: 20000 }, expect.any(Function));
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO server_ops_audit'),
      expect.arrayContaining(['uptime', 'uptime info 12:00', true])
    );
  });

  it('limitează output-ul la 8KB', async () => {
    const hugeOutput = 'a'.repeat(9000);
    mockExecFile.mockImplementation((file, args, options, callback) => {
      callback(null, hugeOutput, '');
    });

    const result = await serverOps('free');
    expect(result.length).toBeLessThan(9000);
    expect(result).toContain('[TRUNCATED - Output exceeded 8KB limit]');
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO server_ops_audit'),
      expect.arrayContaining(['free', expect.any(String), true])
    );
  });

  it('gestionează corect timeout-ul de 20s', async () => {
    const killedError = new Error('Command timed out');
    (killedError as any).killed = true;

    mockExecFile.mockImplementation((file, args, options, callback) => {
      callback(killedError, 'some partial stdout', 'some stderr');
    });

    const result = await serverOps('df');
    expect(result).toContain('Command timed out after 20s');
    expect(result).toContain('some partial stdout');
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO server_ops_audit'),
      expect.arrayContaining(['df', expect.any(String), false])
    );
  });
});
