import { performance } from 'node:perf_hooks';
import sql from 'mssql';
import type { AppConfig } from '../config/config.js';
import { validateSql, type StatementKind } from '../sql/guardrails.js';
import { parseMultipartIdentifier, quoteIdentifierParts } from '../sql/identifiers.js';
import { AppError, normalizeError } from '../utils/errors.js';
import { boundRecordsets, sumRowsAffected, toJsonValue } from '../utils/json.js';
import {
  bindInputParameters,
  bindProcedureParameters,
  type BindableRequest
} from './parameters.js';
import type { PoolManager } from './pool.js';
import type {
  MutationResult,
  ProcedureParameter,
  ProcedureResult,
  QueryResult,
  SqlParameter,
  TransactionResult,
  TransactionStep,
  TransactionStepResult
} from './types.js';

interface DriverResult {
  recordsets?: readonly (readonly unknown[])[];
  rowsAffected?: number[];
  output?: Record<string, unknown>;
  returnValue?: unknown;
}

export interface RequestLike extends BindableRequest {
  query(command: string): Promise<DriverResult>;
  execute(procedure: string): Promise<DriverResult>;
}

export interface TransactionLike {
  begin(): Promise<unknown>;
  commit(): Promise<unknown>;
  rollback(): Promise<unknown>;
}

export interface ExecutorDriver {
  request(parent: unknown): RequestLike;
  transaction(pool: sql.ConnectionPool): TransactionLike;
}

export interface PoolProvider {
  getPool(): Promise<sql.ConnectionPool>;
  readonly connected: boolean;
}

const defaultDriver: ExecutorDriver = {
  request: (parent) => new sql.Request(parent as never) as unknown as RequestLike,
  transaction: (pool) => new sql.Transaction(pool)
};

function elapsed(start: number): number {
  return Number((performance.now() - start).toFixed(2));
}

function asRecordsets(result: DriverResult): readonly (readonly unknown[])[] {
  return result.recordsets ?? [];
}

function queryFailure(message: string, error: unknown): AppError {
  const normalized = normalizeError(error);
  return new AppError('DATABASE_QUERY_ERROR', message, normalized.details, { cause: error });
}

export class SqlExecutor {
  constructor(
    private readonly pools: PoolProvider | PoolManager,
    private readonly config: AppConfig,
    private readonly driver: ExecutorDriver = defaultDriver
  ) {}

  private checkMutation(kind: 'insert' | 'update' | 'delete'): void {
    if (!this.config.features.allowWrite) {
      throw new AppError('FEATURE_DISABLED', 'Database write operations are disabled');
    }
    if (kind === 'delete' && !this.config.features.allowDelete) {
      throw new AppError('FEATURE_DISABLED', 'DELETE operations are disabled');
    }
  }

