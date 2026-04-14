import { z } from "zod";
import sql from "mssql";
import { getPool } from "../connection-pool.js";
import { logAudit, startTimer } from "../logger.js";
import { checkRateLimit } from "../rate-limiter.js";

export const getTableSchemaToolName = "get_table_schema";

export const getTableSchemaDescription =
  "Get column definitions, data types, constraints, and foreign key relationships for a specific table.";

export const getTableSchemaParams = {
  database: z.string().describe("Database name as defined in databases.json"),
  table: z
    .string()
    .describe("Table name (e.g., 'Users', 'Orders', 'Products')"),
  schema: z
    .string()
    .default("dbo")
    .describe("Schema name (default: dbo)"),
};

export async function getTableSchemaHandler({
  database,
  table,
  schema,
}: {
  database: string;
  table: string;
  schema: string;
}) {
  const elapsed = startTimer();

  const rateCheck = checkRateLimit();
  if (!rateCheck.allowed) {
    logAudit({
      timestamp: new Date().toISOString(),
      tool: getTableSchemaToolName,
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
    const result = await pool
      .request()
      .input("table", sql.NVarChar, table)
      .input("schema", sql.NVarChar, schema).query(`
        SELECT
          c.COLUMN_NAME,
          c.DATA_TYPE,
          c.CHARACTER_MAXIMUM_LENGTH,
          c.NUMERIC_PRECISION,
          c.NUMERIC_SCALE,
          c.IS_NULLABLE,
          c.COLUMN_DEFAULT,
          CASE WHEN pk.COLUMN_NAME IS NOT NULL THEN 'YES' ELSE 'NO' END AS IS_PRIMARY_KEY,
          fk.REFERENCED_TABLE_NAME,
          fk.REFERENCED_COLUMN_NAME
        FROM INFORMATION_SCHEMA.COLUMNS c
        LEFT JOIN (
          SELECT ku.COLUMN_NAME
          FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
          JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE ku
            ON tc.CONSTRAINT_NAME = ku.CONSTRAINT_NAME
          WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
            AND ku.TABLE_NAME = @table
            AND ku.TABLE_SCHEMA = @schema
        ) pk ON c.COLUMN_NAME = pk.COLUMN_NAME
        LEFT JOIN (
          SELECT
            ccu.COLUMN_NAME,
            kcu2.TABLE_NAME AS REFERENCED_TABLE_NAME,
            kcu2.COLUMN_NAME AS REFERENCED_COLUMN_NAME
          FROM INFORMATION_SCHEMA.CONSTRAINT_COLUMN_USAGE ccu
          JOIN INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS rc
            ON ccu.CONSTRAINT_NAME = rc.CONSTRAINT_NAME
          JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu2
            ON rc.UNIQUE_CONSTRAINT_NAME = kcu2.CONSTRAINT_NAME
          WHERE ccu.TABLE_NAME = @table
            AND ccu.TABLE_SCHEMA = @schema
        ) fk ON c.COLUMN_NAME = fk.COLUMN_NAME
        WHERE c.TABLE_NAME = @table
          AND c.TABLE_SCHEMA = @schema
        ORDER BY c.ORDINAL_POSITION
      `);

    const durationMs = elapsed();

    if (result.recordset.length === 0) {
      logAudit({
        timestamp: new Date().toISOString(),
        tool: getTableSchemaToolName,
        database,
        durationMs,
        rowCount: 0,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: `Table '${schema}.${table}' not found in database '${database}'. Use list_tables to see available tables.`,
          },
        ],
      };
    }

    logAudit({
      timestamp: new Date().toISOString(),
      tool: getTableSchemaToolName,
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
              table: `${schema}.${table}`,
              columnCount: result.recordset.length,
              durationMs,
              columns: result.recordset,
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
      tool: getTableSchemaToolName,
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
