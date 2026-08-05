# SQL Server POS MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a production-readable TypeScript MCP server that dynamically discovers and safely reads or mutates a Microsoft SQL Server POS database over stdio and Streamable HTTP.

**Architecture:** A transport-neutral `McpServer` factory registers focused tools backed by a single shared `mssql` pool manager. SQL validation, parameter binding, database execution, metadata discovery, MCP response conversion, and transport startup remain separate modules with dependency injection at the tool boundary for fast tests.

**Tech Stack:** Node.js 20+, TypeScript 6, MCP TypeScript SDK v2 (`@modelcontextprotocol/server`, `@modelcontextprotocol/node`), `mssql` 12, Zod 4, Vitest, ESLint, and Prettier.

## Global Constraints

- Do not hardcode any POS database schema, table, view, column, key, or procedure name.
- Support both stdio and stateless Streamable HTTP through `MCP_TRANSPORT=stdio|http`.
- Use one lazily initialized `mssql.ConnectionPool` and close it during graceful shutdown.
- Keep credentials and parameter values out of logs and tool errors.
- Bind HTTP to `127.0.0.1` by default and validate the request path and Host header.
- Enable INSERT and UPDATE by default; disable DELETE by default.
- Enforce `DB_MAX_ROWS`, `DB_MAX_SQL_LENGTH`, request timeouts, and transaction step limits.
- Treat SQL inspection as a practical guardrail, not as a replacement for SQL Server permissions.
- Run formatting, linting, unit tests, MCP smoke tests, and TypeScript compilation without a live POS database.

---

## File Map

- `package.json`: ESM metadata, pinned runtime dependencies, and developer scripts.
- `tsconfig.json`: strict Node ESM compilation into `dist/`.
- `eslint.config.js`, `.prettierrc.json`: static and formatting rules.
- `.gitignore`, `.env.example`: generated-file exclusions and safe configuration template.
- `src/config/config.ts`: environment parsing and immutable `AppConfig`.
- `src/utils/logger.ts`: structured stderr logger.
- `src/utils/errors.ts`: stable application errors and safe normalization.
- `src/utils/json.ts`: JSON-safe SQL value and recordset conversion.
- `src/sql/identifiers.ts`: identifier validation and bracket quoting.
- `src/sql/guardrails.ts`: T-SQL tokenization, statement classification, and operation validation.
- `src/database/types.ts`: parameter and result contracts shared by database and tools.
- `src/database/parameters.ts`: SQL type resolution and `mssql.Request` binding.
- `src/database/pool.ts`: single-pool lifecycle.
- `src/database/executor.ts`: SELECT, mutation, procedure, transaction, health, version, and explain execution.
- `src/database/metadata.ts`: catalog-driven discovery queries.
- `src/tools/schemas.ts`: reusable Zod input schemas.
- `src/tools/responses.ts`: successful and failed MCP result construction.
- `src/tools/discovery.ts`: metadata tool registration.
- `src/tools/execution.ts`: SELECT/mutation/procedure/transaction tool registration.
- `src/tools/diagnostics.ts`: health, version, and explain tool registration.
- `src/tools/register.ts`: complete tool registry.
- `src/server/create-server.ts`: transport-neutral MCP server factory.
- `src/server/stdio.ts`: modern/legacy stdio serving.
- `src/server/http.ts`: modern/legacy Streamable HTTP serving through Node.
- `src/index.ts`: configuration, dependency composition, transport selection, and shutdown.
- `scripts/live-smoke.ts`: optional read-only live database checks.
- `tests/**/*.test.ts`: focused unit, integration-boundary, and MCP protocol tests.
- `README.md`: setup, clients, tools, safety, examples, and troubleshooting.

---

### Task 1: Project Foundation and Validated Configuration

**Files:**

- Create: `package.json`
- Create: `tsconfig.json`
- Create: `eslint.config.js`
- Create: `.prettierrc.json`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `src/config/config.ts`
- Create: `src/utils/logger.ts`
- Test: `tests/config/config.test.ts`

**Interfaces:**

- Produces: `loadConfig(env?: NodeJS.ProcessEnv): AppConfig`
- Produces: `Logger` with `debug`, `info`, `warn`, and `error` methods.
- Produces: the exact `AppConfig` sections `database`, `pool`, `limits`, `features`, `transport`, and `logging`.

- [ ] **Step 1: Add the ESM TypeScript package and quality-tool configuration**

Create scripts with these exact responsibilities:

```json
{
  "type": "module",
  "main": "dist/index.js",
  "bin": { "mcp-sql-server": "dist/index.js" },
  "scripts": {
    "dev": "tsx src/index.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint .",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "smoke:live": "tsx scripts/live-smoke.ts",
    "verify": "npm run format:check && npm run lint && npm run typecheck && npm test && npm run build"
  }
}
```

Install runtime packages at their stable release line:

