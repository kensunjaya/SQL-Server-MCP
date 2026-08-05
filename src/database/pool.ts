import sql from 'mssql';
import type { AppConfig } from '../config/config.js';
import type { Logger } from '../utils/logger.js';
import { AppError } from '../utils/errors.js';

export type PoolFactory = (config: sql.config) => sql.ConnectionPool;

export class PoolManager {
  private pool: sql.ConnectionPool | undefined;
  private connectionPromise: Promise<sql.ConnectionPool> | undefined;

  constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger,
    private readonly poolFactory: PoolFactory = (poolConfig) => new sql.ConnectionPool(poolConfig)
  ) {}

  private createPoolConfig(): sql.config {
    const database = this.config.database;
    return {
      server: database.server,
      database: database.database,
      user: database.user,
      password: database.password,
      ...(database.port === undefined ? {} : { port: database.port }),
      connectionTimeout: database.connectionTimeoutMs,
      requestTimeout: database.requestTimeoutMs,
      pool: {
        min: this.config.pool.min,
        max: this.config.pool.max,
        idleTimeoutMillis: this.config.pool.idleTimeoutMs
      },
      options: {
        encrypt: database.encrypt,
        trustServerCertificate: database.trustServerCertificate,
        ...(database.instanceName === undefined ? {} : { instanceName: database.instanceName })
      }
    };
  }

  async getPool(): Promise<sql.ConnectionPool> {
    if (this.connectionPromise !== undefined) return this.connectionPromise;

    const pool = this.poolFactory(this.createPoolConfig());
    pool.on('error', (error) => {
      this.logger.error('SQL Server connection pool error', {
        driverCode:
          typeof (error as { code?: unknown }).code === 'string'
            ? (error as { code: string }).code
            : undefined
      });
    });
    this.pool = pool;

    const attempt = pool
      .connect()
      .then(() => {
        this.logger.info('Connected to SQL Server', { database: this.config.database.database });
        return pool;
      })
      .catch((error: unknown) => {
        if (this.connectionPromise === attempt) this.connectionPromise = undefined;
        if (this.pool === pool) this.pool = undefined;
        throw new AppError(
          'DATABASE_CONNECTION_ERROR',
          'Could not connect to SQL Server',
          undefined,
          {
            cause: error
          }
        );
      });

    this.connectionPromise = attempt;
    return attempt;
  }

  get connected(): boolean {
    return this.pool?.connected ?? false;
  }

  async close(): Promise<void> {
    const activePool = this.pool;
    this.pool = undefined;
    this.connectionPromise = undefined;
    if (activePool === undefined) return;
    await activePool.close();
    this.logger.info('SQL Server connection pool closed');
  }
}
