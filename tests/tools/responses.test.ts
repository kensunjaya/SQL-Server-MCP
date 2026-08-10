import type { AuthInfo, ServerContext } from '@modelcontextprotocol/server';
import { describe, expect, it, vi } from 'vitest';
import { successResult, withToolErrors } from '../../src/tools/responses.js';
import type { Logger } from '../../src/utils/logger.js';

function logger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function httpContext(authInfo: AuthInfo): ServerContext {
  return { http: { authInfo } } as ServerContext;
}

describe('tool response auditing', () => {
  it('logs a successful Cloudflare-authenticated tool call with safe identity fields', async () => {
    const log = logger();
    const context = httpContext({
      token: 'raw-jwt-must-not-be-logged',
      clientId: 'access-user-id',
      scopes: [],
      extra: {
        authenticationType: 'cloudflare',
        subject: 'access-user-id',
        email: 'cashier@example.com',
        issuer: 'https://example.cloudflareaccess.com',
        audience: 'application-audience'
      }
    });
    const wrapped = withToolErrors('list_tables', log, async () =>
      successResult('Found 0 tables.', { returned: 0 })
    );

    await wrapped({}, context);

    expect(log.info).toHaveBeenCalledWith('MCP tool audit', {
      tool: 'list_tables',
      outcome: 'success',
      executionTimeMs: expect.any(Number),
      authenticationType: 'cloudflare',
      subject: 'access-user-id',
      email: 'cashier@example.com',
      issuer: 'https://example.cloudflareaccess.com',
      audience: 'application-audience'
    });
    expect(JSON.stringify(vi.mocked(log.info).mock.calls)).not.toContain(
      'raw-jwt-must-not-be-logged'
    );
  });

  it('logs failed HTTP tool calls with bearer identity and no credential', async () => {
    const log = logger();
    const context = httpContext({
      token: 'developer-secret',
      clientId: 'static-bearer',
      scopes: [],
      extra: { authenticationType: 'bearer', subject: 'static-bearer' }
    });
    const wrapped = withToolErrors('execute_update', log, async () => {
      throw new Error('database rejected request');
    });

    const result = await wrapped({}, context);

    expect(result.isError).toBe(true);
    expect(log.info).toHaveBeenCalledWith('MCP tool audit', {
      tool: 'execute_update',
      outcome: 'failure',
      executionTimeMs: expect.any(Number),
      authenticationType: 'bearer',
      subject: 'static-bearer'
    });
    expect(JSON.stringify(vi.mocked(log.info).mock.calls)).not.toContain('developer-secret');
  });

  it('does not emit an HTTP identity audit event for non-HTTP transports', async () => {
    const log = logger();
    const wrapped = withToolErrors('health_check', log, async () =>
      successResult('Healthy.', { ok: true })
    );

    await wrapped({}, {} as ServerContext);

    expect(log.info).not.toHaveBeenCalled();
    expect(log.debug).toHaveBeenCalledWith('MCP tool completed', expect.any(Object));
  });
});
