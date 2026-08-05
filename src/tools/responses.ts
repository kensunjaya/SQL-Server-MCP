import { performance } from 'node:perf_hooks';
import type { CallToolResult } from '@modelcontextprotocol/server';
import { normalizeError } from '../utils/errors.js';
import type { Logger } from '../utils/logger.js';

export function successResult<TData extends object>(summary: string, data: TData): CallToolResult {
  return {
    content: [{ type: 'text', text: summary }],
    structuredContent: data as Record<string, unknown>
  };
}

export function errorResult(
  error: unknown,
  logger: Logger,
  toolName: string,
  executionTimeMs: number
): CallToolResult {
  const safe = normalizeError(error);
  logger.error('MCP tool failed', {
    tool: toolName,
    code: safe.code,
    executionTimeMs,
    ...(safe.details?.driverCode === undefined ? {} : { driverCode: safe.details.driverCode })
  });
  return {
    content: [{ type: 'text', text: `${safe.code}: ${safe.message}` }],
    structuredContent: {
      error: {
        code: safe.code,
        message: safe.message,
        ...(safe.details === undefined ? {} : { details: safe.details })
      },
      executionTimeMs
    },
    isError: true
  };
}

export function withToolErrors<TArgs>(
  toolName: string,
  logger: Logger,
  handler: (args: TArgs) => Promise<CallToolResult>
): (args: TArgs) => Promise<CallToolResult> {
  return async (args) => {
    const start = performance.now();
    try {
      const result = await handler(args);
      logger.debug('MCP tool completed', {
        tool: toolName,
        executionTimeMs: Number((performance.now() - start).toFixed(2))
      });
      return result;
    } catch (error) {
      return errorResult(error, logger, toolName, Number((performance.now() - start).toFixed(2)));
    }
  };
}