```powershell
npm install @modelcontextprotocol/server@^2.0.0 @modelcontextprotocol/node@^2.0.0 mssql@^12.7.0 zod@^4.4.3 dotenv@^17.4.2
npm install --save-dev @modelcontextprotocol/client@^2.0.0 @types/mssql@^12.3.0 @types/node@^26.1.2 eslint@^10.8.0 prettier@^3.9.6 tsx@^4.23.8 typescript@^6.0.3 typescript-eslint@^8.66.0 vitest@^4.1.10
```

Use `module` and `moduleResolution` set to `NodeNext`, `target` set to `ES2022`, `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`, `types: ["node"]`, `rootDir: "."`, and compile `src` plus `scripts` to `dist`.

- [ ] **Step 2: Write failing configuration tests**

Cover required values, typed defaults, mutually exclusive port/instance handling, invalid ranges, and secret-safe errors:

```ts
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config/config.js';

const required = {
  DB_SERVER: 'localhost',
  DB_DATABASE: 'PosDb',
  DB_USER: 'mcp_user',
  DB_PASSWORD: 'do-not-print-me'
};

it('loads safe defaults', () => {
  const config = loadConfig(required);
  expect(config.transport.kind).toBe('stdio');
  expect(config.transport.httpHost).toBe('127.0.0.1');
  expect(config.limits.maxRows).toBe(500);
  expect(config.features.allowWrite).toBe(true);
  expect(config.features.allowDelete).toBe(false);
  expect(config.pool.max).toBe(10);
});

it('does not reveal the password in validation errors', () => {
  expect(() => loadConfig({ ...required, DB_PORT: 'invalid' })).toThrowError(
    expect.not.stringContaining('do-not-print-me')
  );
});
```

- [ ] **Step 3: Run the focused test and confirm the missing module failure**

Run: `npx vitest run tests/config/config.test.ts`

Expected: FAIL because `src/config/config.ts` does not exist.

- [ ] **Step 4: Implement environment parsing and the stderr logger**

Define and return this stable configuration shape:

```ts
export interface AppConfig {
  database: {
    server: string;
    port?: number;
    instanceName?: string;
    database: string;
    user: string;
    password: string;
    encrypt: boolean;
    trustServerCertificate: boolean;
    connectionTimeoutMs: number;
    requestTimeoutMs: number;
  };
  pool: { min: number; max: number; idleTimeoutMs: number };
  limits: { maxRows: number; maxSqlLength: number; maxTransactionSteps: number };
  features: {
    allowWrite: boolean;
    allowDelete: boolean;
    allowProcedures: boolean;
    allowTransactions: boolean;
  };
  transport: {
    kind: 'stdio' | 'http';
    httpHost: string;
    httpPort: number;
    httpPath: string;
  };
  logging: { level: 'debug' | 'info' | 'warn' | 'error' };
}
```

Use Zod coercion helpers that explicitly accept `true|false|1|0`, validate ports from 1 through 65535, require positive timeouts and limits, require `pool.min <= pool.max`, normalize the HTTP path to one leading slash, and reject simultaneous `DB_PORT` and `DB_INSTANCE_NAME`. Call `dotenv.config({ quiet: true })` only when `env === process.env`.

The logger emits one JSON object per line with `timestamp`, `level`, `message`, and safe metadata through `process.stderr.write`. It filters by configured level and never accepts configuration objects as metadata.

- [ ] **Step 5: Add the complete safe environment template**

Use these names and defaults in `.env.example`:

```dotenv
DB_SERVER=localhost
DB_PORT=1433
DB_DATABASE=PosDb
DB_USER=mcp_user
DB_PASSWORD=replace_me
DB_ENCRYPT=true
DB_TRUST_SERVER_CERTIFICATE=false
DB_POOL_MIN=0
DB_POOL_MAX=10
DB_POOL_IDLE_TIMEOUT_MS=30000
DB_CONNECTION_TIMEOUT_MS=15000
DB_REQUEST_TIMEOUT_MS=30000
DB_MAX_ROWS=500
DB_MAX_SQL_LENGTH=100000
DB_MAX_TRANSACTION_STEPS=20
DB_ALLOW_WRITE=true
DB_ALLOW_DELETE=false
DB_ALLOW_PROCEDURES=true
DB_ALLOW_TRANSACTIONS=true
MCP_TRANSPORT=stdio
MCP_HTTP_HOST=127.0.0.1
MCP_HTTP_PORT=3000
MCP_HTTP_PATH=/mcp
LOG_LEVEL=info
```

- [ ] **Step 6: Run tests and static checks**

Run: `npx vitest run tests/config/config.test.ts && npm run typecheck && npm run lint`

Expected: all commands pass.

- [ ] **Step 7: Commit the foundation**

```powershell
git add package.json package-lock.json tsconfig.json eslint.config.js .prettierrc.json .gitignore .env.example src/config src/utils/logger.ts tests/config
git commit -m "chore: scaffold TypeScript MCP server"
```

