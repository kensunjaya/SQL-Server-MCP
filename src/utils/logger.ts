export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(message: string, metadata?: Record<string, unknown>): void;
  info(message: string, metadata?: Record<string, unknown>): void;
  warn(message: string, metadata?: Record<string, unknown>): void;
  error(message: string, metadata?: Record<string, unknown>): void;
}

const priority: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const sensitiveKey =
  /password|secret|credential|connectionString|token|jwt|authorization|cookie|headers?/i;

function sanitizeValue(value: unknown, seen: Set<object>): unknown {
  if (typeof value !== 'object' || value === null) return value;
  if (seen.has(value)) return '[Circular]';

  seen.add(value);
  const sanitized = Array.isArray(value)
    ? value.map((item) => sanitizeValue(item, seen))
    : Object.fromEntries(
        Object.entries(value)
          .filter(([key]) => !sensitiveKey.test(key))
          .map(([key, item]) => [key, sanitizeValue(item, seen)])
      );
  seen.delete(value);
  return sanitized;
}

function safeMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> {
  if (metadata === undefined) return {};
  return sanitizeValue(metadata, new Set()) as Record<string, unknown>;
}

export function createLogger(minimumLevel: LogLevel): Logger {
  const write = (level: LogLevel, message: string, metadata?: Record<string, unknown>): void => {
    if (priority[level] < priority[minimumLevel]) return;
    process.stderr.write(
      `${JSON.stringify({
        ...safeMetadata(metadata),
        timestamp: new Date().toISOString(),
        level,
        message
      })}\n`
    );
  };

  return {
    debug: (message, metadata) => write('debug', message, metadata),
    info: (message, metadata) => write('info', message, metadata),
    warn: (message, metadata) => write('warn', message, metadata),
    error: (message, metadata) => write('error', message, metadata)
  };
}
