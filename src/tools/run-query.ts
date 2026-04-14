import { z } from "zod";
import { getPool } from "../connection-pool.js";
import { validateQuery } from "../query-validator.js";
import { logAudit, startTimer } from "../logger.js";
import { checkRateLimit } from "../rate-limiter.js";

export const runQueryToolName = "run_query";

export const runQueryDescription =
  "Execute a read-only SQL query against a database. Only SELECT/WITH/DECLARE statements are allowed. Use TOP or WHERE clauses to limit results. Supports pagination via offset.";

export const runQueryParams = {
  database: z
    .string()
    .describe(
      "Database name as defined in databases.json (use list_databases to see available names)"
    ),
  query: z.string().describe("SQL SELECT query to execute. Must be read-only."),
  maxRows: z
    .number()
    .int()
    .min(1)
    .max(500)
    .default(100)
    .describe("Maximum rows to return (default 100, max 500)"),
  offset: z
    .number()
    .int()
    .min(0)
    .default(0)
    .describe("Number of rows to skip for pagination (default 0)"),
};

export async function runQueryHandler({
  database,
  query,
  maxRows,
  offset,
}: {
  database: string;
  query: string;
  maxRows: number;
  offset: number;
}) {
  const elapsed = startTimer();

  // Rate limit check
  const rateCheck = checkRateLimit();
  if (!rateCheck.allowed) {
    logAudit({
      timestamp: new Date().toISOString(),
      tool: runQueryToolName,
      database,
      query,
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

  // Query validation
  const validation = validateQuery(query);
  if (!validation.safe) {
    logAudit({
      timestamp: new Date().toISOString(),
      tool: runQueryToolName,
      database,
      query,
      durationMs: elapsed(),
      blocked: true,
      blockedReason: validation.reason,
    });
    return {
      content: [
        {
          type: "text" as const,
          text: `BLOCKED: ${validation.reason}\n\nOnly read-only queries (SELECT, WITH, DECLARE+SELECT) are allowed.`,
        },
      ],
    };
  }

  const cap = Math.min(maxRows, 500);

  try {
    const pool = await getPool(database);
    const result = await pool.request().query(query);

    const totalRows = result.recordset?.length ?? 0;
    const sliced = result.recordset.slice(offset, offset + cap);
    const hasMore = offset + cap < totalRows;

    const columns = result.recordset.columns
      ? Object.keys(result.recordset.columns)
      : sliced.length > 0
        ? Object.keys(sliced[0])
        : [];

    const durationMs = elapsed();

    logAudit({
      timestamp: new Date().toISOString(),
      tool: runQueryToolName,
      database,
      query,
      durationMs,
      rowCount: totalRows,
    });

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              database,
              totalRows,
              returnedRows: sliced.length,
              offset,
              hasMore,
              nextOffset: hasMore ? offset + cap : null,
              durationMs,
              columns,
              data: sliced,
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
      tool: runQueryToolName,
      database,
      query,
      durationMs,
      error: message,
    });

    return {
      content: [
        {
          type: "text" as const,
          text: `SQL Error on ${database}: ${message}`,
        },
      ],
    };
  }
}
