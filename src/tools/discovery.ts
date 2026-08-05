import type { McpServer } from '@modelcontextprotocol/server';
import type { MetadataService } from '../database/metadata.js';
import type { Logger } from '../utils/logger.js';
import { describeTableSchema, paginationSchema, searchSchema } from './schemas.js';
import { successResult, withToolErrors } from './responses.js';

export interface MetadataToolsService {
  listTables: MetadataService['listTables'];
  listViews: MetadataService['listViews'];
  searchObjects: MetadataService['searchObjects'];
  describeTable: MetadataService['describeTable'];
  getDatabaseSchema: MetadataService['getDatabaseSchema'];
}

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

export function registerDiscoveryTools(
  server: McpServer,
  metadata: MetadataToolsService,
  logger: Logger
): void {
  server.registerTool(
    'list_tables',
    {
      title: 'List database tables',
      description: 'List user tables dynamically, including schema and approximate row count.',
      inputSchema: paginationSchema,
      annotations: readOnly
    },
    withToolErrors('list_tables', logger, async args => {
      const result = await metadata.listTables(args);
      return successResult(`Found ${result.returned} table(s).`, result);
    })
  );

  server.registerTool(
    'list_views',
    {
      title: 'List database views',
      description: 'List user views dynamically, including their schemas.',
      inputSchema: paginationSchema,
      annotations: readOnly
    },
    withToolErrors('list_views', logger, async args => {
      const result = await metadata.listViews(args);
      return successResult(`Found ${result.returned} view(s).`, result);
    })
  );

  server.registerTool(
    'search_tables',
    {
      title: 'Search tables and views',
      description: 'Search user table and view names by a literal case-insensitive database pattern.',
      inputSchema: searchSchema,
      annotations: readOnly
    },
    withToolErrors('search_tables', logger, async args => {
      const result = await metadata.searchObjects(args);
      return successResult(`Found ${result.returned} matching object(s).`, result);
    })
  );

  server.registerTool(
    'describe_table',
    {
      title: 'Describe a table',
      description:
        'Describe columns, SQL types, nullability, defaults, primary key, identity/computed fields, and incoming/outgoing foreign keys.',
      inputSchema: describeTableSchema,
      annotations: readOnly
    },
    withToolErrors('describe_table', logger, async args => {
      const result = await metadata.describeTable(args);
      return successResult(`Described ${args.schema}.${args.table}.`, result);
    })
  );

  server.registerTool(
    'get_database_schema',
    {
      title: 'Get database schema',
      description: 'Return a paginated overview of user tables, views, and their columns.',
      inputSchema: paginationSchema,
      annotations: readOnly
    },
    withToolErrors('get_database_schema', logger, async args => {
      const result = await metadata.getDatabaseSchema(args);
      return successResult(`Returned ${String(result.returnedObjects)} schema object(s).`, result);
    })
  );
}
