import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWTPayload } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  CloudflareAccessTokenError,
  createCloudflareAccessVerifier
} from '../../src/auth/cloudflare.js';

const teamDomain = 'https://example.cloudflareaccess.com';
const audience = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const keyId = 'test-key';

let privateKey: CryptoKey;
let verifier: ReturnType<typeof createCloudflareAccessVerifier>;

async function signToken(
  claims: JWTPayload = {},
  options: {
    issuer?: string;
    audience?: string | string[];
    expiration?: string | number | false;
    signingKey?: CryptoKey;
    kid?: string;
  } = {}
): Promise<string> {
  let token = new SignJWT({ email: 'cashier@example.com', ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: options.kid ?? keyId })
    .setSubject('access-user-id')
    .setIssuer(options.issuer ?? teamDomain)
    .setAudience(options.audience ?? audience)
    .setIssuedAt();

  if (options.expiration !== false) {
    token = token.setExpirationTime(options.expiration ?? '5m');
  }

  return token.sign(options.signingKey ?? privateKey);
}

beforeAll(async () => {
  const keyPair = await generateKeyPair('RS256', { extractable: true });
  privateKey = keyPair.privateKey;
  const publicJwk = await exportJWK(keyPair.publicKey);
  verifier = createCloudflareAccessVerifier(
    { teamDomain, audience },
    createLocalJWKSet({ keys: [{ ...publicJwk, alg: 'RS256', kid: keyId, use: 'sig' }] })
  );
});

describe('Cloudflare Access JWT verification', () => {
  it('cryptographically verifies a token and extracts its identity', async () => {
    const identity = await verifier.verify(await signToken());

    expect(identity).toEqual({
      type: 'cloudflare',
      subject: 'access-user-id',
      email: 'cashier@example.com',
      issuer: teamDomain,
      audience,
      expiresAt: expect.any(Number)
    });
  });

  it.each([
    ['expired token', () => signToken({}, { expiration: '1 second ago' })],
    ['missing expiration', () => signToken({}, { expiration: false })],
    ['wrong issuer', () => signToken({}, { issuer: 'https://other.cloudflareaccess.com' })],
    ['wrong audience', () => signToken({}, { audience: 'another-application' })],
    ['unknown signing key', () => signToken({}, { kid: 'unknown-key' })]
  ])('rejects an %s without exposing verification details', async (_name, createToken) => {
    await expect(verifier.verify(await createToken())).rejects.toEqual(
      expect.objectContaining({
        name: 'CloudflareAccessTokenError',
        message: 'Cloudflare Access token is invalid'
      })
    );
  });

  it('rejects a token signed by an untrusted key', async () => {
    const otherKeyPair = await generateKeyPair('RS256');

    await expect(
      verifier.verify(await signToken({}, { signingKey: otherKeyPair.privateKey }))
    ).rejects.toBeInstanceOf(CloudflareAccessTokenError);
  });

  it('rejects malformed input', async () => {
    await expect(verifier.verify('not-a-jwt')).rejects.toBeInstanceOf(CloudflareAccessTokenError);
  });

  it('preserves an array audience claim after validating the configured audience', async () => {
    const identity = await verifier.verify(
      await signToken({}, { audience: ['another-audience', audience] })
    );

    expect(identity.audience).toEqual(['another-audience', audience]);
  });
});
