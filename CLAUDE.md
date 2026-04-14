# dbhelper-mcp

MCP server for safe, read-only SQL Server database access.

## Build & Test

```bash
npm install
npm run build          # tsc → dist/
npm test               # vitest run
npm run test:watch     # vitest (watch mode)
npm run dev            # tsx watch src/index.ts
```

## Key Files

- `src/index.ts` — MCP server entry point, tool registration
- `src/config.ts` — Database registry from databases.json
- `src/connection-pool.ts` — Lazy per-database connection pool manager
- `src/query-validator.ts` — Read-only SQL enforcement (21 blocked keywords)
- `src/logger.ts` — Structured audit logging with pluggable sinks
- `src/rate-limiter.ts` — In-memory sliding-window rate limiter
- `src/tools/` — 6 MCP tool implementations

## Architecture

- **Dual-layer security**: App-level query validation + DB-level read-only user
- **All tools**: list_databases, run_query, list_tables, get_table_schema, describe_stored_procedure, compare_databases
- **Parameterized queries**: All SQL uses mssql parameter binding (no string interpolation)
- **Audit logging**: Every tool call logged with timing, query, result metadata
- **Rate limiting**: Sliding window, 60 req/min default

## Configuration

- `databases.json` — Database connection definitions (see databases.example.json)
- `.env` — SQL_READONLY_USER, SQL_READONLY_PASSWORD, DBHELPER_CONFIG

## Testing

- Tests in `__tests__/` — 88 tests across 11 files
- Core modules tested directly
- Tool tests use mocked DB connections
- Run `npm test` before committing
