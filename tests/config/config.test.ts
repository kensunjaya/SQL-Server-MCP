import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config/config.js';

const required = {
  DB_SERVER: 'localhost',
  DB_DATABASE: 'PosDb',
  DB_USER: 'mcp_user',
  DB_PASSWORD: 'do-not-print-me'
};

describe('loadConfig', () => {
  it('loads safe defaults', () => {
    const config = loadConfig(required);
    expect(config.transport.kind).toBe('stdio');
    expect(config.transport.httpHost).toBe('127.0.0.1');
    expect(config.limits.maxRows).toBe(500);
    expect(config.features.allowWrite).toBe(true);
    expect(config.features.allowDelete).toBe(false);
    expect(config.pool.max).toBe(10);
  });

  it('coerces supported booleans and normalizes the HTTP path', () => {
    const config = loadConfig({
      ...required,
      DB_ENCRYPT: '0',
      DB_ALLOW_DELETE: '1',
      MCP_HTTP_PATH: 'database/mcp'
    });
    expect(config.database.encrypt).toBe(false);
    expect(config.features.allowDelete).toBe(true);
    expect(config.transport.httpPath).toBe('/database/mcp');
  });

  it('rejects a port and instance name together', () => {
    expect(() =>
      loadConfig({ ...required, DB_PORT: '1433', DB_INSTANCE_NAME: 'SQLEXPRESS' })
    ).toThrow('cannot both be set');
  });

  it('rejects a pool minimum greater than its maximum', () => {
    expect(() => loadConfig({ ...required, DB_POOL_MIN: '20', DB_POOL_MAX: '10' })).toThrow(
      'cannot exceed'
    );
  });

  it('does not reveal the password in validation errors', () => {
    try {
      loadConfig({ ...required, DB_PORT: 'invalid' });
      expect.fail('Expected invalid configuration to throw');
    } catch (error) {
      expect(error).toMatchObject({ code: 'CONFIGURATION_ERROR' });
      expect(String(error)).not.toContain('do-not-print-me');
    }
  });
});
