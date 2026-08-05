import { describe, expect, it, vi } from 'vitest';
import type sql from 'mssql';
import { loadConfig } from '../../src/config/config.js';
import { PoolManager } from '../../src/database/pool.js';
import type { Logger } from '../../src/utils/logger.js';

const config = loadConfig({
  DB_SERVER: 'localhost',
  DB_DATABASE: 'PosDb',
  DB_USER: 'user',
  DB_PASSWORD: 'password'
});
const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function fakePool(connect: ReturnType<typeof vi.fn>) {
  return { connect, close: vi.fn().mockResolvedValue(undefined), on: vi.fn(), connected: true };
}

describe('PoolManager', () => {
  it('shares one in-flight pool connection', async () => {
    const pool = fakePool(vi.fn().mockResolvedValue(undefined));
    const manager = new PoolManager(config, logger, () => pool as unknown as sql.ConnectionPool);
    const [first, second] = await Promise.all([manager.getPool(), manager.getPool()]);
    expect(first).toBe(second);
    expect(pool.connect).toHaveBeenCalledOnce();
  });

  it('retries after a failed connection', async () => {
    const first = fakePool(vi.fn().mockRejectedValue(new Error('down')));
    const second = fakePool(vi.fn().mockResolvedValue(undefined));
    const factory = vi
      .fn()
      .mockReturnValueOnce(first as unknown as sql.ConnectionPool)
      .mockReturnValueOnce(second as unknown as sql.ConnectionPool);
    const manager = new PoolManager(config, logger, factory);
    await expect(manager.getPool()).rejects.toMatchObject({ code: 'DATABASE_CONNECTION_ERROR' });
    await expect(manager.getPool()).resolves.toBe(second);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('closes at most once', async () => {
    const pool = fakePool(vi.fn().mockResolvedValue(undefined));
    const manager = new PoolManager(config, logger, () => pool as unknown as sql.ConnectionPool);
    await manager.getPool();
    await manager.close();
    await manager.close();
    expect(pool.close).toHaveBeenCalledOnce();
  });
});
