#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { loadConfig } from './config/config.js';
import { SqlExecutor } from './database/executor.js';
import { MetadataService } from './database/metadata.js';
import { PoolManager } from './database/pool.js';
import { createMcpServer } from './server/create-server.js';
import { startHttp } from './server/http.js';
import { startStdio, type ServerHandle } from './server/stdio.js';
import { normalizeError } from './utils/errors.js';
import { createLogger } from './utils/logger.js';

export async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logging.level);
  const pool = new PoolManager(config, logger);
  const executor = new SqlExecutor(pool, config);
  const metadata = new MetadataService(pool, config);
  const factory = () => createMcpServer({ config, executor, metadata, logger });

  const handle: ServerHandle =
    config.transport.kind === 'stdio'
      ? startStdio(factory, logger)
      : await startHttp(factory, config, logger);
  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('Shutting down MCP server', { signal });
    try {
      await handle.close();
      await pool.close();
    } catch (error) {
      const safe = normalizeError(error);
      logger.error('MCP server shutdown failed', { code: safe.code, message: safe.message });
      process.exitCode = 1;
    }
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

const entryPath = process.argv[1];
if (entryPath !== undefined && import.meta.url === pathToFileURL(entryPath).href) {
  main().catch((error) => {
    const safe = normalizeError(error);
    process.stderr.write(
      `${JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'error',
        message: safe.message,
        code: safe.code
      })}\n`
    );
    process.exitCode = 1;
  });
}
