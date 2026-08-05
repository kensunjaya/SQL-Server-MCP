# HTTP Bearer Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require an environment-configured bearer token for every Streamable HTTP MCP request while preserving unauthenticated stdio operation.

**Architecture:** Configuration validation owns the secure-by-default startup rule: HTTP mode cannot load without a token. A focused authentication helper at the HTTP boundary parses the standard bearer header, compares the secret with `node:crypto.timingSafeEqual`, and rejects failures before the MCP handler or database layer runs.

**Tech Stack:** TypeScript 6, Node.js 20+, MCP TypeScript SDK 2, Zod 4, Vitest 4.

## Global Constraints

- Use `MCP_HTTP_BEARER_TOKEN` as the server-side environment variable.
- Require a non-empty token only when `MCP_TRANSPORT=http`; stdio remains unchanged.
- Never log, serialize, or expose the configured token in an error response.
- Return `401 Unauthorized` and `WWW-Authenticate: Bearer` for missing, malformed, or incorrect credentials.
- Perform authentication before invoking the MCP handler or database code.
- Retain existing route and Host-header validation behavior.

---

### Task 1: Validate and expose the HTTP bearer token

**Files:**
- Modify: `tests/config/config.test.ts`
- Modify: `src/config/config.ts`

**Interfaces:**
- Consumes: `loadConfig(env?: NodeJS.ProcessEnv): AppConfig`
- Produces: `AppConfig.transport.httpBearerToken?: string`

- [ ] **Step 1: Write failing configuration tests**

Add tests showing that stdio loads without a token, HTTP rejects a missing token, and HTTP accepts and exposes a supplied token:

```ts
it('requires a bearer token for HTTP transport', () => {
  expect(() => loadConfig({ ...required, MCP_TRANSPORT: 'http' })).toThrow(
    'MCP_HTTP_BEARER_TOKEN is required when MCP_TRANSPORT=http'
  );
});

it('loads the configured HTTP bearer token', () => {
  const config = loadConfig({
    ...required,
    MCP_TRANSPORT: 'http',
    MCP_HTTP_BEARER_TOKEN: 'test-secret'
  });
  expect(config.transport.httpBearerToken).toBe('test-secret');
});
```

- [ ] **Step 2: Run the focused tests and confirm failure**

Run: `npm test -- tests/config/config.test.ts`

Expected: the HTTP-without-token test does not throw and the token property does not exist.

- [ ] **Step 3: Implement conditional configuration validation**

Add the optional property to `AppConfig.transport`, parse a trimmed non-empty `MCP_HTTP_BEARER_TOKEN`, and add this refinement:

```ts
if (value.MCP_TRANSPORT === 'http' && value.MCP_HTTP_BEARER_TOKEN === undefined) {
  context.addIssue({
    code: 'custom',
    path: ['MCP_HTTP_BEARER_TOKEN'],
    message: 'is required when MCP_TRANSPORT=http'
  });
}
```

Return the property only when defined so `exactOptionalPropertyTypes` remains satisfied.

- [ ] **Step 4: Run the focused tests and confirm success**

Run: `npm test -- tests/config/config.test.ts`

Expected: all configuration tests pass.

- [ ] **Step 5: Commit the configuration behavior**

```powershell
git add -- src/config/config.ts tests/config/config.test.ts
git commit -m "feat: require bearer token for HTTP transport"
```

### Task 2: Enforce bearer authentication at the HTTP boundary

**Files:**
- Modify: `tests/server/http.test.ts`
- Modify: `src/server/http.ts`

**Interfaces:**
- Consumes: `AppConfig.transport.httpBearerToken?: string`
- Produces: `bearerAuthenticationResponse(request: Request, expectedToken: string): Response | undefined`
- Produces: authenticated behavior in `startHttp(factory, config, logger)`

- [ ] **Step 1: Extend the HTTP test request helper**

Allow test requests to send authorization and return response metadata:

```ts
interface TestResponse {
  status: number;
  authenticate?: string;
}

function request(
  url: string,
  headers: Record<string, string> = {}
): Promise<TestResponse> {
  // Issue an HTTP GET, drain the body, and resolve status plus
  // response.headers['www-authenticate'].
}
```

Ensure every HTTP test config includes `MCP_HTTP_BEARER_TOKEN: 'test-secret'`.

- [ ] **Step 2: Write failing authentication tests**

Add test cases that assert:

