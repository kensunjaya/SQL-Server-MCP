import http from 'node:http';
import {
  createMcpHandler,
  hostHeaderValidationResponse,
  localhostAllowedHostnames,
  type McpServerFactory
} from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import {
  AuthenticationError,
  createRequestAuthenticator,
  toMcpAuthInfo,
  type RequestAuthenticator
} from '../auth/authenticate.js';
import type { AppConfig } from '../config/config.js';
import { AppError } from '../utils/errors.js';
import type { Logger } from '../utils/logger.js';
import type { ServerHandle } from './stdio.js';

export interface HttpServerHandle extends ServerHandle {
  readonly port: number;
  readonly url: string;
}

function isLoopback(host: string): boolean {
  return ['127.0.0.1', 'localhost', '::1'].includes(host.toLowerCase());
}

function authenticationResponse(): Response {
  return new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: {
      'content-type': 'application/json',
      'www-authenticate': 'Bearer'
    }
  });
}

function closeHttpServer(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
}

export async function startHttp(
  factory: McpServerFactory,
  config: AppConfig,
  logger: Logger,
  providedAuthenticator?: RequestAuthenticator
): Promise<HttpServerHandle> {
  const { httpHost, httpPort, httpPath, httpAllowedHosts } = config.transport;
  const { mode, bearerToken, cloudflare } = config.auth;
  if ((mode === 'bearer' || mode === 'hybrid') && bearerToken === undefined) {
    throw new AppError(
      'CONFIGURATION_ERROR',
      'MCP_AUTH_TOKEN is required for bearer HTTP authentication'
    );
  }
  if ((mode === 'cloudflare' || mode === 'hybrid') && cloudflare === undefined) {
    throw new AppError(
      'CONFIGURATION_ERROR',
      'CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD are required for Cloudflare HTTP authentication'
    );
  }
  if (!isLoopback(httpHost) && httpAllowedHosts.length === 0) {
    throw new AppError(
      'CONFIGURATION_ERROR',
      'MCP_HTTP_ALLOWED_HOSTS is required when MCP_HTTP_HOST is not a loopback address'
    );
  }

  const allowedHosts = [
    ...(isLoopback(httpHost) ? localhostAllowedHostnames() : [httpHost]),
    ...httpAllowedHosts
  ];
  const handler = createMcpHandler(factory, {
    legacy: 'stateless',
    onerror: (error) => logger.error('HTTP MCP handler error', { message: error.message })
  });
  const authenticator = providedAuthenticator ?? createRequestAuthenticator(config.auth);
  const securedHandler = {
    fetch: async (request: Request): Promise<Response> => {
      const hostRejection = hostHeaderValidationResponse(request, allowedHosts);
      if (hostRejection !== undefined) return hostRejection;

      try {
        const authentication = await authenticator.authenticateRequest(request);
        return await handler.fetch(request, { authInfo: toMcpAuthInfo(authentication) });
      } catch (error) {
        if (error instanceof AuthenticationError) {
          logger.warn('HTTP authentication rejected', {
            reason: error.reason,
            attemptedAuthenticationTypes: error.attemptedCredentials
          });
        } else {
          // Do not include verifier errors here: JWT/JWKS failures may contain sensitive details.
          logger.error('HTTP authentication failed unexpectedly');
        }
        return authenticationResponse();
      }
    }
  };
  const nodeHandler = toNodeHandler(securedHandler, {
    onerror: (error) => logger.error('HTTP MCP adapter error', { message: error.message })
  });

  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (pathname !== httpPath) {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'Not found' }));
      return;
    }
    void nodeHandler(request as never, response as never);
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => reject(error);
    server.once('error', onError);
    server.listen(httpPort, httpHost, () => {
      server.off('error', onError);
      resolve();
    });
  });

  const address = server.address();
  const boundPort = typeof address === 'object' && address !== null ? address.port : httpPort;
  const displayHost = httpHost.includes(':') ? `[${httpHost}]` : httpHost;
  const url = `http://${displayHost}:${boundPort}${httpPath}`;
  logger.info('MCP server listening over Streamable HTTP', { url });
  let closed = false;

  return {
    port: boundPort,
    url,
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      await closeHttpServer(server);
      await handler.close();
      logger.info('HTTP MCP server closed');
    }
  };
}
