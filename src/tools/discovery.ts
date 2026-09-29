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

const readOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false
};

export function registerDiscoveryTools(
  server: McpServer,
  metadata: MetadataToolsService,
  logger: Logger
): void {
  server.registerTool(
    'list_tables',
    {
      title: 'List database tables',
      description:
        'Discover user tables in the configured SQL Server database, with schema names, descriptions, and approximate row counts. Supports offset and limit pagination.',
      inputSchema: paginationSchema,
      annotations: readOnly
    },
    withToolErrors('list_tables', logger, async (args) => {
      const result = await metadata.listTables(args);
      return successResult(`Found ${result.returned} table(s).`, result);
    })
  );

  server.registerTool(
    'list_views',
    {
      title: 'List database views',
      description:
        'Discover user views in the configured SQL Server database, with schema names and descriptions. Supports offset and limit pagination.',
      inputSchema: paginationSchema,
      annotations: readOnly
    },
    withToolErrors('list_views', logger, async (args) => {
      const result = await metadata.listViews(args);
      return successResult(`Found ${result.returned} view(s).`, result);
    })
  );

  server.registerTool(
    'search_tables',
    {
      title: 'Search tables and views',
      description:
        'Find user tables and views by a literal substring of their schema or object names. Filter by objectType and paginate with offset and limit. Case sensitivity follows the database collation.',
      inputSchema: searchSchema,
      annotations: readOnly
    },
    withToolErrors('search_tables', logger, async (args) => {
      const result = await metadata.searchObjects(args);
      return successResult(`Found ${result.returned} matching object(s).`, result);
    })
  );

  server.registerTool(
    'describe_table',
    {
      title: 'Describe a table',
      description:
        'Inspect a user table before CRUD operations: columns, SQL types, nullability, defaults, primary key, identity and computed fields, and incoming and outgoing foreign keys. Specify schema and table; schema defaults to dbo.',
      inputSchema: describeTableSchema,
      annotations: readOnly
    },
    withToolErrors('describe_table', logger, async (args) => {
      const result = await metadata.describeTable(args);
      return successResult(`Described ${args.schema}.${args.table}.`, result);
    })
  );

  server.registerTool(
    'get_database_schema',
    {
      title: 'Get database schema',
      description:
        'Explore the configured database with a paginated overview of user tables and views, including columns, SQL types, primary-key ordinals, and outgoing foreign keys.',
      inputSchema: paginationSchema,
      annotations: readOnly
    },
    withToolErrors('get_database_schema', logger, async (args) => {
      const result = await metadata.getDatabaseSchema(args);
      return successResult(`Returned ${String(result.returnedObjects)} schema object(s).`, result);
    })
  );
}
