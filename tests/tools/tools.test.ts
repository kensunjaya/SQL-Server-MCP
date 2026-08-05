import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { loadConfig } from '../../src/config/config.js';
import { createMcpServer } from '../../src/server/create-server.js';
import type { ToolDependencies } from '../../src/tools/register.js';
import { AppError } from '../../src/utils/errors.js';
import type { Logger } from '../../src/utils/logger.js';

const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const clients: Client[] = [];

function dependencies(allowDelete: boolean): ToolDependencies {
  const config = loadConfig({
    DB_SERVER: 'localhost',
    DB_DATABASE: 'PosDb',
    DB_USER: 'user',
    DB_PASSWORD: 'password',
    DB_ALLOW_DELETE: String(allowDelete)
  });
  return {
    config,
    logger,
    metadata: {
      listTables: vi.fn().mockResolvedValue({ items: [], returned: 0, hasMore: false }),
      listViews: vi.fn().mockResolvedValue({ items: [], returned: 0, hasMore: false }),
      searchObjects: vi.fn().mockResolvedValue({ items: [], returned: 0, hasMore: false }),
      describeTable: vi.fn().mockResolvedValue({ schema: 'dbo', table: 'Items' }),
      getDatabaseSchema: vi.fn().mockResolvedValue({ objects: [], returnedObjects: 0, hasMore: false })
    },
    executor: {
      select: vi.fn().mockResolvedValue({
        recordsets: [[{ id: 1 }]],
        returnedRows: 1,
        truncated: false,
        offset: 0,
        limit: 10,
        executionTimeMs: 1
      }),
      mutate: vi.fn().mockResolvedValue({
        recordsets: [],
        returnedRows: 0,
        truncated: false,
        rowsAffected: [1],
        affectedRows: 1,
        executionTimeMs: 1
      }),
      executeProcedure: vi.fn().mockResolvedValue({
        recordsets: [],
        returnedRows: 0,
        truncated: false,
        rowsAffected: [],
        affectedRows: 0,
        output: {},
        returnValue: 0,
        executionTimeMs: 1
      }),
      executeTransaction: vi.fn().mockResolvedValue({ committed: true, steps: [], executionTimeMs: 1 }),
      health: vi.fn().mockResolvedValue({
        ok: true,
        database: 'PosDb',
        poolConnected: true,
        executionTimeMs: 1
      }),
      version: vi.fn().mockResolvedValue({ productVersion: '17.0', executionTimeMs: 1 }),
      explain: vi.fn().mockResolvedValue({ planXml: '<ShowPlanXML />', executionTimeMs: 1 })
    }
  };
}

async function connectedClient(deps: ToolDependencies): Promise<Client> {
  const server = createMcpServer(deps);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await client.connect(clientTransport);
  clients.push(client);
  return client;
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map(client => client.close()));
});

describe('MCP SQL Server tools', () => {
  it('registers the complete enabled tool set', async () => {
    const client = await connectedClient(dependencies(true));
    expect((await client.listTools()).tools.map(tool => tool.name).sort()).toEqual(
      [
        'describe_table',
        'execute_delete',
        'execute_insert',
        'execute_select',
        'execute_stored_procedure',
        'execute_transaction',
        'execute_update',
        'explain_query',
        'get_database_schema',
        'get_database_version',
        'health_check',
        'list_tables',
        'list_views',
        'search_tables'
      ].sort()
    );
  });

  it('does not advertise DELETE while disabled', async () => {
    const client = await connectedClient(dependencies(false));
    expect((await client.listTools()).tools.map(tool => tool.name)).not.toContain('execute_delete');
  });

  it('returns text and structured SELECT content', async () => {
    const client = await connectedClient(dependencies(false));
    const result = await client.callTool({
      name: 'execute_select',
      arguments: { sql: 'SELECT 1 AS id' }
    });
    expect(result.isError).not.toBe(true);
    expect(result.content[0]).toMatchObject({ type: 'text' });
    expect(result.structuredContent).toMatchObject({ returnedRows: 1, recordsets: [[{ id: 1 }]] });
  });

  it('returns a safe MCP tool error without a stack or password', async () => {
    const deps = dependencies(false);
    vi.mocked(deps.executor.select).mockRejectedValue(
      new AppError('DATABASE_QUERY_ERROR', 'Query timed out', { driverCode: 'ETIMEOUT' })
    );
    const client = await connectedClient(deps);
    const result = await client.callTool({
      name: 'execute_select',
      arguments: { sql: 'SELECT 1' }
    });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      error: { code: 'DATABASE_QUERY_ERROR', message: 'Query timed out' }
    });
    expect(JSON.stringify(result)).not.toContain('password');
    expect(JSON.stringify(result)).not.toContain('stack');
  });

  it('rejects invalid input before calling the executor', async () => {
    const deps = dependencies(false);
    const client = await connectedClient(deps);
    const result = await client.callTool({
      name: 'execute_select',
      arguments: { sql: '', offset: -1 }
    });
    expect(result.isError).toBe(true);
    expect(deps.executor.select).not.toHaveBeenCalled();
  });
});