---

### Task 2: SQL Identifiers and Statement Guardrails

**Files:**

- Create: `src/utils/errors.ts`
- Create: `src/sql/identifiers.ts`
- Create: `src/sql/guardrails.ts`
- Test: `tests/sql/identifiers.test.ts`
- Test: `tests/sql/guardrails.test.ts`

**Interfaces:**

- Produces: `AppError(code, message, details?)` and `normalizeError(error): SafeError`.
- Produces: `parseMultipartIdentifier(value, maxParts): string[]` and `quoteIdentifierParts(parts): string`.
- Produces: `validateSql(sql, expectedKind, maxLength): ValidatedSql` where `expectedKind` is `'select' | 'insert' | 'update' | 'delete'`.

- [ ] **Step 1: Write identifier and SQL validation tests**

Use table-driven cases that prove literals and comments cannot smuggle extra statements:

```ts
it.each([
  ['SELECT 1', 'select'],
  [';WITH sales AS (SELECT 1 AS id) SELECT id FROM sales;', 'select'],
  ["SELECT '; DROP TABLE Sales' AS sample", 'select'],
  ['UPDATE dbo.Items SET Price = @price WHERE Id = @id;', 'update']
])('accepts %s as %s', (sql, kind) => {
  expect(validateSql(sql, kind as StatementKind, 10_000).kind).toBe(kind);
});

it.each([
  'SELECT 1; DROP TABLE Sales',
  'SELECT * INTO dbo.Copy FROM dbo.Sales',
  'WITH x AS (DELETE FROM dbo.Sales OUTPUT deleted.Id) SELECT * FROM x',
  'EXEC dbo.RebuildEverything'
])('rejects unsafe select input: %s', (sql) => {
  expect(() => validateSql(sql, 'select', 10_000)).toThrow(AppError);
});

it('quotes a two-part procedure identifier', () => {
  expect(quoteIdentifierParts(parseMultipartIdentifier('sales.CloseDay', 2))).toBe(
    '[sales].[CloseDay]'
  );
});
```

Also test nested block comments, line comments, escaped single quotes, `N'...'`, double-quoted names, bracket escapes, trailing semicolons, leading semicolons before a CTE, missing CTE terminal SELECT, parameter names, DDL keywords, `MERGE`, `EXECUTE`, `DBCC`, `USE`, `BACKUP`, permission statements, and length enforcement.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run tests/sql`

Expected: FAIL because the SQL modules are missing.

- [ ] **Step 3: Implement stable application errors and identifiers**

Use these public contracts:

```ts
export type ErrorCode =
  | 'CONFIGURATION_ERROR'
  | 'VALIDATION_ERROR'
  | 'FEATURE_DISABLED'
  | 'DATABASE_CONNECTION_ERROR'
  | 'DATABASE_QUERY_ERROR'
  | 'TRANSACTION_ERROR'
  | 'INTERNAL_ERROR';

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
    options?: ErrorOptions
  ) {
    super(message, options);
  }
}
```

`normalizeError` preserves an `AppError`; maps `mssql`-style `code`, `number`, `state`, and `class` fields into safe details; never copies a connection string, password, parameter value, or full arbitrary object; and uses `INTERNAL_ERROR` for unknown values.

Identifier parsing accepts ordinary SQL identifiers or already bracketed parts, rejects empty parts and more than the requested part count, unescapes `]]`, and always re-quotes with `]` doubled.

- [ ] **Step 4: Implement the lightweight T-SQL lexer and validator**

Tokenize into words, punctuation, semicolons, parameters, strings, identifiers, and comments while retaining token positions. Ignore whitespace and comments for classification. Permit only one statement plus optional leading semicolons for a CTE and one trailing semicolon. For `WITH`, balance parentheses across comma-separated CTE definitions and require the next top-level command to be SELECT.

Apply exact operation rules:

```ts
const globallyForbidden = new Set([
  'ALTER',
  'BACKUP',
  'CREATE',
  'DBCC',
  'DENY',
  'DROP',
  'EXEC',
  'EXECUTE',
  'GRANT',
  'MERGE',
  'RECONFIGURE',
  'RESTORE',
  'REVOKE',
  'TRUNCATE',
  'USE'
]);

