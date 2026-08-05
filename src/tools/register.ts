import type { McpServer } from '@modelcontextprotocol/server';
import type { AppConfig } from '../config/config.js';
import type { Logger } from '../utils/logger.js';
import { registerDiagnosticTools, type DiagnosticToolsService } from './diagnostics.js';
import { registerDiscoveryTools, type MetadataToolsService } from './discovery.js';
import { registerExecutionTools, type ExecutionToolsService } from './execution.js';

export interface ToolDependencies {
  config: AppConfig;
  executor: ExecutionToolsService & DiagnosticToolsService;
  metadata: MetadataToolsService;
  logger: Logger;
}

export function registerTools(server: McpServer, dependencies: ToolDependencies): void {
  registerDiscoveryTools(server, dependencies.metadata, dependencies.logger);
  registerExecutionTools(server, dependencies.executor, dependencies.config, dependencies.logger);
  registerDiagnosticTools(server, dependencies.executor, dependencies.logger);
}
