# Cloudflare Access Managed OAuth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Cloudflare Access JWT authentication and four configurable HTTP authentication modes while preserving static bearer authentication and the existing SQL/MCP tool behavior.

**Architecture:** A new `src/auth/` module validates static bearer credentials or Cloudflare Access assertions and returns a normalized identity. The HTTP boundary runs Host validation, invokes the authenticator, then passes verified identity through MCP SDK `AuthInfo`; the centralized tool wrapper adds identity-aware audit logs without touching database services or individual tool implementations.

**Tech Stack:** Node.js 20+, TypeScript 6, MCP TypeScript SDK 2, Zod 4, `jose` 6.2.8, Vitest 4.

## Global Constraints

- Keep the existing `/mcp` Streamable HTTP endpoint and MCP SDK.
- Do not change SQL services, SQL guardrails, write controls, transaction behavior, stored procedures, or metadata tools.
- Support `MCP_AUTH_MODE=none|bearer|cloudflare|hybrid`.
- Preserve `Authorization: Bearer <static token>` in `bearer` and `hybrid` modes.
- Validate `Cf-Access-Jwt-Assertion` cryptographically with Cloudflare JWKS, issuer, audience, RS256, and expiration checks.
- Fail closed when Cloudflare validation cannot complete.
- Never log static tokens, raw JWTs, OAuth tokens, SQL passwords, authorization headers, or cookies.
- Preserve Host-header validation and use two Cloudflare hostnames for developer bearer traffic and Managed OAuth traffic.

---

### Task 1: Add authentication configuration and compatibility rules

**Files:**

- Modify: `tests/config/config.test.ts`
- Modify: `src/config/config.ts`

**Interfaces:**

- Consumes: `loadConfig(env?: NodeJS.ProcessEnv): AppConfig`
- Produces: `AuthenticationMode`, `AuthenticationConfig`, and `AppConfig.auth`
- Removes: `AppConfig.transport.httpBearerToken`

- [ ] **Step 1: Add failing configuration tests**

Extend `tests/config/config.test.ts` with explicit cases:

```ts
it('defaults HTTP authentication to bearer for compatibility', () => {
  const config = loadConfig({
    ...required,
    MCP_TRANSPORT: 'http',
    MCP_HTTP_BEARER_TOKEN: 'legacy-secret'
  });
  expect(config.auth).toMatchObject({ mode: 'bearer', bearerToken: 'legacy-secret' });
});

it.each(['cloudflare', 'hybrid'] as const)('requires Cloudflare settings for %s mode', (mode) => {
  expect(() =>
    loadConfig({
      ...required,
      MCP_TRANSPORT: 'http',
      MCP_AUTH_MODE: mode,
      MCP_AUTH_TOKEN: 'test-secret'
    })
  ).toThrow('CF_ACCESS_TEAM_DOMAIN');
});

it('loads normalized hybrid authentication configuration', () => {
  const config = loadConfig({
    ...required,
    MCP_TRANSPORT: 'http',
    MCP_AUTH_MODE: 'hybrid',
    MCP_AUTH_TOKEN: 'test-secret',
    CF_ACCESS_TEAM_DOMAIN: 'https://example.cloudflareaccess.com/',
    CF_ACCESS_AUD: 'application-audience'
  });
  expect(config.auth).toEqual({
    mode: 'hybrid',
    bearerToken: 'test-secret',
    cloudflare: {
      teamDomain: 'https://example.cloudflareaccess.com',
      audience: 'application-audience'
    }
  });
});

it('rejects conflicting new and legacy bearer tokens', () => {
  expect(() =>
    loadConfig({
      ...required,
      MCP_AUTH_TOKEN: 'new-secret',
      MCP_HTTP_BEARER_TOKEN: 'different-secret'
    })
  ).toThrow('must match');
});
```

Also test `none`, bearer/cloudflare missing-variable failures, stdio without auth variables, an unsafe non-Cloudflare team URL, credentials/path/query in the domain, and equal new/legacy tokens.

- [ ] **Step 2: Run the focused configuration tests**

Run: `npm test -- tests/config/config.test.ts`

Expected: new tests fail because `AppConfig.auth` and the new environment variables do not exist.

- [ ] **Step 3: Implement the authentication configuration model**

Export these types from `src/config/config.ts`:

