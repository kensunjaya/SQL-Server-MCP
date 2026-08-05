import dotenv from 'dotenv';
import { z } from 'zod/v4';

export interface AppConfig {
  database: {
    server: string;
    port?: number;
    instanceName?: string;
    database: string;
    user: string;
    password: string;
    encrypt: boolean;
    trustServerCertificate: boolean;
    connectionTimeoutMs: number;
    requestTimeoutMs: number;
  };
  pool: { min: number; max: number; idleTimeoutMs: number };
  limits: { maxRows: number; maxSqlLength: number; maxTransactionSteps: number };
  features: {
    allowWrite: boolean;
    allowDelete: boolean;
    allowProcedures: boolean;
    allowTransactions: boolean;
  };
  transport: {
    kind: 'stdio' | 'http';
    httpHost: string;
    httpPort: number;
    httpPath: string;
    httpAllowedHosts: readonly string[];
  };
  logging: { level: 'debug' | 'info' | 'warn' | 'error' };
}

const booleanValue = (defaultValue: boolean) =>
  z
    .enum(['true', 'false', '1', '0'])
    .default(defaultValue ? 'true' : 'false')
    .transform(value => value === 'true' || value === '1');

const integerValue = (defaultValue: number, minimum: number, maximum = Number.MAX_SAFE_INTEGER) =>
  z
    .string()
    .default(String(defaultValue))
    .refine(value => /^\d+$/.test(value), 'must be a whole number')
    .transform(Number)
    .pipe(z.number().int().min(minimum).max(maximum));

const optionalInteger = z
  .string()
  .optional()
  .transform(value => (value === undefined || value === '' ? undefined : Number(value)))
  .pipe(z.number().int().min(1).max(65_535).optional());

const envSchema = z
  .object({
    DB_SERVER: z.string().trim().min(1),
    DB_PORT: optionalInteger,
    DB_INSTANCE_NAME: z.string().trim().min(1).optional(),
    DB_DATABASE: z.string().trim().min(1),
    DB_USER: z.string().trim().min(1),
    DB_PASSWORD: z.string().min(1),
    DB_ENCRYPT: booleanValue(true),
    DB_TRUST_SERVER_CERTIFICATE: booleanValue(false),
    DB_POOL_MIN: integerValue(0, 0, 1_000),
    DB_POOL_MAX: integerValue(10, 1, 1_000),
    DB_POOL_IDLE_TIMEOUT_MS: integerValue(30_000, 1),
    DB_CONNECTION_TIMEOUT_MS: integerValue(15_000, 1),
    DB_REQUEST_TIMEOUT_MS: integerValue(30_000, 1),
    DB_MAX_ROWS: integerValue(500, 1, 100_000),
    DB_MAX_SQL_LENGTH: integerValue(100_000, 1, 10_000_000),
    DB_MAX_TRANSACTION_STEPS: integerValue(20, 1, 1_000),
    DB_ALLOW_WRITE: booleanValue(true),
    DB_ALLOW_DELETE: booleanValue(false),
    DB_ALLOW_PROCEDURES: booleanValue(true),
    DB_ALLOW_TRANSACTIONS: booleanValue(true),
    MCP_TRANSPORT: z.enum(['stdio', 'http']).default('stdio'),
    MCP_HTTP_HOST: z.string().trim().min(1).default('127.0.0.1'),
    MCP_HTTP_PORT: integerValue(3_000, 1, 65_535),
    MCP_HTTP_PATH: z.string().trim().min(1).default('/mcp'),
    MCP_HTTP_ALLOWED_HOSTS: z.string().default(''),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info')
  })
  .superRefine((value, context) => {
    if (value.DB_PORT !== undefined && value.DB_INSTANCE_NAME !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['DB_INSTANCE_NAME'],
        message: 'DB_PORT and DB_INSTANCE_NAME cannot both be set'
      });
    }
    if (value.DB_POOL_MIN > value.DB_POOL_MAX) {
      context.addIssue({
        code: 'custom',
        path: ['DB_POOL_MIN'],
        message: 'DB_POOL_MIN cannot exceed DB_POOL_MAX'
      });
    }
  });

function formatConfigError(error: z.ZodError): Error {
  const fields = error.issues.map(issue => `${issue.path.join('.') || 'environment'}: ${issue.message}`);
  return new Error(`Invalid configuration: ${fields.join('; ')}`);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  if (env === process.env) {
    dotenv.config({ quiet: true });
  }

  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw formatConfigError(parsed.error);
  }

  const value = parsed.data;
  const normalizedPath = `/${value.MCP_HTTP_PATH.replace(/^\/+/, '')}`;
  const allowedHosts = value.MCP_HTTP_ALLOWED_HOSTS.split(',')
    .map(host => host.trim())
    .filter(Boolean);

  return Object.freeze({
    database: Object.freeze({
      server: value.DB_SERVER,
      ...(value.DB_PORT === undefined ? {} : { port: value.DB_PORT }),
      ...(value.DB_INSTANCE_NAME === undefined ? {} : { instanceName: value.DB_INSTANCE_NAME }),
      database: value.DB_DATABASE,
      user: value.DB_USER,
      password: value.DB_PASSWORD,
      encrypt: value.DB_ENCRYPT,
      trustServerCertificate: value.DB_TRUST_SERVER_CERTIFICATE,
      connectionTimeoutMs: value.DB_CONNECTION_TIMEOUT_MS,
      requestTimeoutMs: value.DB_REQUEST_TIMEOUT_MS
    }),
    pool: Object.freeze({
      min: value.DB_POOL_MIN,
      max: value.DB_POOL_MAX,
      idleTimeoutMs: value.DB_POOL_IDLE_TIMEOUT_MS
    }),
    limits: Object.freeze({
      maxRows: value.DB_MAX_ROWS,
      maxSqlLength: value.DB_MAX_SQL_LENGTH,
      maxTransactionSteps: value.DB_MAX_TRANSACTION_STEPS
    }),
    features: Object.freeze({
      allowWrite: value.DB_ALLOW_WRITE,
      allowDelete: value.DB_ALLOW_DELETE,
      allowProcedures: value.DB_ALLOW_PROCEDURES,
      allowTransactions: value.DB_ALLOW_TRANSACTIONS
    }),
    transport: Object.freeze({
      kind: value.MCP_TRANSPORT,
      httpHost: value.MCP_HTTP_HOST,
      httpPort: value.MCP_HTTP_PORT,
      httpPath: normalizedPath,
      httpAllowedHosts: Object.freeze(allowedHosts)
    }),
    logging: Object.freeze({ level: value.LOG_LEVEL })
  });
}
