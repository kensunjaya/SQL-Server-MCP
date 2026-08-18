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
    expect(config.features.allowDdl).toBe(false);
    expect(config.pool.max).toBe(10);
    expect(config.auth).toEqual({ mode: 'bearer' });
  });

  it('coerces supported booleans and normalizes the HTTP path', () => {
    const config = loadConfig({
      ...required,
      DB_ENCRYPT: '0',
      DB_ALLOW_DELETE: '1',
      DB_ALLOW_DDL: 'true',
      MCP_HTTP_PATH: 'database/mcp'
    });
    expect(config.database.encrypt).toBe(false);
    expect(config.features.allowDelete).toBe(true);
    expect(config.features.allowDdl).toBe(true);
    expect(config.transport.httpPath).toBe('/database/mcp');
  });

  it('requires a bearer token for HTTP bearer mode', () => {
    expect(() => loadConfig({ ...required, MCP_TRANSPORT: 'http' })).toThrow(
      'MCP_AUTH_TOKEN: is required for bearer or hybrid HTTP authentication'
    );
  });

  it('defaults HTTP authentication to bearer and accepts the legacy token variable', () => {
    const config = loadConfig({
      ...required,
      MCP_TRANSPORT: 'http',
      MCP_HTTP_BEARER_TOKEN: 'legacy-secret'
    });

    expect(config.auth).toEqual({ mode: 'bearer', bearerToken: 'legacy-secret' });
    expect(config.transport).not.toHaveProperty('httpBearerToken');
  });

  it('loads none mode without credentials', () => {
    const config = loadConfig({
      ...required,
      MCP_TRANSPORT: 'http',
      MCP_AUTH_MODE: 'none'
    });

    expect(config.auth).toEqual({ mode: 'none' });
  });

  it.each(['cloudflare', 'hybrid'] as const)('requires Cloudflare settings for %s mode', (mode) => {
    expect(() =>
      loadConfig({
        ...required,
        MCP_TRANSPORT: 'http',
        MCP_AUTH_MODE: mode,
        MCP_AUTH_TOKEN: 'test-secret'
      })
    ).toThrow('CF_ACCESS_TEAM_DOMAIN');
  });

  it('requires a bearer token for hybrid mode', () => {
    expect(() =>
      loadConfig({
        ...required,
        MCP_TRANSPORT: 'http',
        MCP_AUTH_MODE: 'hybrid',
        CF_ACCESS_TEAM_DOMAIN: 'https://example.cloudflareaccess.com',
        CF_ACCESS_AUD: 'application-audience'
      })
    ).toThrow('MCP_AUTH_TOKEN');
  });

  it('loads normalized Cloudflare-only authentication configuration', () => {
    const config = loadConfig({
      ...required,
      MCP_TRANSPORT: 'http',
      MCP_AUTH_MODE: 'cloudflare',
      CF_ACCESS_TEAM_DOMAIN: 'https://example.cloudflareaccess.com/',
      CF_ACCESS_AUD: 'application-audience'
    });

    expect(config.auth).toEqual({
      mode: 'cloudflare',
      cloudflare: {
        teamDomain: 'https://example.cloudflareaccess.com',
        audience: 'application-audience'
      }
    });
  });

  it('loads normalized hybrid authentication configuration', () => {
    const config = loadConfig({
      ...required,
      MCP_TRANSPORT: 'http',
      MCP_AUTH_MODE: 'hybrid',
      MCP_AUTH_TOKEN: 'test-secret',
      CF_ACCESS_TEAM_DOMAIN: 'https://example.cloudflareaccess.com/',
      CF_ACCESS_AUD: 'application-audience'
    });

    expect(config.auth).toEqual({
      mode: 'hybrid',
      bearerToken: 'test-secret',
      cloudflare: {
        teamDomain: 'https://example.cloudflareaccess.com',
        audience: 'application-audience'
      }
    });
  });

  it('allows stdio without HTTP authentication settings', () => {
    const config = loadConfig({ ...required, MCP_AUTH_MODE: 'hybrid' });
    expect(config.transport.kind).toBe('stdio');
    expect(config.auth).toEqual({ mode: 'hybrid' });
  });

  it('rejects conflicting new and legacy bearer tokens', () => {
    expect(() =>
      loadConfig({
        ...required,
        MCP_AUTH_TOKEN: 'new-secret',
        MCP_HTTP_BEARER_TOKEN: 'different-secret'
      })
    ).toThrow('must match');
  });

  it('accepts matching new and legacy bearer tokens', () => {
    const config = loadConfig({
      ...required,
      MCP_TRANSPORT: 'http',
      MCP_AUTH_TOKEN: 'same-secret',
      MCP_HTTP_BEARER_TOKEN: 'same-secret'
    });

    expect(config.auth.bearerToken).toBe('same-secret');
  });

  it.each([
    'http://example.cloudflareaccess.com',
    'https://example.com',
    'https://user@example.cloudflareaccess.com',
    'https://example.cloudflareaccess.com/path',
    'https://example.cloudflareaccess.com?query=value'
  ])('rejects unsafe Cloudflare team domain %s', (teamDomain) => {
    expect(() =>
      loadConfig({
        ...required,
        MCP_TRANSPORT: 'http',
        MCP_AUTH_MODE: 'cloudflare',
        CF_ACCESS_TEAM_DOMAIN: teamDomain,
        CF_ACCESS_AUD: 'application-audience'
      })
    ).toThrow('must be an HTTPS cloudflareaccess.com origin');
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