const crossOperation: Record<StatementKind, ReadonlySet<string>> = {
  select: new Set(['INSERT', 'UPDATE', 'DELETE']),
  insert: new Set(['UPDATE', 'DELETE']),
  update: new Set(['INSERT', 'DELETE']),
  delete: new Set(['INSERT', 'UPDATE'])
};
```

Reject `INTO` at SELECT top level, any semicolon before the final significant token, and mismatched parentheses/comments/quotes. Return normalized SQL with only a trailing semicolon removed, the classified kind, and referenced parameter names for later diagnostics.

- [ ] **Step 5: Run focused tests and the full static check**

Run: `npx vitest run tests/sql && npm run typecheck && npm run lint`

Expected: all commands pass.

- [ ] **Step 6: Commit guardrails**

```powershell
git add src/sql src/utils/errors.ts tests/sql
git commit -m "feat: validate SQL operations and identifiers"
```

---

### Task 3: Parameters, Result Serialization, and Pool Lifecycle

**Files:**

- Create: `src/database/types.ts`
- Create: `src/database/parameters.ts`
- Create: `src/database/pool.ts`
- Create: `src/utils/json.ts`
- Test: `tests/database/parameters.test.ts`
- Test: `tests/database/pool.test.ts`
- Test: `tests/utils/json.test.ts`

**Interfaces:**

- Produces: `SqlParameter`, `ProcedureParameter`, `QueryResult`, `MutationResult`, `ProcedureResult`, `TransactionStep`, and `TransactionResult`.
- Produces: `bindInputParameters(request, parameters)` and `bindProcedureParameters(request, parameters)`.
- Produces: `PoolManager.getPool(): Promise<sql.ConnectionPool>` and `PoolManager.close(): Promise<void>`.
- Produces: `toJsonValue`, `boundRecordsets`, and `sumRowsAffected`.

- [ ] **Step 1: Write failing parameter, serialization, and pool tests**

Test inferred scalar input, explicit `NVarChar(100)`, `Decimal(19,4)`, `VarBinary(MAX)`, null with explicit type, output parameters, invalid names, duplicate names case-insensitively, unsupported type names, invalid length/precision/scale, and reserved `p1`-style names.

Use a fake pool factory to prove concurrent calls share one promise and failed connections retry:

```ts
it('shares one in-flight pool connection', async () => {
  const connect = vi.fn().mockResolvedValue(undefined);
  const pool = { connect, close: vi.fn(), on: vi.fn() };
  const manager = new PoolManager(config, logger, () => pool as never);
  const [first, second] = await Promise.all([manager.getPool(), manager.getPool()]);
  expect(first).toBe(second);
  expect(connect).toHaveBeenCalledOnce();
});
```

Test that Date becomes ISO text, Buffer becomes `{ "$binary": "...base64..." }`, bigint becomes a decimal string, nested values remain safe, circular values fail with `AppError`, row limits are global across recordsets, and truncation metadata is accurate.

- [ ] **Step 2: Run focused tests and confirm they fail**

Run: `npx vitest run tests/database/parameters.test.ts tests/database/pool.test.ts tests/utils/json.test.ts`

Expected: FAIL because the database contracts are missing.

- [ ] **Step 3: Define database contracts and parameter binding**

Use the following stable input contracts:

```ts
export interface SqlParameter {
  name: string;
  value: unknown;
  type?: string;
  length?: number | 'MAX';
  precision?: number;
  scale?: number;
}

export interface ProcedureParameter extends SqlParameter {
  direction?: 'input' | 'output' | 'inputOutput';
}

export interface TransactionStep {
  operation: 'select' | 'insert' | 'update' | 'delete';
  sql: string;
  parameters?: SqlParameter[];
}
```

Resolve an allowlist containing Bit, TinyInt, SmallInt, Int, BigInt, Real, Float, Decimal, Numeric, Money, SmallMoney, Char, NChar, VarChar, NVarChar, Text, NText, Binary, VarBinary, Date, Time, SmallDateTime, DateTime, DateTime2, DateTimeOffset, UniqueIdentifier, Xml, and MAX-capable variable types. Use `request.input(name, value)` only when type is omitted and value is non-null. Require explicit type for null and every output parameter. For `inputOutput`, call both input and output with the same resolved type and initial value.

- [ ] **Step 4: Implement JSON-safe bounded conversion**

Expose:

```ts
export interface BoundedRecordsets {
  recordsets: Record<string, unknown>[][];
  returnedRows: number;
  truncated: boolean;
}

export function boundRecordsets(
  recordsets: readonly (readonly unknown[])[],
  maxRows: number,
  offset = 0
): BoundedRecordsets;
```

Apply `offset` only to the first recordset for SELECT pagination and then use one global row budget across all returned recordsets. Convert SQL metadata-bearing row objects to plain objects without prototypes. Do not include driver metadata or request objects.

- [ ] **Step 5: Implement the single lazy pool manager**

Build `mssql.config` from `AppConfig`, including `options.encrypt`, `options.trustServerCertificate`, optional `options.instanceName`, `pool`, `connectionTimeout`, and `requestTimeout`. Omit `port` when an instance name is present. Attach one pool error listener. Cache the connection promise, clear it on failure, and make `close()` idempotent.

- [ ] **Step 6: Run tests and static checks**

Run: `npx vitest run tests/database tests/utils/json.test.ts && npm run typecheck && npm run lint`

Expected: all commands pass.

- [ ] **Step 7: Commit the database primitives**

```powershell
git add src/database/types.ts src/database/parameters.ts src/database/pool.ts src/utils/json.ts tests/database tests/utils
git commit -m "feat: add pooled SQL primitives"
```

---

### Task 4: Query, Procedure, Transaction, and Diagnostic Execution

**Files:**

- Create: `src/database/executor.ts`
- Test: `tests/database/executor.test.ts`

**Interfaces:**

- Consumes: `PoolManager`, `validateSql`, parameter binders, JSON conversion, `AppConfig`.
- Produces: class `SqlExecutor` with `select`, `mutate`, `executeProcedure`, `executeTransaction`, `health`, `version`, and `explain`.

- [ ] **Step 1: Write failing executor tests against mocked mssql boundaries**

Assert the following observable behavior:

```ts
await expect(executor.select({ sql: 'UPDATE T SET X=1' })).rejects.toMatchObject({
  code: 'VALIDATION_ERROR'
});

