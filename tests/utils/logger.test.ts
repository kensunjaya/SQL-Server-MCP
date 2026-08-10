import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from '../../src/utils/logger.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('logger secret redaction', () => {
  it('removes sensitive fields recursively and preserves trusted log envelope fields', () => {
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const logger = createLogger('info');

    logger.info('safe message', {
      token: 'top-level-token',
      headers: { authorization: 'Bearer nested-token' },
      nested: {
        password: 'database-password',
        safe: 'kept',
        deeper: { jwt: 'raw-jwt', email: 'cashier@example.com' }
      },
      timestamp: 'untrusted timestamp',
      level: 'debug',
      message: 'untrusted message'
    });

    const output = String(write.mock.calls[0]?.[0]);
    const event = JSON.parse(output) as Record<string, unknown>;
    expect(event).toMatchObject({
      level: 'info',
      message: 'safe message',
      nested: {
        safe: 'kept',
        deeper: { email: 'cashier@example.com' }
      }
    });
    expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(output).not.toMatch(/top-level-token|nested-token|database-password|raw-jwt/);
    expect(event).not.toHaveProperty('headers');
  });
});
