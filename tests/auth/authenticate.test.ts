import { describe, expect, it, vi } from 'vitest';
import type { AuthenticationConfig } from '../../src/config/config.js';
import {
  AuthenticationError,
  createRequestAuthenticator,
  toMcpAuthInfo
} from '../../src/auth/authenticate.js';
import type { CloudflareAccessVerifier, CloudflareIdentity } from '../../src/auth/types.js';

const staticToken = 'developer-secret';
const accessJwt = 'signed.cloudflare.jwt';
const cloudflareIdentity: CloudflareIdentity = {
  type: 'cloudflare',
  subject: 'access-user-id',
  email: 'cashier@example.com',
  issuer: 'https://example.cloudflareaccess.com',
  audience: 'application-audience',
  expiresAt: 1_900_000_000
};

function request(headers: Record<string, string> = {}): Request {
  return new Request('https://mcp.example.com/mcp', { headers });
}

function fakeVerifier(
  implementation: (token: string) => Promise<CloudflareIdentity> = async () => cloudflareIdentity
): CloudflareAccessVerifier & { verify: ReturnType<typeof vi.fn> } {
  return { verify: vi.fn(implementation) };
}

function authenticator(
  config: AuthenticationConfig,
  verifier?: CloudflareAccessVerifier
): ReturnType<typeof createRequestAuthenticator> {
  return createRequestAuthenticator(config, verifier);
}

describe('request authentication', () => {
  it('allows anonymous requests only in none mode', async () => {
    const result = await authenticator({ mode: 'none' }).authenticateRequest(request());

    expect(result).toEqual({
      credential: '',
      identity: { type: 'none', subject: 'anonymous' }
    });
  });

  it('accepts the configured static token in bearer mode', async () => {
    const result = await authenticator({
      mode: 'bearer',
      bearerToken: staticToken
    }).authenticateRequest(request({ authorization: `Bearer ${staticToken}` }));

    expect(result).toEqual({
      credential: staticToken,
      identity: { type: 'bearer', subject: 'static-bearer' }
    });
  });

  it.each([undefined, '', 'Basic credentials', 'Bearer wrong-token'])(
    'rejects missing or invalid bearer credentials without exposing them (%s)',
    async (authorization) => {
      const headers = authorization === undefined ? {} : { authorization };
      const operation = authenticator({
        mode: 'bearer',
        bearerToken: staticToken
      }).authenticateRequest(request(headers));

      await expect(operation).rejects.toEqual(
        expect.objectContaining({
          name: 'AuthenticationError',
          attemptedCredentials: authorization?.startsWith('Bearer ') ? ['bearer'] : []
        })
      );
      await expect(operation).rejects.not.toHaveProperty(
        'message',
        expect.stringContaining(staticToken)
      );
    }
  );

  it('requires and verifies Cf-Access-Jwt-Assertion in cloudflare mode', async () => {
    const verifier = fakeVerifier();
    const result = await authenticator(
      {
        mode: 'cloudflare',
        cloudflare: {
          teamDomain: cloudflareIdentity.issuer,
          audience: String(cloudflareIdentity.audience)
        }
      },
      verifier
    ).authenticateRequest(request({ 'cf-access-jwt-assertion': accessJwt }));

    expect(verifier.verify).toHaveBeenCalledWith(accessJwt);
    expect(result).toEqual({ credential: accessJwt, identity: cloudflareIdentity });
  });

  it('rejects a missing Cloudflare assertion without trying remote verification', async () => {
    const verifier = fakeVerifier();
    const operation = authenticator(
      {
        mode: 'cloudflare',
        cloudflare: {
          teamDomain: cloudflareIdentity.issuer,
          audience: String(cloudflareIdentity.audience)
        }
      },
      verifier
    ).authenticateRequest(request());

    await expect(operation).rejects.toEqual(expect.objectContaining({ attemptedCredentials: [] }));
    expect(verifier.verify).not.toHaveBeenCalled();
  });

  it('prefers a valid Cloudflare assertion in hybrid mode', async () => {
    const verifier = fakeVerifier();
    const result = await authenticator(
      {
        mode: 'hybrid',
        bearerToken: staticToken,
        cloudflare: {
          teamDomain: cloudflareIdentity.issuer,
          audience: String(cloudflareIdentity.audience)
        }
      },
      verifier
    ).authenticateRequest(
      request({
        authorization: `Bearer ${staticToken}`,
        'cf-access-jwt-assertion': accessJwt
      })
    );

    expect(result.identity.type).toBe('cloudflare');
  });

  it('falls back to a valid static token when a Cloudflare assertion is invalid', async () => {
    const verifier = fakeVerifier(async () => {
      throw new Error('signature failed');
    });
    const result = await authenticator(
      {
        mode: 'hybrid',
        bearerToken: staticToken,
        cloudflare: {
          teamDomain: cloudflareIdentity.issuer,
          audience: String(cloudflareIdentity.audience)
        }
      },
      verifier
    ).authenticateRequest(
      request({
        authorization: `Bearer ${staticToken}`,
        'cf-access-jwt-assertion': accessJwt
      })
    );

    expect(result.identity.type).toBe('bearer');
  });

  it('fails closed when neither hybrid credential is valid', async () => {
    const verifier = fakeVerifier(async () => {
      throw new Error('signature failed');
    });
    const operation = authenticator(
      {
        mode: 'hybrid',
        bearerToken: staticToken,
        cloudflare: {
          teamDomain: cloudflareIdentity.issuer,
          audience: String(cloudflareIdentity.audience)
        }
      },
      verifier
    ).authenticateRequest(
      request({ authorization: 'Bearer wrong', 'cf-access-jwt-assertion': accessJwt })
    );

    await expect(operation).rejects.toEqual(
      expect.objectContaining({ attemptedCredentials: ['cloudflare', 'bearer'] })
    );
  });

  it('converts Cloudflare identity to MCP auth context without putting secrets in extra', () => {
    const authInfo = toMcpAuthInfo({ credential: accessJwt, identity: cloudflareIdentity });

    expect(authInfo).toEqual({
      token: accessJwt,
      clientId: 'access-user-id',
      scopes: [],
      expiresAt: cloudflareIdentity.expiresAt,
      extra: {
        authenticationType: 'cloudflare',
        subject: 'access-user-id',
        email: 'cashier@example.com',
        issuer: cloudflareIdentity.issuer,
        audience: cloudflareIdentity.audience
      }
    });
    expect(JSON.stringify(authInfo.extra)).not.toContain(accessJwt);
  });

  it('uses a stable MCP auth context for static bearer authentication', () => {
    expect(
      toMcpAuthInfo({
        credential: staticToken,
        identity: { type: 'bearer', subject: 'static-bearer' }
      })
    ).toEqual({
      token: staticToken,
      clientId: 'static-bearer',
      scopes: [],
      extra: { authenticationType: 'bearer', subject: 'static-bearer' }
    });
  });

  it('uses a specific error type for safe HTTP handling', async () => {
    await expect(
      authenticator({ mode: 'bearer', bearerToken: staticToken }).authenticateRequest(request())
    ).rejects.toBeInstanceOf(AuthenticationError);
  });
});