await expect(executor.mutate('delete', { sql: 'DELETE FROM T' })).rejects.toMatchObject({
  code: 'FEATURE_DISABLED'
});

expect(
  await executor.mutate('update', {
    sql: 'UPDATE dbo.Items SET Price=@price WHERE Id=@id',
    parameters: [
      { name: 'price', type: 'Decimal', precision: 19, scale: 4, value: 9.5 },
      { name: 'id', type: 'Int', value: 4 }
    ]
  })
).toMatchObject({ affectedRows: 2 });
```

Also prove elapsed time is present, returned data is bounded, all affected-row entries are summed, a procedure returns recordsets/output/return value, every transaction statement is validated before `begin`, requests bind to one transaction, success commits once, failure rolls back once, rollback failure preserves the original failure as the primary error, health uses `SELECT DB_NAME()`, and version queries `SERVERPROPERTY` values.

For explain, assert the exact sequence on one transaction-bound connection: begin; `SET SHOWPLAN_XML ON`; validated parameterized SELECT; `SET SHOWPLAN_XML OFF` in `finally`; rollback the read-only control transaction.

- [ ] **Step 2: Run the focused tests and confirm they fail**

Run: `npx vitest run tests/database/executor.test.ts`

Expected: FAIL because `SqlExecutor` is missing.

- [ ] **Step 3: Implement SELECT and mutation execution**

Use inputs and return types that do not expose driver objects:

```ts
select(input: {
  sql: string;
  parameters?: SqlParameter[];
  offset?: number;
  limit?: number;
}): Promise<QueryResult>;

mutate(
  kind: 'insert' | 'update' | 'delete',
  input: { sql: string; parameters?: SqlParameter[] }
): Promise<MutationResult>;
```

Validate before acquiring the pool. Clamp `limit` to `1..config.limits.maxRows`, require non-negative offset, check feature flags, bind parameters, call `request.query`, convert recordsets, total `rowsAffected`, and measure time with `performance.now()`.

- [ ] **Step 4: Implement procedures and transactions**

Validate and quote a procedure name before acquiring the pool. Procedures must check `allowProcedures`, bind input/output parameters, call `request.execute(quotedName)`, and return safe recordsets, output values, return value, affected rows, and duration.

Transactions must check `allowTransactions`, cap non-empty steps at `maxTransactionSteps`, validate every step and every feature flag first, then begin one `mssql.Transaction(pool)`. Execute sequential `new sql.Request(transaction)` calls, collect bounded per-step summaries, commit, and return total duration. In `catch`, roll back only after a successful begin and throw an `AppError('TRANSACTION_ERROR', ...)` whose cause is the original failure.

- [ ] **Step 5: Implement health, version, and explain**

Health returns `{ ok, database, poolConnected, executionTimeMs }` and converts connection/query failures into a normal failed result at the MCP layer. Version uses:

```sql
SELECT
  CAST(SERVERPROPERTY('ProductVersion') AS nvarchar(128)) AS productVersion,
  CAST(SERVERPROPERTY('ProductLevel') AS nvarchar(128)) AS productLevel,
  CAST(SERVERPROPERTY('Edition') AS nvarchar(128)) AS edition,
  CAST(SERVERPROPERTY('EngineEdition') AS int) AS engineEdition,
  @@VERSION AS versionText;
