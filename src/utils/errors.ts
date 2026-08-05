export type ErrorCode =
  | 'CONFIGURATION_ERROR'
  | 'VALIDATION_ERROR'
  | 'FEATURE_DISABLED'
  | 'DATABASE_CONNECTION_ERROR'
  | 'DATABASE_QUERY_ERROR'
  | 'TRANSACTION_ERROR'
  | 'INTERNAL_ERROR';

export interface SafeError {
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'AppError';
  }
}

interface DriverErrorLike {
  code?: unknown;
  number?: unknown;
  state?: unknown;
  class?: unknown;
  message?: unknown;
}

function isDriverErrorLike(error: unknown): error is DriverErrorLike {
  return typeof error === 'object' && error !== null;
}

export function normalizeError(error: unknown): SafeError {
  if (error instanceof AppError) {
    return {
      code: error.code,
      message: error.message,
      ...(error.details === undefined ? {} : { details: error.details })
    };
  }

  if (isDriverErrorLike(error)) {
    const driverCode = typeof error.code === 'string' ? error.code : undefined;
    const details = Object.fromEntries(
      Object.entries({
        driverCode,
        number: typeof error.number === 'number' ? error.number : undefined,
        state: typeof error.state === 'number' ? error.state : undefined,
        severity: typeof error.class === 'number' ? error.class : undefined
      }).filter((entry): entry is [string, string | number] => entry[1] !== undefined)
    );
    const connectionCodes = new Set(['ELOGIN', 'ESOCKET', 'ECONNCLOSED', 'ENOTOPEN']);
    return {
      code: driverCode !== undefined && connectionCodes.has(driverCode)
        ? 'DATABASE_CONNECTION_ERROR'
        : 'DATABASE_QUERY_ERROR',
      message:
        typeof error.message === 'string' && error.message.trim() !== ''
          ? error.message
          : 'SQL Server operation failed',
      ...(Object.keys(details).length === 0 ? {} : { details })
    };
  }

  return { code: 'INTERNAL_ERROR', message: 'An unexpected internal error occurred' };
}
