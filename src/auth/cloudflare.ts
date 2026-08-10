import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { AuthenticationConfig } from '../config/config.js';
import type { CloudflareAccessVerifier, CloudflareIdentity } from './types.js';

type CloudflareConfig = NonNullable<AuthenticationConfig['cloudflare']>;

export class CloudflareAccessTokenError extends Error {
  constructor(options?: ErrorOptions) {
    super('Cloudflare Access token is invalid', options);
    this.name = 'CloudflareAccessTokenError';
  }
}

/**
 * Creates a verifier backed by Cloudflare's remotely published signing keys.
 * createRemoteJWKSet caches successful JWKS responses and rate-limits refreshes.
 */
export function createCloudflareAccessVerifier(
  config: CloudflareConfig,
  keyResolver: JWTVerifyGetKey = createRemoteJWKSet(
    new URL('/cdn-cgi/access/certs', config.teamDomain),
    {
      timeoutDuration: 5_000,
      cooldownDuration: 30_000,
      cacheMaxAge: 10 * 60 * 1_000
    }
  )
): CloudflareAccessVerifier {
  return {
    async verify(token: string): Promise<CloudflareIdentity> {
      try {
        const { payload } = await jwtVerify(token, keyResolver, {
          algorithms: ['RS256'],
          issuer: config.teamDomain,
          audience: config.audience
        });

        // jose validates exp when it is present. Requiring it explicitly makes
        // Access authentication fail closed if Cloudflare ever sends a malformed JWT.
        if (
          typeof payload.exp !== 'number' ||
          !Number.isFinite(payload.exp) ||
          typeof payload.sub !== 'string' ||
          payload.sub === '' ||
          typeof payload.iss !== 'string' ||
          (typeof payload.aud !== 'string' &&
            (!Array.isArray(payload.aud) ||
              payload.aud.length === 0 ||
              !payload.aud.every((item) => typeof item === 'string')))
        ) {
          throw new Error('Required Cloudflare Access claims are missing');
        }

        return {
          type: 'cloudflare',
          subject: payload.sub,
          ...(typeof payload.email === 'string' && payload.email !== ''
            ? { email: payload.email }
            : {}),
          issuer: payload.iss,
          audience: payload.aud,
          expiresAt: payload.exp
        };
      } catch (cause) {
        throw new CloudflareAccessTokenError({ cause });
      }
    }
  };
}