```

Explain accepts only SELECT, uses a transaction to reserve one pool connection, toggles `SHOWPLAN_XML` in separate requests, returns the XML plan as a string, always attempts to turn the setting off, and rolls back the control transaction.

- [ ] **Step 6: Run focused and cumulative verification**

Run: `npx vitest run tests/database && npm run typecheck && npm run lint`

Expected: all commands pass.

- [ ] **Step 7: Commit execution services**

```powershell
git add src/database/executor.ts tests/database/executor.test.ts
git commit -m "feat: execute SQL operations and transactions"
```

---

### Task 5: Dynamic Metadata Discovery

**Files:**

- Create: `src/database/metadata.ts`
- Test: `tests/database/metadata.test.ts`

**Interfaces:**

- Consumes: `PoolManager`, parameter binder, bounds, timer.
- Produces: class `MetadataService` with `listTables`, `listViews`, `searchObjects`, `describeTable`, and `getDatabaseSchema`.

- [ ] **Step 1: Write failing catalog-query tests**

Use a captured fake request to verify every user-supplied filter is bound as a parameter, queries use `sys.schemas`, `sys.tables`, `sys.views`, `sys.columns`, `sys.types`, `sys.indexes`, `sys.index_columns`, `sys.foreign_keys`, and `sys.foreign_key_columns`, and every query excludes system objects.

Test `describeTable({ schema: 'sales', table: 'Orders' })` returns columns, ordered composite primary-key positions, outgoing foreign keys, and incoming foreign keys. Test a missing table raises `VALIDATION_ERROR` with `sales.Orders` but no query text. Test schema pagination clamps limit and requires non-negative offset.

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run tests/database/metadata.test.ts`

Expected: FAIL because `MetadataService` is missing.

- [ ] **Step 3: Implement table, view, and search queries**

Return schema/name ordered results. Table rows include schema, name, approximate row count from `sys.dm_db_partition_stats` aggregated only for index IDs 0 and 1, and optional extended-property description. If the login lacks permission for partition statistics, catch that specific SQL error and retry the same catalog query with row count set to null.

Search accepts a literal substring, escapes `%`, `_`, and `[` for `LIKE ... ESCAPE '\\'`, binds it as `@pattern`, supports `table|view|all`, and applies the configured result cap.

- [ ] **Step 4: Implement detailed table and paginated schema descriptions**

Describe columns with base and user-defined type names, max length, precision, scale, nullability, identity seed/increment, computed expression, persisted flag, default expression, collation, and primary-key ordinal. Return foreign keys with constraint name, ordered column pairs, referenced schema/table, update action, and delete action.

`getDatabaseSchema` returns a bounded page of objects first, then queries columns and relationships only for those schema/name pairs. Its response includes `offset`, `limit`, `returnedObjects`, `hasMore`, and `objects` so large databases do not create one enormous MCP result.

- [ ] **Step 5: Run focused and cumulative verification**

Run: `npx vitest run tests/database && npm run typecheck && npm run lint`

Expected: all commands pass.

- [ ] **Step 6: Commit metadata discovery**

```powershell
git add src/database/metadata.ts tests/database/metadata.test.ts
git commit -m "feat: discover SQL Server metadata"
```

---

### Task 6: MCP Schemas, Responses, and Tool Registration

**Files:**

- Create: `src/tools/schemas.ts`
- Create: `src/tools/responses.ts`
- Create: `src/tools/discovery.ts`
- Create: `src/tools/execution.ts`
- Create: `src/tools/diagnostics.ts`
- Create: `src/tools/register.ts`
- Create: `src/server/create-server.ts`
- Test: `tests/tools/tools.test.ts`

**Interfaces:**

- Consumes: `SqlExecutor`, `MetadataService`, `AppConfig`, `Logger`.
- Produces: `registerTools(server, dependencies): void`.
- Produces: `createMcpServer(dependencies): McpServer`.

- [ ] **Step 1: Write failing MCP tool registration tests**

Connect a v2 `Client` and the server through `InMemoryTransport.createLinkedPair()` for legacy-era unit coverage. Assert exact tool names:

```ts
expect((await client.listTools()).tools.map((tool) => tool.name).sort()).toEqual(
  [
    'describe_table',
    'execute_delete',
    'execute_insert',
    'execute_select',
    'execute_stored_procedure',
    'execute_transaction',
    'execute_update',
    'explain_query',
    'get_database_schema',
    'get_database_version',
    'health_check',
    'list_tables',
    'list_views',
    'search_tables'
  ].sort()
);
```

Run the same assertion with DELETE disabled and expect `execute_delete` to be absent. Call a successful mocked SELECT and assert human text plus `structuredContent`; force an `AppError` and assert `isError: true`, stable code, safe message, and no stack/password; submit invalid Zod input and assert the SDK rejects it before calling the executor.

- [ ] **Step 2: Run the tool tests and confirm they fail**

Run: `npx vitest run tests/tools/tools.test.ts`

Expected: FAIL because the server factory is missing.

- [ ] **Step 3: Define reusable MCP input schemas**

Create strict Zod schemas for parameters, SELECT input, mutation input, procedure input, transaction input, object search, table description, and schema pagination. Add descriptions that tell AI callers to use `@name` placeholders and pass values separately. Enforce parameter name syntax, non-negative offsets, positive limits, non-empty SQL, non-empty transaction steps, and procedure output type requirements at the schema boundary.

- [ ] **Step 4: Implement consistent MCP responses**

Expose:

```ts
export function successResult(summary: string, data: Record<string, unknown>): CallToolResult;
export function errorResult(error: unknown, logger: Logger, toolName: string): CallToolResult;
export function withToolErrors<TArgs>(
  toolName: string,
  logger: Logger,
  handler: (args: TArgs) => Promise<CallToolResult>
): (args: TArgs) => Promise<CallToolResult>;
```

