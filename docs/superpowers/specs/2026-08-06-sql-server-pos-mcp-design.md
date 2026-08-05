# SQL Server POS MCP Server Design

## Summary

Build a TypeScript MCP server that exposes dynamic discovery and controlled SQL execution for a Microsoft SQL Server database used by a point-of-sale system. The server will use the stable MCP TypeScript SDK v2 packages, `mssql` connection pooling, named query parameters, bounded results, and both local stdio and stateless Streamable HTTP transports.

The project is a new codebase. It must not assume any application-specific tables, schemas, columns, or stored procedures.

## Goals

- Let MCP clients discover tables, views, columns, keys, relationships, and database metadata.
- Execute parameterized SELECT, INSERT, and UPDATE statements.
- Support DELETE behind a disabled-by-default feature flag.
- Execute stored procedures with typed input and output parameters.
- Execute multiple supported statements atomically in a transaction.
- Return structured results, affected-row counts, execution time, and useful errors.
- Remain straightforward to configure, operate, test, and extend.

## Non-Goals

- Providing a complete SQL authorization or policy engine.
- Parsing every valid T-SQL grammar production.
- Adding authentication or TLS termination to the HTTP transport.
- Hardcoding POS entities or business workflows.
- Replacing SQL Server permissions, auditing, backups, or network security.

## Technology and Runtime

- Node.js 20 or newer.
- Modern TypeScript compiled as ESM.
- Stable MCP TypeScript SDK v2: `@modelcontextprotocol/server` and `@modelcontextprotocol/node`.
- `mssql` for SQL Server access and pooling.
- Zod v4 for configuration and MCP input validation.
- Vitest for automated tests.
- ESLint and Prettier for static checks and formatting.

The v2 SDK is the current stable release line and splits the server and transport packages. The implementation will follow the official v2 stdio and Streamable HTTP APIs rather than legacy `@modelcontextprotocol/sdk` v1 imports.

## Architecture

The codebase will be divided into focused modules:

- `config` loads environment variables once, applies defaults, and returns a validated immutable configuration object.
- `database` owns the `mssql.ConnectionPool`, database lifecycle, parameter binding, query execution, stored procedures, and transactions.
- `sql` classifies statements, validates operation boundaries, and safely handles SQL identifiers.
- `tools` defines MCP schemas and registers discovery, query, mutation, procedure, transaction, and diagnostic tools.
- `server` creates the shared `McpServer` and starts either stdio or Streamable HTTP.
- `utils` provides stderr logging, timing, error normalization, and JSON-safe result conversion.

All transports use the same server factory and database service. The process creates one pool manager and closes it during graceful shutdown.

## Transports

`MCP_TRANSPORT` selects one of two entry points:

- `stdio`: for clients that spawn a local child process, including Claude Desktop and Cursor. Application logs go only to stderr so stdout remains a valid MCP JSON-RPC channel.
- `http`: a stateless Streamable HTTP endpoint for network clients. It binds to `127.0.0.1` by default and uses a configurable path and port.

HTTP authentication and TLS are outside the internal-use scope. The README will state that remote or shared deployment should place the endpoint behind authentication, TLS, host validation, and an appropriate reverse proxy.

## Configuration

Configuration is read only from environment variables. Required settings are SQL Server host, database name, username, and password. Supported options include:

- SQL Server host, port, optional instance name, database, username, and password.
- Encryption and server-certificate trust settings.
- Pool minimum, pool maximum, and idle timeout.
- Connection and request timeouts.
- MCP transport, HTTP host, port, and endpoint path.
- Maximum returned rows and maximum SQL text length.
- Write, DELETE, stored-procedure, and transaction feature flags.

The checked-in `.env.example` contains names and safe example values but no real credentials. Startup configuration errors identify the missing or invalid variable without echoing secrets.

Default policy:

- Reads and metadata discovery are enabled.
- INSERT and UPDATE are enabled through `DB_ALLOW_WRITE=true`.
- DELETE is disabled through `DB_ALLOW_DELETE=false`.
- Stored procedures and transactions are enabled.
- HTTP listens only on loopback.
- Returned rows, SQL length, pool size, and timeouts have conservative finite limits.