```ts
export type AuthenticationMode = 'none' | 'bearer' | 'cloudflare' | 'hybrid';

export interface AuthenticationConfig {
  mode: AuthenticationMode;
  bearerToken?: string;
  cloudflare?: {
    teamDomain: string;
    audience: string;
  };
}
```

Add `auth: AuthenticationConfig` to `AppConfig`, parse `MCP_AUTH_MODE`, `MCP_AUTH_TOKEN`, `CF_ACCESS_TEAM_DOMAIN`, and `CF_ACCESS_AUD`, and retain `MCP_HTTP_BEARER_TOKEN` as the legacy input. Validate the mode-specific requirements only for HTTP, reject mismatched new/legacy tokens, validate the team URL, normalize it to `URL.origin`, and build an immutable `auth` object.

Remove `httpBearerToken` from the transport object. Do not include secret values in Zod issue messages.

- [ ] **Step 4: Run and pass configuration tests**

Run: `npm test -- tests/config/config.test.ts`

Expected: every configuration test passes.

- [ ] **Step 5: Commit configuration behavior**

```powershell
git add -- src/config/config.ts tests/config/config.test.ts
git commit -m "feat: configure MCP authentication modes"
```

### Task 2: Add cryptographic Cloudflare Access verification

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/auth/types.ts`
- Create: `src/auth/cloudflare.ts`
- Create: `tests/auth/cloudflare.test.ts`

**Interfaces:**

- Consumes: `AuthenticationConfig['cloudflare']`
- Produces: `CloudflareIdentity`
- Produces: `CloudflareAccessVerifier.verify(token: string): Promise<CloudflareIdentity>`
- Produces: `createCloudflareAccessVerifier(config, jwks?): CloudflareAccessVerifier`

- [ ] **Step 1: Install the current `jose` dependency**

Run: `npm install jose@^6.2.8`

Expected: `package.json` and `package-lock.json` contain `jose` as a production dependency.

- [ ] **Step 2: Define focused authentication types**

Create `src/auth/types.ts` with:

```ts
export interface CloudflareIdentity {
  type: 'cloudflare';
  subject: string;
  email?: string;
  issuer: string;
  audience: string | string[];
  expiresAt: number;
}

export type AuthenticatedIdentity =
  | { type: 'none'; subject: 'anonymous' }
  | { type: 'bearer'; subject: 'static-bearer' }
  | CloudflareIdentity;

export interface CloudflareAccessVerifier {
  verify(token: string): Promise<CloudflareIdentity>;
}
```

- [ ] **Step 3: Write failing RS256 verification tests**

In `tests/auth/cloudflare.test.ts`, generate an RS256 keypair with `generateKeyPair('RS256')`, export the public JWK with `exportJWK`, set `kid`, `alg`, and `use`, and create a local key set using `createLocalJWKSet`.

Use a helper that signs tokens with:

```ts
new SignJWT({ email: 'cashier@example.com' })
  .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
  .setIssuer('https://example.cloudflareaccess.com')
  .setAudience('application-audience')
  .setSubject('user-123')
  .setIssuedAt()
  .setExpirationTime('5m')
  .sign(privateKey);
