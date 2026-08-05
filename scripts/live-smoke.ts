import { loadConfig } from '../src/config/config.js';
import { SqlExecutor } from '../src/database/executor.js';
import { MetadataService } from '../src/database/metadata.js';
import { PoolManager } from '../src/database/pool.js';
import { normalizeError } from '../src/utils/errors.js';
import { createLogger } from '../src/utils/logger.js';

async function run(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logging.level);
  const pool = new PoolManager(config, logger);
  const executor = new SqlExecutor(pool, config);
  const metadata = new MetadataService(pool, config);

  try {
    const health = await executor.health();
    const version = await executor.version();
    const tables = await metadata.listTables({ offset: 0, limit: 5 });
    const databaseName = await executor.select({
      sql: 'SELECT CAST(DB_NAME() AS nvarchar(128)) AS databaseName',
      limit: 1
    });
    process.stdout.write(`${JSON.stringify({ health, version, tables, databaseName }, null, 2)}\n`);
  } finally {
    await pool.close();
  }
}

run().catch((error) => {
  const safe = normalizeError(error);
  process.stderr.write(`${safe.code}: ${safe.message}\n`);
  process.exitCode = 1;
});
