import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { loadConfig } from '../../src/config/config.js';
import { createMcpServer } from '../../src/server/create-server.js';
import type { ToolDependencies } from '../../src/tools/register.js';
import type { Logger } from '../../src/utils/logger.js';

const clients: Client[] = [];
const handlers: ReturnType<typeof createMcpHandler>[] = [];
const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

afterEach(async () => {
  await Promise.all(clients.splice(0).map(client => client.close()));
  await Promise.all(handlers.splice(0).map(handler => handler.close()));
});

describe('MCP protocol compatibility', () => {
  it('serves the modern 2026 protocol through the v2 handler', async () => {
    const config = loadConfig({
      DB_SERVER: 'localhost',
      DB_DATABASE: 'PosDb',
      DB_USER: 'user',
      DB_PASSWORD: 'password'
    });
    const dependencies = {
      config,
      logger,
      executor: {
        select: vi.fn(),
        mutate: vi.fn(),
        executeProcedure: vi.fn(),
        executeTransaction: vi.fn(),
        health: vi.fn().mockResolvedValue({ ok: true, database: 'PosDb', poolConnected: true, executionTimeMs: 1 }),
        version: vi.fn(),
        explain: vi.fn()
      },
      metadata: {
        listTables: vi.fn(),
        listViews: vi.fn(),
        searchObjects: vi.fn(),
        describeTable: vi.fn(),
        getDatabaseSchema: vi.fn()
      }
    } as ToolDependencies;
    const handler = createMcpHandler(() => createMcpServer(dependencies));
    handlers.push(handler);
    const transport = new StreamableHTTPClientTransport(new URL('http://test.local/mcp'), {
      fetch: (url, init) => handler.fetch(new Request(url, init))
    });
    const client = new Client(
      { name: 'protocol-test', version: '1.0.0' },
      { versionNegotiation: { mode: 'auto' } }
    );
    await client.connect(transport);
    clients.push(client);
    expect(client.getProtocolEra()).toBe('modern');
    expect((await client.listTools()).tools.some(tool => tool.name === 'health_check')).toBe(true);
  });
});
