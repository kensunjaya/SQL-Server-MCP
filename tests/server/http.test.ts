import { afterEach, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import type { McpServerFactory } from '@modelcontextprotocol/server';
import { loadConfig } from '../../src/config/config.js';
import { createMcpServer } from '../../src/server/create-server.js';
import { startHttp, type HttpServerHandle } from '../../src/server/http.js';
import type { ToolDependencies } from '../../src/tools/register.js';
import type { Logger } from '../../src/utils/logger.js';

const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const handles: HttpServerHandle[] = [];

function requestStatus(url: string, host: string): Promise<number> {
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: target.hostname,
        port: target.port,
        path: target.pathname,
        method: 'GET',
        headers: { host }
      },
      (response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      }
    );
    request.on('error', reject);
    request.end();
  });
}

function dependencies() {
  const config = loadConfig({
    DB_SERVER: 'localhost',
    DB_DATABASE: 'PosDb',
    DB_USER: 'user',
    DB_PASSWORD: 'password',
    MCP_TRANSPORT: 'http'
  });
  const executor = {
    select: vi.fn(),
    mutate: vi.fn(),
    executeProcedure: vi.fn(),
    executeTransaction: vi.fn(),
    health: vi
      .fn()
      .mockResolvedValue({ ok: true, database: 'PosDb', poolConnected: true, executionTimeMs: 1 }),
    version: vi.fn(),
    explain: vi.fn()
  };
  const metadata = {
    listTables: vi.fn(),
    listViews: vi.fn(),
    searchObjects: vi.fn(),
    describeTable: vi.fn(),
    getDatabaseSchema: vi.fn()
  };
  return { config, dependencies: { config, executor, metadata, logger } as ToolDependencies };
}

afterEach(async () => {
  await Promise.all(handles.splice(0).map((handle) => handle.close()));
});

describe('Streamable HTTP server', () => {
  it('mounts only the configured MCP path and validates Host', async () => {
    const setup = dependencies();
    const config = {
      ...setup.config,
      transport: { ...setup.config.transport, httpPort: 0 }
    };
    const factory: McpServerFactory = () => createMcpServer(setup.dependencies);
    const handle = await startHttp(factory, config, logger);
    handles.push(handle);

    const missing = await fetch(`http://127.0.0.1:${handle.port}/wrong`);
    expect(missing.status).toBe(404);

    const invalidHostStatus = await requestStatus(handle.url, 'evil.example');
    expect([403, 421]).toContain(invalidHostStatus);
  });

  it('requires an allowed-host list for non-loopback binding', async () => {
    const setup = dependencies();
    const config = {
      ...setup.config,
      transport: {
        ...setup.config.transport,
        httpHost: '0.0.0.0',
        httpPort: 0,
        httpAllowedHosts: []
      }
    };
    await expect(
      startHttp(() => createMcpServer(setup.dependencies), config, logger)
    ).rejects.toMatchObject({ code: 'CONFIGURATION_ERROR' });
  });
});