```

Assert successful claim extraction and rejection of expired, missing-expiration, wrong-issuer, wrong-audience, malformed, and unknown-key tokens.

- [ ] **Step 4: Run the focused JWT tests**

Run: `npm test -- tests/auth/cloudflare.test.ts`

Expected: the test fails because the Cloudflare verifier is not implemented.

- [ ] **Step 5: Implement Cloudflare verification**

In `src/auth/cloudflare.ts`, create one remote key resolver per verifier:

```ts
const remoteJwks = createRemoteJWKSet(new URL(`${config.teamDomain}/cdn-cgi/access/certs`), {
  timeoutDuration: 5_000,
  cooldownDuration: 30_000,
  cacheMaxAge: 10 * 60_000
});
```

Allow the key resolver to be injected for tests. Call `jwtVerify` with exact `issuer`, `audience`, and `algorithms: ['RS256']`. Require non-empty `iss`, `aud`, and numeric `exp` after verification; normalize optional email and use `cloudflare-authenticated` when `sub` is unavailable.

- [ ] **Step 6: Run and pass JWT tests**

Run: `npm test -- tests/auth/cloudflare.test.ts`

Expected: all cryptographic verification cases pass.

- [ ] **Step 7: Commit Cloudflare JWT verification**

```powershell
git add -- package.json package-lock.json src/auth/types.ts src/auth/cloudflare.ts tests/auth/cloudflare.test.ts
git commit -m "feat: verify Cloudflare Access JWTs"
```

### Task 3: Implement reusable mode-aware request authentication

**Files:**

- Create: `src/auth/authenticate.ts`
- Create: `tests/auth/authenticate.test.ts`

**Interfaces:**

- Consumes: `AuthenticationConfig`
- Consumes: `CloudflareAccessVerifier`
- Produces: `AuthenticationResult { identity: AuthenticatedIdentity; credential: string }`
- Produces: `RequestAuthenticator.authenticateRequest(request): Promise<AuthenticationResult>`
- Produces: `AuthenticationError.attemptedTypes`
- Produces: `toMcpAuthInfo(result): AuthInfo`

- [ ] **Step 1: Write failing mode and hybrid tests**

Create requests containing bearer, Cloudflare, both, or neither credentials. Assert:

```ts
expect((await none.authenticateRequest(new Request('https://mcp.example/mcp'))).identity.type).toBe(
  'none'
);

expect((await bearer.authenticateRequest(requestWithBearer('test-secret'))).identity).toEqual({
  type: 'bearer',
  subject: 'static-bearer'
});

