import { performance } from 'node:perf_hooks';
import type { AppConfig } from '../config/config.js';
import { AppError } from '../utils/errors.js';
import { boundRecordsets, toJsonValue } from '../utils/json.js';
import { bindInputParameters } from './parameters.js';
import type { PoolManager } from './pool.js';
import type { ExecutorDriver, PoolProvider, RequestLike } from './executor.js';
import sql from 'mssql';

export interface MetadataPage<T> {
  items: T[];
  offset: number;
  limit: number;
  returned: number;
  hasMore: boolean;
  executionTimeMs: number;
}

export interface ForeignKeyDescription {
  name: string;
  schema: string;
  table: string;
  referencedSchema: string;
  referencedTable: string;
  columns: { column: string; referencedColumn: string; ordinal: number }[];
  updateAction: string;
  deleteAction: string;
}

interface MetadataDriver {
  request(parent: unknown): RequestLike;
}

const defaultDriver: MetadataDriver = {
  request: parent => new sql.Request(parent as never) as unknown as RequestLike
};

function duration(start: number): number {
  return Number((performance.now() - start).toFixed(2));
}

function records(result: Awaited<ReturnType<RequestLike['query']>>): Record<string, unknown>[] {
  return boundRecordsets(result.recordsets ?? [], Number.MAX_SAFE_INTEGER).recordsets[0] ?? [];
}

function groupForeignKeys(rows: readonly Record<string, unknown>[]): ForeignKeyDescription[] {
  const grouped = new Map<string, ForeignKeyDescription>();
  for (const row of rows) {
    const name = String(row.name ?? '');
    const schema = String(row.schemaName ?? '');
    const table = String(row.tableName ?? '');
    const referencedSchema = String(row.referencedSchemaName ?? '');
    const referencedTable = String(row.referencedTableName ?? '');
    const key = `${schema}.${table}.${name}.${referencedSchema}.${referencedTable}`;
    let item = grouped.get(key);
    if (item === undefined) {
      item = {
        name,
        schema,
        table,
        referencedSchema,
        referencedTable,
        columns: [],
        updateAction: String(row.updateAction ?? ''),
        deleteAction: String(row.deleteAction ?? '')
      };
      grouped.set(key, item);
    }
    item.columns.push({
      column: String(row.columnName ?? ''),
      referencedColumn: String(row.referencedColumnName ?? ''),
      ordinal: Number(row.ordinal ?? 0)
    });
  }
  return [...grouped.values()];
}

export class MetadataService {
  private readonly driver: MetadataDriver;

  constructor(
    private readonly pools: PoolProvider | PoolManager,
    private readonly config: AppConfig,
    driver?: Pick<ExecutorDriver, 'request'>
  ) {
    this.driver = driver ?? defaultDriver;
  }

  private page(offset = 0, limit = this.config.limits.maxRows): { offset: number; limit: number } {
    if (!Number.isInteger(offset) || offset < 0) {
      throw new AppError('VALIDATION_ERROR', 'Metadata offset must be a non-negative integer');
    }
    if (!Number.isInteger(limit) || limit < 1) {
      throw new AppError('VALIDATION_ERROR', 'Metadata limit must be a positive integer');
    }
    return { offset, limit: Math.min(limit, this.config.limits.maxRows) };
  }

  private async execute(command: string, parameters: { name: string; value: unknown; type?: string }[] = []) {
    const pool = await this.pools.getPool();
    const request = this.driver.request(pool);
    bindInputParameters(request, parameters);
    return request.query(command);
  }

  async listTables(input: { offset?: number; limit?: number } = {}): Promise<MetadataPage<Record<string, unknown>>> {
    const { offset, limit } = this.page(input.offset, input.limit);
    const start = performance.now();
    const result = await this.execute(
      `SELECT
        s.name AS schemaName,
        t.name AS tableName,
        CAST(COALESCE(SUM(CASE WHEN p.index_id IN (0, 1) THEN p.rows ELSE 0 END), 0) AS bigint) AS approximateRowCount,
        CAST(ep.value AS nvarchar(4000)) AS description
      FROM sys.tables AS t
      INNER JOIN sys.schemas AS s ON s.schema_id = t.schema_id
      LEFT JOIN sys.partitions AS p ON p.object_id = t.object_id
      LEFT JOIN sys.extended_properties AS ep
        ON ep.major_id = t.object_id AND ep.minor_id = 0 AND ep.name = N'MS_Description'
      WHERE t.is_ms_shipped = 0
      GROUP BY s.name, t.name, ep.value
      ORDER BY s.name, t.name
      OFFSET @offset ROWS FETCH NEXT @fetch ROWS ONLY`,
      [
        { name: 'offset', type: 'Int', value: offset },
        { name: 'fetch', type: 'Int', value: limit + 1 }
      ]
    );
    const all = records(result);
    return {
      items: all.slice(0, limit),
      offset,
      limit,
      returned: Math.min(all.length, limit),
      hasMore: all.length > limit,
      executionTimeMs: duration(start)
    };
  }

