# SQL Server POS MCP Server

A TypeScript [Model Context Protocol](https://modelcontextprotocol.io/) server for exploring and interacting with a Microsoft SQL Server database. It discovers the schema dynamically, so it works with an existing POS database without hardcoded table or column names.

It supports local stdio clients and stateless Streamable HTTP, using the stable [MCP TypeScript SDK v2](https://ts.sdk.modelcontextprotocol.io/v2/) and a shared `mssql` connection pool.

## What it can do

- List and search tables and views.
- Describe columns, SQL types, primary keys, defaults, identity/computed fields, and foreign keys.
- Return a paginated database-schema overview.
- Execute parameterized SELECT, INSERT, and UPDATE statements.
- Optionally expose DELETE; it is disabled by default.
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
DB_DATABASE=PosDb
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

| Variable                      |       Required | Default        | Purpose                                                                                      |
| ----------------------------- | -------------: | -------------- | -------------------------------------------------------------------------------------------- |
| `DB_SERVER`                   |            Yes | —              | SQL Server host name or IP address.                                                          |
| `DB_PORT`                     |             No | Driver default | TCP port. Do not set with `DB_INSTANCE_NAME`.                                                |
| `DB_INSTANCE_NAME`            |             No | —              | Named SQL Server instance, such as `SQLEXPRESS`. Do not set with `DB_PORT`.                  |
| `DB_DATABASE`                 |            Yes | —              | Database name.                                                                               |
| `DB_USER`                     |            Yes | —              | SQL authentication username.                                                                 |
| `DB_PASSWORD`                 |            Yes | —              | SQL authentication password. Never commit it.                                                |
| `DB_ENCRYPT`                  |             No | `true`         | Encrypt the SQL connection.                                                                  |
| `DB_TRUST_SERVER_CERTIFICATE` |             No | `false`        | Trust a self-signed/unverified server certificate. Prefer `false` outside local development. |
| `DB_POOL_MIN`                 |             No | `0`            | Minimum pooled connections.                                                                  |
| `DB_POOL_MAX`                 |             No | `10`           | Maximum pooled connections.                                                                  |
| `DB_POOL_IDLE_TIMEOUT_MS`     |             No | `30000`        | Idle connection timeout.                                                                     |
| `DB_CONNECTION_TIMEOUT_MS`    |             No | `15000`        | Initial connection timeout.                                                                  |
| `DB_REQUEST_TIMEOUT_MS`       |             No | `30000`        | Per-request SQL timeout.                                                                     |
| `DB_MAX_ROWS`                 |             No | `500`          | Maximum rows serialized in one tool result.                                                  |
| `DB_MAX_SQL_LENGTH`           |             No | `100000`       | Maximum accepted raw SQL characters.                                                         |
| `DB_MAX_TRANSACTION_STEPS`    |             No | `20`           | Maximum statements in one transaction call.                                                  |
| `DB_ALLOW_WRITE`              |             No | `true`         | Enable INSERT, UPDATE, and transaction mutations.                                            |
| `DB_ALLOW_DELETE`             |             No | `false`        | Register and enable DELETE.                                                                  |
| `DB_ALLOW_PROCEDURES`         |             No | `true`         | Enable stored procedures, which may perform writes internally.                               |
| `DB_ALLOW_TRANSACTIONS`       |             No | `true`         | Enable multi-statement transactions.                                                         |
| `MCP_TRANSPORT`               |             No | `stdio`        | `stdio` or `http`.                                                                           |
| `MCP_HTTP_HOST`               |             No | `127.0.0.1`    | HTTP bind address.                                                                           |
| `MCP_HTTP_PORT`               |             No | `3000`         | HTTP listen port.                                                                            |
| `MCP_HTTP_PATH`               |             No | `/mcp`         | Streamable HTTP endpoint path.                                                               |
| `MCP_HTTP_ALLOWED_HOSTS`      | No on loopback | —              | Comma-separated Host-header allowlist. Required for non-loopback binding.                    |
| `MCP_HTTP_BEARER_TOKEN`       |   In HTTP mode | —              | Shared bearer token for HTTP clients. Never commit it. Ignored by stdio.                     |
| `LOG_LEVEL`                   |             No | `info`         | `debug`, `info`, `warn`, or `error`.                                                         |

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
    "pos-sql-server": {
      "command": "node",
      "args": ["F:\\Codes\\MCP\\dist\\src\\index.js"],
      "env": {
        "MCP_TRANSPORT": "stdio",
        "DB_SERVER": "localhost",
        "DB_PORT": "1433",
        "DB_DATABASE": "PosDb",
        "DB_USER": "mcp_user",
        "DB_PASSWORD": "replace_me"
      }
    }
  }
}
```

Restart the client after changing its MCP configuration. Prefer an OS secret manager or client-supported secret injection instead of storing a password directly in client JSON.

### Streamable HTTP

Set:

```dotenv
MCP_TRANSPORT=http
MCP_HTTP_HOST=127.0.0.1
MCP_HTTP_PORT=3000
MCP_HTTP_PATH=/mcp
MCP_HTTP_BEARER_TOKEN=replace_with_a_long_random_secret
```

Then run:

```powershell
npm start
```

The endpoint is `http://127.0.0.1:3000/mcp`. Clients must send `Authorization: Bearer <token>`. Missing or incorrect credentials receive `401 Unauthorized`. The v2 handler serves current MCP clients and a stateless legacy fallback from the same tool factory.

