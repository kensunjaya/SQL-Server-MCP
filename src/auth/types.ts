export interface AnonymousIdentity {
  type: 'none';
  subject: 'anonymous';
}

export interface BearerIdentity {
  type: 'bearer';
  subject: 'static-bearer';
}

export interface CloudflareIdentity {
  type: 'cloudflare';
  subject: string;
  email?: string;
  issuer: string;
  audience: string | string[];
  expiresAt: number;
}

export type AuthenticatedIdentity = AnonymousIdentity | BearerIdentity | CloudflareIdentity;

export interface CloudflareAccessVerifier {
  verify(token: string): Promise<CloudflareIdentity>;
}