expect(
  (await cloudflare.authenticateRequest(requestWithCloudflare('signed-jwt'))).identity
).toMatchObject({ type: 'cloudflare', email: 'cashier@example.com' });
```

Test missing/malformed/wrong bearer credentials, Cloudflare verifier failure, Cloudflare-only mode ignoring bearer, bearer-only mode ignoring the assertion, Cloudflare precedence when both are valid, and valid bearer fallback when the assertion is invalid.

- [ ] **Step 2: Run the focused authenticator tests**

Run: `npm test -- tests/auth/authenticate.test.ts`

Expected: imports fail because the request authenticator does not exist.

- [ ] **Step 3: Implement the composite authenticator**

Create `AuthenticationError` with only safe attempted credential types. Build the Cloudflare verifier once in `createRequestAuthenticator`, parse bearer credentials without accepting whitespace inside the token, retain timing-safe comparison, and implement the four mode branches.

Map results to MCP `AuthInfo`:

```ts
return {
  token: result.credential,
  clientId: result.identity.subject,
  scopes: [],
  ...(result.identity.type === 'cloudflare'
    ? {
        expiresAt: result.identity.expiresAt,
        extra: {
          authenticationType: 'cloudflare',
          subject: result.identity.subject,
          ...(result.identity.email === undefined ? {} : { email: result.identity.email }),
          issuer: result.identity.issuer,
          audience: result.identity.audience
        }
      }
    : { extra: { authenticationType: result.identity.type } })
};
```

No credential value may appear in `AuthenticationError` or its message.

- [ ] **Step 4: Run and pass authenticator tests**

Run: `npm test -- tests/auth/authenticate.test.ts`

Expected: all modes, precedence, fallback, and safe-error tests pass.

- [ ] **Step 5: Commit reusable authentication**

```powershell
git add -- src/auth/authenticate.ts tests/auth/authenticate.test.ts
git commit -m "feat: authenticate MCP HTTP requests by mode"
```

### Task 4: Integrate authentication with Streamable HTTP

**Files:**

- Modify: `src/server/http.ts`
- Modify: `tests/server/http.test.ts`

**Interfaces:**

- Consumes: `RequestAuthenticator`
- Consumes: `toMcpAuthInfo(result): AuthInfo`
- Produces: `startHttp(factory, config, logger, authenticator?)`

- [ ] **Step 1: Replace bearer-only HTTP fixtures with mode-aware fixtures**

Update the HTTP test configuration to use:

```ts
MCP_AUTH_MODE: 'bearer',
MCP_AUTH_TOKEN: 'test-secret'
```

Add fake authenticators for Cloudflare and failure cases so HTTP integration tests do not make external JWKS requests.

- [ ] **Step 2: Add failing HTTP boundary tests**

Assert that:

- Missing/invalid authentication returns generic `401` plus `WWW-Authenticate: Bearer`.
- `none` reaches the MCP handler without credentials.
- An injected Cloudflare identity reaches the `McpServerFactory` as `ctx.authInfo.extra`.
- Authentication failure does not invoke the MCP server factory.
- Existing `404`, invalid Host, and non-loopback allowlist behavior remains unchanged.

Use `StreamableHTTPClientTransport` against the temporary server for the identity propagation test so an actual MCP initialize/list-tools request passes through the boundary.

- [ ] **Step 3: Run the focused HTTP tests**

Run: `npm test -- tests/server/http.test.ts`

Expected: mode-aware tests fail while the file still contains bearer-only middleware.

- [ ] **Step 4: Replace inline authentication with the auth module**

Remove token parsing and timing-safe comparison from `src/server/http.ts`. Construct the default authenticator once before creating the HTTP server. After Host validation, await authentication and call:

```ts
return handler.fetch(request, { authInfo: toMcpAuthInfo(result) });
```

Catch authentication and verification failures at this boundary, log only safe attempted credential types, and return a generic `401`. Keep routing and Host validation ordering unchanged.

- [ ] **Step 5: Run and pass HTTP tests**

Run: `npm test -- tests/server/http.test.ts`

Expected: all mode-aware, route, Host, and MCP identity propagation tests pass.

- [ ] **Step 6: Commit HTTP integration**

```powershell
git add -- src/server/http.ts tests/server/http.test.ts
git commit -m "feat: protect HTTP MCP with hybrid authentication"
```

### Task 5: Add identity-aware audit logging and redaction

**Files:**

- Modify: `src/tools/responses.ts`
- Modify: `src/utils/logger.ts`
- Create: `tests/tools/responses.test.ts`
- Create: `tests/utils/logger.test.ts`

**Interfaces:**

- Consumes: MCP `ServerContext.http.authInfo`
- Produces: centralized `MCP tool audit` success/failure log metadata
- Produces: expanded sensitive-key filtering in `createLogger`

- [ ] **Step 1: Write failing audit-wrapper tests**

Construct a minimal `ServerContext` fixture containing:

```ts
http: {
  authInfo: {
    token: 'must-not-log',
    clientId: 'user-123',
    scopes: [],
    extra: {
      authenticationType: 'cloudflare',
      subject: 'user-123',
      email: 'cashier@example.com'
    }
  }
}
```

Call a wrapped successful handler and a throwing handler. Assert logs include tool, outcome, execution time, authentication type, subject, and email, and exclude the token. Assert stdio context omits HTTP identity fields.

- [ ] **Step 2: Write failing logger-redaction tests**

Capture `process.stderr.write`, log metadata containing `password`, `token`, `jwt`, `authorization`, `cookie`, and `headers`, and assert that none of their values appear while safe audit fields remain.

- [ ] **Step 3: Run focused audit tests**

Run: `npm test -- tests/tools/responses.test.ts tests/utils/logger.test.ts`

Expected: tests fail because callbacks ignore `ServerContext` and logger redaction is narrower.

- [ ] **Step 4: Implement centralized audit metadata**

Change `withToolErrors` so the returned callback accepts `(args, context)`, passes context to its handler, and records one audit event at `info` for success or `error` for failure. Extract only allowlisted fields from `context.http?.authInfo?.extra`; never spread the whole auth object.

Update logger filtering to reject metadata keys matching:

```ts
/password|secret|credential|token|jwt|authorization|cookie|headers?/i;
```

- [ ] **Step 5: Run and pass audit tests plus existing tool tests**

Run: `npm test -- tests/tools/responses.test.ts tests/utils/logger.test.ts tests/tools/tools.test.ts`

Expected: audit, redaction, and all existing MCP tool tests pass.

- [ ] **Step 6: Commit audit logging**

```powershell
git add -- src/tools/responses.ts src/utils/logger.ts tests/tools/responses.test.ts tests/utils/logger.test.ts
git commit -m "feat: audit authenticated MCP tool calls"
```

### Task 6: Document Cloudflare and developer authentication

**Files:**

- Modify: `.env.example`
- Modify: `README.md`

**Interfaces:**

- Consumes: all authentication modes and the two-hostname deployment topology
- Produces: deploy, configure, test, and troubleshoot instructions

- [ ] **Step 1: Replace the sample authentication variables**

Keep `.env.example` free of real secrets and add comments plus these values:

```dotenv
# HTTP auth: none (local only), bearer, cloudflare, or hybrid
MCP_AUTH_MODE=hybrid
MCP_AUTH_TOKEN=replace_with_a_long_random_secret