  async listViews(input: { offset?: number; limit?: number } = {}): Promise<MetadataPage<Record<string, unknown>>> {
    const { offset, limit } = this.page(input.offset, input.limit);
    const start = performance.now();
    const result = await this.execute(
      `SELECT
        s.name AS schemaName,
        v.name AS viewName,
        CAST(ep.value AS nvarchar(4000)) AS description
      FROM sys.views AS v
      INNER JOIN sys.schemas AS s ON s.schema_id = v.schema_id
      LEFT JOIN sys.extended_properties AS ep
        ON ep.major_id = v.object_id AND ep.minor_id = 0 AND ep.name = N'MS_Description'
      WHERE v.is_ms_shipped = 0
      ORDER BY s.name, v.name
      OFFSET @offset ROWS FETCH NEXT @fetch ROWS ONLY`,
      [
        { name: 'offset', type: 'Int', value: offset },
        { name: 'fetch', type: 'Int', value: limit + 1 }
      ]
    );
    const all = records(result);
    return {
      items: all.slice(0, limit),
      offset,
      limit,
      returned: Math.min(all.length, limit),
      hasMore: all.length > limit,
      executionTimeMs: duration(start)
    };
  }

  async searchObjects(input: {
    search: string;
    objectType?: 'table' | 'view' | 'all';
    offset?: number;
    limit?: number;
  }): Promise<MetadataPage<Record<string, unknown>>> {
    const search = input.search.trim();
    if (search === '') throw new AppError('VALIDATION_ERROR', 'Search text cannot be empty');
    const { offset, limit } = this.page(input.offset, input.limit);
    const objectType = input.objectType ?? 'all';
    const escaped = search.replaceAll('[', '[[]').replaceAll('%', '[%]').replaceAll('_', '[_]');
    const start = performance.now();
    const result = await this.execute(
      `SELECT s.name AS schemaName, o.name AS objectName,
        CASE o.type WHEN 'U' THEN 'table' WHEN 'V' THEN 'view' END AS objectType
      FROM sys.objects AS o
      INNER JOIN sys.schemas AS s ON s.schema_id = o.schema_id
      WHERE o.is_ms_shipped = 0
        AND o.type IN ('U', 'V')
        AND (@objectType = 'all' OR (@objectType = 'table' AND o.type = 'U') OR (@objectType = 'view' AND o.type = 'V'))
        AND (s.name LIKE @pattern OR o.name LIKE @pattern)
      ORDER BY s.name, o.name
      OFFSET @offset ROWS FETCH NEXT @fetch ROWS ONLY`,
      [
        { name: 'objectType', type: 'NVarChar', value: objectType },
        { name: 'pattern', type: 'NVarChar', value: `%${escaped}%` },
        { name: 'offset', type: 'Int', value: offset },
        { name: 'fetch', type: 'Int', value: limit + 1 }
      ]
    );
    const all = records(result);
    return {
      items: all.slice(0, limit),
      offset,
      limit,
      returned: Math.min(all.length, limit),
      hasMore: all.length > limit,
      executionTimeMs: duration(start)
    };
  }

