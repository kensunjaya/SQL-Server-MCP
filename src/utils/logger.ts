export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(message: string, metadata?: Record<string, unknown>): void;
  info(message: string, metadata?: Record<string, unknown>): void;
  warn(message: string, metadata?: Record<string, unknown>): void;
  error(message: string, metadata?: Record<string, unknown>): void;
}

const priority: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function safeMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> {
  if (metadata === undefined) return {};

  return Object.fromEntries(
    Object.entries(metadata).filter(([key]) => !/password|secret|credential|connectionString/i.test(key))
  );
}

export function createLogger(minimumLevel: LogLevel): Logger {
  const write = (level: LogLevel, message: string, metadata?: Record<string, unknown>): void => {
    if (priority[level] < priority[minimumLevel]) return;
    process.stderr.write(
      `${JSON.stringify({
        timestamp: new Date().toISOString(),
        level,
        message,
        ...safeMetadata(metadata)
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