# Required for cloudflare or hybrid mode
CF_ACCESS_TEAM_DOMAIN=https://example.cloudflareaccess.com
CF_ACCESS_AUD=replace_with_the_access_application_aud
```

Remove the active `MCP_HTTP_BEARER_TOKEN` example and document it only as a deprecated fallback in README.

- [ ] **Step 2: Update configuration and request-flow documentation**

Add a mode matrix and explain that Cloudflare Managed OAuth client tokens are opaque, while the origin validates the signed `Cf-Access-Jwt-Assertion`. Link the official Cloudflare Managed OAuth and JWT validation pages.

- [ ] **Step 3: Add exact Cloudflare Zero Trust steps**

Document:

1. Add a second Tunnel public hostname that points to the same local MCP service and `/mcp` path.
2. Leave the existing developer hostname outside Access so its static bearer reaches the origin.
3. In Zero Trust, add/protect the remote hostname as an MCP server or self-hosted Access application.
4. Configure identity providers and Allow policies for only intended users/groups.
5. Enable Managed OAuth under the Access application's Advanced settings.
6. Enable dynamic client registration; allow localhost and loopback only when using local MCP Inspector callbacks.
7. Add the exact HTTPS redirect URI presented by each remote client. For Claude, include `https://claude.ai/api/mcp/auth_callback` and `https://claude.com/api/mcp/auth_callback` as documented by Anthropic.
8. Use a 5–15 minute access-token lifetime and a 1–2 week grant session, following Cloudflare's agent guidance.
9. Copy the Application Audience (AUD) Tag from the application's Additional settings and use the Zero Trust team domain ending in `cloudflareaccess.com`.
10. Put both public hostnames in `MCP_HTTP_ALLOWED_HOSTS`, set hybrid auth variables, and restart the origin.

Do not invent a ChatGPT callback URI; instruct the administrator to copy the exact URI shown/registered during ChatGPT connector setup into Cloudflare's allowed redirect URIs.

- [ ] **Step 4: Document Codex and remote-client tests**

For Codex, retain the existing `--bearer-token-env-var MCP_AUTH_TOKEN` flow against the developer hostname and verify a read-only tool call.

For ChatGPT and Claude, add the Managed OAuth hostname as a custom remote MCP connector, complete the Cloudflare browser login, invoke `health_check` or `list_tables`, and confirm the origin audit log shows `authenticationType=cloudflare` plus the expected email. Include MCP Inspector's Quick OAuth Flow as a client-neutral diagnostic.

- [ ] **Step 5: Add targeted troubleshooting**

Cover missing `Cf-Access-Jwt-Assertion`, issuer/audience mismatches, JWKS reachability, expired assertions, Host allowlist failures, and static bearer requests being stopped by Access before reaching the developer hostname.

- [ ] **Step 6: Format and commit documentation**

Run: `npx prettier --write .env.example README.md`

Then:

```powershell
git add -- .env.example README.md
git commit -m "docs: explain Cloudflare Managed OAuth setup"
```

### Task 7: Verify the complete implementation

**Files:**

- Verify: all files changed by Tasks 1–6

**Interfaces:**

- Consumes: completed authentication, audit, configuration, and documentation changes
- Produces: verified build and clean repository state

- [ ] **Step 1: Run the complete verification suite**

Run: `npm run verify`

Expected: Prettier, ESLint, TypeScript, all Vitest suites, and the production build pass.

- [ ] **Step 2: Inspect changes for secrets and scope**

Run:

```powershell
git diff HEAD~6 --check
git diff --stat HEAD~6
rg -n "MCP_AUTH_TOKEN|CF_ACCESS_TEAM_DOMAIN|CF_ACCESS_AUD|Cf-Access-Jwt-Assertion" src tests .env.example README.md
```

Expected: only placeholders and test credentials appear; no real token, raw JWT, password, or unrelated SQL-layer change is present.

- [ ] **Step 3: Confirm dependency and repository state**

Run:

```powershell
npm ls jose
git status --short
```

Expected: `jose@6.2.8` resolves successfully and the worktree is clean after all task commits.
