import { McpServer } from '@modelcontextprotocol/server';
import { registerTools, type ToolDependencies } from '../tools/register.js';

export function createMcpServer(dependencies: ToolDependencies): McpServer {
  const server = new McpServer(
    { name: 'mcp-sql-server', version: '1.0.0' },
    {
      capabilities: { tools: { listChanged: false } },
      instructions:
        'General-purpose SQL Server schema discovery and CRUD. Explore the configured database schema before writing SQL. Use execute_select to read records, execute_insert to create records, execute_update to modify records, and execute_delete to remove records when enabled. Use named parameters for values and schema-qualified object names. Match mutations to the requested scope and respect configured feature permissions.'
    }
  );
  registerTools(server, dependencies);
  return server;
}
