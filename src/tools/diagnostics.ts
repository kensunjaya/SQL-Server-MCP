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
      description: 'Check MCP server and SQL Server connectivity without exposing credentials.',
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
        'Return SQL Server product version, level, edition, engine edition, and version text.',
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
        'Compile a parameterized SELECT and return its estimated XML plan without executing it.',
      inputSchema: explainSchema,
      annotations: readOnly
    },
    withToolErrors('explain_query', logger, async (args) => {
      const result = await executor.explain(args);
      return successResult(`Generated estimated plan in ${result.executionTimeMs} ms.`, result);
    })
  );
}