The token provides shared-secret authentication but not encryption. Do not expose plain HTTP to an untrusted network. For remote clients, use TLS, a restrictive firewall or reverse proxy, and a precise `MCP_HTTP_ALLOWED_HOSTS` list.

### Codex over Streamable HTTP

Start the server as described above. In the shell that launches Codex, set the same token and register the endpoint:

```powershell
$env:MCP_HTTP_BEARER_TOKEN = "replace_with_the_same_secret_used_by_the_server"
codex mcp add pos_sql_http `
  --url http://127.0.0.1:3000/mcp `
  --bearer-token-env-var MCP_HTTP_BEARER_TOKEN
codex mcp list
```

Codex stores only the environment-variable name in its MCP configuration. The Codex process must have `MCP_HTTP_BEARER_TOKEN` in its environment whenever it connects, so launch it from that shell or configure the variable through your usual secret-management process.

## Tool reference

| Tool                       | Purpose                                                                                              |
| -------------------------- | ---------------------------------------------------------------------------------------------------- |
| `list_tables`              | List user tables with schema, approximate row count, and description.                                |
| `list_views`               | List user views with schema and description.                                                         |
| `search_tables`            | Search table/view names using a literal substring.                                                   |
| `describe_table`           | Return detailed columns, primary key, and incoming/outgoing foreign keys.                            |
| `get_database_schema`      | Return a bounded page of tables/views with columns, primary-key ordinals, and outgoing foreign keys. |
| `execute_select`           | Execute one SELECT or SELECT-ending CTE with parameters and result pagination.                       |
| `execute_insert`           | Execute one INSERT and return affected rows plus `OUTPUT` recordsets.                                |
| `execute_update`           | Execute one UPDATE and return affected rows plus `OUTPUT` recordsets.                                |
| `execute_delete`           | Execute one DELETE; registered only when `DB_ALLOW_DELETE=true`.                                     |
| `execute_stored_procedure` | Execute a one- or two-part procedure name with typed parameters.                                     |
| `execute_transaction`      | Execute supported ordered statements atomically.                                                     |
| `health_check`             | Check SQL connectivity and the pool state.                                                           |
| `get_database_version`     | Return version, product level, edition, and engine information.                                      |
| `explain_query`            | Return the estimated XML plan for a SELECT without executing its data query.                         |

## Parameterized SQL

Use `@name` placeholders in SQL and pass values separately. Never concatenate model-provided values into SQL text.

### SELECT

```json
{
  "sql": "SELECT Id, Name, Price FROM dbo.Items WHERE StoreId = @storeId AND Price >= @minimumPrice ORDER BY Id",
  "parameters": [
    { "name": "storeId", "type": "Int", "value": 12 },
    { "name": "minimumPrice", "type": "Decimal", "precision": 19, "scale": 4, "value": 5.5 }
  ],
  "offset": 0,
  "limit": 100
}
```

### INSERT with `OUTPUT`

```json
{
  "sql": "INSERT dbo.Items (Name, Price) OUTPUT inserted.Id, inserted.Name VALUES (@name, @price)",
  "parameters": [
    { "name": "name", "type": "NVarChar", "length": 200, "value": "Coffee" },
    { "name": "price", "type": "Decimal", "precision": 19, "scale": 4, "value": 3.75 }
  ]
}
```

### UPDATE

```json
{
  "sql": "UPDATE dbo.Items SET Price = @price WHERE Id = @id",
  "parameters": [
    { "name": "price", "type": "Decimal", "precision": 19, "scale": 4, "value": 4.25 },
    { "name": "id", "type": "Int", "value": 42 }
  ]
}
```

### Date and binary values

Pass date/time values as ISO-8601 strings with an explicit date/time SQL type. Pass binary values as base64 text or as `{ "$binary": "..." }` with `Binary` or `VarBinary`.

```json
{
  "name": "soldAt",
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
  "procedure": "sales.CloseBusinessDay",
  "parameters": [
    { "name": "storeId", "direction": "input", "type": "Int", "value": 12 },
    {
      "name": "closedSales",
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
      "sql": "UPDATE dbo.Stock SET Quantity = Quantity - @quantity WHERE ItemId = @itemId",
      "parameters": [
        { "name": "quantity", "type": "Int", "value": 2 },
        { "name": "itemId", "type": "Int", "value": 42 }
      ]
    },
    {
      "operation": "insert",
      "sql": "INSERT dbo.StockMovements (ItemId, Quantity) VALUES (@itemId, @quantity)",
      "parameters": [
        { "name": "itemId", "type": "Int", "value": 42 },
        { "name": "quantity", "type": "Int", "value": -2 }
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
SELECT Id, ReceiptNumber, Total
FROM sales.Receipts
WHERE StoreId = @storeId
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
- Stacked statements, DDL, permission changes, `EXEC` inside raw SQL, `MERGE`, `DBCC`, backup/restore, `USE`, and `SELECT INTO` are rejected.
- DELETE is disabled by default.
- SQL length, returned rows, request time, pool size, and transaction steps are bounded.
- Credentials and parameter values are not logged.
- HTTP validates Host headers and defaults to loopback.

The lightweight SQL inspection is accident prevention, not a complete T-SQL security boundary. Use a dedicated least-privilege SQL login. For read-only deployments, set `DB_ALLOW_WRITE=false`, `DB_ALLOW_DELETE=false`, and consider `DB_ALLOW_PROCEDURES=false` because procedures can write internally.

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

The test suite uses mocked SQL boundaries plus in-process and spawned MCP clients; it does not require access to the POS database.

You can also inspect the stdio server interactively:

```powershell
npx @modelcontextprotocol/inspector node dist/src/index.js
```

## Project layout

```text
src/
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

Use exactly one statement and the matching tool. Move procedure calls to `execute_stored_procedure`; remove DDL or administrative commands. CTE-based reads must end in SELECT.

### MCP client reports malformed JSON on stdio

Anything written to stdout corrupts the MCP channel. This implementation logs to stderr; ensure wrappers and startup scripts do the same.

### HTTP works locally but not remotely

Non-loopback binding requires `MCP_HTTP_ALLOWED_HOSTS`. Confirm that the client sends the configured bearer token. Remote use also needs firewall routing and TLS, usually provided by infrastructure in front of this server.

## Production hardening extension points

For wider deployment, replace or augment the shared token with per-client authentication and authorization, then add TLS, schema/table/procedure allowlists, mutation confirmation, audit storage, rate limiting, monitoring, and a full T-SQL parser. These can be added around the existing transport, tool, and database-service boundaries.