  async describeTable(input: { schema?: string; table: string }): Promise<Record<string, unknown>> {
    const schema = input.schema?.trim() || 'dbo';
    const table = input.table.trim();
    if (table === '') throw new AppError('VALIDATION_ERROR', 'Table name cannot be empty');
    const start = performance.now();
    const parameters = [
      { name: 'schema', type: 'NVarChar', value: schema },
      { name: 'table', type: 'NVarChar', value: table }
    ];

    const columnsResult = await this.execute(
      `SELECT
        c.column_id AS ordinal,
        c.name AS columnName,
        ty.name AS typeName,
        TYPE_SCHEMA_NAME(c.user_type_id) AS typeSchema,
        c.max_length AS maxLength,
        c.precision,
        c.scale,
        c.is_nullable AS nullable,
        c.is_identity AS identityColumn,
        ic.seed_value AS identitySeed,
        ic.increment_value AS identityIncrement,
        c.is_computed AS computed,
        cc.definition AS computedExpression,
        cc.is_persisted AS persisted,
        dc.definition AS defaultExpression,
        c.collation_name AS collation,
        pk.key_ordinal AS primaryKeyOrdinal
      FROM sys.tables AS t
      INNER JOIN sys.schemas AS s ON s.schema_id = t.schema_id
      INNER JOIN sys.columns AS c ON c.object_id = t.object_id
      INNER JOIN sys.types AS ty ON ty.user_type_id = c.user_type_id
      LEFT JOIN sys.identity_columns AS ic ON ic.object_id = c.object_id AND ic.column_id = c.column_id
      LEFT JOIN sys.computed_columns AS cc ON cc.object_id = c.object_id AND cc.column_id = c.column_id
      LEFT JOIN sys.default_constraints AS dc ON dc.object_id = c.default_object_id
      LEFT JOIN (
        SELECT ic2.object_id, ic2.column_id, ic2.key_ordinal
        FROM sys.indexes AS i
        INNER JOIN sys.index_columns AS ic2 ON ic2.object_id = i.object_id AND ic2.index_id = i.index_id
        WHERE i.is_primary_key = 1
      ) AS pk ON pk.object_id = c.object_id AND pk.column_id = c.column_id
      WHERE s.name = @schema AND t.name = @table AND t.is_ms_shipped = 0
      ORDER BY c.column_id`,
      parameters
    );
    const columns = records(columnsResult);
    if (columns.length === 0) {
      throw new AppError('VALIDATION_ERROR', `Table not found: ${schema}.${table}`);
    }

    const foreignKeyQuery = `SELECT
      fk.name,
      ps.name AS schemaName,
      pt.name AS tableName,
      rs.name AS referencedSchemaName,
      rt.name AS referencedTableName,
      pc.name AS columnName,
      rc.name AS referencedColumnName,
      fkc.constraint_column_id AS ordinal,
      fk.update_referential_action_desc AS updateAction,
      fk.delete_referential_action_desc AS deleteAction
    FROM sys.foreign_keys AS fk
    INNER JOIN sys.foreign_key_columns AS fkc ON fkc.constraint_object_id = fk.object_id
    INNER JOIN sys.tables AS pt ON pt.object_id = fk.parent_object_id
    INNER JOIN sys.schemas AS ps ON ps.schema_id = pt.schema_id
    INNER JOIN sys.columns AS pc ON pc.object_id = pt.object_id AND pc.column_id = fkc.parent_column_id
    INNER JOIN sys.tables AS rt ON rt.object_id = fk.referenced_object_id
    INNER JOIN sys.schemas AS rs ON rs.schema_id = rt.schema_id
    INNER JOIN sys.columns AS rc ON rc.object_id = rt.object_id AND rc.column_id = fkc.referenced_column_id
    WHERE (__DIRECTION__)
    ORDER BY fk.name, fkc.constraint_column_id`;
    const outgoing = records(
      await this.execute(
        foreignKeyQuery.replace('__DIRECTION__', 'ps.name = @schema AND pt.name = @table'),
        parameters
      )
    );
    const incoming = records(
      await this.execute(
        foreignKeyQuery.replace('__DIRECTION__', 'rs.name = @schema AND rt.name = @table'),
        parameters
      )
    );

    return {
      schema,
      table,
      columns,
      primaryKey: columns
        .filter(column => Number(column.primaryKeyOrdinal ?? 0) > 0)
        .map(column => ({
          column: column.columnName,
          ordinal: column.primaryKeyOrdinal
        })),
      outgoingForeignKeys: groupForeignKeys(outgoing),
      incomingForeignKeys: groupForeignKeys(incoming),
      executionTimeMs: duration(start)
    };
  }

  async getDatabaseSchema(input: { offset?: number; limit?: number } = {}): Promise<Record<string, unknown>> {
    const { offset, limit } = this.page(input.offset, input.limit);
    const start = performance.now();
    const result = await this.execute(
      `WITH Objects AS (
        SELECT s.name AS schemaName, o.name AS objectName,
          CASE o.type WHEN 'U' THEN 'table' ELSE 'view' END AS objectType,
          o.object_id AS objectId
        FROM sys.objects AS o
        INNER JOIN sys.schemas AS s ON s.schema_id = o.schema_id
        WHERE o.is_ms_shipped = 0 AND o.type IN ('U', 'V')
      ), Paged AS (
        SELECT *, ROW_NUMBER() OVER (ORDER BY schemaName, objectName) AS rowNumber
        FROM Objects
      )
      SELECT
        p.schemaName,
        p.objectName,
        p.objectType,
        (
          SELECT c.column_id AS ordinal, c.name AS columnName, ty.name AS typeName,
            c.max_length AS maxLength, c.precision, c.scale, c.is_nullable AS nullable
          FROM sys.columns AS c
          INNER JOIN sys.types AS ty ON ty.user_type_id = c.user_type_id
          WHERE c.object_id = p.objectId
          ORDER BY c.column_id
          FOR JSON PATH
        ) AS columnsJson
      FROM Paged AS p
      WHERE p.rowNumber > @offset AND p.rowNumber <= @upperBound
      ORDER BY p.rowNumber`,
      [
        { name: 'offset', type: 'Int', value: offset },
        { name: 'upperBound', type: 'Int', value: offset + limit + 1 }
      ]
    );
    const all = records(result);
    const items = all.slice(0, limit).map(item => {
      const raw = typeof item.columnsJson === 'string' ? item.columnsJson : '[]';
      let columns: unknown;
      try {
        columns = JSON.parse(raw) as unknown;
      } catch {
        columns = [];
      }
      const object = { ...item };
      delete object.columnsJson;
      return { ...object, columns: toJsonValue(columns) };
    });
    return {
      offset,
      limit,
      returnedObjects: items.length,
      hasMore: all.length > limit,
      objects: items,
      executionTimeMs: duration(start)
    };
  }
}