  async select(input: {
    sql: string;
    parameters?: SqlParameter[] | undefined;
    offset?: number | undefined;
    limit?: number | undefined;
  }): Promise<QueryResult> {
    const validated = validateSql(input.sql, 'select', this.config.limits.maxSqlLength);
    const offset = input.offset ?? 0;
    const requestedLimit = input.limit ?? this.config.limits.maxRows;
    if (!Number.isInteger(offset) || offset < 0) {
      throw new AppError('VALIDATION_ERROR', 'Row offset must be a non-negative integer');
    }
    if (!Number.isInteger(requestedLimit) || requestedLimit < 1) {
      throw new AppError('VALIDATION_ERROR', 'Row limit must be a positive integer');
    }
    const limit = Math.min(requestedLimit, this.config.limits.maxRows);
    const start = performance.now();

    try {
      const pool = await this.pools.getPool();
      const request = this.driver.request(pool);
      bindInputParameters(request, input.parameters);
      const result = await request.query(validated.sql);
      return {
        ...boundRecordsets(asRecordsets(result), limit, offset),
        offset,
        limit,
        executionTimeMs: elapsed(start)
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw queryFailure('SELECT query failed', error);
    }
  }

  async mutate(
    kind: 'insert' | 'update' | 'delete',
    input: { sql: string; parameters?: SqlParameter[] | undefined }
  ): Promise<MutationResult> {
    this.checkMutation(kind);
    const validated = validateSql(input.sql, kind, this.config.limits.maxSqlLength);
    const start = performance.now();

    try {
      const pool = await this.pools.getPool();
      const request = this.driver.request(pool);
      bindInputParameters(request, input.parameters);
      const result = await request.query(validated.sql);
      const rowsAffected = result.rowsAffected ?? [];
      return {
        ...boundRecordsets(asRecordsets(result), this.config.limits.maxRows),
        rowsAffected,
        affectedRows: sumRowsAffected(rowsAffected),
        executionTimeMs: elapsed(start)
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw queryFailure(`${kind.toUpperCase()} statement failed`, error);
    }
  }

  async executeProcedure(input: {
    procedure: string;
    parameters?: ProcedureParameter[] | undefined;
  }): Promise<ProcedureResult> {
    if (!this.config.features.allowProcedures) {
      throw new AppError('FEATURE_DISABLED', 'Stored procedure execution is disabled');
    }
    const procedure = quoteIdentifierParts(parseMultipartIdentifier(input.procedure, 2));
    const start = performance.now();

    try {
      const pool = await this.pools.getPool();
      const request = this.driver.request(pool);
      bindProcedureParameters(request, input.parameters);
      const result = await request.execute(procedure);
      const rowsAffected = result.rowsAffected ?? [];
      const output = toJsonValue(result.output ?? {}) as Record<string, unknown>;
      return {
        ...boundRecordsets(asRecordsets(result), this.config.limits.maxRows),
        rowsAffected,
        affectedRows: sumRowsAffected(rowsAffected),
        output,
        returnValue: toJsonValue(result.returnValue),
        executionTimeMs: elapsed(start)
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw queryFailure(`Stored procedure ${procedure} failed`, error);
    }
  }

  private validateTransactionSteps(steps: readonly TransactionStep[]): void {
    if (!this.config.features.allowTransactions) {
      throw new AppError('FEATURE_DISABLED', 'Transactions are disabled');
    }
    if (steps.length === 0) {
      throw new AppError('VALIDATION_ERROR', 'A transaction requires at least one step');
    }
    if (steps.length > this.config.limits.maxTransactionSteps) {
      throw new AppError(
        'VALIDATION_ERROR',
        `Transaction exceeds the configured maximum of ${this.config.limits.maxTransactionSteps} steps`
      );
    }
    for (const step of steps) {
      if (step.operation !== 'select') this.checkMutation(step.operation);
      validateSql(step.sql, step.operation, this.config.limits.maxSqlLength);
    }
  }

  async executeTransaction(input: { steps: TransactionStep[] }): Promise<TransactionResult> {
    this.validateTransactionSteps(input.steps);
    const start = performance.now();
    const pool = await this.pools.getPool();
    const transaction = this.driver.transaction(pool);
    let begun = false;

    try {
      await transaction.begin();
      begun = true;
      const results: TransactionStepResult[] = [];
      for (const step of input.steps) {
        const stepStart = performance.now();
        const validated = validateSql(
          step.sql,
          step.operation as StatementKind,
          this.config.limits.maxSqlLength
        );
        const request = this.driver.request(transaction);
        bindInputParameters(request, step.parameters);
        const result = await request.query(validated.sql);
        const rowsAffected = result.rowsAffected ?? [];
        results.push({
          operation: step.operation,
          ...boundRecordsets(asRecordsets(result), this.config.limits.maxRows),
          rowsAffected,
          affectedRows: sumRowsAffected(rowsAffected),
          executionTimeMs: elapsed(stepStart)
        });
      }
      await transaction.commit();
      return { committed: true, steps: results, executionTimeMs: elapsed(start) };
    } catch (error) {
      if (begun) {
        try {
          await transaction.rollback();
        } catch {
          // Preserve the statement failure as the primary cause.
        }
      }
      const normalized = normalizeError(error);
      throw new AppError('TRANSACTION_ERROR', 'Transaction rolled back', normalized.details, {
        cause: error
      });
    }
  }

  async health(): Promise<{
    ok: true;
    database: string;
    poolConnected: boolean;
    executionTimeMs: number;
  }> {
    const start = performance.now();
    try {
      const pool = await this.pools.getPool();
      const result = await this.driver
        .request(pool)
        .query('SELECT CAST(DB_NAME() AS nvarchar(128)) AS databaseName');
      const row = asRecordsets(result)[0]?.[0] as { databaseName?: unknown } | undefined;
      return {
        ok: true,
        database:
          typeof row?.databaseName === 'string' ? row.databaseName : this.config.database.database,
        poolConnected: this.pools.connected,
        executionTimeMs: elapsed(start)
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw queryFailure('SQL Server health check failed', error);
    }
  }

  async version(): Promise<Record<string, unknown>> {
    const start = performance.now();
    const query = `SELECT
      CAST(SERVERPROPERTY('ProductVersion') AS nvarchar(128)) AS productVersion,
      CAST(SERVERPROPERTY('ProductLevel') AS nvarchar(128)) AS productLevel,
      CAST(SERVERPROPERTY('Edition') AS nvarchar(128)) AS edition,
      CAST(SERVERPROPERTY('EngineEdition') AS int) AS engineEdition,
      @@VERSION AS versionText`;
    try {
      const pool = await this.pools.getPool();
      const result = await this.driver.request(pool).query(query);
      const row = toJsonValue(asRecordsets(result)[0]?.[0] ?? {}) as Record<string, unknown>;
      return { ...row, executionTimeMs: elapsed(start) };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw queryFailure('Could not read SQL Server version', error);
    }
  }

  async explain(input: { sql: string; parameters?: SqlParameter[] | undefined }): Promise<{
    planXml: string;
    executionTimeMs: number;
  }> {
    const validated = validateSql(input.sql, 'select', this.config.limits.maxSqlLength);
    const start = performance.now();
    const pool = await this.pools.getPool();
    const transaction = this.driver.transaction(pool);
    let begun = false;
    let showplanEnabled = false;

    try {
      await transaction.begin();
      begun = true;
      await this.driver.request(transaction).query('SET SHOWPLAN_XML ON');
      showplanEnabled = true;
      const request = this.driver.request(transaction);
      bindInputParameters(request, input.parameters);
      const result = await request.query(validated.sql);
      const row = asRecordsets(result)[0]?.[0];
      const plan =
        typeof row === 'object' && row !== null
          ? Object.values(row).find((value) => typeof value === 'string')
          : undefined;
      if (typeof plan !== 'string') {
        throw new AppError(
          'DATABASE_QUERY_ERROR',
          'SQL Server did not return an estimated XML plan'
        );
      }
      return { planXml: plan, executionTimeMs: elapsed(start) };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw queryFailure('Could not generate an estimated query plan', error);
    } finally {
      if (showplanEnabled) {
        try {
          await this.driver.request(transaction).query('SET SHOWPLAN_XML OFF');
        } catch {
          // The transaction rollback below still releases the reserved connection.
        }
      }
      if (begun) {
        try {
          await transaction.rollback();
        } catch {
          // The original query or plan result remains the useful error.
        }
      }
    }
  }
}
