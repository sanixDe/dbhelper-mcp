import { z } from "zod";
import sql from "mssql";
import { getPool } from "../connection-pool.js";
import { logAudit, startTimer } from "../logger.js";
import { checkRateLimit } from "../rate-limiter.js";

export const describeStoredProcedureToolName = "describe_stored_procedure";

export const describeStoredProcedureDescription =
  "Get the definition (source code) and parameters of a stored procedure. Useful for understanding data logic that lives in the database.";

export const describeStoredProcedureParams = {
  database: z.string().describe("Database name as defined in databases.json"),
  procedure: z
    .string()
    .describe(
      "Stored procedure name (e.g., 'usp_GetOrderDetails'). Can include schema prefix like 'dbo.usp_GetOrderDetails'."
    ),
};

export async function describeStoredProcedureHandler({
  database,
  procedure,
}: {
  database: string;
  procedure: string;
}) {
  const elapsed = startTimer();

  const rateCheck = checkRateLimit();
  if (!rateCheck.allowed) {
    logAudit({
      timestamp: new Date().toISOString(),
      tool: describeStoredProcedureToolName,
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

    // Get the procedure definition
    const defResult = await pool
      .request()
      .input("proc", sql.NVarChar, procedure).query(`
        SELECT OBJECT_DEFINITION(OBJECT_ID(@proc)) AS Definition
      `);

    // Get the procedure parameters
    const paramResult = await pool
      .request()
      .input("proc", sql.NVarChar, procedure).query(`
        SELECT
          p.name AS ParameterName,
          TYPE_NAME(p.user_type_id) AS DataType,
          p.max_length AS MaxLength,
          p.is_output AS IsOutput,
          p.has_default_value AS HasDefault,
          p.default_value AS DefaultValue
        FROM sys.parameters p
        JOIN sys.procedures sp ON p.object_id = sp.object_id
        WHERE sp.name = @proc
           OR (SCHEMA_NAME(sp.schema_id) + '.' + sp.name) = @proc
        ORDER BY p.parameter_id
      `);

    const definition =
      defResult.recordset[0]?.Definition ?? null;

    const durationMs = elapsed();

    if (!definition) {
      logAudit({
        timestamp: new Date().toISOString(),
        tool: describeStoredProcedureToolName,
        database,
        durationMs,
        rowCount: 0,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: `Stored procedure '${procedure}' not found in database '${database}'. Check the name and try with schema prefix (e.g., 'dbo.${procedure}').`,
          },
        ],
      };
    }

    logAudit({
      timestamp: new Date().toISOString(),
      tool: describeStoredProcedureToolName,
      database,
      durationMs,
      rowCount: paramResult.recordset.length,
    });

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              database,
              procedure,
              parameterCount: paramResult.recordset.length,
              durationMs,
              parameters: paramResult.recordset,
              definition,
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
      tool: describeStoredProcedureToolName,
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
