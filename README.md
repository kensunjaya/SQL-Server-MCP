# SQL Server MCP Server

A general-purpose TypeScript [Model Context Protocol](https://modelcontextprotocol.io/) server for Microsoft SQL Server schema discovery and create, read, update, and delete (CRUD) operations. It discovers the configured database schema dynamically without hardcoded table or column names. The package and MCP server name are `mcp-sql-server`.

It supports local stdio clients and stateless Streamable HTTP, using the stable [MCP TypeScript SDK v2](https://ts.sdk.modelcontextprotocol.io/v2/) and a shared `mssql` connection pool. HTTP authentication can use a static bearer token, a cryptographically verified Cloudflare Access JWT, or both.

## What it can do

- List and search tables and views.
- Describe columns, SQL types, primary keys, defaults, identity/computed fields, and foreign keys.
- Return a paginated database-schema overview.
- Execute parameterized SELECT, INSERT, and UPDATE statements.
- Optionally expose DELETE; it is disabled by default.
- Optionally execute CREATE TABLE and ALTER TABLE; table DDL is disabled by default.
- Execute stored procedures with input, output, and input-output parameters.
- Execute multiple statements in one transaction with automatic rollback.
- Report affected rows, bounded recordsets, truncation, and execution time.
- Check connectivity, report SQL Server version, and generate estimated XML query plans.

## Requirements

- Node.js 20 or newer.
- Network access to Microsoft SQL Server.
- A SQL login with only the permissions this MCP server should use.

## Quick start

```powershell
npm install
Copy-Item .env.example .env
```

Edit `.env` with your SQL Server connection details:

```dotenv
DB_SERVER=localhost
DB_PORT=1433
DB_DATABASE=AppDb
DB_USER=mcp_user
DB_PASSWORD=replace_me
DB_ENCRYPT=true
DB_TRUST_SERVER_CERTIFICATE=false
MCP_TRANSPORT=stdio
```

Build and start the server:

```powershell
npm run build
npm start
```

An stdio server waits for an MCP client on stdin. It does not print a prompt. Logs are written to stderr so they cannot corrupt MCP messages on stdout.

To verify database connectivity directly:

```powershell
npm run smoke:live
```

The live smoke check is read-only. It runs health, version, table-list, and database-name SELECT operations.

## Configuration

All configuration comes from environment variables. `.env` is loaded for command-line use and is excluded from Git.

| Variable                      |               Required | Default        | Purpose                                                                                      |
| ----------------------------- | ---------------------: | -------------- | -------------------------------------------------------------------------------------------- |
| `DB_SERVER`                   |                    Yes | —              | SQL Server host name or IP address.                                                          |
| `DB_PORT`                     |                     No | Driver default | TCP port. Do not set with `DB_INSTANCE_NAME`.                                                |
| `DB_INSTANCE_NAME`            |                     No | —              | Named SQL Server instance, such as `SQLEXPRESS`. Do not set with `DB_PORT`.                  |
| `DB_DATABASE`                 |                    Yes | —              | Database name.                                                                               |
| `DB_USER`                     |                    Yes | —              | SQL authentication username.                                                                 |
| `DB_PASSWORD`                 |                    Yes | —              | SQL authentication password. Never commit it.                                                |
| `DB_ENCRYPT`                  |                     No | `true`         | Encrypt the SQL connection.                                                                  |
| `DB_TRUST_SERVER_CERTIFICATE` |                     No | `false`        | Trust a self-signed/unverified server certificate. Prefer `false` outside local development. |
| `DB_POOL_MIN`                 |                     No | `0`            | Minimum pooled connections.                                                                  |
| `DB_POOL_MAX`                 |                     No | `10`           | Maximum pooled connections.                                                                  |
| `DB_POOL_IDLE_TIMEOUT_MS`     |                     No | `30000`        | Idle connection timeout.                                                                     |
| `DB_CONNECTION_TIMEOUT_MS`    |                     No | `15000`        | Initial connection timeout.                                                                  |
| `DB_REQUEST_TIMEOUT_MS`       |                     No | `30000`        | Per-request SQL timeout.                                                                     |
| `DB_MAX_ROWS`                 |                     No | `500`          | Maximum rows serialized in one tool result.                                                  |
| `DB_MAX_SQL_LENGTH`           |                     No | `100000`       | Maximum accepted raw SQL characters.                                                         |
| `DB_MAX_TRANSACTION_STEPS`    |                     No | `20`           | Maximum statements in one transaction call.                                                  |
| `DB_ALLOW_WRITE`              |                     No | `true`         | Enable INSERT, UPDATE, and transaction mutations.                                            |
| `DB_ALLOW_DELETE`             |                     No | `false`        | Register and enable DELETE.                                                                  |
| `DB_ALLOW_DDL`                |                     No | `false`        | Register and enable CREATE TABLE and ALTER TABLE; also requires `DB_ALLOW_WRITE=true`.       |
| `DB_ALLOW_PROCEDURES`         |                     No | `true`         | Enable stored procedures, which may perform writes internally.                               |
| `DB_ALLOW_TRANSACTIONS`       |                     No | `true`         | Enable multi-statement transactions.                                                         |
| `MCP_TRANSPORT`               |                     No | `stdio`        | `stdio` or `http`.                                                                           |
| `MCP_HTTP_HOST`               |                     No | `127.0.0.1`    | HTTP bind address.                                                                           |
| `MCP_HTTP_PORT`               |                     No | `3000`         | HTTP listen port.                                                                            |
| `MCP_HTTP_PATH`               |                     No | `/mcp`         | Streamable HTTP endpoint path.                                                               |
| `MCP_HTTP_ALLOWED_HOSTS`      |         No on loopback | —              | Comma-separated Host-header allowlist. Required for non-loopback binding.                    |
| `MCP_AUTH_MODE`               |                     No | `bearer`       | HTTP authentication mode: `none`, `bearer`, `cloudflare`, or `hybrid`.                       |
| `MCP_AUTH_TOKEN`              |     Bearer/hybrid HTTP | —              | Static bearer token for developer clients. Never commit it.                                  |
| `MCP_HTTP_BEARER_TOKEN`       |                     No | —              | Legacy alias for `MCP_AUTH_TOKEN`. If both are set, their values must match.                 |
| `CF_ACCESS_TEAM_DOMAIN`       | Cloudflare/hybrid HTTP | —              | Team domain, such as `https://example.cloudflareaccess.com`.                                 |
| `CF_ACCESS_AUD`               | Cloudflare/hybrid HTTP | —              | Audience tag assigned to the protected Cloudflare Access application.                        |
| `LOG_LEVEL`                   |                     No | `info`         | `debug`, `info`, `warn`, or `error`.                                                         |

Boolean settings accept `true`, `false`, `1`, or `0`.

### Named SQL Server instances

Remove `DB_PORT` and set the instance name:

```dotenv
DB_SERVER=localhost
DB_INSTANCE_NAME=SQLEXPRESS
```

### Local self-signed certificates

If a local SQL Server uses a certificate that the machine does not trust, development may require:

```dotenv
DB_ENCRYPT=true
DB_TRUST_SERVER_CERTIFICATE=true
```

Do not use this as a substitute for a valid certificate on a shared or production network.

## Connect an MCP client

### Claude Desktop, Cursor, and other stdio clients

Build first, then add a server entry using the absolute path to `dist/src/index.js`:

```json
{
  "mcpServers": {
    "sql-server": {
      "command": "node",
      "args": ["F:\\Codes\\MCP\\dist\\src\\index.js"],
      "env": {
        "MCP_TRANSPORT": "stdio",
        "DB_SERVER": "localhost",
        "DB_PORT": "1433",
        "DB_DATABASE": "AppDb",
        "DB_USER": "mcp_user",
        "DB_PASSWORD": "replace_me"
      }
    }
  }
}
```

Restart the client after changing its MCP configuration. Prefer an OS secret manager or client-supported secret injection instead of storing a password directly in client JSON.

### Streamable HTTP authentication

The endpoint remains `/mcp`. Start with the common HTTP settings, then choose an authentication mode:

```dotenv
MCP_TRANSPORT=http
MCP_HTTP_HOST=127.0.0.1
MCP_HTTP_PORT=3000
MCP_HTTP_PATH=/mcp
MCP_HTTP_ALLOWED_HOSTS=
MCP_AUTH_MODE=bearer
MCP_AUTH_TOKEN=replace_with_a_long_random_secret
```

```powershell
npm run build
npm start
```

| Mode         | Accepted request credentials                                         | Intended use                                     |
| ------------ | -------------------------------------------------------------------- | ------------------------------------------------ |
| `none`       | None                                                                 | Loopback-only local development.                 |
| `bearer`     | `Authorization: Bearer <MCP_AUTH_TOKEN>`                             | Codex CLI and other trusted developer clients.   |
| `cloudflare` | A verified JWT in `Cf-Access-Jwt-Assertion`                          | Only traffic authenticated by Cloudflare Access. |
| `hybrid`     | Either the static bearer token or the verified Cloudflare Access JWT | Recommended when both client paths are required. |

Authentication applies only to HTTP. Stdio continues to rely on the local process boundary. Missing, malformed, expired, wrongly signed, or incorrectly scoped credentials receive a generic `401 Unauthorized`; `403` is reserved for future authorization rules.

`MCP_HTTP_BEARER_TOKEN` remains accepted as a backward-compatible alias. Prefer `MCP_AUTH_TOKEN` for new deployments. If both variables are present, they must contain the same value.

### Codex and developer tools: static bearer token

Use an endpoint that is not intercepted by a Cloudflare Access application. The origin server still validates the static token in `bearer` or `hybrid` mode:

```powershell
$env:SQL_MCP_TOKEN = "the_same_value_as_the_server_MCP_AUTH_TOKEN"
codex mcp add sql_http `
  --url https://mcp-dev.example.com/mcp `
  --bearer-token-env-var SQL_MCP_TOKEN
codex mcp list
```

Codex stores the environment-variable name, not the token value. The Codex process must inherit `SQL_MCP_TOKEN` whenever it connects; restart Codex from the configured shell after changing it.

Quick bearer checks:

```powershell
curl.exe -i https://mcp-dev.example.com/mcp
curl.exe -i -H "Authorization: Bearer $env:SQL_MCP_TOKEN" https://mcp-dev.example.com/mcp
```

The first response must be `401`. The second may be an MCP method/content-type response rather than `200` for a bare GET, but it must not be the origin authentication `401`.

### ChatGPT and Claude: Cloudflare Access Managed OAuth

[Cloudflare Managed OAuth](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/managed-oauth/) is the OAuth authorization server. This application is only the protected resource server; it does not implement OAuth endpoints or store OAuth clients.

The request flow is:

```text
ChatGPT or Claude -> opaque OAuth token -> Cloudflare Access
Cloudflare Access -> Cf-Access-Jwt-Assertion -> this MCP server
this MCP server -> verify JWKS signature + issuer + audience + expiration -> MCP tools
```

Cloudflare says Managed OAuth client tokens are opaque. Access resolves them at the edge and sends a signed application assertion to the origin. The server validates that assertion against `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`; decoding without signature verification is never accepted. See Cloudflare's [JWT validation guide](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/).

Configure the origin for both authentication paths:

```dotenv
MCP_AUTH_MODE=hybrid
MCP_AUTH_TOKEN=replace_with_a_long_random_secret
CF_ACCESS_TEAM_DOMAIN=https://example.cloudflareaccess.com
CF_ACCESS_AUD=replace_with_the_access_application_aud
MCP_HTTP_ALLOWED_HOSTS=mcp-dev.example.com,mcpsql01.example.com
```

`CF_ACCESS_TEAM_DOMAIN` must be the HTTPS `*.cloudflareaccess.com` team domain with no path. `CF_ACCESS_AUD` must be the unique Audience (AUD) tag of the Access application protecting the OAuth hostname.

#### Cloudflare configuration to complete manually

1. In the Cloudflare Tunnel, publish two hostnames to the same origin service, for example `http://127.0.0.1:3000`:
   - `mcp-dev.example.com` for Codex/static bearer traffic.
   - `mcpsql01.example.com` for Access Managed OAuth traffic.
2. Keep the developer hostname outside the Access application. If organizational policy requires Access everywhere, use a narrowly scoped bypass that is appropriate for your environment; an Access-protected hostname will process the `Authorization` header before the origin can validate the arbitrary static bearer token.
3. Go to **Zero Trust > Access controls > Applications** and create or edit a self-hosted/MCP application for only `mcpsql01.example.com`. Protect the whole OAuth hostname so Cloudflare's `/.well-known/` discovery endpoints and `/mcp` share the same application.
4. Add an **Allow** policy for the exact users, groups, identity provider, and any device posture your database access policy requires. Do not create a broad public bypass on this OAuth hostname.
5. On the application's **Advanced settings** tab, enable **Managed OAuth**.
6. Configure Managed OAuth redirect settings:
   - Allow the exact redirect URI displayed or dynamically registered by ChatGPT during app creation; do not guess a ChatGPT callback URI.
   - For Claude, allow `https://claude.ai/api/mcp/auth_callback` and the forward-compatible `https://claude.com/api/mcp/auth_callback`.
   - Enable localhost or loopback clients only if you will use a local MCP Inspector/client callback.
7. Use a short Access token lifetime (Cloudflare recommends 5–15 minutes for agents/CLIs) and a longer grant session (typically 1–2 weeks) so refresh tokens can re-evaluate Access policy without frequent interactive login.
8. Save the application, copy its **Application Audience (AUD) tag** into `CF_ACCESS_AUD`, and put your Zero Trust team domain into `CF_ACCESS_TEAM_DOMAIN`. The Access Applications API exposes the same value as the application's `aud` field if you need to retrieve it programmatically.
9. Confirm both public hostnames are listed in `MCP_HTTP_ALLOWED_HOSTS`, then restart the MCP server. Cloudflare Tunnel preserves the public Host header, so the existing allowlist remains enforced.

Do not configure an OAuth client secret in this server. Dynamic client registration, consent, authorization codes, access tokens, refresh tokens, and OAuth discovery are Cloudflare's responsibility.

#### Test with ChatGPT

ChatGPT custom MCP apps require a remote HTTPS endpoint and an eligible workspace/account. Following the current [OpenAI developer-mode guide](https://help.openai.com/en/articles/12584461-developer-mode-and-full-mcp-connectors-in-chatgpt):

1. Enable developer mode for the account/workspace.
2. Go to **Settings > Apps > Create** or **Workspace settings > Apps > Create**.
3. Enter `https://mcpsql01.example.com/mcp` and select OAuth authentication.
4. Select **Scan Tools**, complete the Cloudflare Access browser login, and wait for the scan to finish.
5. Create/enable the draft app, open a new chat, select it from the tools/apps menu, and ask it to run `health_check` and then `list_tables`.
6. Confirm the server log contains `MCP tool audit` with `authenticationType: "cloudflare"`, the Access email/subject, the tool name, and `outcome: "success"`.

Because this server exposes write tools, review and restrict the app's write actions before publishing it to the workspace. Start testing with the read-only health and discovery tools.

#### Test with Claude

In Claude, go to **Customize > Connectors**, add a custom connector, enter `https://mcpsql01.example.com/mcp`, then select **Connect** and complete the Cloudflare Access login. Team/Enterprise owners add it first under **Organization settings > Connectors**. Enable the connector in a conversation and run `health_check`.

#### Direct Cloudflare checks

Before adding an AI client, request the protected URL without credentials:

```powershell
curl.exe -i https://mcpsql01.example.com/mcp
```

Managed OAuth should return a Cloudflare `401` with a `WWW-Authenticate` challenge pointing to OAuth discovery, rather than the origin's plain `{"error":"Unauthorized"}` response. You can also inspect:

```text
https://mcpsql01.example.com/.well-known/oauth-authorization-server
https://example.cloudflareaccess.com/cdn-cgi/access/certs
```

## Tool reference

Tool IDs remain unchanged for existing clients. For CRUD, use `execute_insert` to create records, `execute_select` to read, `execute_update` to modify, and `execute_delete` to remove. DELETE is disabled by default.

| Tool                       | Purpose                                                                                                    |
| -------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `list_tables`              | List user tables with schema, approximate row count, and description.                                      |
| `list_views`               | List user views with schema and description.                                                               |
| `search_tables`            | Search schema and table/view names using a literal substring; case sensitivity follows database collation. |
| `describe_table`           | Return detailed columns, primary key, and incoming/outgoing foreign keys.                                  |
| `get_database_schema`      | Return a bounded page of tables/views with columns, primary-key ordinals, and outgoing foreign keys.       |
| `execute_select`           | Execute one SELECT or SELECT-ending CTE with parameters and result pagination.                             |
| `execute_insert`           | Execute one INSERT and return affected rows plus `OUTPUT` recordsets.                                      |
| `execute_update`           | Execute one UPDATE and return affected rows plus `OUTPUT` recordsets.                                      |
| `execute_delete`           | Execute one DELETE; registered only when `DB_ALLOW_DELETE=true`.                                           |
| `execute_create_table`     | Execute one CREATE TABLE; registered only when `DB_ALLOW_DDL=true`.                                        |
| `execute_alter_table`      | Execute one ALTER TABLE; registered only when `DB_ALLOW_DDL=true`.                                         |
| `execute_stored_procedure` | Execute a one- or two-part procedure name with typed parameters.                                           |
| `execute_transaction`      | Execute supported ordered statements atomically.                                                           |
| `health_check`             | Check SQL connectivity and the pool state.                                                                 |
| `get_database_version`     | Return version, product level, edition, and engine information.                                            |
| `explain_query`            | Return the estimated XML plan for a SELECT without executing its data query.                               |

## Parameterized SQL

Use `@name` placeholders in SQL and pass values separately. Never concatenate model-provided values into SQL text.

The following examples use illustrative tables and procedures; discover your database schema and adapt the SQL before executing them.

### SELECT

```json
{
  "sql": "SELECT Id, Name, Budget FROM dbo.Projects WHERE OwnerId = @ownerId AND Budget >= @minimumBudget ORDER BY Id",
  "parameters": [
    { "name": "ownerId", "type": "Int", "value": 12 },
    { "name": "minimumBudget", "type": "Decimal", "precision": 19, "scale": 4, "value": 5.5 }
  ],
  "offset": 0,
  "limit": 100
}
```

### INSERT with `OUTPUT`

```json
{
  "sql": "INSERT dbo.Projects (Name, Budget) OUTPUT inserted.Id, inserted.Name VALUES (@name, @budget)",
  "parameters": [
    { "name": "name", "type": "NVarChar", "length": 200, "value": "Website redesign" },
    { "name": "budget", "type": "Decimal", "precision": 19, "scale": 4, "value": 3.75 }
  ]
}
```

### UPDATE

```json
{
  "sql": "UPDATE dbo.Projects SET Budget = @budget WHERE Id = @id",
  "parameters": [
    { "name": "budget", "type": "Decimal", "precision": 19, "scale": 4, "value": 4.25 },
    { "name": "id", "type": "Int", "value": 42 }
  ]
}
```

### DELETE

Enable deletion with `DB_ALLOW_WRITE=true` and `DB_ALLOW_DELETE=true`, then restart the server. Call `execute_delete` with a targeted statement:

```json
{
  "sql": "DELETE FROM dbo.Projects WHERE Id = @id",
  "parameters": [{ "name": "id", "type": "Int", "value": 42 }]
}
```

### Table DDL

Enable both write and DDL execution, then restart the MCP server:

```dotenv
DB_ALLOW_WRITE=true
DB_ALLOW_DDL=true
```

Use `execute_create_table` or `execute_alter_table` with exactly one matching statement:

```json
{
  "sql": "CREATE TABLE dbo.Categories (Id int IDENTITY(1,1) NOT NULL PRIMARY KEY, Name nvarchar(100) NOT NULL)"
}
```

```json
{
  "sql": "ALTER TABLE dbo.Categories ADD IsActive bit NOT NULL CONSTRAINT DF_Categories_IsActive DEFAULT (1)"
}
```

DDL identifiers and definitions are SQL syntax and cannot be supplied as query parameters. The SQL login still needs narrowly scoped SQL Server permissions for the target database, schema, and tables.

### Date and binary values

Pass date/time values as ISO-8601 strings with an explicit date/time SQL type. Pass binary values as base64 text or as `{ "$binary": "..." }` with `Binary` or `VarBinary`.

```json
{
  "name": "createdAt",
  "type": "DateTime2",
  "scale": 3,
  "value": "2026-08-06T12:30:00.000Z"
}
```

### Supported explicit SQL types

`Bit`, `TinyInt`, `SmallInt`, `Int`, `BigInt`, `Real`, `Float`, `Decimal`, `Numeric`, `Money`, `SmallMoney`, `Char`, `NChar`, `VarChar`, `NVarChar`, `Text`, `NText`, `Binary`, `VarBinary`, `Date`, `Time`, `SmallDateTime`, `DateTime`, `DateTime2`, `DateTimeOffset`, `UniqueIdentifier`, and `Xml`.

Type names are case-insensitive. Use `length`, `precision`, and `scale` only where that type supports them. A type is optional for ordinary non-null inputs because `mssql` can infer it; explicit types are required for null and output values.

## Stored procedures

Use a schema-qualified name where possible. Output parameters require an explicit type and a JSON `null` value.

```json
{
  "procedure": "dbo.SummarizeProjects",
  "parameters": [
    { "name": "ownerId", "direction": "input", "type": "Int", "value": 12 },
    {
      "name": "totalBudget",
      "direction": "output",
      "type": "Decimal",
      "precision": 19,
      "scale": 4,
      "value": null
    }
  ]
}
```

The result includes all bounded recordsets, `output`, `returnValue`, `rowsAffected`, total `affectedRows`, and `executionTimeMs`.

## Transactions

The server validates every step before opening the transaction. All requests use one transaction-bound connection; a failed step rolls everything back.

```json
{
  "steps": [
    {
      "operation": "update",
      "sql": "UPDATE dbo.Tasks SET HoursRemaining = HoursRemaining - @hours WHERE TaskId = @taskId",
      "parameters": [
        { "name": "hours", "type": "Int", "value": 2 },
        { "name": "taskId", "type": "Int", "value": 42 }
      ]
    },
    {
      "operation": "insert",
      "sql": "INSERT dbo.TaskChanges (TaskId, HoursChange) VALUES (@taskId, @hours)",
      "parameters": [
        { "name": "taskId", "type": "Int", "value": 42 },
        { "name": "hours", "type": "Int", "value": -2 }
      ]
    }
  ]
}
```

DELETE steps require both writes and DELETE to be enabled.

## Pagination and result limits

`execute_select` accepts `offset` and `limit`. The server never serializes more than `DB_MAX_ROWS`; it returns `returnedRows` and `truncated` so the client can see when output was bounded.

This output bound does not make an unbounded SQL query efficient. For large tables, put deterministic pagination in SQL:

```sql
SELECT Id, Name, Budget
FROM dbo.Projects
WHERE OwnerId = @ownerId
ORDER BY Id
OFFSET @sqlOffset ROWS
FETCH NEXT @pageSize ROWS ONLY
```

Then pass `sqlOffset` and `pageSize` as `Int` parameters. A stable `ORDER BY` is essential; otherwise page contents can shift between calls.

Metadata list and schema tools have their own `offset` and `limit` inputs and report `hasMore`.

## Safety model

This server is intended for trusted internal use, but it still applies useful guardrails:

- Named values go through `mssql.Request.input`/`output` instead of string interpolation.
- Raw-query tools accept one operation of the expected type.
- Stacked statements, unsupported DDL, permission changes, `EXEC` inside raw SQL, `MERGE`, `DBCC`, backup/restore, `USE`, and `SELECT INTO` are rejected.
- DELETE and table DDL are disabled by default. DDL tools accept only CREATE TABLE or ALTER TABLE; they do not accept CREATE VIEW, ALTER DATABASE, or DROP TABLE.
- SQL length, returned rows, request time, pool size, and transaction steps are bounded.
- Credentials and parameter values are not logged.
- HTTP validates Host headers and defaults to loopback.
- Cloudflare assertions are verified cryptographically against cached Access JWKS keys, including issuer, audience, and expiration checks.
- HTTP tool audits record the authentication type and safe identity claims, tool, outcome, timestamp, and execution time without recording bearer tokens or raw JWTs.

The lightweight SQL inspection is accident prevention, not a complete T-SQL security boundary. Use a dedicated least-privilege SQL login. For read-only deployments, set `DB_ALLOW_WRITE=false`, `DB_ALLOW_DELETE=false`, `DB_ALLOW_DDL=false`, and consider `DB_ALLOW_PROCEDURES=false` because procedures can write internally.

## Development and verification

```powershell
npm run dev
npm test
npm run typecheck
npm run lint
npm run format:check
npm run build
npm run verify
```

The test suite uses mocked SQL boundaries plus in-process and spawned MCP clients; it does not require access to a live database.

You can also inspect the stdio server interactively:

```powershell
npx @modelcontextprotocol/inspector node dist/src/index.js
```

## Project layout

```text
src/
  auth/         Bearer and Cloudflare Access request authentication
  config/       Environment validation
  database/     Pool, parameters, execution, and metadata
  server/       MCP factory and transports
  sql/          Statement and identifier guardrails
  tools/        MCP schemas and registrations
  utils/        Logging, errors, and JSON conversion
scripts/        Optional live database smoke check
tests/          Unit and MCP protocol tests
```

## Troubleshooting

### Login failed (`ELOGIN`)

Verify `DB_USER`, `DB_PASSWORD`, database access, SQL authentication mode, and that the login is mapped to the configured database.

### Certificate error

Install/trust the correct SQL Server certificate. For local development only, `DB_TRUST_SERVER_CERTIFICATE=true` may be appropriate.

### Connection timeout or socket error

Check the host, port, named instance, SQL Browser service where applicable, firewall rules, and TCP/IP enablement in SQL Server Configuration Manager.

### Query timeout

Improve the query/indexes or raise `DB_REQUEST_TIMEOUT_MS` deliberately. Use `explain_query` to inspect the estimated plan when the login has permission.

### Permission denied on metadata or query tools

Grant the dedicated login only the catalog visibility and table/procedure permissions it needs. SQL Server metadata visibility depends on permissions.

### Statement rejected by SQL validation

Use exactly one statement and the matching tool. Move procedure calls to `execute_stored_procedure`. CREATE TABLE and ALTER TABLE require their dedicated tools and `DB_ALLOW_DDL=true`; other DDL and administrative commands remain unsupported. CTE-based reads must end in SELECT.

### MCP client reports malformed JSON on stdio

Anything written to stdout corrupts the MCP channel. This implementation logs to stderr; ensure wrappers and startup scripts do the same.

### HTTP works locally but not remotely

Non-loopback binding requires `MCP_HTTP_ALLOWED_HOSTS`. Include the public Cloudflare hostname, not only the local bind address. Confirm the Tunnel route targets the configured host/port and that TLS terminates at Cloudflare.

### Codex reports `Auth required` or always gets `Forbidden`

Use the developer hostname that is outside the Cloudflare Access application. Confirm that its `Authorization: Bearer ...` value equals the server's `MCP_AUTH_TOKEN`, that `MCP_AUTH_MODE` is `bearer` or `hybrid`, and that the Codex process inherited the environment variable named by `--bearer-token-env-var`. Restart Codex after changing the variable. A static bearer token sent to the Managed OAuth hostname is handled by Access before it reaches this server.

### Cloudflare OAuth login succeeds but the origin returns `401`

Confirm `CF_ACCESS_TEAM_DOMAIN` is the correct team domain and `CF_ACCESS_AUD` exactly matches the protected application's Audience tag. Check system time, outbound HTTPS access to `/cdn-cgi/access/certs`, and that the Tunnel has not removed `Cf-Access-Jwt-Assertion`. The server intentionally fails closed when signing keys cannot be fetched or any JWT check fails.

### ChatGPT or Claude cannot discover OAuth

Request the protected hostname without credentials and confirm Cloudflare returns `401` plus `WWW-Authenticate`, not a `302` browser redirect. Recheck that Managed OAuth is enabled on the correct Access application and that the client's exact redirect URI is allowed. Do not add OAuth routes to this application; discovery and token endpoints belong to Cloudflare.

## Production hardening extension points

For wider deployment, add authorization rules based on the verified Cloudflare identity, persistent audit storage, schema/table/procedure allowlists, mutation confirmation, rate limiting, monitoring, and a full T-SQL parser. These can be added around the existing authentication, transport, tool, and database-service boundaries.
