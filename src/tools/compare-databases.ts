import { z } from "zod";
import { getPool } from "../connection-pool.js";
import { validateQuery } from "../query-validator.js";
import { logAudit, startTimer } from "../logger.js";
import { checkRateLimit } from "../rate-limiter.js";

export const compareDatabasesToolName = "compare_databases";

export const compareDatabasesDescription =
  "Run the same read-only query across multiple databases and compare results side by side. Useful for finding differences or verifying consistency across environments.";

export const compareDatabasesParams = {
  databases: z
    .array(z.string())
    .min(2)
    .describe(
      "Array of database names to compare (e.g., ['myapp-dev', 'myapp-staging', 'myapp-prod'])"
    ),
  query: z
    .string()
    .describe("SQL SELECT query to run on each database"),
  maxRowsPerDatabase: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(20)
    .describe("Max rows to return per database (default 20, max 100)"),
};

export async function compareDatabasesHandler({
  databases,
  query,
  maxRowsPerDatabase,
}: {
  databases: string[];
  query: string;
  maxRowsPerDatabase: number;
}) {
  const elapsed = startTimer();

  const rateCheck = checkRateLimit();
  if (!rateCheck.allowed) {
    logAudit({
      timestamp: new Date().toISOString(),
      tool: compareDatabasesToolName,
      database: databases.join(","),
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

  const validation = validateQuery(query);
  if (!validation.safe) {
    logAudit({
      timestamp: new Date().toISOString(),
      tool: compareDatabasesToolName,
      database: databases.join(","),
      query,
      durationMs: elapsed(),
      blocked: true,
      blockedReason: validation.reason,
    });
    return {
      content: [
        {
          type: "text" as const,
          text: `BLOCKED: ${validation.reason}\n\nOnly read-only queries are allowed.`,
        },
      ],
    };
  }

  const cap = Math.min(maxRowsPerDatabase, 100);
  const results: Record<
    string,
    { rowCount: number; data: unknown[] } | { error: string }
  > = {};

  // Run queries in parallel across databases
  await Promise.allSettled(
    databases.map(async (db) => {
      try {
        const pool = await getPool(db);
        const result = await pool.request().query(query);
        results[db] = {
          rowCount: result.recordset.length,
          data: result.recordset.slice(0, cap),
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Unknown error";
        results[db] = { error: message };
      }
    })
  );

  const durationMs = elapsed();

  logAudit({
    timestamp: new Date().toISOString(),
    tool: compareDatabasesToolName,
    database: databases.join(","),
    query,
    durationMs,
    rowCount: Object.values(results).reduce((sum, r) => {
      return sum + ("rowCount" in r ? r.rowCount : 0);
    }, 0),
  });

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            query,
            databasesQueried: databases.length,
            durationMs,
            results,
          },
          null,
          2
        ),
      },
    ],
  };
}
