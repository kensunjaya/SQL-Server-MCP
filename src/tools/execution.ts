import type { McpServer } from '@modelcontextprotocol/server';
import type { AppConfig } from '../config/config.js';
import type { SqlExecutor } from '../database/executor.js';
import type { Logger } from '../utils/logger.js';
import {
  ddlSchema,
  mutationSchema,
  procedureSchema,
  selectSchema,
  transactionSchema
} from './schemas.js';
import { successResult, withToolErrors } from './responses.js';

export interface ExecutionToolsService {
  select: SqlExecutor['select'];
  mutate: SqlExecutor['mutate'];
  executeDdl: SqlExecutor['executeDdl'];
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
      title: 'Read records with SELECT',
      description:
        'Read records using one SQL Server SELECT statement or SELECT-ending CTE. Bind values with @name placeholders and the parameters array. Supports offset and limit; returns bounded recordsets, row counts, truncation status, and execution time.',
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
        title: operation === 'insert' ? 'Create records with INSERT' : 'Update records with UPDATE',
        description:
          operation === 'insert'
            ? 'Create records using one SQL Server INSERT statement. Bind values with @name placeholders and the parameters array. Returns affected row counts and bounded OUTPUT recordsets when requested by the SQL. Requires DB_ALLOW_WRITE=true.'
            : 'Modify records using one SQL Server UPDATE statement. Use a WHERE clause to target the intended records and bind values with @name placeholders and the parameters array. Returns affected row counts and bounded OUTPUT recordsets when requested by the SQL. Requires DB_ALLOW_WRITE=true.',
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
        title: 'Delete records with DELETE',
        description:
          'Remove records using one SQL Server DELETE statement. Use a WHERE clause to target the intended records and bind values with @name placeholders and the parameters array. Returns affected row counts and bounded OUTPUT recordsets when requested by the SQL. Available when DB_ALLOW_DELETE=true; also requires DB_ALLOW_WRITE=true.',
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

  if (config.features.allowDdl) {
    for (const operation of [
      {
        kind: 'createTable',
        toolName: 'execute_create_table',
        title: 'Execute a CREATE TABLE statement',
        label: 'CREATE TABLE'
      },
      {
        kind: 'alterTable',
        toolName: 'execute_alter_table',
        title: 'Execute an ALTER TABLE statement',
        label: 'ALTER TABLE'
      }
    ] as const) {
      server.registerTool(
        operation.toolName,
        {
          title: operation.title,
          description: `Execute one SQL Server ${operation.label} statement to manage a table in the configured database. Available when DB_ALLOW_DDL=true; also requires DB_ALLOW_WRITE=true.`,
          inputSchema: ddlSchema,
          annotations: {
            readOnlyHint: false,
            destructiveHint: true,
            idempotentHint: false,
            openWorldHint: false
          }
        },
        withToolErrors(operation.toolName, logger, async (args) => {
          const result = await executor.executeDdl(operation.kind, args);
          return successResult(
            `${operation.label} completed in ${result.executionTimeMs} ms.`,
            result
          );
        })
      );
    }
  }

  server.registerTool(
    'execute_stored_procedure',
    {
      title: 'Execute a stored procedure',
      description:
        'Execute a SQL Server stored procedure by one- or two-part name, preferably schema-qualified, with typed input, output, or input-output parameters. Returns bounded recordsets, affected row counts, output parameters, and the return value. Procedures may modify data; requires DB_ALLOW_PROCEDURES=true.',
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
        'Run an ordered batch of parameterized SELECT, INSERT, UPDATE, or enabled DELETE statements in one SQL Server transaction. Commits all steps on success and rolls back on failure. Requires DB_ALLOW_TRANSACTIONS=true; write and delete steps also require their corresponding feature permissions.',
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
