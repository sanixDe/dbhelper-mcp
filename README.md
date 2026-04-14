# dbhelper-mcp

An MCP (Model Context Protocol) server that gives AI assistants **read-only access** to SQL Server databases. Query schemas, inspect tables, read stored procedures, and compare data across multiple databases — all through a safe, read-only interface.

Built for use with [Claude Code](https://claude.ai/claude-code), [Cursor](https://cursor.com), and any MCP-compatible client.

## Features

- **6 tools** for comprehensive database exploration
- **Read-only enforcement** — dual-layer protection (app-level query validation + DB-level permissions)
- **Multi-database** — configure as many databases as you need via a simple JSON file
- **Connection pooling** — lazy per-database pools with automatic cleanup
- **SQL injection protection** — blocks 21 dangerous keywords, system procedures, comment-based bypasses, and multi-statement attacks

## Tools

| Tool | Description |
|------|-------------|
| `list_databases` | List all configured databases with environment and server info |
| `run_query` | Execute read-only SQL (SELECT/WITH/DECLARE) with row limits |
| `list_tables` | List all tables in a database with approximate row counts |
| `get_table_schema` | Get column definitions, types, constraints, and foreign keys |
| `describe_stored_procedure` | Get stored procedure source code and parameters |
| `compare_databases` | Run the same query across multiple databases in parallel |

## Quick Start

### 1. Clone and install

```bash
git clone https://github.com/sani-savaliya/dbhelper-mcp.git
cd dbhelper-mcp
npm install
```

### 2. Create your database config

```bash
cp databases.example.json databases.json
```

Edit `databases.json` with your databases:

```json
{
  "databases": [
    {
      "name": "myapp-dev",
      "server": "my-server.database.windows.net",
      "database": "myapp-dev-db",
      "environment": "nonprod"
    },
    {
      "name": "myapp-prod",
      "server": "my-server.database.windows.net",
      "database": "myapp-prod-db",
      "environment": "prod"
    }
  ]
}
```

Each entry:
- **name** — friendly name you'll use to reference this database in queries
- **server** — SQL Server hostname
- **database** — actual database name on the server
- **environment** — `"prod"` or `"nonprod"` (informational, shown in `list_databases`)

### 3. Set up the read-only SQL user

Run the SQL script in `sql/create-readonly-user.sql` on your SQL Server to create a locked-down read-only user. The script:
- Creates a login on `master`
- Auto-discovers all databases and provisions the user in each
- Grants only `db_datareader` + `VIEW DEFINITION`
- Explicitly denies INSERT, UPDATE, DELETE, ALTER, EXECUTE, CREATE

### 4. Set environment variables

```bash
cp .env.example .env
```

Edit `.env`:
```
SQL_READONLY_USER=dbhelper_readonly
SQL_READONLY_PASSWORD=your_strong_password
```

### 5. Add to Claude Code

Add this to your `~/.claude.json` (or project `.mcp.json`):

```json
{
  "mcpServers": {
    "dbhelper": {
      "type": "stdio",
      "command": "cmd",
      "args": ["/c", "npx", "tsx", "C:/path/to/dbhelper-mcp/src/index.ts"],
      "env": {
        "SQL_READONLY_USER": "dbhelper_readonly",
        "SQL_READONLY_PASSWORD": "your_password",
        "DBHELPER_CONFIG": "C:/path/to/dbhelper-mcp/databases.json"
      }
    }
  }
}
```

On macOS/Linux, replace `"command": "cmd"` and `"args": ["/c", ...]` with:
```json
{
  "command": "npx",
  "args": ["tsx", "/path/to/dbhelper-mcp/src/index.ts"]
}
```

### 6. Restart Claude Code

The tools (`list_databases`, `run_query`, etc.) should now be available.

## Security

This server is designed with defense-in-depth:

### Application Level
- Only `SELECT`, `WITH`, and `DECLARE` (with SELECT) statements are allowed
- 21 dangerous keywords blocked: INSERT, UPDATE, DELETE, DROP, ALTER, CREATE, TRUNCATE, MERGE, EXEC, EXECUTE, etc.
- System procedure prefixes blocked: `xp_*`, `sp_*`
- SQL comments stripped before validation (prevents comment-based bypasses)
- Multi-statement queries blocked (semicolons between statements)

### Database Level
- Read-only user with only `db_datareader` role
- Explicit DENY on INSERT, UPDATE, DELETE, ALTER, EXECUTE, CREATE
- `VIEW DEFINITION` granted for reading stored procedure source

### Configuration
- Credentials passed via environment variables, never hardcoded
- `databases.json` is gitignored by default
- `.env` is gitignored by default

## Development

```bash
# Run in dev mode (auto-restart on changes)
npm run dev

# Run tests
npm test

# Build
npm run build

# Run built version
npm start
```

## Configuration Reference

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SQL_READONLY_USER` | Yes | SQL Server username |
| `SQL_READONLY_PASSWORD` | Yes | SQL Server password |
| `DBHELPER_CONFIG` | No | Path to `databases.json` (defaults to `./databases.json`) |

### databases.json Schema

```json
{
  "databases": [
    {
      "name": "string (required) — friendly identifier",
      "server": "string (required) — SQL Server hostname",
      "database": "string (required) — database name on server",
      "environment": "prod | nonprod (required)",
      "displayName": "string (optional) — pretty name for display"
    }
  ]
}
```

## License

MIT
