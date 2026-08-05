import { serveStdio } from '@modelcontextprotocol/server/stdio';
import type { McpServerFactory } from '@modelcontextprotocol/server';
import type { Logger } from '../utils/logger.js';

export interface ServerHandle {
  close(): Promise<void>;
}

export function startStdio(factory: McpServerFactory, logger: Logger): ServerHandle {
  const handle = serveStdio(factory, {
    legacy: 'serve',
    onerror: error => logger.error('Stdio MCP transport error', { message: error.message })
  });
  logger.info('MCP server listening on stdio');
  return handle;
}
