export interface SqlParameter {
  name: string;
  value: unknown;
  type?: string | undefined;
  length?: number | 'MAX' | undefined;
  precision?: number | undefined;
  scale?: number | undefined;
}

export interface ProcedureParameter extends SqlParameter {
  direction?: 'input' | 'output' | 'inputOutput' | undefined;
}

export interface BoundedRecordsets {
  recordsets: Record<string, unknown>[][];
  returnedRows: number;
  truncated: boolean;
}

export interface QueryResult extends BoundedRecordsets {
  offset: number;
  limit: number;
  executionTimeMs: number;
}

export interface MutationResult extends BoundedRecordsets {
  rowsAffected: number[];
  affectedRows: number;
  executionTimeMs: number;
}

export interface DdlResult {
  executionTimeMs: number;
}

export interface ProcedureResult extends MutationResult {
  output: Record<string, unknown>;
  returnValue: unknown;
}

export interface TransactionStep {
  operation: 'select' | 'insert' | 'update' | 'delete';
  sql: string;
  parameters?: SqlParameter[] | undefined;
}

export interface TransactionStepResult extends BoundedRecordsets {
  operation: TransactionStep['operation'];
  rowsAffected: number[];
  affectedRows: number;
  executionTimeMs: number;
}

export interface TransactionResult {
  committed: true;
  steps: TransactionStepResult[];
  executionTimeMs: number;
}
