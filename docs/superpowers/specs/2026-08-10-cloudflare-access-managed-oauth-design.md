# Cloudflare Access Managed OAuth Design

## Goal

Add Cloudflare Access Managed OAuth support to the existing Streamable HTTP MCP server without changing its SQL Server, tool, write-control, transaction, or stored-procedure layers. Preserve static bearer authentication for Codex and other developer clients.

The application will validate the signed Cloudflare Access assertion delivered to the origin. Cloudflare remains responsible for OAuth discovery, dynamic client registration, authorization, token issuance, refresh, Access policies, and the interactive identity-provider flow.

## Cloudflare Deployment Topology

Use two public hostnames routed through the same Cloudflare Tunnel to the same MCP origin and `/mcp` path:

- The existing developer hostname remains outside Cloudflare Access, or has an explicit narrowly scoped Access bypass. The origin protects it with the static bearer token.
- A second remote-client hostname is protected by a Cloudflare Access MCP server or self-hosted application with Managed OAuth enabled. Cloudflare authenticates the user and forwards a signed `Cf-Access-Jwt-Assertion` header to the origin.

This split is required because Cloudflare Access processes the client's `Authorization` header before forwarding a request. A custom static bearer token sent to a fully Access-protected hostname is not a Cloudflare Managed OAuth token and will not reach the origin as an authenticated request.

Both public hostnames must be included in `MCP_HTTP_ALLOWED_HOSTS`. The Cloudflare Tunnel should remain the only network path to the origin for remote traffic.

## Configuration

Add an `auth` section to `AppConfig` and keep transport configuration focused on HTTP serving:

```ts
type AuthenticationMode = 'none' | 'bearer' | 'cloudflare' | 'hybrid';

interface AuthenticationConfig {
  mode: AuthenticationMode;
  bearerToken?: string;
  cloudflare?: {
    teamDomain: string;
    audience: string;
  };
}
```

Environment variables:

- `MCP_AUTH_MODE=none|bearer|cloudflare|hybrid`
- `MCP_AUTH_TOKEN`
- `CF_ACCESS_TEAM_DOMAIN`
- `CF_ACCESS_AUD`

Backward compatibility:

- HTTP defaults to `bearer` behavior when `MCP_AUTH_MODE` is omitted.
- `MCP_HTTP_BEARER_TOKEN` remains a deprecated fallback for `MCP_AUTH_TOKEN`.
- If both bearer variables are present with different values, configuration fails instead of choosing silently.
- Codex continues sending `Authorization: Bearer <static token>` and does not need a client configuration change.

Conditional validation applies when `MCP_TRANSPORT=http`:

- `none` requires no authentication variables and is documented for local development only.
- `bearer` requires a bearer token.
- `cloudflare` requires `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD`.
- `hybrid` requires both the bearer token and Cloudflare settings.
- Stdio does not require or perform HTTP authentication.

`CF_ACCESS_TEAM_DOMAIN` is normalized without a trailing slash and must be an HTTPS origin under `cloudflareaccess.com` with no username, password, path, query, or fragment. This prevents an authentication configuration error from turning the JWKS fetch into an arbitrary outbound request.

## Authentication Module

Authentication lives under `src/auth/`, separate from the HTTP adapter, database services, and MCP tools.

The main interface is conceptually:

```ts
interface RequestAuthenticator {
  authenticateRequest(request: Request): Promise<AuthenticatedIdentity>;
}
```

The authenticator is created once when the HTTP server starts. This also creates one reusable remote JWKS resolver, allowing the `jose` library to cache keys and refresh them when Cloudflare rotates signing keys.

`AuthenticatedIdentity` is a small discriminated union:

```ts
type AuthenticatedIdentity =
  | { type: 'none'; subject: 'anonymous' }
  | { type: 'bearer'; subject: 'static-bearer' }
  | {
      type: 'cloudflare';
      subject: string;
      email?: string;
      issuer: string;
      audience: string | string[];
      expiresAt: number;
    };
```

Only validated claims enter this identity object. Raw bearer tokens and JWTs are never placed in log metadata or error messages.

## Static Bearer Validation

Bearer validation preserves the existing behavior:

- Read `Authorization` using the case-insensitive `Bearer` scheme.
- Compare the supplied token with the configured token using `node:crypto.timingSafeEqual` after checking byte lengths.
- Reject missing, malformed, or incorrect credentials.

## Cloudflare Access JWT Validation

Read the Access assertion only from `Cf-Access-Jwt-Assertion`. Do not trust `CF_Authorization` cookies or decoded claims without signature verification.

Use `jose`:

```ts
const jwks = createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`));