`successResult` returns both one text content block and `structuredContent`. `errorResult` logs only code/tool/duration-safe metadata and returns one concise text block plus structured `{ error: { code, message, details } }` with `isError: true`.

- [ ] **Step 5: Register discovery, execution, and diagnostic tools**

Each tool uses `server.registerTool(name, { title, description, inputSchema, annotations }, handler)`. Mark discovery, SELECT, health, version, and explain tools with `readOnlyHint: true`; mark INSERT, UPDATE, DELETE, procedures, and transactions with `readOnlyHint: false`; set `destructiveHint: true` only for DELETE and procedures/transactions that may write; do not claim idempotence for mutations.

Register DELETE only when `allowDelete` is true. Keep INSERT and UPDATE registered when writes are disabled so callers get a clear feature-disabled result if configuration changes after discovery; the executor remains authoritative.

- [ ] **Step 6: Build the transport-neutral server factory**

Use:

```ts
export function createMcpServer(dependencies: ToolDependencies): McpServer {
  const server = new McpServer(
    { name: 'mcp-sql-server-pos', version: '1.0.0' },
    {
      capabilities: { tools: { listChanged: false } },
      instructions:
        'Explore schema before querying. Use named parameters for values. Prefer SELECT and confirm business intent before mutations.'
    }
  );
  registerTools(server, dependencies);
  return server;
}
```

- [ ] **Step 7: Run MCP tool tests and cumulative verification**

Run: `npx vitest run tests/tools && npm run typecheck && npm run lint`

Expected: all commands pass.

- [ ] **Step 8: Commit MCP tools**

```powershell
git add src/tools src/server/create-server.ts tests/tools
git commit -m "feat: expose SQL Server MCP tools"
```

---

### Task 7: Stdio, Streamable HTTP, Composition, and Protocol Smoke Tests

**Files:**

- Create: `src/server/stdio.ts`
- Create: `src/server/http.ts`
- Create: `src/index.ts`
- Test: `tests/server/http.test.ts`
- Test: `tests/server/protocol.test.ts`

**Interfaces:**

- Consumes: `createMcpServer`, `AppConfig`, `PoolManager`, `Logger`.
- Produces: `startStdio(factory, logger): ServerHandle`.
- Produces: `startHttp(factory, config, logger): Promise<ServerHandle>`.
- Produces: executable `src/index.ts`.

- [ ] **Step 1: Write failing HTTP and protocol tests**

For HTTP, start on port 0 and assert the configured MCP path reaches the handler, other paths return 404, an invalid Host returns 403, unsupported methods are handled by MCP, and shutdown closes the HTTP server and MCP handler.

For modern protocol coverage, drive `createMcpHandler(factory).fetch` in-process with `StreamableHTTPClientTransport` and client version negotiation:

```ts
const handler = createMcpHandler(factory);
const transport = new StreamableHTTPClientTransport(new URL('http://test.local/mcp'), {
  fetch: (url, init) => handler.fetch(new Request(url, init))
});
const client = new Client(
  { name: 'protocol-test', version: '1.0.0' },
  { versionNegotiation: { mode: 'auto' } }
);
await client.connect(transport);
expect(client.getProtocolEra()).toBe('modern');
expect((await client.listTools()).tools.some((tool) => tool.name === 'health_check')).toBe(true);
```

Also spawn the compiled stdio entry with the SDK `StdioClientTransport`, negotiate automatically, list tools, and close cleanly without any non-protocol stdout.

- [ ] **Step 2: Run focused tests and confirm they fail**

Run: `npx vitest run tests/server`

Expected: FAIL because transport modules are missing.

- [ ] **Step 3: Implement stdio serving for modern and legacy clients**

Use `serveStdio(factory, { legacy: 'serve', onerror })` from `@modelcontextprotocol/server/stdio`. Return a handle exposing `close()`. Log the startup banner to stderr only.

- [ ] **Step 4: Implement stateless Streamable HTTP serving**

Create one `createMcpHandler(factory, { legacy: 'stateless', onerror })`, wrap its fetch face with Host validation from `@modelcontextprotocol/server`, adapt it using `toNodeHandler` from `@modelcontextprotocol/node`, and mount it on a plain `node:http` server only at `config.transport.httpPath`. Use the configured host and port. The close handle first stops accepting HTTP connections, then calls `handler.close()`.

Allowed hosts are the configured hostname plus loopback aliases when binding to loopback. If configured to bind on a non-loopback interface, require `MCP_HTTP_ALLOWED_HOSTS` as an additional comma-separated configuration value and fail startup when it is absent.

- [ ] **Step 5: Compose dependencies and graceful shutdown**

`src/index.ts` must:

```ts
const config = loadConfig();
const logger = createLogger(config.logging.level);
const pool = new PoolManager(config, logger);
const executor = new SqlExecutor(pool, config, logger);
const metadata = new MetadataService(pool, config, logger);
const factory = () => createMcpServer({ config, executor, metadata, logger });
```

Select the configured transport without connecting to SQL eagerly. Install SIGINT and SIGTERM handlers that run once, close the server handle, close the pool, set a non-zero exit code only on shutdown failure, and never call `process.exit()` before cleanup completes. Catch startup errors, log the normalized safe error, and set `process.exitCode = 1`.

- [ ] **Step 6: Run protocol and full automated tests**

Run: `npm run build && npx vitest run tests/server && npm test`

Expected: compilation succeeds and every test passes.

- [ ] **Step 7: Commit transports and entry point**

```powershell
git add src/server src/index.ts tests/server
git commit -m "feat: serve MCP over stdio and HTTP"
```

---

### Task 8: Documentation, Live Smoke Check, and Final Verification

**Files:**

- Create: `scripts/live-smoke.ts`
- Create: `README.md`
- Modify: `package.json`
- Test: all existing tests.

**Interfaces:**

- Consumes: the public environment variables and built server.
- Produces: a complete operator guide and read-only live validation command.

- [ ] **Step 1: Implement the read-only live smoke script**

Load configuration, create the logger/pool/executor/metadata services, then run health, version, `listTables({ offset: 0, limit: 5 })`, and `select({ sql: 'SELECT DB_NAME() AS databaseName', limit: 1 })`. Print a JSON-safe summary, close the pool in `finally`, and never call mutation, procedure, transaction, or explain operations.

- [ ] **Step 2: Write the complete README**

Document:

- prerequisites and `npm install`, `npm run build`, `npm start`;
- every environment variable, default, required status, and security implication;
- SQL authentication, named instances, encryption, and local self-signed certificate troubleshooting;
- stdio configurations for Claude Desktop and Cursor using absolute `node` and `dist/index.js` paths;
- Streamable HTTP startup and endpoint URL for compatible remote clients;
- all 14 tools, arguments, feature flags, and return fields;
- named parameter examples for SELECT, INSERT, UPDATE, stored-procedure inputs/outputs, and transactions;
- deterministic SQL Server pagination with `ORDER BY ... OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY`;
- why server result slicing bounds output but does not make an unbounded query efficient;
- DELETE-disabled behavior and least-privilege SQL login guidance;
- health, MCP Inspector, and `npm run smoke:live` checks;
- error troubleshooting for login, encryption certificates, timeouts, permissions, invalid SQL classification, and stdout corruption;
- production extension points for auth, TLS, allowlists, auditing, confirmation, and rate limiting.

Use this client configuration shape with Windows paths escaped correctly:

```json
{
  "mcpServers": {
    "pos-sql-server": {
      "command": "node",
      "args": ["F:\\Codes\\MCP\\dist\\index.js"],
      "env": {
        "MCP_TRANSPORT": "stdio",
        "DB_SERVER": "localhost",
        "DB_DATABASE": "PosDb",
        "DB_USER": "mcp_user",
        "DB_PASSWORD": "replace_me"
      }
    }
  }
}
```

- [ ] **Step 3: Run a dependency and secret audit**

Run:

```powershell
npm audit --omit=dev
git grep -n -E "DB_PASSWORD=.+|password.*do-not-print-me" -- ':!docs/superpowers/**' ':!tests/**' ':!.env.example'
```

Expected: the production audit has no high/critical finding that applies to runtime use, and the grep produces no output.

- [ ] **Step 4: Run final verification**

Run: `npm run verify`

Expected: Prettier check, ESLint, TypeScript typecheck, all Vitest suites, and the production build pass.

Run: `node dist/index.js` with intentionally missing database variables.

Expected: one safe configuration error on stderr, no credential echo, exit code 1, and no stack trace at info log level.

When test SQL credentials are available, run: `npm run smoke:live`.

Expected: health, version, table sample, and database-name SELECT succeed without writes.

- [ ] **Step 5: Review acceptance criteria and repository status**

Check every acceptance criterion in `docs/superpowers/specs/2026-08-06-sql-server-pos-mcp-design.md` against a test, command output, or README section. Run `git status --short` and ensure only intended files remain.

- [ ] **Step 6: Commit documentation and final verification assets**

```powershell
git add README.md scripts/live-smoke.ts package.json package-lock.json
git commit -m "docs: add setup and operations guide"
```

---

## Completion Evidence

Before declaring the build complete, retain these command results in the final handoff:

```text
npm run format:check  -> pass
npm run lint          -> pass
npm run typecheck     -> pass
npm test              -> pass, with test and assertion counts
npm run build         -> pass
npm audit --omit=dev  -> report summarized
git status --short    -> clean or explicitly explained
```

State explicitly that database-independent protocol behavior was verified locally and that live POS database connectivity remains unverified unless `npm run smoke:live` was run with user-supplied credentials.
