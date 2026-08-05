import { beforeEach, describe, expect, it, vi } from 'vitest';
import type sql from 'mssql';
import { loadConfig } from '../../src/config/config.js';
import {
  SqlExecutor,
  type ExecutorDriver,
  type PoolProvider,
  type RequestLike,
  type TransactionLike
} from '../../src/database/executor.js';

const baseEnv = {
  DB_SERVER: 'localhost',
  DB_DATABASE: 'PosDb',
  DB_USER: 'user',
  DB_PASSWORD: 'password'
};
const pool = {} as sql.ConnectionPool;
const pools: PoolProvider = { getPool: vi.fn().mockResolvedValue(pool), connected: true };

function request(result: unknown): RequestLike {
  return {
    input: vi.fn(),
    output: vi.fn(),
    query: vi.fn().mockResolvedValue(result),
    execute: vi.fn().mockResolvedValue(result)
  };
}

function setup(results: unknown[], transaction?: TransactionLike) {
  const requests = results.map((result) => request(result));
  const driver: ExecutorDriver = {
    request: vi.fn(() => {
      const next = requests.shift();
      if (next === undefined) throw new Error('No fake request available');
      return next;
    }),
    transaction: vi.fn(
      () =>
        transaction ?? {
          begin: vi.fn().mockResolvedValue(undefined),
          commit: vi.fn().mockResolvedValue(undefined),
          rollback: vi.fn().mockResolvedValue(undefined)
        }
    )
  };
  return { driver, executor: new SqlExecutor(pools, loadConfig(baseEnv), driver) };
}

beforeEach(() => vi.clearAllMocks());

describe('SqlExecutor', () => {
  it('rejects a non-select before acquiring a connection', async () => {
    const { executor } = setup([]);
    await expect(executor.select({ sql: 'UPDATE T SET X=1' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR'
    });
    expect(pools.getPool).not.toHaveBeenCalled();
  });

  it('bounds SELECT output and reports timing', async () => {
    const { executor } = setup([{ recordsets: [[{ id: 1 }, { id: 2 }, { id: 3 }]] }]);
    const result = await executor.select({ sql: 'SELECT id FROM dbo.Items', offset: 1, limit: 1 });
    expect(result.recordsets).toEqual([[{ id: 2 }]]);
    expect(result).toMatchObject({ returnedRows: 1, truncated: true, offset: 1, limit: 1 });
    expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('rejects DELETE when disabled', async () => {
    const { executor } = setup([]);
    await expect(executor.mutate('delete', { sql: 'DELETE dbo.T' })).rejects.toMatchObject({
      code: 'FEATURE_DISABLED'
    });
  });

  it('returns mutation affected rows and output data', async () => {
    const { executor } = setup([{ recordsets: [[{ id: 4 }]], rowsAffected: [1, 2] }]);
    const result = await executor.mutate('update', {
      sql: 'UPDATE dbo.Items SET Price=@price OUTPUT inserted.Id WHERE Id=@id',
      parameters: [
        { name: 'price', type: 'Decimal', precision: 19, scale: 4, value: 9.5 },
        { name: 'id', type: 'Int', value: 4 }
      ]
    });
    expect(result).toMatchObject({ affectedRows: 3, rowsAffected: [1, 2] });
    expect(result.recordsets).toEqual([[{ id: 4 }]]);
  });

  it('returns stored procedure output and return value', async () => {
    const { executor, driver } = setup([
      { recordsets: [[{ closed: true }]], rowsAffected: [2], output: { count: 2 }, returnValue: 0 }
    ]);
    const result = await executor.executeProcedure({ procedure: 'sales.CloseDay' });
    expect(result).toMatchObject({ affectedRows: 2, output: { count: 2 }, returnValue: 0 });
    const usedRequest = vi.mocked(driver.request).mock.results[0]?.value;
    expect(usedRequest?.execute).toHaveBeenCalledWith('[sales].[CloseDay]');
  });

  it('validates every transaction step before begin', async () => {
    const transaction: TransactionLike = {
      begin: vi.fn(),
      commit: vi.fn(),
      rollback: vi.fn()
    };
    const { executor } = setup([], transaction);
    await expect(
      executor.executeTransaction({
        steps: [
          { operation: 'update', sql: 'UPDATE dbo.T SET x=1' },
          { operation: 'select', sql: 'DROP TABLE dbo.T' }
        ]
      })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(transaction.begin).not.toHaveBeenCalled();
  });

  it('commits a successful transaction', async () => {
    const transaction: TransactionLike = {
      begin: vi.fn().mockResolvedValue(undefined),
      commit: vi.fn().mockResolvedValue(undefined),
      rollback: vi.fn().mockResolvedValue(undefined)
    };
    const { executor } = setup(
      [
        { recordsets: [[{ id: 1 }]], rowsAffected: [] },
        { recordsets: [], rowsAffected: [1] }
      ],
      transaction
    );
    const result = await executor.executeTransaction({
      steps: [
        { operation: 'select', sql: 'SELECT 1 AS id' },
        { operation: 'update', sql: 'UPDATE dbo.T SET x=1' }
      ]
    });
    expect(result.committed).toBe(true);
    expect(transaction.commit).toHaveBeenCalledOnce();
    expect(transaction.rollback).not.toHaveBeenCalled();
  });

  it('rolls back a failed transaction', async () => {
    const failing = request({});
    vi.mocked(failing.query).mockRejectedValue(new Error('deadlock'));
    const transaction: TransactionLike = {
      begin: vi.fn().mockResolvedValue(undefined),
      commit: vi.fn(),
      rollback: vi.fn().mockResolvedValue(undefined)
    };
    const driver: ExecutorDriver = {
      request: vi.fn(() => failing),
      transaction: vi.fn(() => transaction)
    };
    const executor = new SqlExecutor(pools, loadConfig(baseEnv), driver);
    await expect(
      executor.executeTransaction({ steps: [{ operation: 'update', sql: 'UPDATE dbo.T SET x=1' }] })
    ).rejects.toMatchObject({ code: 'TRANSACTION_ERROR' });
    expect(transaction.rollback).toHaveBeenCalledOnce();
  });

  it('uses one control transaction for estimated plans', async () => {
    const transaction: TransactionLike = {
      begin: vi.fn().mockResolvedValue(undefined),
      commit: vi.fn(),
      rollback: vi.fn().mockResolvedValue(undefined)
    };
    const { executor, driver } = setup(
      [{}, { recordsets: [[{ ShowPlanXML: '<ShowPlanXML />' }]] }, {}],
      transaction
    );
    await expect(executor.explain({ sql: 'SELECT 1' })).resolves.toMatchObject({
      planXml: '<ShowPlanXML />'
    });
    expect(transaction.begin).toHaveBeenCalledOnce();
    expect(transaction.rollback).toHaveBeenCalledOnce();
    expect(driver.request).toHaveBeenCalledTimes(3);
  });

  it('reports health and version metadata', async () => {
    const { executor } = setup([
      { recordsets: [[{ databaseName: 'PosDb' }]] },
      { recordsets: [[{ productVersion: '17.0', edition: 'Developer' }]] }
    ]);
    await expect(executor.health()).resolves.toMatchObject({ ok: true, database: 'PosDb' });
    await expect(executor.version()).resolves.toMatchObject({
      productVersion: '17.0',
      edition: 'Developer'
    });
  });
});