```ts
expect(await request(handle.url)).toMatchObject({
  status: 401,
  authenticate: 'Bearer'
});
expect(
  await request(handle.url, { authorization: 'Basic test-secret' })
).toMatchObject({ status: 401 });
expect(
  await request(handle.url, { authorization: 'Bearer wrong-secret' })
).toMatchObject({ status: 401 });
```

For the correct token, assert that the request is no longer rejected as unauthorized:

```ts
const authenticated = await request(handle.url, {
  authorization: 'Bearer test-secret'
});
expect(authenticated.status).not.toBe(401);
```

- [ ] **Step 3: Run the focused HTTP tests and confirm failure**

Run: `npm test -- tests/server/http.test.ts`

Expected: unauthenticated and incorrect-token requests are not rejected with `401`.

- [ ] **Step 4: Implement timing-safe bearer validation**

In `src/server/http.ts`, import `timingSafeEqual` from `node:crypto`. Parse only the standard case-insensitive `Bearer` scheme with a non-empty credential. Compare equal-length UTF-8 buffers using `timingSafeEqual`:

```ts
function tokensMatch(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}
```

Return this generic response for every authentication failure:

```ts
new Response(JSON.stringify({ error: 'Unauthorized' }), {
  status: 401,
  headers: {
    'content-type': 'application/json',
    'www-authenticate': 'Bearer'
  }
});
```

Compose Host validation and bearer authentication before `handler.fetch(request)`. Add a defensive startup error if a manually constructed `AppConfig` omits the token.

- [ ] **Step 5: Run the focused HTTP tests and confirm success**

Run: `npm test -- tests/server/http.test.ts`

Expected: all HTTP tests pass, including existing route and Host validation checks.

- [ ] **Step 6: Commit HTTP enforcement**

```powershell
git add -- src/server/http.ts tests/server/http.test.ts
git commit -m "feat: authenticate HTTP MCP requests"
```

### Task 3: Document server and Codex client configuration

**Files:**
- Modify: `.env.example`
- Modify: `README.md`

**Interfaces:**
- Consumes: `MCP_HTTP_BEARER_TOKEN` and the `Authorization: Bearer` contract
- Produces: setup instructions for direct HTTP clients and Codex

- [ ] **Step 1: Update the sample environment**

Add an empty placeholder beside the HTTP settings:

```dotenv
MCP_HTTP_BEARER_TOKEN=replace_with_a_long_random_secret
```

- [ ] **Step 2: Update README configuration and security guidance**

Document that the token is required in HTTP mode, is ignored by stdio, must not be committed, and protects the endpoint with a bearer header. Replace the statement that HTTP authentication is absent. Retain the warning that TLS is needed across untrusted networks.

- [ ] **Step 3: Add Codex HTTP setup instructions**

Include a secret-preserving example:

```powershell
$env:MCP_HTTP_BEARER_TOKEN = "replace_with_the_same_secret_used_by_the_server"
codex mcp add pos_sql_http `
  --url http://127.0.0.1:3000/mcp `
  --bearer-token-env-var MCP_HTTP_BEARER_TOKEN
```

Explain that the secret value stays in the environment and the MCP configuration stores only the environment-variable name.

- [ ] **Step 4: Check formatting**

Run: `npm run format:check`

Expected: formatting passes after running `npm run format` if needed.

- [ ] **Step 5: Commit documentation**

```powershell
git add -- .env.example README.md
git commit -m "docs: explain HTTP bearer token setup"
```

### Task 4: Verify the complete change

**Files:**
- Verify: all source, tests, and documentation changed in Tasks 1-3

**Interfaces:**
- Consumes: completed bearer-authentication implementation
- Produces: a clean build and verified repository state

- [ ] **Step 1: Run the complete verification suite**

Run: `npm run verify`

Expected: Prettier, ESLint, TypeScript, Vitest, and production build all pass.

- [ ] **Step 2: Inspect the final diff for secret leakage and scope**

Run:

```powershell
git diff HEAD~3 --check
git diff HEAD~3 -- src/config/config.ts src/server/http.ts tests/config/config.test.ts tests/server/http.test.ts .env.example README.md
```

Expected: no whitespace errors, real token values, credential logging, or unrelated changes.

- [ ] **Step 3: Confirm the worktree state**

Run: `git status --short`

Expected: no uncommitted files remain except this implementation plan if it has not yet been committed.
