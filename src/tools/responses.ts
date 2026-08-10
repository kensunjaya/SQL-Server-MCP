import { performance } from 'node:perf_hooks';
import type { CallToolResult, ServerContext } from '@modelcontextprotocol/server';
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
  handler: (args: TArgs, context: ServerContext) => Promise<CallToolResult>
): (args: TArgs, context: ServerContext) => Promise<CallToolResult> {
  return async (args, context) => {
    const start = performance.now();
    try {
      const result = await handler(args, context);
      const executionTimeMs = Number((performance.now() - start).toFixed(2));
      logger.debug('MCP tool completed', {
        tool: toolName,
        executionTimeMs
      });
      logHttpAudit(logger, toolName, 'success', executionTimeMs, context);
      return result;
    } catch (error) {
      const executionTimeMs = Number((performance.now() - start).toFixed(2));
      const result = errorResult(error, logger, toolName, executionTimeMs);
      logHttpAudit(logger, toolName, 'failure', executionTimeMs, context);
      return result;
    }
  };
}

function logHttpAudit(
  logger: Logger,
  toolName: string,
  outcome: 'success' | 'failure',
  executionTimeMs: number,
  context: ServerContext
): void {
  const authInfo = context.http?.authInfo;
  const extra = authInfo?.extra;
  const authenticationType = extra?.authenticationType;
  if (
    authInfo === undefined ||
    (authenticationType !== 'none' &&
      authenticationType !== 'bearer' &&
      authenticationType !== 'cloudflare')
  ) {
    return;
  }

  const subject =
    typeof extra?.subject === 'string' && extra.subject !== '' ? extra.subject : authInfo.clientId;
  const email = typeof extra?.email === 'string' && extra.email !== '' ? extra.email : undefined;
  const issuer =
    typeof extra?.issuer === 'string' && extra.issuer !== '' ? extra.issuer : undefined;
  const audience =
    typeof extra?.audience === 'string' ||
    (Array.isArray(extra?.audience) && extra.audience.every((item) => typeof item === 'string'))
      ? extra.audience
      : undefined;

  logger.info('MCP tool audit', {
    tool: toolName,
    outcome,
    executionTimeMs,
    authenticationType,
    subject,
    ...(email === undefined ? {} : { email }),
    ...(issuer === undefined ? {} : { issuer }),
    ...(audience === undefined ? {} : { audience })
  });
}
