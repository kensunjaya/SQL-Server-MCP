import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/client/stdio';

describe('stdio entry point', () => {
  it('negotiates MCP and lists tools without connecting to SQL Server', async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['node_modules/tsx/dist/cli.mjs', 'src/index.ts'],
      cwd: process.cwd(),
      stderr: 'pipe',
      env: {
        ...getDefaultEnvironment(),
        DB_SERVER: 'localhost',
        DB_DATABASE: 'PosDb',
        DB_USER: 'user',
        DB_PASSWORD: 'password',
        MCP_TRANSPORT: 'stdio',
        LOG_LEVEL: 'error'
      }
    });
    const client = new Client(
      { name: 'stdio-test', version: '1.0.0' },
      { versionNegotiation: { mode: 'auto' } }
    );
    try {
      await client.connect(transport);
      expect(['modern', 'legacy']).toContain(client.getProtocolEra());
      expect((await client.listTools()).tools.some((tool) => tool.name === 'execute_select')).toBe(
        true
      );
    } finally {
      await client.close();
    }
  }, 15_000);
});
