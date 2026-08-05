import type { BoundedRecordsets } from '../database/types.js';
import { AppError } from './errors.js';

function convert(value: unknown, ancestors: WeakSet<object>): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'bigint') return value.toString(10);
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return { $binary: value.toString('base64') };
  if (typeof value !== 'object') return String(value);
  if (ancestors.has(value)) {
    throw new AppError('DATABASE_QUERY_ERROR', 'SQL Server returned a circular value');
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) return value.map((item) => convert(item, ancestors));
    const plain: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) plain[key] = convert(item, ancestors);
    return plain;
  } finally {
    ancestors.delete(value);
  }
}

export function toJsonValue(value: unknown): unknown {
  return convert(value, new WeakSet());
}

export function boundRecordsets(
  recordsets: readonly (readonly unknown[])[],
  maxRows: number,
  offset = 0
): BoundedRecordsets {
  if (!Number.isInteger(maxRows) || maxRows < 1) {
    throw new AppError('VALIDATION_ERROR', 'Maximum rows must be a positive integer');
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new AppError('VALIDATION_ERROR', 'Row offset must be a non-negative integer');
  }

  let remaining = maxRows;
  let returnedRows = 0;
  let truncated = false;
  const bounded = recordsets.map((recordset, recordsetIndex) => {
    const source = recordsetIndex === 0 ? recordset.slice(offset) : recordset;
    const take = Math.min(source.length, remaining);
    if (take < source.length) truncated = true;
    const rows = source.slice(0, take).map((row) => {
      const converted = toJsonValue(row);
      if (typeof converted !== 'object' || converted === null || Array.isArray(converted)) {
        return { value: converted };
      }
      return converted as Record<string, unknown>;
    });
    remaining -= take;
    returnedRows += take;
    return rows;
  });

  return { recordsets: bounded, returnedRows, truncated };
}

export function sumRowsAffected(rowsAffected: readonly number[] | undefined): number {
  return (rowsAffected ?? []).reduce((total, count) => total + count, 0);
}
