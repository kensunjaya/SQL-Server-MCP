import { afterEach, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import type { McpRequestContext, McpServerFactory } from '@modelcontextprotocol/server';
import type { RequestAuthenticator } from '../../src/auth/authenticate.js';
import { loadConfig } from '../../src/config/config.js';
import { createMcpServer } from '../../src/server/create-server.js';
import { startHttp, type HttpServerHandle } from '../../src/server/http.js';
import type { ToolDependencies } from '../../src/tools/register.js';
import type { Logger } from '../../src/utils/logger.js';

const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const handles: HttpServerHandle[] = [];
const clients: Client[] = [];

interface TestResponse {
  status: number;
  authenticate?: string;
}

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

async function request(url: string, headers: Record<string, string> = {}): Promise<TestResponse> {
  const response = await fetch(url, { headers });
  await response.body?.cancel();
  const authenticate = response.headers.get('www-authenticate');
  return {
    status: response.status,
    ...(authenticate === null ? {} : { authenticate })
  };
}

function dependencies() {
  const config = loadConfig({
    DB_SERVER: 'localhost',
    DB_DATABASE: 'PosDb',
    DB_USER: 'user',
    DB_PASSWORD: 'password',
    MCP_TRANSPORT: 'http',
    MCP_HTTP_BEARER_TOKEN: 'test-secret'
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
  await Promise.all(clients.splice(0).map((client) => client.close()));
  await Promise.all(handles.splice(0).map((handle) => handle.close()));
  vi.clearAllMocks();
});

describe('Streamable HTTP server', () => {
  it('requires the configured bearer token', async () => {
    const setup = dependencies();
    const config = {
      ...setup.config,
      transport: { ...setup.config.transport, httpPort: 0 }
    };
    const handle = await startHttp(() => createMcpServer(setup.dependencies), config, logger);
    handles.push(handle);

    expect(await request(handle.url)).toMatchObject({
      status: 401,
      authenticate: 'Bearer'
    });
    expect(await request(handle.url, { authorization: 'Basic test-secret' })).toMatchObject({
      status: 401
    });
    expect(await request(handle.url, { authorization: 'Bearer wrong-secret' })).toMatchObject({
      status: 401
    });

    const authenticated = await request(handle.url, {
      authorization: 'Bearer test-secret'
    });
    expect(authenticated.status).not.toBe(401);
  });

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

  it('allows requests without credentials in none mode', async () => {
    const setup = dependencies();
    const config = {
      ...setup.config,
      auth: { mode: 'none' as const },
      transport: { ...setup.config.transport, httpPort: 0 }
    };
    const handle = await startHttp(() => createMcpServer(setup.dependencies), config, logger);
    handles.push(handle);

    expect((await request(handle.url)).status).not.toBe(401);
  });

  it('uses the reusable authenticator for Cloudflare Access requests', async () => {
    const setup = dependencies();
    const config = {
      ...setup.config,
      auth: {
        mode: 'cloudflare' as const,
        cloudflare: {
          teamDomain: 'https://example.cloudflareaccess.com',
          audience: 'application-audience'
        }
      },
      transport: { ...setup.config.transport, httpPort: 0 }
    };
    const authenticator: RequestAuthenticator = {
      authenticateRequest: vi.fn().mockResolvedValue({
        credential: 'signed.cloudflare.jwt',
        identity: {
          type: 'cloudflare',
          subject: 'access-user-id',
          email: 'cashier@example.com',
          issuer: 'https://example.cloudflareaccess.com',
          audience: 'application-audience',
          expiresAt: 1_900_000_000
        }
      })
    };
    const handle = await startHttp(
      () => createMcpServer(setup.dependencies),
      config,
      logger,
      authenticator
    );
    handles.push(handle);

    const response = await request(handle.url, {
      'cf-access-jwt-assertion': 'signed.cloudflare.jwt'
    });

    expect(response.status).not.toBe(401);
    expect(authenticator.authenticateRequest).toHaveBeenCalledOnce();
  });

  it('passes verified identity to the MCP request context', async () => {
    const setup = dependencies();
    const config = {
      ...setup.config,
      auth: {
        mode: 'cloudflare' as const,
        cloudflare: {
          teamDomain: 'https://example.cloudflareaccess.com',
          audience: 'application-audience'
        }
      },
      transport: { ...setup.config.transport, httpPort: 0 }
    };
    const authenticator: RequestAuthenticator = {
      authenticateRequest: vi.fn().mockResolvedValue({
        credential: 'signed.cloudflare.jwt',
        identity: {
          type: 'cloudflare',
          subject: 'access-user-id',
          email: 'cashier@example.com',
          issuer: 'https://example.cloudflareaccess.com',
          audience: 'application-audience',
          expiresAt: 1_900_000_000
        }
      })
    };
    const contexts: McpRequestContext[] = [];
    const factory: McpServerFactory = (context) => {
      contexts.push(context);
      return createMcpServer(setup.dependencies);
    };
    const handle = await startHttp(factory, config, logger, authenticator);
    handles.push(handle);
    const transport = new StreamableHTTPClientTransport(new URL(handle.url), {
      requestInit: { headers: { 'cf-access-jwt-assertion': 'signed.cloudflare.jwt' } }
    });
    const client = new Client(
      { name: 'auth-context-test', version: '1.0.0' },
      { versionNegotiation: { mode: 'auto' } }
    );

    await client.connect(transport);
    clients.push(client);
    await client.listTools();
    await client.callTool({ name: 'health_check', arguments: {} });

    expect(contexts.some((context) => context.authInfo?.clientId === 'access-user-id')).toBe(true);
    expect(
      contexts.some((context) => context.authInfo?.extra?.authenticationType === 'cloudflare')
    ).toBe(true);
    expect(logger.info).toHaveBeenCalledWith(
      'MCP tool audit',
      expect.objectContaining({
        tool: 'health_check',
        outcome: 'success',
        authenticationType: 'cloudflare',
        subject: 'access-user-id',
        email: 'cashier@example.com'
      })
    );
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

  it('defensively rejects a bearer HTTP config without a bearer token', async () => {
    const setup = dependencies();
    const auth = { ...setup.config.auth };
    delete auth.bearerToken;
    const config = {
      ...setup.config,
      auth,
      transport: { ...setup.config.transport, httpPort: 0 }
    };

    await expect(
      startHttp(() => createMcpServer(setup.dependencies), config, logger)
    ).rejects.toMatchObject({
      code: 'CONFIGURATION_ERROR',
      message: expect.stringContaining('MCP_AUTH_TOKEN')
    });
  });
});
