import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod/v4';
import type { SqlExecutor } from '../database/executor.js';
import type { Logger } from '../utils/logger.js';
import { explainSchema } from './schemas.js';
import { successResult, withToolErrors } from './responses.js';

export interface DiagnosticToolsService {
  health: SqlExecutor['health'];
  version: SqlExecutor['version'];
  explain: SqlExecutor['explain'];
}

const readOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false
};

export function registerDiagnosticTools(
  server: McpServer,
  executor: DiagnosticToolsService,
  logger: Logger
): void {
  server.registerTool(
    'health_check',
    {
      title: 'Check database health',
      description:
        'Check connectivity to the configured SQL Server database and return its name, connection pool state, and execution time without exposing credentials.',
      inputSchema: z.object({}).strict(),
      annotations: readOnly
    },
    withToolErrors('health_check', logger, async () => {
      const result = await executor.health();
      return successResult(`SQL Server is reachable (${result.executionTimeMs} ms).`, result);
    })
  );

  server.registerTool(
    'get_database_version',
    {
      title: 'Get SQL Server version',
      description:
        'Identify the connected SQL Server instance by its product version, product level, edition, engine edition, and full version text.',
      inputSchema: z.object({}).strict(),
      annotations: readOnly
    },
    withToolErrors('get_database_version', logger, async () => {
      const result = await executor.version();
      return successResult(
        `SQL Server version ${String(result.productVersion ?? 'unknown')}.`,
        result
      );
    })
  );

  server.registerTool(
    'explain_query',
    {
      title: 'Explain a SELECT query',
      description:
        'Inspect the estimated execution plan for one parameterized SQL Server SELECT statement or SELECT-ending CTE without executing the data query. Returns the XML plan; requires SQL Server SHOWPLAN permission.',
      inputSchema: explainSchema,
      annotations: readOnly
    },
    withToolErrors('explain_query', logger, async (args) => {
      const result = await executor.explain(args);
      return successResult(`Generated estimated plan in ${result.executionTimeMs} ms.`, result);
    })
  );
}
