import { beforeEach, describe, expect, it, vi } from 'vitest';
import type sql from 'mssql';
import { loadConfig } from '../../src/config/config.js';
import type { ExecutorDriver, PoolProvider, RequestLike } from '../../src/database/executor.js';
import { MetadataService } from '../../src/database/metadata.js';

const config = loadConfig({
  DB_SERVER: 'localhost',
  DB_DATABASE: 'PosDb',
  DB_USER: 'user',
  DB_PASSWORD: 'password',
  DB_MAX_ROWS: '10'
});
const pools: PoolProvider = {
  getPool: vi.fn().mockResolvedValue({} as sql.ConnectionPool),
  connected: true
};

function request(result: unknown): RequestLike {
  return {
    input: vi.fn(),
    output: vi.fn(),
    query: vi.fn().mockResolvedValue(result),
    execute: vi.fn()
  };
}

function service(results: unknown[]) {
  const requests = results.map((result) => request(result));
  const used: RequestLike[] = [];
  const driver: Pick<ExecutorDriver, 'request'> = {
    request: vi.fn(() => {
      const next = requests.shift();
      if (next === undefined) throw new Error('No fake metadata request available');
      used.push(next);
      return next;
    })
  };
  return { metadata: new MetadataService(pools, config, driver), used };
}

beforeEach(() => vi.clearAllMocks());

describe('MetadataService', () => {
  it('lists tables from SQL Server catalogs with pagination', async () => {
    const { metadata, used } = service([
      {
        recordsets: [
          [
            { schemaName: 'dbo', tableName: 'Items' },
            { schemaName: 'sales', tableName: 'Orders' }
          ]
        ]
      }
    ]);
    const result = await metadata.listTables({ limit: 1 });
    expect(result).toMatchObject({ returned: 1, hasMore: true });
    const queryText = vi.mocked(used[0]!.query).mock.calls[0]?.[0] ?? '';
    expect(queryText).toContain('sys.tables');
    expect(queryText).toContain('sys.schemas');
    expect(queryText).toContain('is_ms_shipped = 0');
    expect(used[0]?.input).toHaveBeenCalledWith('offset', expect.anything(), 0);
  });

  it('binds escaped search text instead of interpolating it', async () => {
    const { metadata, used } = service([{ recordsets: [[]] }]);
    await metadata.searchObjects({ search: "50%_sale'", objectType: 'table' });
    const queryText = vi.mocked(used[0]!.query).mock.calls[0]?.[0] ?? '';
    expect(queryText).not.toContain("50%_sale'");
    expect(used[0]?.input).toHaveBeenCalledWith('pattern', expect.anything(), "%50[%][_]sale'%");
  });

  it('describes columns, primary keys, and both foreign-key directions', async () => {
    const columns = [
      { columnName: 'Id', typeName: 'int', primaryKeyOrdinal: 1 },
      { columnName: 'StoreId', typeName: 'int', primaryKeyOrdinal: null }
    ];
    const outgoing = [
      {
        name: 'FK_Orders_Stores',
        schemaName: 'sales',
        tableName: 'Orders',
        referencedSchemaName: 'dbo',
        referencedTableName: 'Stores',
        columnName: 'StoreId',
        referencedColumnName: 'Id',
        ordinal: 1,
        updateAction: 'NO_ACTION',
        deleteAction: 'NO_ACTION'
      }
    ];
    const { metadata, used } = service([
      { recordsets: [columns] },
      { recordsets: [outgoing] },
      { recordsets: [[]] }
    ]);
    const result = await metadata.describeTable({ schema: 'sales', table: 'Orders' });
    expect(result.primaryKey).toEqual([{ column: 'Id', ordinal: 1 }]);
    expect(result.outgoingForeignKeys).toHaveLength(1);
    const columnsQuery = vi.mocked(used[0]!.query).mock.calls[0]?.[0] ?? '';
    expect(columnsQuery).toContain('c.collation_name AS [collation]');
    expect(columnsQuery).not.toContain('c.collation_name AS collation');
    expect(columnsQuery).toContain('ts.name AS [typeSchema]');
    expect(columnsQuery).toContain('INNER JOIN sys.schemas AS ts ON ts.schema_id = ty.schema_id');
    expect(columnsQuery).not.toContain('TYPE_SCHEMA_NAME');
    expect(columnsQuery).toContain('LEFT JOIN sys.indexes AS pki');
    expect(columnsQuery).toContain('LEFT JOIN sys.index_columns AS pk');
    expect(columnsQuery).not.toContain(') AS pk');
    for (const usedRequest of used) {
      expect(usedRequest.input).toHaveBeenCalledWith('schema', expect.anything(), 'sales');
      expect(usedRequest.input).toHaveBeenCalledWith('table', expect.anything(), 'Orders');
    }
  });

  it('reports a missing table without exposing SQL', async () => {
    const { metadata } = service([{ recordsets: [[]] }]);
    await expect(
      metadata.describeTable({ schema: 'sales', table: 'Missing' })
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'Table not found: sales.Missing'
    });
  });

  it('returns a bounded database schema page', async () => {
    const { metadata } = service([
      {
        recordsets: [
          [
            {
              schemaName: 'dbo',
              objectName: 'Items',
              objectType: 'table',
              columnsJson: '[{"columnName":"Id","primaryKeyOrdinal":1}]',
              foreignKeysJson: '[]'
            },
            {
              schemaName: 'dbo',
              objectName: 'Stores',
              objectType: 'table',
              columnsJson: '[]',
              foreignKeysJson: '[]'
            }
          ]
        ]
      }
    ]);
    const result = await metadata.getDatabaseSchema({ limit: 1 });
    expect(result).toMatchObject({ returnedObjects: 1, hasMore: true });
    expect(result.objects).toEqual([
      {
        schemaName: 'dbo',
        objectName: 'Items',
        objectType: 'table',
        columns: [{ columnName: 'Id', primaryKeyOrdinal: 1 }],
        foreignKeys: []
      }
    ]);
  });
});
