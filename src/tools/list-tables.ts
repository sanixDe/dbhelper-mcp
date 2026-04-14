import { z } from "zod";
import sql from "mssql";
import { getPool } from "../connection-pool.js";
import { logAudit, startTimer } from "../logger.js";
import { checkRateLimit } from "../rate-limiter.js";

export const listTablesToolName = "list_tables";

export const listTablesDescription =
  "List all tables in a database with approximate row counts. Useful for understanding the database structure.";

export const listTablesParams = {
  database: z.string().describe("Database name as defined in databases.json"),
  schema: z
    .string()
    .optional()
    .describe("Filter by schema name (e.g., 'dbo'). If omitted, shows all schemas."),
};

export async function listTablesHandler({
  database,
  schema,
}: {
  database: string;
  schema?: string;
}) {
  const elapsed = startTimer();

  const rateCheck = checkRateLimit();
  if (!rateCheck.allowed) {
    logAudit({
      timestamp: new Date().toISOString(),
      tool: listTablesToolName,
      database,
      durationMs: elapsed(),
      blocked: true,
      blockedReason: "Rate limit exceeded",
    });
    return {
      content: [
        {
          type: "text" as const,
          text: `Rate limit exceeded. Try again in ${Math.ceil((rateCheck.retryAfterMs ?? 0) / 1000)}s.`,
        },
      ],
    };
  }

  try {
    const pool = await getPool(database);

    const baseQuery = `
      SELECT
        s.name AS SchemaName,
        t.name AS TableName,
        p.rows AS ApproxRowCount
      FROM sys.tables t
      JOIN sys.schemas s ON t.schema_id = s.schema_id
      JOIN sys.partitions p ON t.object_id = p.object_id AND p.index_id IN (0,1)
    `;

    const request = pool.request();
    let query: string;

    if (schema) {
      request.input("schema", sql.NVarChar, schema);
      query = baseQuery + ` WHERE s.name = @schema ORDER BY s.name, t.name`;
    } else {
      query = baseQuery + ` ORDER BY s.name, t.name`;
    }

    const result = await request.query(query);
    const durationMs = elapsed();

    logAudit({
      timestamp: new Date().toISOString(),
      tool: listTablesToolName,
      database,
      durationMs,
      rowCount: result.recordset.length,
    });

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              database,
              tableCount: result.recordset.length,
              durationMs,
              tables: result.recordset,
            },
            null,
            2
          ),
        },
      ],
    };
  } catch (err: unknown) {
    const durationMs = elapsed();
    const message = err instanceof Error ? err.message : "Unknown error";

    logAudit({
      timestamp: new Date().toISOString(),
      tool: listTablesToolName,
      database,
      durationMs,
      error: message,
    });

    return {
      content: [
        { type: "text" as const, text: `Error: ${message}` },
      ],
    };
  }
}