const { payload } = await jwtVerify(token, jwks, {
  issuer: teamDomain,
  audience,
  algorithms: ['RS256']
});
```

This verifies:

- The RSA signature against the Cloudflare Access JWKS.
- The expected issuer.
- The Access application audience.
- The expiration and other time claims enforced by `jose`.
- The declared signing algorithm.

The verifier accepts Cloudflare's normal string or array audience representation. It extracts `sub`, `email`, `iss`, `aud`, and `exp` only after successful verification. A missing or unusable subject falls back to a stable non-secret authenticated label for audit purposes; email remains optional because claim availability can differ by identity type.

JWKS network, parsing, key-selection, signature, issuer, audience, and expiration failures all fail closed. Their internal error details are not returned to clients.

## Mode Selection

Authentication mode behavior:

- `none`: return the anonymous identity without inspecting credentials.
- `bearer`: require a valid static bearer token.
- `cloudflare`: require a valid Cloudflare Access JWT.
- `hybrid`: accept either independently valid credential.

In `hybrid`, a valid Cloudflare assertion takes precedence because it supplies user identity. If Cloudflare validation fails but the static bearer is valid, the request succeeds as bearer-authenticated. If neither path validates, the request fails.

## HTTP Request Flow

For the configured MCP path:

1. Validate the `Host` header with the existing allowlist.
2. Authenticate the request with the reusable authenticator.
3. Convert the identity to the MCP SDK's per-request `AuthInfo` and pass it to `handler.fetch(request, { authInfo })`.
4. Let the existing MCP handler create and execute the per-request server instance.

Requests to other paths continue returning `404 Not Found`. The MCP path and SDK remain unchanged. Cloudflare serves OAuth discovery and authorization endpoints at the edge; this application does not add OAuth endpoints.

Authentication errors return:

- HTTP `401 Unauthorized`.
- A generic JSON body without validation details.
- `WWW-Authenticate: Bearer` for the origin response.

Cloudflare Managed OAuth replaces the protected hostname's unauthenticated response with its own OAuth discovery challenge. HTTP `403` remains reserved for future cases where a valid identity lacks authorization.

## MCP Authentication Context

Map the validated identity into MCP `AuthInfo` so request factories and tool callbacks can access it through the SDK's HTTP context. The extra data contains only normalized identity fields:

- Authentication type.
- Subject.
- Email when present.
- Issuer and audience for Cloudflare.

The SDK auth context is not used to change SQL behavior in this feature. It is an extension point for future authorization and database auditing.

## Audit Logging

Reuse the existing JSON logger and centralized `withToolErrors` wrapper. No individual SQL tool needs authentication-specific code.

For HTTP MCP tool calls, emit one completion event containing:

- Logger-generated ISO timestamp.
- Tool name.
- Outcome: `success` or `failure`.
- Execution time.
- Authentication type: `bearer`, `cloudflare`, or `none`.
- Cloudflare subject and email when available.
- Safe application error code on failure.

Authentication failures emit a separate warning with the configured mode and attempted credential types, but no raw credential or detailed JWT-library error.

Expand logger metadata-key redaction to cover password, secret, credential, token, JWT, authorization, cookie, and sensitive header names. Never log SQL passwords, static tokens, raw JWTs, Cloudflare opaque OAuth tokens, or authorization headers.

## Error Behavior

- Missing credentials: `401`.
- Malformed bearer or JWT: `401`.
- Incorrect bearer token: `401`.
- Invalid signature, issuer, or audience: `401`.
- Expired token: `401`.
- JWKS fetch or key-resolution failure: `401`, failing closed.
- Future authenticated-but-forbidden policy: `403`.
- Invalid startup configuration: existing `CONFIGURATION_ERROR` behavior.

Client responses and normal logs do not distinguish these authentication failures. Tests inspect outcomes through injected verifiers rather than exposing runtime internals.

## Testing Strategy

Configuration tests cover:

- All four modes.
- Conditional requirements for HTTP.
- Stdio compatibility.
- New and legacy bearer variable handling.
- Conflicting bearer variables.
- Cloudflare team-domain normalization and rejection of unsafe domains.

Authentication tests cover:

- Bearer success and failure.
- Cloudflare assertion extraction.
- Real RS256-signed JWTs for valid, expired, wrong-issuer, wrong-audience, malformed, and unknown-key cases.
- Hybrid precedence and fallback.
- Fail-closed JWKS behavior.
- Identity claim extraction.

HTTP and protocol tests cover:

- Generic `401` responses.
- All modes reaching or rejecting the MCP handler appropriately.
- Unchanged route and Host validation.
- Public Cloudflare hostnames in the allowlist.
- Identity propagation into a tool callback.
- Audit metadata for successful and failed tool calls.

The final verification runs formatting, linting, TypeScript checking, all Vitest suites, and the production build.

## Documentation

Update `.env.example` with commented authentication examples and no real credentials. Update the README with:

- Mode behavior and conditional variables.
- Static bearer setup for Codex and developer clients.
- Cloudflare Managed OAuth request flow.
- The two-hostname Tunnel topology.
- Exact high-level Zero Trust configuration steps.
- AUD and team-domain lookup.
- Managed OAuth dynamic-client and lifetime settings.
- Host allowlist configuration.
- Codex bearer and ChatGPT/Claude OAuth test procedures.
- Troubleshooting for `401`, missing assertion headers, JWKS failures, issuer/audience mismatches, and Access blocking static bearer traffic before it reaches the origin.

## Out of Scope

- Building an OAuth authorization server.
- Issuing or refreshing OAuth tokens.
- Per-user or per-tool authorization rules.
- New authentication databases or sessions.
- Changes to SQL permissions, guardrails, write controls, transactions, procedures, or metadata tools.
- Replacing the MCP SDK or HTTP endpoint.

## Official References

- [Cloudflare Access Managed OAuth](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/managed-oauth/)
- [Validate Cloudflare Access JWTs](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)
- [Cloudflare Access application token claims](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/)
- [Secure MCP servers with Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/access-controls/ai-controls/secure-mcp-servers/)
