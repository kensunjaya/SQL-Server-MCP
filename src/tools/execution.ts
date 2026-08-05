import type { McpServer } from '@modelcontextprotocol/server';
import type { AppConfig } from '../config/config.js';
import type { SqlExecutor } from '../database/executor.js';
import type { Logger } from '../utils/logger.js';
import { mutationSchema, procedureSchema, selectSchema, transactionSchema } from './schemas.js';
import { successResult, withToolErrors } from './responses.js';

export interface ExecutionToolsService {
  select: SqlExecutor['select'];
  mutate: SqlExecutor['mutate'];
  executeProcedure: SqlExecutor['executeProcedure'];
  executeTransaction: SqlExecutor['executeTransaction'];
}

const readOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false
};
const mutation = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false
};

export function registerExecutionTools(
  server: McpServer,
  executor: ExecutionToolsService,
  config: AppConfig,
  logger: Logger
): void {
  server.registerTool(
    'execute_select',
    {
      title: 'Execute a SELECT query',
      description:
        'Execute one SELECT or CTE query. Put values in named parameters instead of interpolating them into SQL.',
      inputSchema: selectSchema,
      annotations: readOnly
    },
    withToolErrors('execute_select', logger, async (args) => {
      const result = await executor.select(args);
      return successResult(
        `Returned ${result.returnedRows} row(s) in ${result.executionTimeMs} ms${result.truncated ? ' (truncated)' : ''}.`,
        result
      );
    })
  );

  for (const operation of ['insert', 'update'] as const) {
    server.registerTool(
      `execute_${operation}`,
      {
        title: `Execute an ${operation.toUpperCase()} statement`,
        description: `Execute one parameterized ${operation.toUpperCase()} statement and return affected rows plus OUTPUT results.`,
        inputSchema: mutationSchema,
        annotations: mutation
      },
      withToolErrors(`execute_${operation}`, logger, async (args) => {
        const result = await executor.mutate(operation, args);
        return successResult(
          `${operation.toUpperCase()} affected ${result.affectedRows} row(s) in ${result.executionTimeMs} ms.`,
          result
        );
      })
    );
  }

  if (config.features.allowDelete) {
    server.registerTool(
      'execute_delete',
      {
        title: 'Execute a DELETE statement',
        description:
          'Execute one parameterized DELETE statement. This tool is configuration-gated.',
        inputSchema: mutationSchema,
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
          openWorldHint: false
        }
      },
      withToolErrors('execute_delete', logger, async (args) => {
        const result = await executor.mutate('delete', args);
        return successResult(
          `DELETE affected ${result.affectedRows} row(s) in ${result.executionTimeMs} ms.`,
          result
        );
      })
    );
  }

  server.registerTool(
    'execute_stored_procedure',
    {
      title: 'Execute a stored procedure',
      description:
        'Execute a schema-qualified stored procedure with typed input, output, or input-output parameters.',
      inputSchema: procedureSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    withToolErrors('execute_stored_procedure', logger, async (args) => {
      const result = await executor.executeProcedure(args);
      return successResult(
        `Procedure affected ${result.affectedRows} row(s) in ${result.executionTimeMs} ms.`,
        result
      );
    })
  );

  server.registerTool(
    'execute_transaction',
    {
      title: 'Execute a SQL transaction',
      description:
        'Execute ordered SELECT, INSERT, UPDATE, or enabled DELETE statements atomically; all steps roll back on failure.',
      inputSchema: transactionSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    withToolErrors('execute_transaction', logger, async (args) => {
      const result = await executor.executeTransaction(args);
      return successResult(
        `Committed ${result.steps.length} transaction step(s) in ${result.executionTimeMs} ms.`,
        result
      );
    })
  );
}