## Connection Lifecycle

The database layer maintains one lazily initialized `mssql.ConnectionPool`. Concurrent callers share the same connection promise so startup races cannot create duplicate pools. Failed connection attempts clear the cached promise so a later health check or tool call can retry. Pool errors are logged without credentials.

Each ordinary operation creates a request from the connected pool. Transactions use `mssql.Transaction` with requests bound to the transaction so every step runs on the same connection. Shutdown handlers close the pool once and then terminate the transport process cleanly.

## Parameter Model

SQL tools accept parameters separately from SQL text. Each parameter has:

- `name`: an identifier without the leading `@`.
- `value`: a JSON-compatible value or null.
- optional `type`: a supported SQL Server type name.
- optional `length`, `precision`, and `scale` where the selected type permits them.

The binder validates parameter names, rejects duplicates and internal `mssql` parameter names, resolves an allowlist of SQL types, and calls `Request.input` or `Request.output`. Type inference is allowed for ordinary non-null input values. Explicit types are required for output parameters and recommended for nulls, decimals, dates, binary data, and values outside normal JavaScript numeric precision.

Identifiers cannot be SQL parameters. Metadata filters use parameters as values, while stored-procedure names are restricted to valid one- or two-part identifiers and bracket-quoted by the server.

## SQL Guardrails

Each execution tool accepts only its named operation. A lightweight lexer examines tokens outside string literals, quoted identifiers, bracketed identifiers, and comments. It will:

- reject empty SQL and SQL longer than the configured maximum;
- reject stacked statements, allowing only an optional trailing semicolon;
- recognize SELECT statements that begin directly with `SELECT` or use one or more CTEs introduced by `WITH`;
- require INSERT, UPDATE, or DELETE tools to begin with their corresponding operation;
- reject dangerous or cross-operation top-level tokens, including DDL, permission changes, backup/restore, `USE`, `DBCC`, procedure execution from raw-query tools, and `SELECT INTO`;
- enforce write and DELETE feature flags before creating a database request.

This layer is a practical accident-prevention mechanism. It is not a substitute for a least-privilege SQL login. The README will recommend a dedicated database user with only the permissions the AI client genuinely needs.

## Tools

### Discovery

- `list_tables`: lists user tables, schema, row-count estimate, and optional descriptive metadata.
- `list_views`: lists views and schema.
- `search_tables`: searches table and view names with a parameterized pattern and bounded results.
- `describe_table`: returns columns, SQL types, lengths/precision/scale, nullability, identity/computed/default information, primary-key membership, and inbound/outbound foreign keys.
- `get_database_schema`: returns a paginated overview of schemas, tables, views, columns, primary keys, and foreign keys.

Discovery queries use SQL Server catalog views and parameterized filters. They exclude system objects and make no assumptions about POS naming conventions.

### Query and Mutation

- `execute_select`: executes one SELECT or CTE statement with named parameters, offset, and limit.
- `execute_insert`: executes one INSERT statement and returns affected rows plus any result sets produced by `OUTPUT`.
- `execute_update`: executes one UPDATE statement and returns affected rows plus any result sets produced by `OUTPUT`.
- `execute_delete`: is registered only when DELETE is enabled and returns affected rows plus any `OUTPUT` result sets.

Every response includes execution time. SELECT responses include returned-row count and truncation status. Mutation responses include the `mssql` affected-row array and its total.

The server applies `offset` and `limit` to its returned result and never serializes more than `DB_MAX_ROWS`. This bounds MCP output but does not transform arbitrary T-SQL into efficient database pagination. For large datasets, callers should put a deterministic `ORDER BY ... OFFSET ... FETCH` clause in the SQL; the README will demonstrate this pattern.

### Stored Procedures

`execute_stored_procedure` accepts a schema-qualified procedure name and typed input/output parameters. It returns all recordsets, output values, return value, affected-row counts, and timing. The feature is independently controlled because a procedure can contain writes that cannot be inferred safely from its name.

