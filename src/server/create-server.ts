import { McpServer } from '@modelcontextprotocol/server';
import { registerTools, type ToolDependencies } from '../tools/register.js';

export function createMcpServer(dependencies: ToolDependencies): McpServer {
  const server = new McpServer(
    { name: 'mcp-sql-server-pos', version: '1.0.0' },
    {
      capabilities: { tools: { listChanged: false } },
      instructions:
        'Explore schema before querying. Use named parameters for values. Prefer SELECT and confirm business intent before mutations.'
    }
  );
  registerTools(server, dependencies);
  return server;
}
