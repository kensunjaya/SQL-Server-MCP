import { timingSafeEqual } from 'node:crypto';
import type { AuthInfo } from '@modelcontextprotocol/server';
import type { AuthenticationConfig } from '../config/config.js';
import { createCloudflareAccessVerifier } from './cloudflare.js';
import type { AuthenticatedIdentity, CloudflareAccessVerifier } from './types.js';

export type CredentialType = 'bearer' | 'cloudflare';
export type AuthenticationFailureReason = 'missing_credentials' | 'invalid_credentials';

export interface AuthenticationResult {
  credential: string;
  identity: AuthenticatedIdentity;
}

export interface RequestAuthenticator {
  authenticateRequest(request: Request): Promise<AuthenticationResult>;
}

export class AuthenticationError extends Error {
  constructor(
    public readonly reason: AuthenticationFailureReason,
    public readonly attemptedCredentials: readonly CredentialType[],
    options?: ErrorOptions
  ) {
    super(
      reason === 'missing_credentials' ? 'Authentication required' : 'Authentication failed',
      options
    );
    this.name = 'AuthenticationError';
  }
}

function tokensMatch(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  return (
    actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

function bearerCredential(request: Request): string | undefined {
  const match = /^Bearer +(\S+)$/i.exec(request.headers.get('authorization') ?? '');
  return match?.[1];
}

function cloudflareCredential(request: Request): string | undefined {
  const value = request.headers.get('cf-access-jwt-assertion')?.trim();
  return value === '' ? undefined : value;
}

export function createRequestAuthenticator(
  config: AuthenticationConfig,
  providedCloudflareVerifier?: CloudflareAccessVerifier
): RequestAuthenticator {
  let cloudflareVerifier: CloudflareAccessVerifier | undefined = providedCloudflareVerifier;
  if (config.mode === 'cloudflare' || config.mode === 'hybrid') {
    if (config.cloudflare === undefined) {
      throw new Error('Cloudflare Access authentication is not configured');
    }
    cloudflareVerifier ??= createCloudflareAccessVerifier(config.cloudflare);
  }

  return {
    async authenticateRequest(request: Request): Promise<AuthenticationResult> {
      if (config.mode === 'none') {
        return { credential: '', identity: { type: 'none', subject: 'anonymous' } };
      }

      const bearer = bearerCredential(request);
      const assertion = cloudflareCredential(request);

      if ((config.mode === 'cloudflare' || config.mode === 'hybrid') && assertion !== undefined) {
        try {
          const identity = await cloudflareVerifier!.verify(assertion);
          return { credential: assertion, identity };
        } catch (cause) {
          if (config.mode === 'cloudflare') {
            throw new AuthenticationError('invalid_credentials', ['cloudflare'], { cause });
          }
        }
      }

      if (
        (config.mode === 'bearer' || config.mode === 'hybrid') &&
        bearer !== undefined &&
        config.bearerToken !== undefined &&
        tokensMatch(bearer, config.bearerToken)
      ) {
        return {
          credential: bearer,
          identity: { type: 'bearer', subject: 'static-bearer' }
        };
      }

      const attemptedCredentials: CredentialType[] = [];
      if (assertion !== undefined && (config.mode === 'cloudflare' || config.mode === 'hybrid')) {
        attemptedCredentials.push('cloudflare');
      }
      if (bearer !== undefined && (config.mode === 'bearer' || config.mode === 'hybrid')) {
        attemptedCredentials.push('bearer');
      }

      throw new AuthenticationError(
        attemptedCredentials.length === 0 ? 'missing_credentials' : 'invalid_credentials',
        attemptedCredentials
      );
    }
  };
}

export function toMcpAuthInfo(result: AuthenticationResult): AuthInfo {
  const { identity } = result;
  if (identity.type === 'cloudflare') {
    return {
      token: result.credential,
      clientId: identity.subject,
      scopes: [],
      expiresAt: identity.expiresAt,
      extra: {
        authenticationType: identity.type,
        subject: identity.subject,
        ...(identity.email === undefined ? {} : { email: identity.email }),
        issuer: identity.issuer,
        audience: identity.audience
      }
    };
  }

  return {
    token: result.credential,
    clientId: identity.subject,
    scopes: [],
    extra: {
      authenticationType: identity.type,
      subject: identity.subject
    }
  };
}