### Transactions

`execute_transaction` accepts an ordered list of steps. Each step declares `select`, `insert`, `update`, or `delete`, supplies one statement, and supplies its own parameters. The server validates every step before beginning the transaction. It then executes the steps sequentially, commits only when all succeed, and rolls back on the first failure. DELETE steps require the DELETE feature flag; mutation steps require the write feature flag.

The tool returns a result summary for every step, including affected rows or bounded result data and execution time. Transaction size is capped by configuration to prevent excessively large AI-generated batches.

### Diagnostics

- `health_check`: reports server status, pool state, database reachability, database name, and elapsed time without exposing credentials.
- `get_database_version`: returns SQL Server product version, level, edition, engine edition, and server version text.
- `explain_query`: validates a SELECT statement, binds its parameters, requests an estimated SQL Server execution plan, and returns the plan without executing the data query. Permission or SQL Server compatibility errors are returned as normal MCP tool errors.

## Result Serialization

Database values are converted to JSON-safe structured content. Dates use ISO-8601 strings, buffers use base64 with an explicit marker, bigint values use decimal strings, and null remains null. Multiple recordsets are retained rather than silently discarded.

Each successful tool result contains:

- a concise human-readable text summary;
- `structuredContent` with operation-specific fields;
- execution time in milliseconds;
- truncation metadata when result bounds apply.

## Errors and Logging

Tool handlers catch all operational failures and return `isError: true` rather than terminating the MCP process. Normalized errors include a stable category, a helpful safe message, the SQL Server or driver error code when available, and elapsed time. Validation failures identify the rejected input and how to correct it.

Logs are structured, timestamped, and written to stderr. They include lifecycle events, tool names, durations, pool errors, and error categories. They do not include passwords, connection strings, or parameter values. SQL text is logged only at debug level and debug logging is disabled by default.

## Testing

Unit tests will cover:

- configuration defaults, coercion, and secret-safe failures;
- SQL tokenization and classification, including strings, comments, CTEs, trailing semicolons, stacked queries, and cross-operation attempts;
- safe identifier parsing and quoting;
- SQL parameter type resolution, duplicate detection, and invalid metadata;
- JSON-safe result serialization and result limits;
- write, DELETE, procedure, and transaction feature flags;
- transaction commit and rollback behavior with mocked database boundaries;
- tool success and MCP error response shapes.

An in-process MCP smoke test will connect through the SDK and verify tool discovery and at least one database-independent validation call. Formatting, ESLint, Vitest, and `tsc --noEmit` will run as normal verification commands.

An optional live smoke script will connect with the configured SQL credentials and run the health, version, list-tables, and bounded SELECT checks. It will not perform writes automatically.

## Documentation and Extension Points

The README will cover installation, environment variables, local stdio configuration examples, Streamable HTTP startup, client examples, available tools, parameter formats, pagination, feature flags, troubleshooting, and production-hardening recommendations.

Future extensions can add structured CRUD tools, allowlists by schema/table/procedure, user confirmation for mutations, audit sinks, authentication, TLS, per-client authorization, rate limiting, or a full T-SQL parser without changing the database service or transport boundaries.

## Acceptance Criteria

- The project installs and builds on Node.js 20+.
- Both stdio and stateless Streamable HTTP start from documented commands.
- One shared `mssql` pool serves all database operations and closes cleanly.
- The server dynamically discovers arbitrary user schemas without hardcoded POS tables.
- SELECT, INSERT, UPDATE, stored procedures, and transactions accept separately supplied named parameters.
- DELETE is absent or rejected while disabled and works through the same execution path when enabled.
- SELECT output is bounded by configuration and reports truncation and timing.
- Mutations and procedures report affected rows and timing.
- Invalid SQL, configuration, and database failures produce helpful MCP errors without crashing or leaking credentials.
- Automated formatting, lint, test, build, and MCP smoke checks pass without requiring a live POS database.
- The README enables a user to configure and run the server without reading source code.
